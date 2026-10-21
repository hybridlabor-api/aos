import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSandboxed, resolveFactorySandbox, runFactoryUnattended } from '../lib/sandbox.mjs';
import { check } from '../bin/go-check.mjs';

const has = (...bins) => (b) => (bins.includes(b) ? `/bin/${b}` : null);

describe('factory sandbox detector (isSandboxed)', () => {
  test('returns true when inside Docker container with marker', () => {
    const ok = isSandboxed({
      env: { AOS_SANDBOX_MARKER: '1' },
      platform: 'linux',
      existsSync: (p) => p === '/.dockerenv',
    });
    assert.equal(ok, true);
  });

  test('returns true when inside Podman container with marker', () => {
    const ok = isSandboxed({
      env: { AOS_SANDBOX_MARKER: 'session-xyz' },
      platform: 'linux',
      existsSync: (p) => p === '/run/.containerenv',
    });
    assert.equal(ok, true);
  });

  test('returns true when inside WSL2 with marker via WSL_DISTRO_NAME', () => {
    const ok = isSandboxed({
      env: { AOS_SANDBOX_MARKER: '1', WSL_DISTRO_NAME: 'Ubuntu-22.04' },
      platform: 'linux',
      existsSync: () => false,
    });
    assert.equal(ok, true);
  });

  test('returns true when inside WSL2 with marker via WSL_INTEROP', () => {
    const ok = isSandboxed({
      env: { AOS_SANDBOX_MARKER: '1', WSL_INTEROP: '/run/WSL/123' },
      platform: 'linux',
      existsSync: () => false,
    });
    assert.equal(ok, true);
  });

  test('returns true when inside WSL2 with marker via /proc/version', () => {
    const ok = isSandboxed({
      env: { AOS_SANDBOX_MARKER: '1' },
      platform: 'linux',
      existsSync: (p) => p === '/proc/version',
      readFileSync: () => 'Linux version 5.15.153.1-microsoft-standard-WSL2 (gcc) #1 SMP',
    });
    assert.equal(ok, true);
  });

  test('returns false when marker is absent in container or VM', () => {
    assert.equal(isSandboxed({ env: {}, existsSync: (p) => p === '/.dockerenv' }), false);
    assert.equal(isSandboxed({ env: {}, existsSync: (p) => p === '/run/.containerenv' }), false);
    assert.equal(isSandboxed({ env: { WSL_DISTRO_NAME: 'Ubuntu' }, platform: 'linux', existsSync: () => false }), false);
  });

  test('env-only on host must NEVER count as sandboxed', () => {
    // macOS host with marker set in env
    assert.equal(
      isSandboxed({
        env: { AOS_SANDBOX_MARKER: '1' },
        platform: 'darwin',
        existsSync: () => false,
      }),
      false,
      'marker on macOS host must not count',
    );

    // Windows host with marker set in env
    assert.equal(
      isSandboxed({
        env: { AOS_SANDBOX_MARKER: '1' },
        platform: 'win32',
        existsSync: () => false,
      }),
      false,
      'marker on Windows host must not count',
    );

    // Standard Linux host with marker set in env (not container, not WSL2)
    assert.equal(
      isSandboxed({
        env: { AOS_SANDBOX_MARKER: '1' },
        platform: 'linux',
        existsSync: (p) => p === '/proc/version',
        readFileSync: () => 'Linux version 6.8.0-generic (buildd@canonical) #45-Ubuntu SMP',
      }),
      false,
      'marker on standard Linux host must not count',
    );
  });

  test('returns false when neither marker nor container is present', () => {
    assert.equal(isSandboxed({ env: {}, platform: 'darwin', existsSync: () => false }), false);
  });
});

describe('factory sandbox runtime resolution (resolveFactorySandbox)', () => {
  describe('macOS platform', () => {
    test('selects docker when available', () => {
      const res = resolveFactorySandbox({ platform: 'darwin', which: has('docker') });
      assert.equal(res.ok, true);
      assert.equal(res.runtime, 'docker');
      assert.equal(res.bin, '/bin/docker');
      const cmd = res.wrap(['factory', 'run'], { cwd: '/workspace' });
      assert.deepEqual(cmd, [
        '/bin/docker',
        'run',
        '-i',
        '--rm',
        '-v',
        '/workspace:/workspace',
        '-w',
        '/workspace',
        '-e',
        'AOS_SANDBOX_MARKER=1',
        'node:24-bookworm',
        'factory',
        'run',
      ]);
    });

    test('selects podman when docker is missing', () => {
      const res = resolveFactorySandbox({ platform: 'darwin', which: has('podman') });
      assert.equal(res.ok, true);
      assert.equal(res.runtime, 'podman');
      assert.equal(res.bin, '/bin/podman');
    });

    test('refuses unattended mode when neither docker nor podman is available', () => {
      const res = resolveFactorySandbox({ platform: 'darwin', which: has() });
      assert.equal(res.ok, false);
      assert.equal(res.runtime, null);
      assert.match(res.message, /Unattended factory runs require a container sandbox/);
      assert.match(res.install, /Docker Desktop/);
      assert.match(res.install, /brew install podman/);
    });
  });

  describe('Linux platform', () => {
    test('selects docker when available', () => {
      const res = resolveFactorySandbox({ platform: 'linux', which: has('docker') });
      assert.equal(res.ok, true);
      assert.equal(res.runtime, 'docker');
    });

    test('selects podman when docker is missing', () => {
      const res = resolveFactorySandbox({ platform: 'linux', which: has('podman') });
      assert.equal(res.ok, true);
      assert.equal(res.runtime, 'podman');
    });

    test('refuses unattended mode when neither docker nor podman is available', () => {
      const res = resolveFactorySandbox({ platform: 'linux', which: has() });
      assert.equal(res.ok, false);
      assert.equal(res.runtime, null);
      assert.match(res.message, /Unattended factory runs require a container sandbox/);
      assert.match(res.install, /apt-get install docker\.io/);
    });
  });

  describe('Windows platform', () => {
    test('selects wsl2 when available', () => {
      const res = resolveFactorySandbox({ platform: 'win32', which: has('wsl.exe') });
      assert.equal(res.ok, true);
      assert.equal(res.runtime, 'wsl2');
      assert.equal(res.bin, '/bin/wsl.exe');
      const cmd = res.wrap(['factory', 'run'], { cwd: 'C:\\workspace' });
      assert.deepEqual(cmd, [
        '/bin/wsl.exe',
        '--cd',
        '/mnt/c/workspace',
        '--exec',
        'env',
        'AOS_SANDBOX_MARKER=1',
        'factory',
        'run',
      ]);
    });

    test('selects docker on Windows when wsl.exe is missing', () => {
      const res = resolveFactorySandbox({ platform: 'win32', which: has('docker.exe') });
      assert.equal(res.ok, true);
      assert.equal(res.runtime, 'docker');
    });

    test('refuses unattended mode when neither wsl2 nor docker is available', () => {
      const res = resolveFactorySandbox({ platform: 'win32', which: has() });
      assert.equal(res.ok, false);
      assert.equal(res.runtime, null);
      assert.match(res.message, /Unattended factory runs require a sandbox runtime/);
      assert.match(res.install, /wsl --install/);
    });
  });

  describe('runFactoryUnattended wrapper', () => {
    test('throws NO_SANDBOX_RUNTIME when no runtime is available', () => {
      assert.throws(
        () => runFactoryUnattended(['factory'], { platform: 'darwin', which: has() }),
        (err) => err.code === 'NO_SANDBOX_RUNTIME' && /Unattended factory runs require a container sandbox/.test(err.message),
      );
    });

    test('wraps command when runtime is available', () => {
      const cmd = runFactoryUnattended(['npm', 'test'], { platform: 'darwin', which: has('docker'), cwd: '/app' });
      assert.equal(cmd[0], '/bin/docker');
      assert.ok(cmd.includes('AOS_SANDBOX_MARKER=1'));
      assert.ok(cmd.includes('npm'));
      assert.ok(cmd.includes('test'));
    });
  });
});

describe('gate integration with sandbox', () => {
  const fakeGate = (isSbx) => ({
    nameKey: (n) => n,
    readBlockTs: () => 0,
    setGateContext: () => {},
    hardBlockReason: (cmd) => (/rm\s+-rf\s+\/($|\s)/.test(cmd) ? 'hard block: cannot delete root' : null),
    commandTooLong: () => false,
    gateStoreReason: () => null,
    isGuardedCommand: (cmd) => /(?:git\s+branch\s+-D|aos-gate\s+grant)/.test(cmd),
    commandScopes: () => ['destructive'],
    neverGrantable: (cmd) => /aos-gate\s+grant/.test(cmd),
    tokenGrantsGo: () => ({ ok: false, reason: 'no GO token' }),
    markBlock: () => {},
    slug: (s) => s,
    isSandboxed: () => isSbx,
  });

  test('inside sandbox: allows guarded command in off mode', () => {
    const res = check(fakeGate(true), { session: 'test-worker', command: 'git branch -D feat' });
    assert.equal(res.code, 0);
    assert.equal(res.out.ok, true);
    assert.equal(res.out.reason, 'sandboxed');
  });

  test('inside sandbox: still blocks neverGrantable commands', () => {
    const res = check(fakeGate(true), { session: 'test-worker', command: 'aos-gate grant push-feature 1h' });
    assert.equal(res.code, 1);
    assert.equal(res.out.ok, false);
    assert.match(res.out.reason, /never grantable/);
  });

  test('inside sandbox: still blocks hard blocks', () => {
    const res = check(fakeGate(true), { session: 'test-worker', command: 'rm -rf /' });
    assert.equal(res.code, 1);
    assert.equal(res.out.ok, false);
    assert.match(res.out.reason, /hard block/);
  });

  test('outside sandbox: guarded command without token is blocked', () => {
    const res = check(fakeGate(false), { session: 'test-worker', command: 'git branch -D feat' });
    assert.equal(res.code, 1);
    assert.equal(res.out.ok, false);
    assert.equal(res.out.reason, 'no GO token');
  });
});
