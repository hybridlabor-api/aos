// Creator Extension in the v5 update: equal version skips the reinstall, install output goes to the log only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-v5c-'));
process.env.HOME = root;
process.env.USERPROFILE = root;

const menu = require('../lib/v5/menu');
const pk = require('../lib/v5/packages');

const NPM = '@hybridlabor-api/bdb-dev-creator-extension';
const newer = (l, r) => l !== r;
let n = 0;

function machine(installed) {
    const home = fs.mkdtempSync(path.join(root, `h${n++}-`));
    const base = path.join(home, '.agents');
    const skills = path.join(home, 'skills');
    fs.mkdirSync(path.join(skills, 'fabric'), { recursive: true });
    const dir = path.join(base, 'bdb-dev-creator-extension');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: installed }));
    fs.writeFileSync(path.join(dir, 'installer.js'), '');
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['fleet', 'gateway'] }));
    const calls = [];
    const host = {
        calls,
        detectInstallState: () => ({ isInstalled: true, localVersion: '4.0.0', installedModules: [] }),
        resolveTargetPaths: () => ({ targetSkillDir: skills, targetMcpDir: path.join(home, 'gemini-config') }),
        moduleBasePath: () => base,
        quickUpdateKernel: () => {},
        quickUpdateHarnesses: () => {},
        refreshOpenWikiSilently: async () => false,
        installCreatorExtension: async () => { calls.push('installCreatorExtension'); process.stdout.write('RAW-VENV-NOISE\n'); process.stderr.write('RAW-PIP-NOISE\n'); return true; },
        isNewerVersion: newer,
        loadExistingEnv: () => ({}),
        PROVIDER_KEY_ENV_NAMES: {},
        saveManifest: () => {},
        flushSessionManifest: () => {},
    };
    const out = [];
    const logFile = path.join(home, 'update.log');
    const npmView = async (name) => (name === NPM ? remote.v : '4.0.0');
    const opts = { home, write: (s) => out.push(s), ui: {}, npmView, logFile };
    return { host, calls, out, opts, logFile, home };
}
const remote = { v: '1.0.0' };

async function runUpdate(m) {
    const seen = [];
    const o = process.stdout.write;
    const e = process.stderr.write;
    process.stdout.write = (c, ...r) => { seen.push(String(c)); return o.call(process.stdout, c, ...r); };
    process.stderr.write = (c, ...r) => { seen.push(String(c)); return e.call(process.stderr, c, ...r); };
    try { await menu.update(m.host, m.opts); } finally { process.stdout.write = o; process.stderr.write = e; }
    return seen.join('');
}

test('equal version: update does not call installCreatorExtension', async () => {
    remote.v = '1.0.0';
    const m = machine('1.0.0');
    await runUpdate(m);
    assert.deepStrictEqual(m.calls, []);
});

test('older version: installCreatorExtension runs once and its output is only in the log', async () => {
    remote.v = '1.1.0';
    const m = machine('1.0.0');
    const leaked = await runUpdate(m);
    assert.deepStrictEqual(m.calls, ['installCreatorExtension']);
    assert.doesNotMatch(leaked + m.out.join(''), /RAW-VENV-NOISE|RAW-PIP-NOISE/);
    const log = fs.readFileSync(m.logFile, 'utf8');
    assert.match(log, /RAW-VENV-NOISE/);
    assert.match(log, /RAW-PIP-NOISE/);
});

test('adapter update: equal target skips, older target and missing target install', async () => {
    const creator = pk.registry.find((p) => p.id === 'creator');
    const eq = machine('2.0.0');
    await creator.update({ host: eq.host, home: eq.home, target: '2.0.0' });
    assert.deepStrictEqual(eq.calls, []);
    await creator.update({ host: eq.host, home: eq.home, target: '2.1.0' });
    assert.deepStrictEqual(eq.calls, ['installCreatorExtension']);
    await creator.update({ host: eq.host, home: eq.home });
    assert.strictEqual(eq.calls.length, 2);
});

test('adapter update: equal version but broken install (no installer.js) still reinstalls', async () => {
    const creator = pk.registry.find((p) => p.id === 'creator');
    const m = machine('2.0.0');
    fs.unlinkSync(path.join(m.home, '.agents', 'bdb-dev-creator-extension', 'installer.js'));
    await creator.update({ host: m.host, home: m.home, target: '2.0.0' });
    assert.deepStrictEqual(m.calls, ['installCreatorExtension']);
});
