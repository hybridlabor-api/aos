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

function machine({ localKernel = runningVersion, membVersion = '2.4.0' } = {}) {
    const home = mkHome();
    const baseDir = path.join(home, '.agents');
    const skills = path.join(home, 'skills');
    const mcp = path.join(home, 'gemini-config');
    fs.mkdirSync(path.join(skills, 'startcycle'), { recursive: true });
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['gateway', 'openwiki'] }));

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
