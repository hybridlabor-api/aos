// Installer v5 core: secrets, versions, packages, menu/update flow. Temp HOME, injected host/npm, no network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-v5-'));
process.env.HOME = root;
process.env.USERPROFILE = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { readSecretsFile, secretsPath } = require('../lib/mcp-secrets');
const secrets = require('../lib/v5/secrets');
const versions = require('../lib/v5/versions');
const menu = require('../lib/v5/menu');
const pk = require('../lib/v5/packages');

const PAT = 'GITHUB_PERSONAL_ACCESS_TOKEN';
const newer = (l, r) => l !== r;
let n = 0;
const mkHome = () => fs.mkdtempSync(path.join(root, `h${n++}-`));
const script = (file, body = 'exit 0') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); };
const pkgJson = (dir, version) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version })); };

// A machine with kernel skills, memB 2.4.0 (healthy venv) and a memb-mcp copy at `copyVersion`.
function machine({ copyVersion = '2.4.0' } = {}) {
    const home = mkHome();
    const base = path.join(home, '.agents');
    const skills = path.join(home, 'skills');
    const mcp = path.join(home, 'gemini-config');
    fs.mkdirSync(path.join(skills, 'startcycle'), { recursive: true });
    const memb = path.join(base, 'memB');
    pkgJson(memb, '2.4.0');
    fs.writeFileSync(path.join(memb, 'requirements.txt'), 'mcp\n');
    script(path.join(memb, '.venv', 'bin', 'python'));
    pkgJson(path.join(mcp, 'mcps', 'memb-mcp'), copyVersion);
    const calls = [];
    const host = {
        calls,
        detectInstallState: () => ({ isInstalled: true, localVersion: '4.0.0', installedModules: ['memb'] }),
        resolveTargetPaths: () => ({ targetSkillDir: skills, targetMcpDir: mcp }),
        moduleBasePath: () => base,
        quickUpdateKernel: () => calls.push('kernel'),
        quickUpdateHarnesses: () => calls.push('harnesses'),
        refreshOpenWikiSilently: async () => false,
        installMemB: async () => { calls.push('installMemB'); return true; },
        installSynapse: async () => true,
        findSynapseBinary: () => null,
        downloadOrUpdateModule: (npm, dir) => { calls.push(`download ${path.basename(dir)}`); pkgJson(dir, '2.4.0'); return true; },
        uvBin: () => 'uv',
        isNewerVersion: newer,
        loadExistingEnv: () => ({}),
        PROVIDER_KEY_ENV_NAMES: {},
        saveManifest: () => calls.push('saveManifest'),
        flushSessionManifest: () => {},
        runUninstaller: () => 0,
    };
    const out = [];
    const opts = (extra = {}) => ({ home, write: (s) => out.push(s), ui: {}, npmView: async () => { throw new Error('offline'); }, ...extra });
    return { home, memb, mcp, host, calls, out, opts };
}
const current = async (name) => ({ '@hybridlabor-api/aos': '4.0.0', '@hybridlabor-api/memb': '2.4.0' }[name] || '1.0.0');

test('second update with stored values never asks', async () => {
    const m = machine();
    const asked = [];
    const first = await menu.update(m.host, m.opts({ npmView: current, ui: { ask: async (k) => { asked.push(k); return 'ghp_secret'; } } }));
    assert.strictEqual(first, 0);
    assert.deepStrictEqual(asked, [PAT]);
    assert.strictEqual(readSecretsFile(secretsPath(m.home)).vars[PAT], 'ghp_secret');

    const second = await menu.update(m.host, m.opts({ npmView: current, ui: { ask: async () => assert.fail('asked again') } }));
    assert.strictEqual(second, 0);
    assert.ok(!m.calls.includes('installMemB'), 'current package is not reinstalled');
    assert.ok(m.out.join('').includes('✔ Kernel') && m.out.join('').includes('✔ memB 2.4.0'));
    assert.ok(m.out.join('').includes('Verify: all ok'));
});

test('update without a TTY (no ui.ask) asks nothing and stores nothing', async () => {
    const m = machine();
    assert.strictEqual(await menu.update(m.host, m.opts({ npmView: current })), 0);
    assert.ok(!fs.existsSync(secretsPath(m.home)));
});

test('blank PAT is remembered as skipped; reask asks again', async () => {
    const home = mkHome();
    let asked = 0;
    const ask = async () => { asked++; return '  '; };
    assert.deepStrictEqual(await secrets.need([PAT], { home, ask }), { [PAT]: '' });
    const r = readSecretsFile(secretsPath(home));
    assert.strictEqual(r.state, 'ok');
    assert.strictEqual(r.vars.AOS_SKIPPED_KEYS, PAT);
    assert.ok(!(PAT in r.vars), 'no placeholder value');
    assert.strictEqual(fs.statSync(secretsPath(home)).mode & 0o777, 0o600);

    await secrets.need([PAT], { home, ask });
    assert.strictEqual(asked, 1, 'not asked on the next run');

    assert.strictEqual(await secrets.reask(PAT, { home, ask: async () => { asked++; return 'tok'; } }), 'tok');
    assert.strictEqual(asked, 2);
    const after = readSecretsFile(secretsPath(home)).vars;
    assert.strictEqual(after[PAT], 'tok');
    assert.ok(!secrets.isSkipped(home, PAT));
});

test('stored and legacy values win over asking', async () => {
    const home = mkHome();
    const ask = async () => assert.fail('asked');
    assert.deepStrictEqual(await secrets.need([PAT], { home, ask, legacy: { [PAT]: 'legacy' } }), { [PAT]: 'legacy' });
    assert.ok(!fs.existsSync(secretsPath(home)), 'legacy is read-only, not copied');
});

test('versions: outdated detected, Update is the default menu entry', async () => {
    const m = machine();
    const rows = await versions.checkAll([{ id: 'memb', npm: '@hybridlabor-api/memb', local: '2.4.0' }], { home: m.home, npmView: async () => '2.5.0', isNewer: newer });
    assert.deepStrictEqual(rows, [{ id: 'memb', local: '2.4.0', remote: '2.5.0', outdated: true }]);

    let initial;
    const ui = { select: async (msg, options, init) => { initial = init; return 'exit'; } };
    await menu.menu(m.host, m.opts({ home: m.home, ui, npmView: async (name) => (name.endsWith('/memb') ? '2.5.0' : '4.0.0') }));
    assert.strictEqual(initial, 'update');

    const m2 = machine();
    await menu.menu(m2.host, m2.opts({ ui, npmView: current }));
    assert.strictEqual(initial, 'status');
});

test('versions: outdated memB is updated then verified; offline stays unknown and never throws', async () => {
    const m = machine();
    const code = await menu.update(m.host, m.opts({ npmView: async (name) => (name.endsWith('/memb') ? '2.5.0' : '4.0.0') }));
    assert.strictEqual(code, 0);
    assert.ok(m.calls.includes('installMemB'));
    assert.ok(m.out.join('').includes('1 update available'));

    const home = mkHome();
    const rows = await versions.checkAll([{ id: 'x', npm: 'x', local: '1.0.0' }], { home, npmView: async () => { throw new Error('ENOTFOUND'); }, isNewer: newer });
    assert.deepStrictEqual(rows, [{ id: 'x', local: '1.0.0', remote: 'unknown', outdated: false }]);
});

test('versions: 24 h cache', async () => {
    const home = mkHome();
    const pkgs = [{ id: 'x', npm: 'x', local: '1.0.0' }];
    await versions.checkAll(pkgs, { home, now: 1000, npmView: async () => '2.0.0', isNewer: newer });
    const dead = async () => { throw new Error('offline'); };
    assert.strictEqual((await versions.checkAll(pkgs, { home, now: 2000, npmView: dead, isNewer: newer }))[0].remote, '2.0.0');
    assert.strictEqual((await versions.checkAll(pkgs, { home, now: 1000 + 25 * 3600 * 1000, npmView: dead, isNewer: newer }))[0].remote, 'unknown');
});

test('memB with a dangling venv python: verify fails, repair renames, recreates, syncs the MCP copy', async () => {
    const m = machine({ copyVersion: '2.3.3' });
    const py = path.join(m.memb, '.venv', 'bin', 'python');
    fs.rmSync(py);
    fs.symlinkSync(path.join(m.home, 'gone', 'python3'), py);
    const c = { host: m.host, home: m.home, run: null };
    const memb = pk.registry.find((p) => p.id === 'memb');
    assert.strictEqual(memb.verify(c).ok, false);

    const venv = { create: (cc, dir) => script(path.join(dir, '.venv', 'bin', 'python')), install: () => {} };
    assert.strictEqual(await menu.repair(m.host, m.opts({ venv })), 0);

    const broken = fs.readdirSync(m.memb).filter((f) => f.startsWith('.venv.broken-'));
    assert.strictEqual(broken.length, 1);
    assert.ok(fs.lstatSync(path.join(m.memb, broken[0], 'bin', 'python')).isSymbolicLink(), 'old venv kept, not deleted');
    assert.deepStrictEqual(memb.verify(c), { ok: true, detail: '2.4.0' });
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(m.mcp, 'mcps', 'memb-mcp', 'package.json'), 'utf8')).version, '2.4.0');
});

test('memB copy out of sync is reported by verify and fixed by the Harnesses step', async () => {
    const m = machine({ copyVersion: '2.3.3' });
    const memb = pk.registry.find((p) => p.id === 'memb');
    assert.match(memb.verify({ host: m.host, home: m.home }).detail, /memb-mcp copy 2\.3\.3 != memB 2\.4\.0/);
    assert.strictEqual(await menu.update(m.host, m.opts({ npmView: current })), 0);
    assert.ok(m.calls.includes('download memb-mcp'));
});

test('aos update without a TTY never falls back to the install wizard', { skip: process.env.AOS_TEST_SANDBOX !== 'container' }, () => {
    const home = mkHome();
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'installer.js'), 'update'], {
        encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home },
    });
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stdout, /not installed/);
    assert.doesNotMatch(r.stdout, /Package Tier|Choose OpenWiki/);
});
