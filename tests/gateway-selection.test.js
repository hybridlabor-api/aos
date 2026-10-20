// Gateway server selection: default set per tier/module, stored choice wins, adopted/seen servers kept,
// buildUpstreams honours the selection, harness URLs carry the active context profile's preset.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const selection = require('../lib/gateway/selection.js');
const cfg = require('../lib/gateway/config.js');
const profile = require('../lib/v5/profile.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwsel-'));
const ENTRY = (n) => ({ command: 'node', args: [`${n}.js`] });
const launcher = '/home/u/.agents/bin/aos-mcp-env.mjs';

test('deriveGatewayServers: base only, media adds, creator adds; keep never dropped', () => {
    assert.deepEqual(selection.deriveGatewayServers(), selection.SERVER_GROUPS.base);
    assert.equal(selection.deriveGatewayServers({ media: true }).filter((n) => selection.SERVER_GROUPS.media.includes(n)).length, 4);
    assert.equal(selection.deriveGatewayServers({ creator: true }).filter((n) => selection.SERVER_GROUPS.creator.includes(n)).length, 5);
    assert.deepEqual(selection.deriveGatewayServers({ media: true, creator: true, desktop: true }).sort(), cfg.GATEWAY_SERVERS.slice().sort());
    // creator as an array = only the detected creator servers
    assert.deepEqual(selection.deriveGatewayServers({ creator: ['bdb_blender_mcp'] }).filter((n) => selection.SERVER_GROUPS.creator.includes(n)), ['bdb_blender_mcp']);
    assert.ok(selection.deriveGatewayServers({ keep: ['github'] }).includes('github'));
});

test('resolveGatewayServers: a valid stored choice wins; invalid falls back to derivation', () => {
    const r = selection.resolveGatewayServers({ settingServers: ['github'], media: true });
    assert.equal(r.fromSetting, true);
    assert.deepEqual(r.servers, ['github']);
    // a stored list is the whole truth: keep (what runs today) is not re-added on later updates
    assert.deepEqual(selection.resolveGatewayServers({ settingServers: ['github'], media: true, keep: ['bdb_unreal_mcp'] }).servers, ['github']);
    // first migration (nothing stored): keep is added and reported
    const first = selection.resolveGatewayServers({ keep: ['bdb_unreal_mcp'] });
    assert.ok(first.servers.includes('bdb_unreal_mcp'));
    assert.deepEqual(first.kept, ['bdb_unreal_mcp']);
    // invalid stores fall back to derivation
    assert.equal(selection.validStoredServers(['nope/ok']), null);
    assert.deepEqual(selection.validStoredServers(['github', 'deja', 'chrome-devtools', 'memb_mcp']), ['github', 'deja', 'chrome-devtools', 'memb_mcp']);
    // [] is a real selection (the user removed the last server): never re-derived
    assert.deepEqual(selection.validStoredServers([]), []);
    assert.deepEqual(selection.resolveGatewayServers({ settingServers: [], media: true, keep: ['github'] }), { servers: [], fromSetting: true, kept: [], retired: [] });
    // a non-empty list with no known name is corrupt and falls back to derivation
    assert.equal(selection.resolveGatewayServers({ settingServers: ['nope'] }).fromSetting, false);
});

test('pkg-gateway apply: builds only the selection, writes it back, keeps adopted servers', async () => {
    // covered by tests/gateway-adopt-config.test.js for adopted behaviour; here: the selection seed from evidence
    const home = tmp();
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({
        mcpServers: {
            github: { type: 'stdio', command: 'npx', args: ['x'], tags: ['aos', 'github'] },
            bdb_unreal_mcp: { type: 'stdio', command: 'node', args: ['u.js'], tags: ['aos', 'bdb_unreal_mcp'] },
            user_own: { type: 'stdio', command: 'node', args: ['o.js'], tags: ['aos', 'user_own'] },
        },
    }, null, 2) + '\n', { mode: 0o600 });
    const pkg = require('../lib/v5/pkg-gateway.js');
    assert.deepEqual(pkg.currentShippedUpstreams(dir).sort(), ['bdb_unreal_mcp', 'github']);
});

test('buildUpstreams: selected filters the shipped gateway set, adopted entries stay', () => {
    const shipped = {
        github: ENTRY('github'), deja: ENTRY('deja'), 'chrome-devtools': ENTRY('cdt'), memb_mcp: ENTRY('memb'),
        bdb_unreal_mcp: ENTRY('unreal'), bdb_davinci_mcp: ENTRY('dv'), bdb_resolume_mcp: ENTRY('res'),
    };
    const adopted = { my_thing: ENTRY('mything') };
    const all = cfg.buildUpstreams({ shipped, home: '/home/u', launcher, pathEnv: '/bin', adopted });
    assert.equal(Object.keys(all).length, 7 + 1);
    const sel = cfg.buildUpstreams({ shipped, home: '/home/u', launcher, pathEnv: '/bin', adopted, selected: ['github', 'deja'] });
    assert.deepEqual(Object.keys(sel).sort(), ['deja', 'github', 'my_thing']);
});

test('harness URLs carry the active context profile preset for every kind', () => {
    const { enable } = require('../lib/gateway/harness.js');
    const { shippedMcpTemplatePath } = require('../lib/mcp-secrets.js');
    const aosRoot = path.resolve(__dirname, '..');
    const shipped = JSON.parse(fs.readFileSync(shippedMcpTemplatePath(aosRoot), 'utf8'));
    const presets = shipped.presets || {};
    const home = tmp();
    fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
    const mk = (name, data) => { const f = path.join(home, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(data, null, 2)); return f; };
    const agyFile = mk(path.join('.gemini', 'config', 'mcp_config.json'), { mcpServers: {} });
    const files = [
        { file: mk('.claude.json', { mcpServers: {} }), kind: 'claude' },
        { file: mk('opencode.json', { mcp: {} }), kind: 'opencode' },
        { file: agyFile, kind: 'agy' },
    ];
    const toml = path.join(home, 'config.toml');
    fs.writeFileSync(toml, '# comment\n');
    files.push({ file: toml, kind: 'toml' });
    const report = enable({ home, token: 'a'.repeat(64), shipped: shipped.mcpServers, files, presets, contextProfile: 'worker' });
    const urls = files.map(({ file }) => {
        if (file === toml) return /^(?:.|\n)*url = "([^"]*)"/m.exec(fs.readFileSync(file, 'utf8'))[1];
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        const e = d.mcpServers ? d.mcpServers.aos : d.mcp.aos;
        return e.url || e.serverUrl;
    });
    assert.equal(report.length, files.length);
    for (const u of urls) assert.ok(u.startsWith('http://127.0.0.1:7790/mcp?preset=worker'), u);
    // full profile: the plain URL (the profile's preset is "all"; the gateway already serves just the selection)
    const reportFull = enable({ home, token: 'a'.repeat(64), shipped: shipped.mcpServers, files, presets, contextProfile: 'full' });
    for (const r of reportFull) {
        const u = r.file === toml ? /url = "([^"]*)"/m.exec(fs.readFileSync(toml, 'utf8'))[1] : '';
        if (r.file === toml) assert.equal(u, 'http://127.0.0.1:7790/mcp');
    }
    // persisted settings default to full: readSettings without context = 'full'
    assert.equal(require('../lib/v5/context-profiles.js').contextProfileOf({}), 'full');
});

test('detectCreatorServers: only servers whose app exists; none on a bare machine', () => {
    const fsFor = (dirs) => ({
        existsSync: (p) => dirs.some((d) => d === p),
        readdirSync: (p) => (p === '/Applications' ? ['Adobe After Effects 2025', 'Safari.app'] : []),
    });
    assert.deepEqual(selection.detectCreatorServers({ platform: 'darwin', env: {}, home: '/h', fsImpl: fsFor([]) }).sort(), ['adobe_uxp_mcp', 'bdb_after_effects_mcp']);
    assert.ok(selection.detectCreatorServers({ platform: 'darwin', env: {}, home: '/h', fsImpl: fsFor(['/Applications/DaVinci Resolve']) }).includes('bdb_davinci_mcp'));
    assert.deepEqual(selection.detectCreatorServers({ platform: 'linux', env: {}, home: '/h', fsImpl: { existsSync: () => false, readdirSync: () => [] } }), []);
});

const SRC = path.resolve(__dirname, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const seedUpstream = (home, names) => {
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'token'), 'a'.repeat(64));
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: Object.fromEntries(names.map((n) => [n, { type: 'stdio', command: 'node', args: [], tags: ['aos', n] }])) }));
    return dir;
};
const ctxOf = (home) => ({ home, aosRoot: SRC, platform: 'darwin', env: {} });
const settingsOf = (home) => path.join(home, '.aos', 'v5-settings.json');

test('resolveAndSaveSelection: first migration keeps running upstreams, saves after the caller says so, and never re-adds them later', () => {
    const home = tmp();
    seedUpstream(home, ['github', 'bdb_unreal_mcp']);
    const pkg = require('../lib/v5/pkg-gateway.js');
    const msgs = [];
    const first = pkg.resolveAndSaveSelection(ctxOf(home), (m) => msgs.push(m));
    assert.ok(first.servers.includes('bdb_unreal_mcp'));
    assert.ok(msgs.some((m) => m.includes('bdb_unreal_mcp')), 'kept servers are logged');
    assert.equal(fs.existsSync(settingsOf(home)), false, 'nothing saved before save()');
    first.save();
    assert.ok(readJson(settingsOf(home)).gateway.servers.includes('bdb_unreal_mcp'));
    // the user deselects it; the live mcp.json still lists it, but the stored choice wins
    const st = readJson(settingsOf(home));
    st.gateway.servers = st.gateway.servers.filter((n) => n !== 'bdb_unreal_mcp');
    fs.writeFileSync(settingsOf(home), JSON.stringify(st));
    const second = pkg.resolveAndSaveSelection(ctxOf(home), () => {});
    assert.ok(!second.servers.includes('bdb_unreal_mcp'));
    second.save();
    assert.ok(!readJson(settingsOf(home)).gateway.servers.includes('bdb_unreal_mcp'));
});

test('resolveAndSaveSelection: Pro MEDIA tier from the manifest adds the media group on a fresh install', () => {
    const home = tmp();
    fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
    fs.writeFileSync(path.join(home, '.agents', '.bdb-manifest.json'), JSON.stringify({ tier: '1' }));
    const { servers } = require('../lib/v5/pkg-gateway.js').resolveAndSaveSelection(ctxOf(home), () => {});
    for (const n of selection.SERVER_GROUPS.media) assert.ok(servers.includes(n), n);
    assert.ok(!servers.includes('zavora_computer_use'), 'desktop group is opt-in');
});

test('an unparseable v5-settings.json is never overwritten; writes are atomic', () => {
    const home = tmp();
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(settingsOf(home), '{ "disabled": ["memb"], oops');
    assert.throws(() => profile.writeSettings(home, { disabled: [] }), /not valid JSON/);
    assert.equal(fs.readFileSync(settingsOf(home), 'utf8'), '{ "disabled": ["memb"], oops');
    const pkg = require('../lib/v5/pkg-gateway.js');
    const msgs = [];
    pkg.resolveAndSaveSelection(ctxOf(home), (m) => msgs.push(m)).save();
    assert.equal(fs.readFileSync(settingsOf(home), 'utf8'), '{ "disabled": ["memb"], oops');
    assert.ok(msgs.some((m) => /could not save/.test(m)));
    const ok = tmp();
    profile.writeSettings(ok, { disabled: [] });
    assert.deepEqual(fs.readdirSync(path.join(ok, '.aos')), ['v5-settings.json']);
});

test('menu adopt state keeps gateway.servers (spread of the existing gateway object)', () => {
    const src = fs.readFileSync(path.join(SRC, 'lib', 'v5', 'menu.js'), 'utf8');
    assert.equal((src.match(/gateway: \{\n\s+\.\.\.\(st\.gateway \|\| \{\}\),\n\s+adopted:/g) || []).length, 2);
});

test('applyServerChange: remove of the last server gives an empty selection and an empty gateway, never re-derived', () => {
    const home = tmp();
    const dir = seedUpstream(home, ['github']);
    profile.writeSettings(home, { disabled: [], gateway: { servers: ['github'] } });
    selection.applyServerChange({ home, aosRoot: SRC, remove: 'github', platform: 'darwin', env: {} });
    assert.deepEqual(readJson(settingsOf(home)).gateway.servers, []);
    assert.deepEqual(Object.keys(readJson(path.join(dir, 'mcp.json')).mcpServers), []);
    const again = selection.resolveGatewayServers({ settingServers: readJson(settingsOf(home)).gateway.servers, media: true });
    assert.deepEqual(again.servers, []);
});

test('applyServerChange: a failing settings write restores the previous mcp.json', () => {
    const home = tmp();
    const dir = seedUpstream(home, ['github']);
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(settingsOf(home), '{ broken');
    const before = fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8');
    assert.throws(() => selection.applyServerChange({ home, aosRoot: SRC, add: 'deja', platform: 'darwin', env: {} }), /not valid JSON/);
    assert.equal(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'), before);
});

test('detectMediaServers selects only media servers whose app exists; deriveGatewayServers takes the array', () => {
    const fsImpl = { readdirSync: (d) => (d === '/Applications' ? ['Resolume Arena', 'x'] : (() => { throw new Error('ENOENT'); })()) };
    assert.deepEqual(selection.detectMediaServers({ platform: 'darwin', fsImpl, home: '/h' }), ['bdb_resolume_mcp']);
    assert.deepEqual(selection.detectMediaServers({ platform: 'linux', fsImpl, home: '/h' }), []);
    const d = selection.deriveGatewayServers({ media: ['bdb_resolume_mcp'] });
    assert.ok(d.includes('bdb_resolume_mcp') && !d.includes('bdb_unreal_mcp'));
});

test('a stored selection of only retired names stays empty and reports them', () => {
    const r = selection.resolveGatewayServers({ settingServers: ['old_server_gone'], media: true });
    assert.deepEqual(r.servers, []);
    assert.equal(r.fromSetting, true);
    assert.deepEqual(r.retired, ['old_server_gone']);
    assert.equal(selection.validStoredServers(['bad name!']), null, 'malformed names still count as corrupt');
});
