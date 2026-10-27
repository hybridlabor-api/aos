const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const ur = require('../lib/uninstall-records.js');

// Child process so installer.js sees HOME=<sandbox> when it computes homeDir; cwd is the sandbox too.
function sandbox() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-uninst-'));
    fs.mkdirSync(path.join(home, 'empty-bin'));
    return home;
}
const env = (home) => ({ HOME: home, USERPROFILE: home, PATH: path.join(home, 'empty-bin'), AOS_PLUGIN_CLI: 'off' });
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function installPieces(home) {
    // Hook scripts the launcher for aos-bus points at.
    fs.cpSync(path.join(REPO, '.claude', 'hooks'), path.join(home, '.claude', 'hooks'), { recursive: true });
    write(path.join(home, '.gemini', 'config', 'hooks.json'), JSON.stringify({ 'my-own': { Stop: [{ type: 'command', command: './mine.sh' }] }, hooks: { Stop: [{ type: 'command', command: './old/graph-gate.mjs' }, { type: 'command', command: './foreign.sh' }] } }));
    fs.mkdirSync(path.join(home, '.gemini', 'antigravity-cli'), { recursive: true });
    fs.symlinkSync(path.join(home, '.gemini', 'config', 'hooks.json'), path.join(home, '.gemini', 'antigravity-cli', 'hooks.json'));
    write(path.join(home, '.codex', 'config.toml'), '[model]\nname = "x"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "./foreign-codex.sh"\n');
    write(path.join(home, '.config', 'opencode', 'opencode.jsonc'), JSON.stringify({ plugin: ['/other/plugin.js'], theme: 'dark' }));
    const script = `
        const i = require(${JSON.stringify(path.join(REPO, 'installer.js'))});
        const p = require('node:path'); const h = process.env.HOME;
        i.mergeAntigravityHooks(p.join(h, '.gemini', 'config', 'hooks.json'), { selfCheck: () => ({ status: 0, stderr: '' }) });
        i.mergeCodexTomlHooks(p.join(h, '.codex', 'config.toml'));
        i.installOpencodePlugin({ targetHome: h, configPath: p.join(h, '.config', 'opencode', 'opencode.jsonc'), optional: new Set(), permission: new Set() });
        i.installGlobalBinaries();
    `;
    const r = spawnSync(process.execPath, ['-e', script], { cwd: home, env: env(home), encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
}

test('uninstall leaves no dangling AOS registration and keeps foreign entries', () => {
    const home = sandbox();
    try {
        installPieces(home);
        const hooksFile = path.join(home, '.gemini', 'config', 'hooks.json');
        const bin = path.join(home, '.local', 'bin');
        const oc = path.join(home, '.config', 'opencode');
        assert.ok(Object.keys(readJson(hooksFile)).includes('aos-go-gate'));
        assert.ok(fs.existsSync(path.join(bin, 'aos-bus')) && fs.existsSync(path.join(bin, 'aos-acp')));
        assert.match(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), /AOS:HOOKS:START/);
        // Manifest needs one entry or the uninstaller refuses to act at all.
        const stray = path.join(home, '.agents', 'x.txt');
        write(stray, 'x');
        write(path.join(home, '.agents', '.bdb-install-manifest.json'), JSON.stringify({ [stray]: { sha256: require('node:crypto').createHash('sha256').update('x').digest('hex') } }));
        write(path.join(home, 'foreign-launcher-target'), '');
        write(path.join(bin, 'aos-custom'), '#!/bin/sh\nexec mine\n');
        write(path.join(bin, 'aos-store'), '#!/bin/sh\nexec node /somewhere/else.mjs\n');

        const dry = spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-uninstall.mjs'), '--dry-run'], { cwd: home, env: env(home), encoding: 'utf8' });
        assert.strictEqual(dry.status, 0, dry.stderr);
        for (const needle of ['aos-go-gate', 'aos-context', 'AOS hooks and MCP entries','bdb-aos.js', 'aos-bus', 'aos-acp']) assert.ok(dry.stdout.includes(needle), `dry-run lists ${needle}\n${dry.stdout}`);
        assert.ok(fs.existsSync(path.join(oc, 'plugins', 'bdb-aos.js')), 'dry-run deletes nothing');
        assert.ok(Object.keys(readJson(hooksFile)).includes('aos-go-gate'));

        const real = spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-uninstall.mjs'), '--yes'], { cwd: home, env: env(home), encoding: 'utf8' });
        assert.strictEqual(real.status, 0, real.stderr);

        const hooks = readJson(hooksFile);
        assert.deepStrictEqual(Object.keys(hooks).sort(), ['hooks', 'my-own']);
        assert.deepStrictEqual(hooks.hooks.Stop, [{ type: 'command', command: './foreign.sh' }]);
        assert.ok(fs.lstatSync(path.join(home, '.gemini', 'antigravity-cli', 'hooks.json')).isSymbolicLink(), 'symlink kept');

        const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
        assert.ok(!/AOS:HOOKS/.test(toml) && !toml.includes('go-gate.mjs'));
        assert.ok(toml.includes('foreign-codex.sh') && toml.includes('name = "x"'));

        assert.ok(!fs.existsSync(path.join(oc, 'plugins', 'bdb-aos.js')));
        const conf = readJson(path.join(oc, 'opencode.jsonc'));
        assert.deepStrictEqual(conf.plugin, ['/other/plugin.js']);
        assert.strictEqual(conf.theme, 'dark');

        for (const n of ur.LAUNCHERS.filter((x) => x !== 'aos-store')) assert.ok(!fs.existsSync(path.join(bin, n)), `${n} launcher removed`);
        assert.ok(fs.existsSync(path.join(bin, 'aos-custom')) && fs.existsSync(path.join(bin, 'aos-store')), 'foreign launchers survive, also under an AOS name');
    } finally { rm(home); }
});

test('an edited OpenCode plugin and a launcher without the marker are handled safely', () => {
    const home = sandbox();
    try {
        installPieces(home);
        const plugin = path.join(home, '.config', 'opencode', 'plugins', 'bdb-aos.js');
        fs.appendFileSync(plugin, '\n// my edit\n');
        const lines = ur.reverseRegistrations({ home, dryRun: false });
        assert.ok(lines.some((l) => l.includes('.bak')), lines.join('\n'));
        assert.ok(fs.readdirSync(path.dirname(plugin)).some((f) => f.startsWith('bdb-aos.js.') && f.endsWith('.bak')), 'backup written');

        const foreignPlugin = path.join(home, '.config', 'opencode', 'plugins', 'bdb-aos.js');
        write(foreignPlugin, '// somebody else\n');
        ur.reverseRegistrations({ home, dryRun: false });
        assert.ok(fs.existsSync(foreignPlugin), 'a foreign bdb-aos.js is left alone');
    } finally { rm(home); }
});

test('Claude plugin is uninstalled only when AOS recorded installing it', () => {
    const home = sandbox();
    try {
        const calls = [];
        let source = 'GitHub (hybridlabor-api/aos)';
        let plugins = '  ❯ bdb-aos@bdb-marketplace\n    Status: enabled\n';
        const runner = (args) => {
            calls.push(args.join(' '));
            if (args.join(' ') === 'plugin marketplace list') return { ok: true, stdout: `  ❯ bdb-marketplace\n    Source: ${source}\n` };
            if (args.join(' ') === 'plugin list') return { ok: true, stdout: plugins };
            return { ok: true };
        };
        ur.reverseRegistrations({ home, runner, injected: true });
        assert.deepStrictEqual(calls, [], 'nothing recorded, nothing run');

        const wrapped = ur.recordingCli(home, (args) => ({ ok: true, stdout: args[1] === 'install' ? 'installed' : '' }));
        wrapped(['plugin', 'marketplace', 'list']);
        assert.deepStrictEqual(ur.readRecords(home), {});
        wrapped(['plugin', 'marketplace', 'add', 'hybridlabor-api/aos']);
        wrapped(['plugin', 'install', 'bdb-aos@bdb-marketplace']);
        assert.deepStrictEqual(ur.readRecords(home).claude, { addedMarketplace: true, installedPlugin: true });

        const dry = ur.reverseRegistrations({ home, runner, injected: true, dryRun: true });
        assert.strictEqual(dry.length, 2);
        assert.deepStrictEqual(calls, []);
        ur.reverseRegistrations({ home, runner, injected: true });
        assert.deepStrictEqual(calls, ['plugin uninstall bdb-aos@bdb-marketplace', 'plugin marketplace list', 'plugin list', 'plugin marketplace remove bdb-marketplace']);
        assert.deepStrictEqual(ur.readRecords(home).claude, {});

        const record = () => { const w = ur.recordingCli(home, (a) => ({ ok: true, stdout: a[1] === 'install' ? 'installed' : '' })); w(['plugin', 'marketplace', 'add', 'x']); w(['plugin', 'install', 'bdb-aos@bdb-marketplace']); };
        record();
        source = 'GitHub (someone/else)';
        calls.length = 0;
        const elsewhere = ur.reverseRegistrations({ home, runner, injected: true });
        assert.ok(!calls.some((c) => c.startsWith('plugin marketplace remove')), 'a marketplace pointing elsewhere is not removed');
        assert.ok(elsewhere.some((l) => l.includes('kept')), elsewhere.join('\n'));

        record();
        source = 'GitHub (hybridlabor-api/aos)';
        plugins += '  ❯ other@bdb-marketplace\n    Status: enabled\n';
        calls.length = 0;
        ur.reverseRegistrations({ home, runner, injected: true });
        assert.ok(!calls.some((c) => c.startsWith('plugin marketplace remove')), 'a marketplace used by another plugin is not removed');
        fs.rmSync(ur.recordsPath(home), { force: true });

        const skip = ur.recordingCli(home, () => ({ ok: true, stdout: 'already installed' }));
        skip(['plugin', 'install', 'x']);
        assert.deepStrictEqual(ur.readRecords(home).claude || {}, {}, 'a plugin the user installed first is not ours');
        const notReal = ur.reverseRegistrations({ home, runner });
        assert.deepStrictEqual(notReal, []);
    } finally { rm(home); }
});

test('a module folder is removed only when the install recorded it', () => {
    const home = sandbox();
    try {
        const unrecorded = path.join(home, '.agents', 'memB', 'package.json');
        const recorded = path.join(home, '.agents', 'bdb-synapse', 'package.json');
        write(unrecorded, '{}');
        write(recorded, '{}');
        write(path.join(home, '.agents', '.bdb-manifest.json'), JSON.stringify({ installedModules: ['synapse'] }));
        const stray = path.join(home, '.agents', 'x.txt');
        write(stray, 'x');
        write(path.join(home, '.agents', '.bdb-install-manifest.json'), JSON.stringify({ [stray]: { sha256: require('node:crypto').createHash('sha256').update('x').digest('hex') } }));

        const real = spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-uninstall.mjs'), '--yes'], { cwd: home, env: env(home), encoding: 'utf8' });
        assert.strictEqual(real.status, 0, real.stderr);
        assert.ok(fs.existsSync(unrecorded), 'folder without an install record is kept');
        assert.ok(!fs.existsSync(path.join(home, '.agents', 'bdb-synapse')), 'recorded folder is removed');
    } finally { rm(home); }
});

test('the deja MCP entry is removed only when AOS recorded installing deja-vu', () => {
    const home = sandbox();
    try {
        const claude = path.join(home, '.claude.json');
        write(claude, JSON.stringify({ mcpServers: { deja: { command: 'deja', args: ['mcp'] } } }));
        // Recorded npm packages are uninstalled through npm; a missing npm counts as a failed uninstall (exit 1).
        const npm = path.join(home, 'empty-bin', 'npm');
        write(npm, '#!/bin/sh\nexit 0\n');
        fs.chmodSync(npm, 0o755);
        const stray = path.join(home, '.agents', 'x.txt');
        const runUninstall = () => {
            write(stray, 'x');
            write(path.join(home, '.agents', '.bdb-install-manifest.json'), JSON.stringify({ [stray]: { sha256: require('node:crypto').createHash('sha256').update('x').digest('hex') } }));
            const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-uninstall.mjs'), '--yes'], { cwd: home, env: env(home), encoding: 'utf8' });
            assert.strictEqual(r.status, 0, r.stderr);
        };

        runUninstall();
        assert.ok(readJson(claude).mcpServers.deja, 'deja entry kept when AOS did not install deja-vu');

        ur.recordNpmGlobal(home, '@vshulcz/deja-vu');
        runUninstall();
        assert.strictEqual(readJson(claude).mcpServers.deja, undefined, 'recorded deja entry removed');
        assert.strictEqual(fs.existsSync(ur.recordsPath(home)), false, 'a finished uninstall retires its records');

        write(claude, JSON.stringify({ mcpServers: { deja: { command: 'node', args: ['my-deja.js'] } } }));
        ur.recordNpmGlobal(home, '@vshulcz/deja-vu');
        runUninstall();
        assert.deepStrictEqual(readJson(claude).mcpServers.deja, { command: 'node', args: ['my-deja.js'] }, 'a user deja entry of another shape is kept');
    } finally { rm(home); }
});

test('Rust + Tauri skill copies and the cargo-built CLI are removed only when AOS recorded them', () => {
    const home = sandbox();
    try {
        const skill = path.join(home, '.agents', 'skills', 'tauri-pilot');
        const own = path.join(home, '.agents', 'skills', 'my-own');
        write(path.join(skill, 'SKILL.md'), 'shipped');
        write(path.join(own, 'SKILL.md'), 'mine');
        const cargo = [];
        const runCargo = (crate) => { cargo.push(crate); return true; };

        assert.deepStrictEqual(ur.reverseRustauri({ home, runCargo }).changed, false, 'nothing recorded, nothing removed');
        assert.ok(fs.existsSync(skill));

        ur.recordSkillCopies(home, 'rustauri', [skill]);
        ur.recordCargoCrate(home, 'rustauri', 'tauri-pilot-cli');
        assert.strictEqual(ur.reverseRustauri({ home, dryRun: true, runCargo }).changed, true);
        assert.ok(fs.existsSync(skill) && cargo.length === 0, 'dry run deletes nothing');

        write(path.join(skill, 'SKILL.md'), 'edited by the user');
        const edited = ur.reverseRustauri({ home, runCargo });
        assert.ok(edited.error.includes('edited'), edited.error);
        assert.ok(fs.existsSync(skill), 'edited copy kept');
        assert.deepStrictEqual(cargo, ['tauri-pilot-cli']);
        assert.ok(fs.existsSync(own), 'user skill never recorded, kept');
        assert.strictEqual(ur.readRecords(home).rustauri, undefined);
    } finally { rm(home); }
});
