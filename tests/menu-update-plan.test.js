// Tests for Task 4: planUpdate() diff-based plan and update gating.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-plan-test-'));
process.env.HOME = root;
process.env.USERPROFILE = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const menu = require('../lib/v5/menu');
const pk = require('../lib/v5/packages');

const runningVersion = require('../package.json').version;
let n = 0;
const mkHome = () => fs.mkdtempSync(path.join(root, `h${n++}-`));
const script = (file, body = 'exit 0') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); };
const pkgJson = (dir, version) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version })); };

function isNewer(local, remote) {
    if (!local || !remote) return false;
    const l = local.split('-')[0].split('.').map(Number);
    const r = remote.split('-')[0].split('.').map(Number);
    for (let i = 0; i < Math.max(l.length, r.length); i++) {
        const lv = l[i] || 0, rv = r[i] || 0;
        if (rv > lv) return true;
        if (lv > rv) return false;
    }
    return false;
}

function machine({ localKernel = runningVersion, membVersion = '2.4.0', hub = false } = {}) {
    const home = mkHome();
    const baseDir = path.join(home, '.agents');
    const skills = path.join(home, 'skills');
    const mcp = path.join(home, 'gemini-config');
    fs.mkdirSync(path.join(skills, 'fabric'), { recursive: true });
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['gateway', 'openwiki', 'deja', ...(hub ? [] : ['hub'])] }));

    const membDir = path.join(baseDir, 'memB');
    pkgJson(membDir, membVersion);
    fs.writeFileSync(path.join(membDir, 'requirements.txt'), 'mcp\n');
    script(path.join(membDir, '.venv', 'bin', 'python'));
    pkgJson(path.join(mcp, 'mcps', 'memb-mcp'), membVersion);

    const calls = [];
    const host = {
        calls,
        detectInstallState: () => ({ isInstalled: true, localVersion: localKernel, installedModules: ['memb'] }),
        resolveTargetPaths: () => ({ targetSkillDir: skills, targetMcpDir: mcp }),
        moduleBasePath: () => baseDir,
        quickUpdateKernel: () => { calls.push('quickUpdateKernel'); return []; },
        quickUpdateHarnesses: () => { calls.push('quickUpdateHarnesses'); return []; },
        refreshOpenWikiSilently: async () => false,
        installMemB: async () => { calls.push('installMemB'); return true; },
        installSynapse: async () => { calls.push('installSynapse'); return true; },
        installDeja: async () => { calls.push('installDeja'); return true; },
        findSynapseBinary: () => null,
        downloadOrUpdateModule: (npm, dir) => { calls.push(`download ${path.basename(dir)}`); return true; },
        uvBin: () => 'uv',
        isNewerVersion: isNewer,
        loadExistingEnv: () => ({}),
        PROVIDER_KEY_ENV_NAMES: {},
        saveManifest: () => calls.push('saveManifest'),
        flushSessionManifest: () => calls.push('flushSessionManifest'),
    };
    const out = [];
    const opts = (overrides = {}) => ({
        home,
        write: (s) => out.push(s),
        logFile: path.join(home, 'test.log'),
        npmView: async (name) => {
            if (name.endsWith('/memb')) return membVersion;
            if (name.endsWith('/aos')) return localKernel;
            return '1.0.0';
        },
        ...overrides,
    });
    return { host, home, calls, out, opts, text: () => out.join('') };
}

test('planUpdate returns planned items with status and reason', async () => {
    const m = machine({ membVersion: '2.4.0' });
    const plan = await menu.planUpdate(m.host, m.opts());
    assert.ok(Array.isArray(plan));

    const kernel = plan.find((p) => p.id === 'kernel');
    assert.ok(kernel, 'plan includes kernel');
    assert.strictEqual(kernel.changed, false, 'kernel is unchanged when local == running');

    const harnesses = plan.find((p) => p.id === 'harnesses');
    assert.ok(harnesses, 'plan includes harnesses');
    assert.strictEqual(harnesses.changed, false, 'harnesses is unchanged when kernel is unchanged');

    const memb = plan.find((p) => p.id === 'memb');
    assert.ok(memb, 'plan includes memb');
    assert.strictEqual(memb.changed, false, 'memb is unchanged when local == remote');
});

test('planUpdate marks outdated package as changed', async () => {
    const m = machine({ membVersion: '2.4.0' });
    const plan = await menu.planUpdate(m.host, m.opts({
        npmView: async (name) => {
            if (name.endsWith('/memb')) return '2.5.0';
            if (name.endsWith('/aos')) return runningVersion;
            return '1.0.0';
        },
    }));
    const memb = plan.find((p) => p.id === 'memb');
    assert.ok(memb);
    assert.strictEqual(memb.changed, true);
    assert.strictEqual(memb.reason, '2.4.0 -> 2.5.0');
});

test('update skips kernel and harnesses when all components are up to date', async () => {
    const m = machine({ localKernel: runningVersion, membVersion: '2.4.0' });
    const code = await menu.update(m.host, m.opts());
    assert.strictEqual(code, 0);

    // Assert kernel and harnesses were NOT executed
    assert.ok(!m.calls.includes('quickUpdateKernel'), 'quickUpdateKernel should be skipped');
    assert.ok(!m.calls.includes('quickUpdateHarnesses'), 'quickUpdateHarnesses should be skipped');
    assert.ok(!m.calls.includes('installMemB'), 'installMemB should be skipped');
    assert.ok(m.calls.includes('flushSessionManifest'), 'session manifest should be flushed');
});

test('update runs only the planned package when a package is outdated', async () => {
    const m = machine({ localKernel: runningVersion, membVersion: '2.4.0' });
    const code = await menu.update(m.host, m.opts({
        npmView: async (name) => {
            if (name.endsWith('/memb')) return '2.5.0';
            if (name.endsWith('/aos')) return runningVersion;
            return '1.0.0';
        },
    }));
    assert.strictEqual(code, 0);

    // Kernel & Harnesses stay skipped
    assert.ok(!m.calls.includes('quickUpdateKernel'), 'quickUpdateKernel should be skipped');
    assert.ok(!m.calls.includes('quickUpdateHarnesses'), 'quickUpdateHarnesses should be skipped');

    // Only memb was updated
    assert.ok(m.calls.includes('installMemB'), 'installMemB should be called');
});

test('equal version with modified shipped file detected as drift and repaired', async () => {
    const m = machine({ localKernel: runningVersion, membVersion: '2.4.0' });
    const shippedFile = path.join(m.home, '.agents', 'test-shipped.txt');
    fs.writeFileSync(shippedFile, 'modified-content');
    const manifestPath = path.join(m.home, '.agents', '.bdb-install-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
        [shippedFile]: { path: shippedFile, sha256: 'original-different-sha256', version: runningVersion }
    }));

    const plan = await menu.planUpdate(m.host, m.opts());
    const kernel = plan.find((p) => p.id === 'kernel');
    assert.ok(kernel);
    assert.strictEqual(kernel.changed, true, 'kernel flagged changed due to drift');
    assert.strictEqual(kernel.reason, 'modified test-shipped.txt');

    const code = await menu.update(m.host, m.opts());
    assert.strictEqual(code, 0);
    assert.ok(m.calls.includes('quickUpdateKernel'), 'quickUpdateKernel called to repair drift');
    assert.ok(m.calls.includes('quickUpdateHarnesses'), 'quickUpdateHarnesses called');
});

test('manifest entries of older releases and outside HOME never count as drift', async () => {
    const m = machine({ localKernel: runningVersion, membVersion: '2.4.0' });
    const stale = path.join(m.home, '.agents', 'old-release.txt');
    fs.writeFileSync(stale, 'changed');
    const outside = path.join(os.tmpdir(), 'aos-no-such-sandbox', 'gone.md');
    fs.writeFileSync(path.join(m.home, '.agents', '.bdb-install-manifest.json'), JSON.stringify({
        [stale]: { path: stale, sha256: 'other', version: '4.18.1' },
        [outside]: { path: outside, sha256: 'other', version: runningVersion },
    }));
    const plan = await menu.planUpdate(m.host, m.opts());
    assert.strictEqual(plan.find((p) => p.id === 'kernel').changed, false);
});

test('failed earlier run is retried even if versions match', async () => {
    const m = machine({ localKernel: runningVersion, membVersion: '2.4.0' });
    const settingsPath = path.join(m.home, '.aos', 'v5-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ disabled: ['gateway', 'openwiki', 'hub'], lastRunFailed: true }));

    const plan = await menu.planUpdate(m.host, m.opts());
    const kernel = plan.find((p) => p.id === 'kernel');
    assert.ok(kernel);
    assert.strictEqual(kernel.changed, true, 'kernel flagged changed due to previous failure');
    assert.strictEqual(kernel.reason, 'retrying failed run');

    const code = await menu.update(m.host, m.opts());
    assert.strictEqual(code, 0);
    assert.ok(m.calls.includes('quickUpdateKernel'), 'quickUpdateKernel retried');

    // After clean update, lastRunFailed should be reset to false
    const afterSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.strictEqual(afterSettings.lastRunFailed, false, 'lastRunFailed cleared after success');
});

test('force flag forces re-update of all components', async () => {
    const m = machine({ localKernel: runningVersion, membVersion: '2.4.0' });
    const plan = await menu.planUpdate(m.host, m.opts({ force: true }));

    const kernel = plan.find((p) => p.id === 'kernel');
    assert.strictEqual(kernel.changed, true);
    assert.strictEqual(kernel.reason, 'forced');

    const harnesses = plan.find((p) => p.id === 'harnesses');
    assert.strictEqual(harnesses.changed, true);
    assert.strictEqual(harnesses.reason, 'forced');

    const memb = plan.find((p) => p.id === 'memb');
    assert.strictEqual(memb.changed, true);
    assert.strictEqual(memb.reason, 'forced');

    const code = await menu.update(m.host, m.opts({ force: true }));
    assert.strictEqual(code, 0);
    assert.ok(m.calls.includes('quickUpdateKernel'), 'kernel executed when forced');
    assert.ok(m.calls.includes('quickUpdateHarnesses'), 'harnesses executed when forced');
    assert.ok(m.calls.includes('installMemB'), 'memb executed when forced');
});

test('gateway and hub re-apply when kernel or harness is updated', async () => {
    const m = machine({ localKernel: '5.2.0', membVersion: '2.4.0' });
    // Enable gateway and hub in settings (remove from disabled list)
    fs.writeFileSync(path.join(m.home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['openwiki'] }));

    const plan = await menu.planUpdate(m.host, m.opts());
    const kernel = plan.find((p) => p.id === 'kernel');
    assert.strictEqual(kernel.changed, true);

    const gateway = plan.find((p) => p.id === 'gateway');
    if (gateway) {
        assert.strictEqual(gateway.changed, true, 'gateway planned for re-apply when kernel updated');
        assert.strictEqual(gateway.reason, 'kernel/harnesses updated');
    }

    const hub = plan.find((p) => p.id === 'hub');
    if (hub) {
        assert.strictEqual(hub.changed, true, 'hub planned for re-apply when kernel updated');
        // not installed in this fake machine: planned as the default supervisor install, not as a re-apply
        assert.match(hub.reason, /kernel\/harnesses updated|not installed \(default supervisor\)/);
    }
});

test('failed step in lastFailedSteps is retried by repair although verify passes, and cleared after success', async () => {
    const m = machine({ localKernel: runningVersion, membVersion: '2.4.0' });
    const settingsPath = path.join(m.home, '.aos', 'v5-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
        disabled: ['gateway', 'openwiki', 'deja'],
        lastRunFailed: true,
        lastFailedSteps: ['memb'],
    }));

    const code = await menu.repair(m.host, m.opts());
    assert.strictEqual(code, 0);

    // memb should have been updated/retried despite verify passing
    assert.ok(m.calls.includes('installMemB'), 'installMemB called because memb was in lastFailedSteps');

    // After clean repair, lastRunFailed and lastFailedSteps cleared
    const afterSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.strictEqual(afterSettings.lastRunFailed, false, 'lastRunFailed cleared after success');
    assert.deepStrictEqual(afterSettings.lastFailedSteps, [], 'lastFailedSteps cleared after success');
});

test('update records failed step ids in lastFailedSteps', async () => {
    const m = machine({ localKernel: runningVersion, membVersion: '2.4.0' });
    m.host.installMemB = async () => { throw new Error('lock error'); };
    const settingsPath = path.join(m.home, '.aos', 'v5-settings.json');

    const code = await menu.update(m.host, m.opts({
        npmView: async (name) => {
            if (name.endsWith('/memb')) return '2.5.0';
            if (name.endsWith('/aos')) return runningVersion;
            return '1.0.0';
        },
    }));
    assert.strictEqual(code, 1);

    const afterSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.strictEqual(afterSettings.lastRunFailed, true);
    assert.ok(Array.isArray(afterSettings.lastFailedSteps));
    assert.ok(afterSettings.lastFailedSteps.includes('memb'));
});

test('Everything is current appears only for an empty plan', async () => {
    // 1. Plan with changes: Everything is current is NOT printed
    const m1 = machine({ localKernel: runningVersion, membVersion: '2.4.0' });
    const settingsPath = path.join(m1.home, '.aos', 'v5-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ disabled: ['gateway', 'openwiki', 'deja'], lastRunFailed: true }));

    await menu.update(m1.host, m1.opts());
    const text1 = m1.text();
    assert.ok(!text1.includes('Everything is current'), 'Everything is current should not appear when plan has changes');
    assert.ok(text1.includes('Plan:'), 'Plan line should appear');

    // 2. Empty plan: Everything is current IS printed
    const m2 = machine({ localKernel: runningVersion, membVersion: '2.4.0' });
    await menu.update(m2.host, m2.opts());
    const text2 = m2.text();
    assert.ok(text2.includes('Everything is current'), 'Everything is current should appear when plan is empty');
    assert.ok(!text2.includes('Plan:'), 'Plan line should not appear');
});

test('sanitizeSettings accepts valid package ids plus kernel and harnesses for lastFailedSteps', () => {
    const profile = require('../lib/v5/profile');
    const { settings, problems } = profile.sanitizeSettings({
        lastFailedSteps: ['kernel', 'harnesses', 'memb', 'not-a-real-package', 123],
    });
    assert.deepStrictEqual(settings.lastFailedSteps, ['kernel', 'harnesses', 'memb']);
    assert.strictEqual(problems.length, 1);
});


test('planUpdate adds the hub supervisor when it is not installed, unless disabled or profile minimal', async () => {
    const m = machine({ hub: true });
    const plan = await menu.planUpdate(m.host, m.opts());
    const hub = plan.find((p) => p.id === 'hub');
    assert.ok(hub, 'plan includes hub');
    assert.strictEqual(hub.changed, true);

    const off = machine();
    fs.writeFileSync(path.join(off.home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['hub'] }));
    assert.ok(!(await menu.planUpdate(off.host, off.opts())).some((p) => p.id === 'hub'));

    const min = machine();
    fs.writeFileSync(path.join(min.home, '.aos', 'v5-settings.json'), JSON.stringify({ profile: 'minimal' }));
    assert.ok(!(await menu.planUpdate(min.host, min.opts())).some((p) => p.id === 'hub'));
});

test('update prints the one-line supervisor notice and installs the hub service for an existing install', async () => {
    const m = machine({ hub: true });
    await menu.update(m.host, m.opts({ serviceRunner: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }) }));
    assert.match(m.text(), /Supervisor: installing the AOS Hub service/);
    assert.match(m.text(), /AOS Hub/);
});

test('update leaves the hub alone when the user disabled it', async () => {
    const m = machine();
    await menu.update(m.host, m.opts());
    assert.doesNotMatch(m.text(), /Supervisor: installing/);
});
