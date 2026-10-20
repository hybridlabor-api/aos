// Gateway hygiene: mcp.json holds exactly selected servers + adopted servers after add/install/update.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cfg = require('../lib/gateway/config.js');
const selection = require('../lib/gateway/selection.js');
const pkg = require('../lib/v5/pkg-gateway.js');
const profile = require('../lib/v5/profile.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwhyg-'));
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const mcpKeys = (home) => Object.keys(rj(path.join(cfg.gatewayDir(home), 'mcp.json')).mcpServers).sort();

function gatewayHome(selected) {
    const home = tmp();
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'token'), 'a'.repeat(64));
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
    fs.writeFileSync(cfg.adoptedPath(home), JSON.stringify({ servers: { user_own: { command: 'node', args: ['own.js'], env: {} } } }));
    profile.writeSettings(home, { disabled: [], gateway: { servers: selected } });
    return home;
}

test('applyServerChange with a non-empty selection writes exactly selected + adopted', () => {
    const home = gatewayHome(['github', 'deja']);
    selection.applyServerChange({ home, aosRoot: ROOT, add: 'chrome-devtools', platform: 'darwin', env: {} });
    assert.deepEqual(mcpKeys(home), ['chrome-devtools', 'deja', 'github', 'user_own']);
    selection.applyServerChange({ home, aosRoot: ROOT, remove: 'deja', platform: 'darwin', env: {} });
    assert.deepEqual(mcpKeys(home), ['chrome-devtools', 'github', 'user_own']);
});

for (const verb of ['install', 'update']) {
    test(`gateway ${verb} with a non-empty selection writes exactly selected + adopted`, async () => {
        const home = gatewayHome(['github', 'deja']);
        const ctx = {
            home, run: async () => ({ status: 0, stdout: '' }), dryRun: false, platform: 'darwin', log: () => {}, nodePath: '/n/node',
            aosRoot: ROOT, uid: 501, env: {}, sleep: async () => {}, statusFn: async () => ({ running: true, port: cfg.GATEWAY_PORT }),
        };
        await pkg[verb](ctx);
        assert.deepEqual(mcpKeys(home), ['deja', 'github', 'user_own']);
    });
}

// ---- duplicates across harness configs -----------------------------------------------------------
const sec = require('../lib/mcp-secrets.js');
const harness = require('../lib/gateway/harness.js');
const adopt = require('../lib/gateway/adopt.js');

const shipped = sec.shippedServers(ROOT);
const TOKEN = 'f'.repeat(64);
const owned = (home, n) => sec.wrapServer(n, shipped[n], sec.launcherPath(home));
const ownedOc = (home, n) => sec.toOpencode({ type: 'local' }, owned(home, n));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };

test('enable cleans both opencode.json and opencode.jsonc and the HOME agy workspace file; user servers stay; backups exist', () => {
    const home = tmp();
    const oc = path.join(home, '.config', 'opencode', 'opencode.json');
    const ocJsonc = path.join(home, '.config', 'opencode', 'opencode.jsonc');
    const agy = path.join(home, '.gemini', 'config', 'mcp_config.json');
    const agyHome = path.join(home, '.agents', 'mcp_config.json');
    wj(oc, { mcp: { github: ownedOc(home, 'github'), mine: { type: 'local', command: ['node', 'm.js'] } } });
    wj(ocJsonc, { mcp: { deja: ownedOc(home, 'deja'), mine2: { type: 'local', command: ['node', 'm2.js'] } } });
    wj(agy, { mcpServers: { github: owned(home, 'github') } });
    wj(agyHome, { mcpServers: { github: owned(home, 'github'), mine: { command: 'node', args: ['mine.js'] } } });
    const files = sec.harnessMcpFiles(home, {}, 'linux', home);
    for (const f of [oc, ocJsonc, agy, agyHome]) assert.ok(files.some((x) => x.file === f), `${f} is a harness file`);
    harness.enable({ home, token: TOKEN, shipped, files, now: 1000 });
    const srv = (f, key) => rj(f)[key];
    assert.deepEqual(Object.keys(srv(oc, 'mcp')).sort(), ['aos', 'mine']);
    assert.deepEqual(Object.keys(srv(ocJsonc, 'mcp')).sort(), ['aos', 'mine2']);
    assert.deepEqual(Object.keys(srv(agy, 'mcpServers')).sort(), ['aos']);
    assert.deepEqual(Object.keys(srv(agyHome, 'mcpServers')).sort(), ['aos', 'mine']);
    for (const f of [oc, ocJsonc, agy, agyHome]) assert.ok(fs.existsSync(`${f}.aos-gateway-bak-1000`), `backup of ${f}`);
});

test('an AOS template copy in ~/.agents/mcp_config.json is not a harness file', () => {
    const home = tmp();
    wj(path.join(home, '.agents', 'mcp_config.json'), { mcpServers: { github: owned(home, 'github') } });
    assert.ok(!sec.harnessMcpFiles(home, {}, 'linux', home).some((f) => f.file === path.join(home, '.agents', 'mcp_config.json')));
});

test('already adopted servers that reappear directly are removed with a backup; a differing definition is kept', () => {
    const home = tmp();
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(cfg.adoptedPath(home), JSON.stringify({ servers: {
        user_own: { command: 'node', args: ['own.js'], env: {} },
        diff_own: { command: 'node', args: ['a.js'], env: {} },
    } }));
    const claude = path.join(home, '.claude.json');
    wj(claude, { mcpServers: {
        user_own: { command: 'node', args: ['own.js'] }, diff_own: { command: 'node', args: ['b.js'] }, other: { command: 'node', args: ['x.js'] },
    } });
    const r = adopt.removeAdoptedDuplicates({ home, token: TOKEN, files: [{ file: claude, kind: 'json' }], shipped, now: 2000 });
    assert.deepEqual(r.files[0].removed, ['user_own']);
    assert.deepEqual(Object.keys(rj(claude).mcpServers).sort(), ['aos', 'diff_own', 'other']);
    assert.ok(fs.existsSync(`${claude}.aos-gateway-bak-2000`));
    assert.ok(rj(cfg.adoptedPath(home)).servers.user_own, 'adopted.json keeps the server');
});

test('per-session servers are never adoptable', () => {
    const e = { command: 'node', args: ['x.js'], env: {} };
    for (const n of ['openwiki', 'aos-a2a', 'memb']) assert.equal(adopt.reasonToSkip(n, e, new Set()), 'per-session server stays direct', n);
    assert.equal(adopt.reasonToSkip('my_tool', e, new Set()), null);
});

test('gateway install removes the direct copies of gateway and adopted servers from Claude and keeps the rest', async () => {
    const home = gatewayHome(['github', 'deja']);
    const claude = path.join(home, '.claude.json');
    wj(claude, { mcpServers: {
        github: owned(home, 'github'), user_own: { command: 'node', args: ['own.js'] }, mine: { command: 'node', args: ['mine.js'] },
    } });
    const ctx = {
        home, run: async () => ({ status: 0, stdout: '' }), dryRun: false, platform: 'darwin', log: () => {}, nodePath: '/n/node',
        aosRoot: ROOT, uid: 501, env: {}, sleep: async () => {}, statusFn: async () => ({ running: true, port: cfg.GATEWAY_PORT }), now: 3000,
    };
    await pkg.install(ctx);
    assert.deepEqual(Object.keys(rj(claude).mcpServers).sort(), ['aos', 'mine']);
    assert.ok(fs.readdirSync(home).some((n) => n.startsWith('.claude.json.aos-gateway-bak-')));
});
