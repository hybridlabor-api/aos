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

// ---- Package adapter tests (remote, ao, creator, hardware, installer, deja, token-saver, codenotch) ----

test('package adapters detect when installed', () => {
    const m = machine();
    const adapters = ['remote', 'ao', 'creator', 'hardware', 'installer'];
    for (const id of adapters) {
        const pkg = pk.registry.find((p) => p.id === id);
        pkgJson(path.join(m.home, '.agents', id === 'ao' ? 'bdb-agent-orchestrator' : `bdb-${id === 'remote' ? 'os-remote' : id === 'creator' ? 'dev-creator-extension' : id === 'hardware' ? 'hardware-pcb' : 'dev-tool-installer'}`), '1.0.0');
        const d = pkg.detect({ host: m.host, home: m.home });
        assert.strictEqual(d.installed, true, `${id} detect should find installed`);
        assert.strictEqual(d.version, '1.0.0', `${id} detect should read version`);
    }
});

test('package adapters detect when not installed', () => {
    const m = machine();
    const adapters = ['remote', 'ao', 'creator', 'hardware', 'installer'];
    for (const id of adapters) {
        const pkg = pk.registry.find((p) => p.id === id);
        const d = pkg.detect({ host: m.host, home: m.home });
        assert.strictEqual(d.installed, false, `${id} detect should not find installed`);
        assert.strictEqual(d.version, null, `${id} detect should have null version`);
    }
});

const withPath = (dir, fn) => { const prev = process.env.PATH; process.env.PATH = dir; try { return fn(); } finally { process.env.PATH = prev; } };

test('T30: deja detect is PATH-isolated (passes on a machine that has deja)', () => {
    const deja = pk.registry.find((p) => p.id === 'deja');
    const empty = path.join(mkHome(), 'empty');
    fs.mkdirSync(empty);
    assert.strictEqual(withPath(empty, () => deja.detect()).installed, false, 'not on PATH');

    const bin = path.join(mkHome(), 'bin');
    script(path.join(bin, 'deja'), 'echo "deja 0.21.1"');
    assert.deepStrictEqual(withPath(bin, () => deja.detect()), { installed: true, version: '0.21.1' });
});

test('codenotch detect when not installed', () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
        // Skip on unsupported platforms
        return;
    }
    const codenotch = pk.registry.find((p) => p.id === 'codenotch');
    const d = codenotch.detect();
    // May or may not be installed on the test machine; just test it doesn't crash
    assert.ok(typeof d.installed === 'boolean');
});

test('T29: remote verify runs `remote --version` (fake binary fails on any other argument)', () => {
    const m = machine();
    const pkg = pk.registry.find((p) => p.id === 'remote');
    const bin = path.join(mkHome(), 'bin');
    const log = path.join(mkHome(), 'args.txt');
    script(path.join(bin, 'remote'), `echo "$@" > "${log}"\n[ "$1" = "--version" ] || exit 1`);
    assert.strictEqual(withPath(bin, () => pkg.verify({ host: m.host, home: m.home })).ok, true);
    assert.strictEqual(fs.readFileSync(log, 'utf8').trim(), '--version');

    const empty = path.join(mkHome(), 'empty');
    fs.mkdirSync(empty);
    assert.strictEqual(withPath(empty, () => pkg.verify({ host: m.host, home: m.home })).ok, false);
});

test('memB verify detects import run failure in memb-mcp', () => {
    const m = machine();
    const memb = pk.registry.find((p) => p.id === 'memb');
    // Create a memb-mcp directory with a working python but missing run module
    const mcpDir = path.join(m.mcp, 'mcps', 'memb-mcp');
    pkgJson(mcpDir, '2.4.0');
    script(path.join(mcpDir, '.venv', 'bin', 'python'), 'exit 1'); // exit 1 on "import run" test
    const result = memb.verify({ host: m.host, home: m.home });
    assert.strictEqual(result.ok, false);
    assert.match(result.detail, /import run fails/);
});

test('token-saver verify checks CLI and hook registration', () => {
    const pkg = pk.registry.find((p) => p.id === 'token-saver');
    const cases = [
        { name: 'ok', cli: 'exit 0', hook: true, ok: true },
        { name: 'missing CLI', cli: null, hook: true, ok: false, re: /CLI missing/ },
        { name: 'CLI exit 1', cli: 'exit 1', hook: true, ok: false, re: /CLI failed \(exit 1\)/ },
        { name: 'missing hook', cli: 'exit 0', hook: false, ok: false, re: /hook not registered in .*settings\.json/ },
    ];
    for (const t of cases) {
        const home = mkHome();
        const bin = path.join(home, 'bin');
        fs.mkdirSync(bin, { recursive: true });
        if (t.cli) script(path.join(bin, 'token-saver'), t.cli);
        const settings = path.join(home, '.claude', 'settings.json');
        fs.mkdirSync(path.dirname(settings), { recursive: true });
        fs.writeFileSync(settings, JSON.stringify({ enabledPlugins: t.hook ? { 'token-saver@token-saver-marketplace': true } : {} }));
        const result = pkg.verify({ home, env: { PATH: bin } });
        assert.strictEqual(result.ok, t.ok, `${t.name}: ${result.detail}`);
        if (t.re) assert.match(result.detail, t.re, t.name);
    }
});

test('A1: a failing harness or kernel step is shown as ✖ and update exits non-zero', async () => {
    const m = machine();
    m.host.quickUpdateHarnesses = () => ['install the Codex plugin: boom'];
    assert.strictEqual(await menu.update(m.host, m.opts({ npmView: current })), 1);
    assert.match(m.out.join(''), /✖ Harnesses/);

    const k = machine();
    k.host.quickUpdateKernel = () => ['plugin migration: boom'];
    assert.strictEqual(await menu.update(k.host, k.opts({ npmView: current })), 1);
    assert.match(k.out.join(''), /✖ Kernel/);
});

test('A2: an installer that returns false makes Settings -> Install fail with ✖', async () => {
    const m = machine();
    m.host.installOSRemoteGateway = async () => false;
    const ui = { select: async () => 'pkg:remote' };
    assert.strictEqual(await menu.settings(m.host, m.opts({ ui })), 1);
    assert.match(m.out.join(''), /✖ BDB OS Remote/);
    for (const id of ['remote', 'ao', 'creator', 'hardware', 'installer', 'deja', 'token-saver', 'codenotch']) {
        const host = { installOSRemoteGateway: async () => false, installOSAgentWorkspace: async () => false, installCreatorExtension: async () => false, installHardwarePcb: async () => false, installDevToolInstaller: async () => false, installDeja: async () => false, installTokenSaver: async () => false, maybeInstallCodenotch: async () => false };
        const p = pk.registry.find((x) => x.id === id);
        await assert.rejects(() => p.install({ host, home: m.home }), /reported a failure/, `${id} install`);
        await assert.rejects(() => p.update({ host, home: m.home }), /reported a failure/, `${id} update`);
    }
});

test('B11: step() disables prompts and restores the previous value', async () => {
    const { step } = require('../lib/v5/run');
    const calls = [];
    const clack = { text: async () => calls.push('text'), password: async () => calls.push('password'), select: async () => calls.push('select'), multiselect: async () => calls.push('multi'), confirm: async () => calls.push('confirm') };
    const p = require('../lib/v5/noprompt')(clack);
    delete process.env.AOS_NONINTERACTIVE;
    let seen;
    await step('x', async () => {
        seen = [await p.confirm({ message: 'm' }), await p.confirm({ message: 'm', initialValue: false }), await p.password({ message: 'k' }), await p.select({ message: 's', options: [{ value: 'a' }] })];
    }, { logFile: path.join(mkHome(), 'l.log'), out: () => {} });
    assert.deepStrictEqual(seen, [true, false, '', 'a']);
    assert.deepStrictEqual(calls, [], 'no prompt reached inside step');
    assert.strictEqual(process.env.AOS_NONINTERACTIVE, undefined);
    await p.confirm({ message: 'outside' });
    assert.deepStrictEqual(calls, ['confirm'], 'prompts work again outside step');
});

test('A3: memB WebUI LaunchAgent exit status is parsed from real `launchctl list <label>` text', () => {
    const m = machine();
    const memb = pk.registry.find((p) => p.id === 'memb');
    const sample = (status) => `{\n\t"LimitLoadToSessionType" = "Aqua";\n\t"Label" = "com.bdb.memb.webui";\n\t"OnDemand" = false;\n\t"LastExitStatus" = ${status};\n\t"PID" = 4242;\n\t"Program" = "/usr/bin/python3";\n};\n`;
    const bad = memb.verify({ host: m.host, home: m.home, launchctl: () => ({ status: 0, stdout: sample(256) }) });
    assert.strictEqual(bad.ok, false);
    assert.match(bad.detail, /WebUI LaunchAgent last exit status: 256/);
    assert.strictEqual(memb.verify({ host: m.host, home: m.home, launchctl: () => ({ status: 0, stdout: sample(0) }) }).ok, true);
    assert.strictEqual(memb.verify({ host: m.host, home: m.home, launchctl: () => ({ status: 113, stdout: '' }) }).ok, true, 'agent not loaded is not a failure here');
});

test('A4: memB repair reinstalls requirements when a runnable venv fails `import mcp`', async () => {
    const m = machine();
    const flag = path.join(m.home, 'mcp-installed');
    script(path.join(m.memb, '.venv', 'bin', 'python'), `[ "$2" = "import mcp" ] && [ ! -f "${flag}" ] && exit 1\nexit 0`);
    const memb = pk.registry.find((p) => p.id === 'memb');
    const c = { host: m.host, home: m.home };
    assert.match(memb.verify(c).detail, /import mcp fails/);
    const installed = [];
    const venv = { create: () => assert.fail('venv is runnable, must not be recreated'), install: (cc, dir) => { installed.push(dir); fs.writeFileSync(flag, ''); } };
    assert.strictEqual(await menu.repair(m.host, m.opts({ venv })), 0);
    assert.deepStrictEqual(installed, [m.memb]);
    assert.strictEqual(fs.readdirSync(m.memb).filter((f) => f.startsWith('.venv.broken-')).length, 0);
});

test('A5: a package without repair gets one retry via update() when verify fails', async () => {
    const m = machine();
    let fixed = false;
    let updates = 0;
    const fake = pk.register({
        id: 'fake-a5', name: 'FakeA5', npm: null,
        detect: () => ({ installed: true, version: '1.0.0' }),
        update: async () => { updates++; fixed = true; },
        verify: () => (fixed ? { ok: true, detail: '' } : { ok: false, detail: 'broken' }),
    });
    try {
        assert.strictEqual(await menu.repair(m.host, m.opts()), 0);
        assert.strictEqual(updates, 1);
        fixed = false;
        updates = 0;
        assert.strictEqual(await menu.update(m.host, m.opts({ npmView: current })), 0);
        assert.strictEqual(updates, 1);
        fake.update = async () => { updates++; };
        fixed = false;
        assert.strictEqual(await menu.repair(m.host, m.opts()), 1, 'still broken after the retry');
    } finally { pk.registry.splice(pk.registry.indexOf(fake), 1); }
});

test('A6: token-saver detect finds the CLI on PATH, ~/.token-saver, or the enabled plugin', () => {
    const ts = pk.registry.find((p) => p.id === 'token-saver');
    const empty = path.join(mkHome(), 'empty');
    fs.mkdirSync(empty);
    assert.strictEqual(ts.detect({ home: mkHome(), env: { PATH: empty } }).installed, false);

    const onPath = mkHome();
    script(path.join(onPath, 'bin', 'token-saver'));
    assert.strictEqual(ts.detect({ home: mkHome(), env: { PATH: path.join(onPath, 'bin') } }).installed, true);

    const withCli = mkHome();
    script(path.join(withCli, '.token-saver', 'src', 'cli.py'));
    assert.strictEqual(ts.detect({ home: withCli, env: { PATH: empty } }).installed, process.platform === 'win32' ? false : true);

    const withPlugin = mkHome();
    fs.mkdirSync(path.join(withPlugin, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(withPlugin, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'token-saver@token-saver-marketplace': true } }));
    assert.strictEqual(ts.detect({ home: withPlugin, env: { PATH: empty } }).installed, true);
});

test('T28: downloadOrUpdateModule names the installed version in the ready line, never "vlatest"', { skip: process.platform === 'win32' }, () => {
    const bin = path.join(mkHome(), 'bin');
    const sysPath = process.env.PATH;
    script(path.join(bin, 'npm'), [
        'if [ "$1" = "view" ]; then echo 9.9.9; exit 0; fi',
        'mkdir -p package && echo \'{"version":"9.9.9"}\' > package/package.json',
        'tar -czf mod-9.9.9.tgz package && rm -r package',
    ].join('\n'));
    const target = path.join(mkHome(), 'mod');
    const host = require('../installer.js');
    const written = [];
    const realWrite = process.stdout.write;
    process.env.PATH = `${bin}${path.delimiter}${sysPath}`;
    process.stdout.write = (chunk, ...rest) => { written.push(String(chunk)); return realWrite.call(process.stdout, chunk, ...rest); };
    let ok;
    try { ok = host.downloadOrUpdateModule('x/mod', target, 'Mod'); } finally { process.stdout.write = realWrite; process.env.PATH = sysPath; }
    assert.strictEqual(ok, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version, '9.9.9');
    const text = written.join('');
    assert.match(text, /Mod ready \(v9\.9\.9\)/);
    assert.doesNotMatch(text, /vlatest/);
});

test('A7: a package whose version cannot be read is "version unknown" in Status; no-npm packages say so', async () => {
    const m = machine();
    fs.mkdirSync(path.join(m.home, '.agents', 'bdb-dev-creator-extension'), { recursive: true });
    await menu.status(m.host, m.opts({ npmView: current }));
    assert.match(m.out.join(''), /Creator Extension\s+version unknown/);
});

test('A8: an outdated kernel is not reported as success and the old version is not recorded', async () => {
    const m = machine();
    const code = await menu.update(m.host, m.opts({ npmView: async (name) => (name.endsWith('/aos') ? '4.1.0' : '2.4.0') }));
    const text = m.out.join('');
    assert.strictEqual(code, 1);
    assert.match(text, /AOS 4\.1\.0 available: run `npx @hybridlabor-api\/aos@latest`/);
    assert.doesNotMatch(text, /Verify: all ok/);
    assert.ok(!m.calls.includes('saveManifest'));
});

test('B12: Settings -> Install OpenWiki without a key asks first, then reports skipped as a failure', async () => {
    const m = machine();
    m.host.PROVIDER_KEY_ENV_NAMES = { google: 'GEMINI_API_KEY' };
    let refreshed = 0;
    m.host.refreshOpenWikiSilently = async (o = {}) => { refreshed++; return Boolean(o.key); };
    const ui = { select: async () => 'pkg:openwiki' };
    const asked = [];
    assert.strictEqual(await menu.settings(m.host, m.opts({ ui: { ...ui, ask: async (k) => { asked.push(k); return ''; } } })), 1);
    assert.deepStrictEqual(asked, ['GEMINI_API_KEY']);
    assert.match(m.out.join(''), /✖ OpenWiki — skipped: no key/);
    assert.strictEqual(refreshed, 0);

    const m2 = machine();
    m2.host.PROVIDER_KEY_ENV_NAMES = { google: 'GEMINI_API_KEY' };
    m2.host.refreshOpenWikiSilently = async (o = {}) => Boolean(o.key);
    assert.strictEqual(await menu.settings(m2.host, m2.opts({ ui: { ...ui, ask: async () => 'k-123' } })), 0);
    assert.match(m2.out.join(''), /✔ OpenWiki/);
});

test('C14: a refused secrets file is reported, never asked into or written', async () => {
    const home = mkHome();
    fs.mkdirSync(path.dirname(secretsPath(home)), { recursive: true });
    fs.writeFileSync(secretsPath(home), 'X=1\n', { mode: 0o644 });
    fs.chmodSync(secretsPath(home), 0o644);
    const ask = async () => assert.fail('asked');
    if (process.platform !== 'win32') {
        assert.deepStrictEqual(await secrets.need([PAT], { home, ask }), { [PAT]: '' });
        assert.strictEqual(await secrets.reask(PAT, { home, ask }), '');
        assert.match(secrets.refusal(home), /secrets file refused \(permissions\/owner\)/);
        assert.strictEqual(fs.readFileSync(secretsPath(home), 'utf8'), 'X=1\n');
    }
});

test('C17: an Ollama OpenWiki provider is never asked for an API key', async () => {
    const m = machine();
    pkgJson(path.join(m.home, '.openwiki'), '1.0.0');
    m.host.loadExistingEnv = () => ({ OPENWIKI_PROVIDER: 'ollama' });
    m.host.PROVIDER_KEY_ENV_NAMES = { ollama: null };
    const bin = path.join(mkHome(), 'bin');
    script(path.join(bin, 'openwiki'), 'echo 1.0.0');
    const asked = [];
    const prev = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${prev}`;
    try { await menu.update(m.host, m.opts({ npmView: current, ui: { ask: async (k) => { asked.push(k); return 'x'; } } })); } finally { process.env.PATH = prev; }
    assert.deepStrictEqual(asked, [PAT]);
});

// ---- re-review round 2 ----
const KEY = 'bdb-aos-fleet@bdb-marketplace';
const withPathAsync = async (dir, fn) => { const prev = process.env.PATH; process.env.PATH = dir; try { return await fn(); } finally { process.env.PATH = prev; } };
const fakeClaude = () => { const bin = path.join(mkHome(), 'bin'); script(path.join(bin, 'claude'), 'echo "2.1.300 (Claude Code)"'); return `${bin}${path.delimiter}${process.env.PATH}`; };
const noClaude = () => { const d = path.join(mkHome(), 'empty'); fs.mkdirSync(d); return d; };
const putClaudeSettings = (home, text) => { fs.mkdirSync(path.join(home, '.claude'), { recursive: true }); fs.writeFileSync(path.join(home, '.claude', 'settings.json'), typeof text === 'string' ? text : JSON.stringify(text)); };
const withPackage = async (entry, fn) => { pk.register(entry); try { return await fn(); } finally { pk.registry.splice(pk.registry.findIndex((e) => e.id === entry.id), 1); } };

test('R5: a JSONC settings.json is a warning on a green Harnesses step; harness failures stay ✖', async () => {
    const m = machine();
    putClaudeSettings(m.home, '{ // mine\n "model": "x" }');
    await withPathAsync(fakeClaude(), async () => {
        assert.strictEqual(await menu.update(m.host, m.opts({ npmView: current })), 0);
        assert.match(m.out.join(''), /✔ Harnesses .*fleet: settings\.json has comments; enable bdb-aos-fleet by hand/);
        assert.doesNotMatch(m.out.join(''), /✖/);
        const f = machine();
        putClaudeSettings(f.home, '{ // mine\n "model": "x" }');
        f.host.quickUpdateHarnesses = () => ['install the Codex plugin: boom'];
        assert.strictEqual(await menu.update(f.host, f.opts({ npmView: current })), 1);
        assert.match(f.out.join(''), /✖ Harnesses/);
    });
});

test('R7: aos-uninstall removes the fleet registration', { skip: process.env.AOS_TEST_SANDBOX !== 'container' }, () => {
    const home = mkHome();
    putClaudeSettings(home, { model: 'x', enabledPlugins: { [KEY]: true } });
    const stray = path.join(home, '.agents', 'x.txt');
    fs.mkdirSync(path.dirname(stray), { recursive: true });
    fs.writeFileSync(stray, 'x');
    fs.writeFileSync(path.join(home, '.agents', '.bdb-install-manifest.json'), JSON.stringify({ [stray]: { sha256: require('crypto').createHash('sha256').update('x').digest('hex') } }));
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'aos-uninstall.mjs'), '--yes'], { cwd: home, encoding: 'utf8', env: { PATH: noClaude(), HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off' } });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    assert.strictEqual(s.model, 'x');
    assert.strictEqual(s.enabledPlugins[KEY], undefined);
});

test('R8: Settings -> Install fleet is ✖ when opted out or Claude Code is missing; a confirmed opt-out is cleared', async () => {
    const ui = (confirm) => ({ select: async () => 'pkg:fleet', ...(confirm ? { confirm } : {}) });
    const off = machine();
    putClaudeSettings(off.home, { enabledPlugins: { [KEY]: false } });
    await withPathAsync(fakeClaude(), async () => {
        assert.strictEqual(await menu.settings(off.host, off.opts({ ui: ui() })), 1);
        assert.match(off.out.join(''), /✖ Fleet mod/);
        const asked = [];
        assert.strictEqual(await menu.settings(off.host, off.opts({ ui: ui(async (q) => { asked.push(q); return true; }) })), 0);
        assert.strictEqual(asked.length, 1);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(off.home, '.claude', 'settings.json'), 'utf8')).enabledPlugins[KEY], true);
    });
    const gone = machine();
    await withPathAsync(noClaude(), async () => {
        assert.strictEqual(await menu.settings(gone.host, gone.opts({ ui: ui() })), 1);
        assert.match(gone.out.join(''), /✖ Fleet mod/);
    });
    assert.strictEqual(fs.existsSync(path.join(gone.home, '.claude', 'settings.json')), false);
});

test('R9: a throwing detect is shown in Status as "detect failed", not as not installed', async () => {
    const m = machine();
    await withPackage({ id: 'boomer', name: 'Boomer', detect: () => { throw new Error('kaput'); } }, async () => {
        assert.strictEqual(await menu.status(m.host, m.opts({ npmView: current })), 1);
    });
    assert.match(m.out.join(''), /✖ Boomer\s+detect failed: kaput/);
});

test('R10: Update and Repair respect the Settings disabled list', async () => {
    const m = machine();
    fs.mkdirSync(path.join(m.home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(m.home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['fleet', 'fixable'] }));
    let repaired = 0;
    await withPackage({ id: 'fixable', name: 'Fixable', detect: () => ({ installed: true }), verify: () => ({ ok: false, detail: 'bad' }), repair: () => { repaired++; } }, async () => {
        await withPathAsync(fakeClaude(), async () => {
            await menu.update(m.host, m.opts({ npmView: current }));
            await menu.repair(m.host, m.opts());
        });
    });
    assert.strictEqual(repaired, 0);
    assert.strictEqual(fs.existsSync(path.join(m.home, '.claude', 'settings.json')), false);
});

test('R11: the real installer prompt helpers return their defaults without clack while AOS_NONINTERACTIVE=1', async () => {
    const { prompts } = require('../installer.js');
    process.env.AOS_NONINTERACTIVE = '1';
    try {
        assert.strictEqual(await prompts.confirm({ message: 'm' }), true);
        assert.strictEqual(await prompts.confirm({ message: 'm', initialValue: false }), false);
        assert.strictEqual(await prompts.select({ message: 's', options: [{ value: 'a' }, { value: 'b' }] }), 'a');
        assert.strictEqual(await prompts.password({ message: 'k' }), '');
    } finally { delete process.env.AOS_NONINTERACTIVE; }
});

test('R14: a failed Codex plugin install and a failed plugin registration are failures', () => {
    const host = require('../installer.js');
    const codex = require('../lib/codex-plugin-install');
    const real = codex.installCodexPlugin;
    codex.installCodexPlugin = () => ({ ok: false, lines: ['Codex plugin: plugin install FAILED (boom)'] });
    try { assert.throws(() => host.runCodexPluginStep(), /FAILED \(boom\)/); } finally { codex.installCodexPlugin = real; }
    const r = host.runPluginMigration({ targetHome: mkHome(), detected: ['claudecode'], mode: 'on', cli: null, registrars: { claudecode: () => ({ ok: false, error: 'nope' }) } });
    assert.match(r.error, /claudecode: plugin registration failed \(nope\)/);
});

test('R13: token-saver detect honours CLAUDE_CONFIG_DIR', () => {
    const ts = pk.registry.find((p) => p.id === 'token-saver');
    const cfg = path.join(mkHome(), 'cfg');
    fs.mkdirSync(cfg);
    fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ enabledPlugins: { 'token-saver@token-saver-marketplace': true } }));
    assert.strictEqual(ts.detect({ home: mkHome(), env: { PATH: noClaude(), CLAUDE_CONFIG_DIR: cfg } }).installed, true);
});
