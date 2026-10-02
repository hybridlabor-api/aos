const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { COMMANDS, checkOpencode, checkAcpAndGoCheck } = require('../lib/opencode-verify.js');

const REPO = path.resolve(__dirname, '..');
let home;
let binDir;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ocv-'));
    binDir = path.join(home, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'opencode'), '');
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const put = (rel, text = '') => { const p = path.join(home, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
const installFiles = () => {
    put('.config/opencode/plugins/bdb-aos.js');
    put('.config/opencode/plugins/aos-hooks/go-gate.mjs');
    for (const c of COMMANDS) put(`.config/opencode/commands/${c}`);
};
const cli = (over = {}) => JSON.stringify({
    plugin_origins: [{ spec: `file://${home}/.config/opencode/plugins/bdb-aos.js` }],
    command: Object.fromEntries(COMMANDS.map((c) => [c.replace(/\.md$/, ''), {}])),
    mcp: { memb_mcp: { enabled: true }, deja: { enabled: true }, github: { enabled: false } },
    ...over,
});
const run = (out) => () => out;
const byName = (rs) => Object.fromEntries(rs.map((r) => [r.name, r]));
const check = (out) => byName(checkOpencode({ home, platform: 'darwin', env: { PATH: binDir }, run: run(out) }));

describe('opencode-verify', () => {
    test('COMMANDS equals the shipped /bdb-aos-* files', () => {
        const shipped = fs.readdirSync(path.join(REPO, '.opencode', 'commands')).filter((f) => f.startsWith('bdb-aos-')).sort();
        assert.deepEqual([...COMMANDS].sort(), shipped);
        assert.equal(COMMANDS.length, 14);
    });

    test('nothing installed and no CLI: no results', () => {
        assert.deepEqual(checkOpencode({ home, env: { PATH: '' } }), []);
    });

    test('full install passes every check', () => {
        installFiles();
        put('.config/opencode/opencode.jsonc', `{ // c\n "plugin": ["${home}/.config/opencode/plugins/bdb-aos.js"] }`);
        const r = check(cli());
        for (const [n, v] of Object.entries(r)) assert.ok(v.ok, `${n}: ${v.detail}`);
        assert.equal(Object.keys(r).length, 6);
        assert.ok(Object.values(r).every((v) => v.warningOnly));
    });

    test('missing plugin and commands warn; registration line is skipped', () => {
        put('.config/opencode/opencode.jsonc', '{}');
        const r = check(cli({ command: {} }));
        assert.equal(r['OpenCode plugin file'].ok, false);
        assert.equal(r['OpenCode plugin registration'], undefined);
        assert.equal(r['OpenCode commands'].ok, false);
        assert.match(r['OpenCode commands'].detail, /missing \/bdb-aos-brainstorm/);
    });

    test('same file by file URL, ~ path and dotdot is one registration; another file is a double load', () => {
        installFiles();
        const same = [`file://${home}/.config/opencode/plugins/bdb-aos.js`, `${home}/.config/opencode/plugins/../plugins/bdb-aos.js`, '~/.config/opencode/plugins/bdb-aos.js'];
        put('.config/opencode/opencode.json', JSON.stringify({ plugin: same }));
        assert.equal(check(cli())['OpenCode plugin registration'].ok, true);
        put('.config/opencode/opencode.jsonc', JSON.stringify({ plugin: ['/elsewhere/repo/.opencode/plugins/bdb-aos.js'] }));
        const r = check(cli())['OpenCode plugin registration'];
        assert.equal(r.ok, false);
        assert.match(r.detail, /twice/);
    });

    test('CLI view: duplicate plugin entries, missing commands, non-lean MCP', () => {
        installFiles();
        const dup = { spec: `file://${home}/x/bdb-aos.js` };
        let r = check(cli({ plugin_origins: [dup, dup] }));
        assert.equal(r['OpenCode CLI view'].ok, false);
        r = check(cli({ mcp: { memb_mcp: { enabled: true }, comfyui: { enabled: true } } }));
        assert.equal(r['OpenCode MCP set'].ok, false);
        assert.match(r['OpenCode MCP set'].detail, /comfyui/);
        r = check('not json');
        assert.equal(r['OpenCode CLI view'].ok, false);
        assert.equal(r['OpenCode MCP set'], undefined);
    });

    test('opencode not on PATH still runs the file checks', () => {
        installFiles();
        const r = byName(checkOpencode({ home, env: { PATH: '' }, run: run(null) }));
        assert.equal(r['OpenCode plugin file'].ok, true);
        assert.equal(r['OpenCode CLI view'].ok, false);
        assert.match(r['OpenCode CLI view'].detail, /not on PATH/);
    });

    test('aos-acp and go-check', () => {
        let r = byName(checkAcpAndGoCheck({ home, env: { PATH: binDir } }));
        assert.equal(r['aos-acp'].ok, false);
        assert.equal(r['go-check'].ok, false);
        put('.local/bin/aos-acp');
        r = byName(checkAcpAndGoCheck({ home, env: { PATH: binDir } }));
        assert.match(r['aos-acp'].detail, /not on PATH/);
        const withBin = { PATH: `${path.join(home, '.local', 'bin')}${path.delimiter}${binDir}` };
        r = byName(checkAcpAndGoCheck({ home, env: withBin }));
        assert.equal(r['aos-acp'].ok, false);
        assert.match(r['aos-acp'].detail, /missing/);
        put('.agents/bin/aos-acp.mjs');
        for (const f of ['go-check.mjs', 'go-gate.mjs', 'guarded-patterns.json']) put(`.aos/bin/${f}`);
        r = byName(checkAcpAndGoCheck({ home, env: withBin }));
        assert.equal(r['aos-acp'].ok, true);
        assert.equal(r['go-check'].ok, true);
    });

    test('Windows: aos-acp.cmd launcher is found on PATH', () => {
        const dir = path.join(home, '.local', 'bin');
        put('.local/bin/aos-acp.cmd');
        put('.agents/bin/aos-acp.mjs');
        const r = byName(checkAcpAndGoCheck({ home, platform: 'win32', env: { PATH: dir } }));
        assert.equal(r['aos-acp'].ok, true);
    });
});

describe('installed layout', () => {
    const nodeEnv = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, AGENTTRAIL_PORT: '1' };

    test('installGlobalHooks wires aos-acp, lib and trail.mjs; the installed aos-acp and aos-doctor start', () => {
        const proj = path.join(home, 'proj');
        fs.mkdirSync(proj);
        const script = `const i=require(${JSON.stringify(path.join(REPO, 'installer.js'))});` +
            `i.installGlobalHooks({targetHome:process.env.HOME,targetGemini:process.env.HOME+'/.gemini'});`;
        const inst = spawnSync(process.execPath, ['-e', script], { cwd: proj, env: { ...nodeEnv, HOME: home }, encoding: 'utf8', timeout: 120000 });
        assert.equal(inst.status, 0, inst.stderr);
        for (const f of ['.local/bin/aos-acp', '.agents/bin/aos-acp.mjs', '.agents/lib/plugin-migration.js', '.aos/bin/trail.mjs', '.aos/bin/go-gate.mjs']) {
            assert.ok(fs.existsSync(path.join(home, f)), `missing ${f}`);
        }
        const env = { ...nodeEnv, HOME: home };
        const help = spawnSync(path.join(home, '.local/bin/aos-acp'), ['--help'], { env, encoding: 'utf8' });
        assert.equal(help.status, 0, help.stderr);
        assert.match(help.stdout, /usage: aos-acp/);
        const fake = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(__dirname, 'fixtures', 'fake-acp-agent.mjs'))}`;
        const dry = spawnSync(path.join(home, '.local/bin/aos-acp'), ['codex', '--cmd', fake, '--name', 'w1', '--prompt', 'hi', '--cwd', proj], { env, encoding: 'utf8', timeout: 30000 });
        assert.equal(dry.status, 0, dry.stderr);
        assert.equal(dry.stdout, 'hello world\n');
        const doc = spawnSync(path.join(home, '.local/bin/aos-doctor'), ['--json'], { env: { ...env, PATH: `${path.join(home, '.local/bin')}:${env.PATH}` }, encoding: 'utf8', timeout: 60000 });
        const parsed = JSON.parse(doc.stdout);
        const names = parsed.results.map((r) => r.name);
        assert.ok(names.includes('aos-acp') && names.includes('go-check'), names.join());
        const row = (n) => parsed.results.find((r) => r.name === n);
        assert.equal(row('aos-acp').ok, true, row('aos-acp').detail);
        assert.equal(row('go-check').ok, true, row('go-check').detail);
    });

    test('real opencode CLI sees one plugin and 14 commands (AOS_E2E_CLI=1)', { skip: process.env.AOS_E2E_CLI !== '1' }, () => {
        const proj = path.join(home, 'proj');
        fs.mkdirSync(proj);
        const script = `const i=require(${JSON.stringify(path.join(REPO, 'installer.js'))});` +
            `i.installOpencodePlugin({targetHome:process.env.HOME,configPath:process.env.HOME+'/.config/opencode/opencode.jsonc'});`;
        const env = { PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`, HOME: home };
        const inst = spawnSync(process.execPath, ['-e', script], { cwd: proj, env, encoding: 'utf8', timeout: 120000 });
        assert.equal(inst.status, 0, inst.stderr);
        const r = byName(checkOpencode({ home, env, cwd: proj }));
        for (const [n, v] of Object.entries(r)) assert.ok(v.ok, `${n}: ${v.detail}`);
        assert.match(r['OpenCode CLI view'].detail, /14 \/bdb-aos-\* commands, 1 bdb-aos\.js entry/);
    });
});

test('the CLI is not run when there is no OpenCode config directory (it would create one)', () => {
    const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ocv-'));
    try {
        fs.mkdirSync(path.join(home2, 'bin'));
        fs.writeFileSync(path.join(home2, 'bin', 'opencode'), '');
        let ran = false;
        const rs = checkOpencode({ home: home2, platform: 'darwin', env: { PATH: path.join(home2, 'bin') }, run: () => { ran = true; return '{}'; } });
        assert.equal(ran, false);
        assert.match(rs.find((r) => r.name === 'OpenCode CLI view').detail, /not run/);
    } finally { fs.rmSync(home2, { recursive: true, force: true }); }
});
