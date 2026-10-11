// A6 unified memory: one bundle (memb + deja + openwiki), on by default, off with --without=memory or minimal;
// off means no memb_mcp / deja MCP and no memb-inject wiring anywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const p = require('../lib/v5/profile');
const { writeProfileFlag, flagPath } = require('../lib/opencode-profile');
const { withoutMemory } = require('../lib/v5/pkg-gateway');

const INSTALLER = path.join(__dirname, '..', 'installer.js');
const IDS = ['kernel', 'memb', 'deja', 'openwiki', 'gateway', 'fleet', 'token-saver', 'codenotch'];
const parse = (argv) => p.parseOptions(['node', 'installer.js', ...argv], {}, IDS);
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `aos-mem-${tag}-`));
const disableMemory = (home) => p.writeSettings(home, { disabled: [...p.BUNDLES.memory] });
const container = { skip: process.env.AOS_TEST_SANDBOX !== 'container' };

test('--without=memory expands to the bundle and composes with other ids', () => {
    assert.deepEqual(parse(['--without=memory']).without, ['memb', 'deja', 'openwiki']);
    assert.deepEqual(parse(['--without=fleet,memory,memb']).without, ['fleet', 'memb', 'deja', 'openwiki']);
    assert.throws(() => parse(['--without=memorry']), /Valid: memory, /);
});

test('standard keeps unified memory, minimal and --without=memory exclude it', () => {
    assert.ok(!p.resolve(parse([]), {}).excluded.has('memb'));
    assert.ok(!p.resolve(parse(['--profile=full']), {}).excluded.has('memb'));
    for (const argv of [['--profile=minimal'], ['--without=memory']]) {
        const ex = p.resolve(parse(argv), {}).excluded;
        for (const id of p.BUNDLES.memory) assert.ok(ex.has(id), `${argv} excludes ${id}`);
    }
});

test('dropContextHooks with a predicate drops only memb-inject', () => {
    const entries = [
        { hooks: [{ command: 'node "$HOME/.claude/hooks/memb-inject.mjs"' }] },
        { hooks: [{ command: 'node "$HOME/.claude/hooks/rules-inject.mjs"' }] },
        { matcher: 'Bash', hooks: [{ command: 'node "$HOME/.claude/hooks/go-gate.mjs"' }] },
    ];
    const cmds = p.dropContextHooks(entries, (c) => c.includes('memb-inject.mjs')).flatMap((e) => e.hooks.map((h) => h.command)).join('\n');
    assert.ok(!cmds.includes('memb-inject') && cmds.includes('rules-inject') && cmds.includes('go-gate'));
});

test('OpenCode flag carries memory:false only when memory is off', () => {
    const dir = path.join(tmp('oc'), '.config', 'opencode');
    writeProfileFlag(dir, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(flagPath(dir), 'utf8')), { contextHooks: true });
    writeProfileFlag(dir, true, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(flagPath(dir), 'utf8')), { contextHooks: true, memory: false });
});

test('OpenCode plugin skips memB injection when memory is false', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '.opencode', 'plugins', 'bdb-aos.js'), 'utf8');
    assert.match(src, /flag\?\.memory === false\) memory = false/);
    assert.match(src, /if \(!contextHooks \|\| !memory\) throw 0;/);
});

test('gateway upstreams drop memb_mcp and deja only when memb is excluded', () => {
    const servers = { memb_mcp: {}, deja: {}, github: {} };
    const home = tmp('gw');
    assert.deepEqual(Object.keys(withoutMemory(servers, home)), ['memb_mcp', 'deja', 'github']);
    disableMemory(home);
    assert.deepEqual(Object.keys(withoutMemory(servers, home)), ['github']);
    const minimal = tmp('gwmin');
    p.writeSettings(minimal, { disabled: [], profile: 'minimal' });
    assert.deepEqual(Object.keys(withoutMemory(servers, minimal)), ['github']);
});

// Child process: HOME is a temp dir, settings decide memoryOn through applyInstallOptions.
const runInstaller = (home, code, extra = []) => spawnSync(process.execPath, ['-e', `const i = require(${JSON.stringify(INSTALLER)}); i.applyInstallOptions(); ${code}`, ...extra], {
    cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8', timeout: 120000,
});

test('-y MCP selection offers memb-mcp only with unified memory (container only)', container, () => {
    const on = tmp('sel-on');
    const off = tmp('sel-off');
    disableMemory(off);
    const pick = (home) => {
        const r = runInstaller(home, 'i.promptMcpSelection("1").then((s) => console.log("SEL=" + JSON.stringify(s)));');
        assert.equal(r.status, 0, r.stderr);
        return JSON.parse(/SEL=(.*)/.exec(r.stdout)[1]);
    };
    assert.ok(pick(on).includes('memb-mcp'));
    assert.ok(!pick(off).includes('memb-mcp'));
});

test('MCP config: memb_mcp only when memb-mcp is selected, deja gone with memory off (container only)', container, () => {
    const write = (home) => {
        const file = path.join(home, 'mcp.json');
        const r = runInstaller(home, 'i.installMcpsForTarget({ targetMcpDir: process.argv[1], mcpConfigPath: process.argv[2], extraMcpConfigPaths: [] }, { selectedMcps: ["deja"], mode: "merge", platformValue: "2", creds: {} });', [path.join(home, 'mcp'), file]);
        assert.equal(r.status, 0, r.stderr);
        return JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers;
    };
    const on = write(tmp('mcp-on'));
    assert.ok(!('memb_mcp' in on), 'memb_mcp not selected, not written');
    assert.ok('deja' in on);
    const offHome = tmp('mcp-off');
    disableMemory(offHome);
    const off = write(offHome);
    assert.ok(!('memb_mcp' in off) && !('deja' in off));
});

test('--hooks-only wires memb-inject only with unified memory (container only)', container, () => {
    const hooks = (home) => {
        const r = spawnSync(process.execPath, [INSTALLER, '--hooks-only', '-y', '--no-intro'], {
            cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8', timeout: 120000,
        });
        assert.equal(r.status, 0, r.stderr);
        return fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
    };
    assert.ok(hooks(tmp('hk-on')).includes('memb-inject.mjs'));
    const offHome = tmp('hk-off');
    disableMemory(offHome);
    const off = hooks(offHome);
    assert.ok(!off.includes('memb-inject.mjs'));
    assert.ok(off.includes('go-gate.mjs') && off.includes('rules-inject.mjs'));
});
