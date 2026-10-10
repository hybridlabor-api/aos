// Installer v5 end-to-end scenarios: menu.update/status/repair/settings with a fake host, fresh temp HOME, fake npmView.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-v5s-'));
process.env.HOME = root;
process.env.USERPROFILE = root;

const { readSecretsFile, secretsPath } = require('../lib/mcp-secrets');
const menu = require('../lib/v5/menu');
const pk = require('../lib/v5/packages');
const noprompt = require('../lib/v5/noprompt');

const PAT = 'GITHUB_PERSONAL_ACCESS_TOKEN';
const CONTAINER = process.env.AOS_TEST_SANDBOX === 'container';
let n = 0;
const mkHome = () => fs.mkdtempSync(path.join(root, `s${n++}-`));
const script = (file, body = 'exit 0') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); };
const pkgJson = (dir, version) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version })); };
const current = async (name) => ({ '@hybridlabor-api/aos': '4.0.0', '@hybridlabor-api/memb': '2.4.0' }[name] || '1.0.0');
const membNewer = async (name) => (name.endsWith('/memb') ? '2.5.0' : current(name));

// Keep real deja/openwiki/claude out of the scan, but leave sh/mkdir for the fake scripts.
const withIsolatedPath = async (fn) => { const prev = process.env.PATH; process.env.PATH = '/usr/bin:/bin'; try { return await fn(); } finally { process.env.PATH = prev; } };
const withPackage = async (entry, fn) => { pk.register(entry); try { return await fn(); } finally { pk.registry.splice(pk.registry.findIndex((e) => e.id === entry.id), 1); } };

// Kernel skills + memB 2.4.0 + memb-mcp copy 2.4.0. dangling: .venv/bin/python links to a missing target.
function machine({ dangling = false, bare = false } = {}) {
    const home = mkHome();
    const base = bare ? path.join(home, 'empty-agents') : path.join(home, '.agents');
    const skills = path.join(home, 'skills');
    const mcp = path.join(home, 'gemini-config');
    fs.mkdirSync(path.join(skills, 'startcycle'), { recursive: true });
    fs.mkdirSync(base, { recursive: true });
    // The gateway step would run real npm and launchctl here: keep it off in these fixtures.
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['gateway'] }));
    const memb = path.join(base, 'memB');
    if (!bare) {
        pkgJson(memb, '2.4.0');
        fs.writeFileSync(path.join(memb, 'requirements.txt'), 'mcp\n');
        if (dangling) { fs.mkdirSync(path.join(memb, '.venv', 'bin'), { recursive: true }); fs.symlinkSync(path.join(home, 'gone', 'python3'), path.join(memb, '.venv', 'bin', 'python')); }
        else script(path.join(memb, '.venv', 'bin', 'python'));
        pkgJson(path.join(mcp, 'mcps', 'memb-mcp'), '2.4.0');
    }
    const calls = [];
    const host = {
        calls,
        detectInstallState: () => ({ isInstalled: !bare, localVersion: bare ? null : '4.0.0', installedModules: bare ? [] : ['memb'] }),
        resolveTargetPaths: () => ({ targetSkillDir: skills, targetMcpDir: mcp }),
        moduleBasePath: () => base,
        quickUpdateKernel: () => calls.push('kernel'),
        quickUpdateHarnesses: () => calls.push('harnesses'),
        refreshOpenWikiSilently: async () => false,
        installMemB: async () => { calls.push('installMemB'); return true; },
        installSynapse: async () => { calls.push('installSynapse'); return true; },
        findSynapseBinary: () => null,
        downloadOrUpdateModule: (npm, dir) => { calls.push(`download ${path.basename(dir)}`); pkgJson(dir, '2.4.0'); return true; },
        uvBin: () => 'uv',
        isNewerVersion: (l, r) => l !== r,
        loadExistingEnv: () => ({}),
        PROVIDER_KEY_ENV_NAMES: {},
        saveManifest: () => calls.push('saveManifest'),
        flushSessionManifest: () => {},
        runUninstaller: () => 0,
    };
    const out = [];
    const opts = (extra = {}) => ({ home, write: (s) => out.push(s), ui: {}, npmView: current, ...extra });
    return { home, memb, mcp, host, calls, out, text: () => out.join(''), opts };
}

// Every prompt function the flow could reach: ui.* plus clack-shaped ones (behind noprompt) exposed on the host.
function promptCounter(host) {
    const hits = [];
    const hit = (name, v) => async () => { hits.push(name); return v; };
    const clack = noprompt({ text: hit('clack.text', ''), password: hit('clack.password', ''), select: hit('clack.select', 'x'), multiselect: hit('clack.multiselect', []), confirm: hit('clack.confirm', true) });
    host.prompts = clack;
    return { hits, ui: { ask: hit('ui.ask', 'x'), select: hit('ui.select', 'exit'), confirm: hit('ui.confirm', true) } };
}

const INSTALLERS = ['installMemB', 'installSynapse', 'download memb-mcp'];

test('S1 fresh install: Status lists no installed package and exits as designed', async () => {
    await withIsolatedPath(async () => {
        const m = machine({ bare: true });
        assert.strictEqual(await menu.runCommand('status', m.host, m.opts()), 1);
        assert.match(m.text(), /AOS is not installed here/);

        const s = machine({ bare: true });
        assert.strictEqual(await menu.status(s.host, s.opts()), 0);
        assert.doesNotMatch(s.text(), /^[✔✖]/m, 'not one package is listed as installed');
        assert.match(s.text(), /0 updates available/);
        assert.deepStrictEqual(s.calls, [], 'status installs nothing');
    });
});

test('S2 second Update with unchanged versions: zero prompts, zero installer calls', async () => {
    await withIsolatedPath(async () => {
        const m = machine();
        assert.strictEqual(await menu.update(m.host, m.opts({ ui: { ask: async () => 'ghp_x' } })), 0);

        const pc = promptCounter(m.host);
        m.calls.length = 0;
        assert.strictEqual(await menu.update(m.host, m.opts({ ui: pc.ui })), 0);
        assert.strictEqual(pc.hits.length, 0, `prompted: ${pc.hits}`);
        assert.match(m.text(), /Everything is current/);
        for (const c of INSTALLERS) assert.ok(!m.calls.includes(c), `${c} not called`);
    });
});

test('S3 outdated module: Status shows "1 update available", Update updates only that package once', async () => {
    await withIsolatedPath(async () => {
        const m = machine();
        assert.strictEqual(await menu.status(m.host, m.opts({ npmView: membNewer })), 0);
        assert.match(m.text(), /memB\s+2\.4\.0 -> 2\.5\.0/);
        assert.match(m.text(), /1 update available/);

        m.calls.length = 0;
        assert.strictEqual(await menu.update(m.host, m.opts({ npmView: membNewer })), 0);
        assert.strictEqual(m.calls.filter((c) => c === 'installMemB').length, 1);
        assert.ok(!m.calls.includes('installSynapse'));
        assert.match(m.text(), /1 update available/);
    });
});

test('S4 dangling memB venv: repair renames .venv, recreates it via uv, keeps the broken dir', { skip: !CONTAINER }, async () => {
    await withIsolatedPath(async () => {
        const m = machine({ dangling: true });
        const log = path.join(m.home, 'calls.log');
        const bin = path.join(m.home, 'bin');
        const uv = path.join(bin, 'uv');
        script(uv, [
            `echo "uv $*" >> "${log}"`,
            'if [ "$1" = "venv" ]; then mkdir -p .venv/bin',
            'cat > .venv/bin/python <<\'EOF\'',
            '#!/bin/sh',
            `echo "python $*" >> "${log}"`,
            'exit 0',
            'EOF',
            'chmod +x .venv/bin/python; fi',
            'exit 0',
        ].join('\n'));
        m.host.uvBin = () => uv;
        const memb = pk.registry.find((p) => p.id === 'memb');
        assert.strictEqual(memb.verify({ host: m.host, home: m.home }).ok, false);

        assert.strictEqual(await menu.repair(m.host, m.opts()), 0);
        const broken = fs.readdirSync(m.memb).filter((f) => f.startsWith('.venv.broken-'));
        assert.strictEqual(broken.length, 1);
        assert.ok(fs.lstatSync(path.join(m.memb, broken[0], 'bin', 'python')).isSymbolicLink(), 'old venv kept');
        const lines = fs.readFileSync(log, 'utf8');
        assert.match(lines, /uv venv --clear --seed \.venv/);
        assert.match(lines, /uv pip install --python .*-r requirements\.txt/);
        assert.match(lines, /python .*import mcp/, 'dependency import check ran');
    });
});

// Copy venv python for the memb-mcp copy: records its args, optionally fails on `from memb import`.
function copyPython(m, failOnMemb) {
    const log = path.join(m.home, 'copy-python.log');
    const py = path.join(m.mcp, 'mcps', 'memb-mcp', '.venv', 'bin', 'python');
    script(py, [`echo "$*" >> "${log}"`, failOnMemb ? 'case "$*" in *"from memb import"*) exit 1;; esac' : ':', 'exit 0'].join('\n'));
    return log;
}
const membPkg = () => pk.registry.find((p) => p.id === 'memb');

test('S4b verify runs `from memb import Memory` with the memb-mcp copy venv python', { skip: !CONTAINER }, async () => {
    await withIsolatedPath(async () => {
        const m = machine();
        const log = copyPython(m, false);
        const r = membPkg().verify({ host: m.host, home: m.home });
        assert.strictEqual(r.ok, true, r.detail);
        assert.match(fs.readFileSync(log, 'utf8'), /^-c from memb import Memory$/m);
    });
});

test('S4c verify fails when `from memb import Memory` fails in the copy venv', { skip: !CONTAINER }, async () => {
    await withIsolatedPath(async () => {
        const m = machine();
        copyPython(m, true);
        const r = membPkg().verify({ host: m.host, home: m.home });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.detail, 'memb-mcp: `from memb import Memory` fails (entry run.py)');
    });
});

test('S4d verify reports an opencode.jsonc pointing at a missing memb-mcp venv python', { skip: !CONTAINER }, async () => {
    await withIsolatedPath(async () => {
        const m = machine();
        copyPython(m, false);
        const missing = path.join(m.home, 'gone', 'memb-mcp', '.venv', 'bin', 'python');
        const cfg = path.join(m.home, '.config', 'opencode', 'opencode.jsonc');
        fs.mkdirSync(path.dirname(cfg), { recursive: true });
        fs.writeFileSync(cfg, `// c\n{ "mcp": { "memb_mcp": { "command": ["${missing}", "${path.join(m.home, 'x', 'run.py')}"] } } }\n`);
        const r = membPkg().verify({ host: m.host, home: m.home });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.detail, `memb_mcp config points at a missing venv python: ${cfg} -> ${missing}`);
    });
});

test('S5 blank PAT: stored as skipped, second Update does not ask, only Settings re-asks', async () => {
    await withIsolatedPath(async () => {
        const m = machine();
        const asked = [];
        const blank = async (k) => { asked.push(k); return ''; };
        assert.strictEqual(await menu.update(m.host, m.opts({ ui: { ask: blank } })), 0);
        assert.deepStrictEqual(asked, [PAT]);
        const vars = readSecretsFile(secretsPath(m.home)).vars;
        assert.strictEqual(vars.AOS_SKIPPED_KEYS, PAT);
        assert.ok(!(PAT in vars));

        await menu.update(m.host, m.opts({ ui: { ask: blank } }));
        assert.strictEqual(asked.length, 1, 'second Update did not ask again');

        const ui = { select: async () => `secret:${PAT}`, ask: async (k) => { asked.push(k); return 'tok'; } };
        assert.strictEqual(await menu.settings(m.host, m.opts({ ui })), 0);
        assert.strictEqual(asked.length, 2, 'Settings asked');
        assert.strictEqual(readSecretsFile(secretsPath(m.home)).vars[PAT], 'tok');
    });
});

test('S6 disabled list is respected by Update and Repair', async () => {
    await withIsolatedPath(async () => {
        const settings = (home, disabled) => { fs.mkdirSync(path.join(home, '.aos'), { recursive: true }); fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled })); };

        const ctl = machine();
        await menu.update(ctl.host, ctl.opts({ npmView: membNewer }));
        assert.ok(ctl.calls.includes('installMemB'), 'control: memB is updated when enabled');

        const m = machine({ dangling: true });
        settings(m.home, ['memb', 'gateway']);
        let created = 0;
        const venv = { create: () => { created++; }, install: () => {} };
        await menu.update(m.host, m.opts({ npmView: membNewer, venv }));
        await menu.repair(m.host, m.opts({ venv }));
        assert.ok(!m.calls.includes('installMemB'), 'Update skipped disabled memB');
        assert.strictEqual(created, 0, 'Repair skipped disabled memB');
        assert.strictEqual(fs.readdirSync(m.memb).filter((f) => f.startsWith('.venv.broken-')).length, 0);
    });
});

test('S7 a detect that throws shows "detect failed" and does not crash Status, Update or Repair', async () => {
    await withIsolatedPath(async () => {
        const m = machine();
        await withPackage({ id: 'boomer', name: 'Boomer', detect: async () => { throw new Error('kaput'); } }, async () => {
            assert.strictEqual(await menu.status(m.host, m.opts()), 1);
            assert.match(m.text(), /✖ Boomer\s+detect failed: kaput/);
            assert.strictEqual(typeof await menu.update(m.host, m.opts()), 'number');
            assert.strictEqual(typeof await menu.repair(m.host, m.opts()), 'number');
            assert.match(m.text(), /✔ Kernel/, 'the other packages still ran');
        });
    });
});
