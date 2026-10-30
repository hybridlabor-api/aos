// Audit updates-tail: `aos update` also prints (a) the global-npm shadow hint (P0-1) and
// (b) the Login Items hint for com.bdb.* LaunchAgents installed but not loaded (P0-3 rest).
// Same host/adapter shape as tests/menu-update-plan.test.js; both hints are injected, so the
// real npm and real launchctl are never touched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-hints-'));
process.env.HOME = testRoot;
process.env.USERPROFILE = testRoot;
process.env.AOS_TEST_SANDBOX = '1';
test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

const menu = require('../lib/v5/menu');
const runningVersion = require('../package.json').version;

let n = 0;
const mkHome = () => fs.mkdtempSync(path.join(testRoot, `h${n++}-`));
const script = (file, body = 'exit 0') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); };
const pkgJson = (dir, version) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version })); };

function machine({ localKernel = runningVersion, membVersion = '2.4.0' } = {}) {
    const home = mkHome();
    const baseDir = path.join(home, '.agents');
    const skills = path.join(home, 'skills');
    const mcp = path.join(home, 'gemini-config');
    fs.mkdirSync(path.join(skills, 'fabric'), { recursive: true });
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['gateway', 'openwiki', 'deja'] }));

    const membDir = path.join(baseDir, 'memB');
    pkgJson(membDir, membVersion);
    fs.writeFileSync(path.join(membDir, 'requirements.txt'), 'mcp\n');
    script(path.join(membDir, '.venv', 'bin', 'python'));
    pkgJson(path.join(mcp, 'mcps', 'memb-mcp'), membVersion);

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
        downloadOrUpdateModule: () => { calls.push('download'); return true; },
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

test('update prints the removal command for a global npm install of the package, and removes nothing', async () => {
    const m = machine();
    const root = mkHome(); // reused as a fake npm global root
    pkgJson(path.join(root, '@hybridlabor-api', 'aos'), '3.2.1');
    try {
        const code = await menu.update(m.host, m.opts({ npmGlobalRun: () => root }));
        assert.strictEqual(code, 0);
        assert.match(m.text(), /npm uninstall -g @hybridlabor-api\/aos/);
        assert.match(m.text(), /older than the installed v/);
        assert.ok(!m.calls.some((c) => typeof c === 'string' && /uninstall/.test(c)), 'AOS never removes the package itself');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('update prints the Login Items hint when a com.bdb.* agent is installed but not loaded', { skip: process.platform !== 'darwin' && 'macOS only' }, async () => {
    const m = machine();
    const dir = path.join(m.home, 'Library', 'LaunchAgents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'com.bdb.memB-webui.plist'), '<plist/>');
    const probed = [];
    const code = await menu.update(m.host, m.opts({
        btmRun: (cmd, args) => { probed.push([cmd, ...args]); return { status: 1 }; },
    }));
    assert.strictEqual(code, 0);
    assert.ok(probed.some(([c, a]) => c === 'launchctl' && a.includes('com.bdb.memB-webui')), 'launchctl print is the only command used');
    assert.match(m.text(), /LaunchAgent com\.bdb\.memB-webui/);
    assert.match(m.text(), /System Settings > General > Login Items/);
});

test('a loaded agent prints no hint, and nothing is loaded or unloaded by AOS', { skip: process.platform !== 'darwin' && 'macOS only' }, async () => {
    const m = machine();
    const dir = path.join(m.home, 'Library', 'LaunchAgents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'com.bdb.gateway.plist'), '<plist/>');
    const code = await menu.update(m.host, m.opts({ btmRun: () => ({ status: 0 }) }));
    assert.strictEqual(code, 0);
    assert.doesNotMatch(m.text(), /LaunchAgent com\.bdb\.gateway/);
});

test('npm missing or offline: no npm-global hint, update still succeeds', async () => {
    const m = machine();
    const code = await menu.update(m.host, m.opts({ npmGlobalRun: () => { throw new Error('offline'); } }));
    assert.strictEqual(code, 0);
    assert.doesNotMatch(m.text(), /npm uninstall -g/);
});

test('dry-run beta update with a newer stable version does not switch channels or spawn', async () => {
    const m = machine({ localKernel: `${runningVersion}-beta.1` });
    const childProcess = require('child_process');
    const originalSpawnSync = childProcess.spawnSync;
    const spawned = [];
    childProcess.spawnSync = (...args) => { spawned.push(args); return { status: 0 }; };
    try {
        const code = await menu.update(m.host, m.opts({
            dryRun: true,
            argv: ['--dry-run'],
            npmView: async (name) => name.endsWith('/aos') ? runningVersion : '2.4.0',
        }));
        assert.ok(Number.isInteger(code));
        assert.deepStrictEqual(spawned, []);
        assert.doesNotMatch(m.text(), /Switching channel to latest/);
    } finally {
        childProcess.spawnSync = originalSpawnSync;
    }
});
