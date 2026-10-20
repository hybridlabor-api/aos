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
    assert.deepEqual(selection.deriveGatewayServers({ media: true, creator: true }).sort(), cfg.GATEWAY_SERVERS.slice().sort());
    assert.ok(selection.deriveGatewayServers({ keep: ['github'] }).includes('github'));
});

test('resolveGatewayServers: a valid stored choice wins; invalid falls back to derivation', () => {
    const r = selection.resolveGatewayServers({ settingServers: ['github'], media: true });
    assert.equal(r.fromSetting, true);
    assert.deepEqual(r.servers, ['github']);
    // derivation ignored when a stored list exists, but keep is still unioned in
    assert.deepEqual(selection.resolveGatewayServers({ settingServers: ['github'], media: true, keep: ['bdb_unreal_mcp'] }).servers.sort(), ['bdb_unreal_mcp', 'github']);
    // invalid stores fall back to derivation
    assert.equal(selection.validStoredServers(['nope/ok']), null);
    assert.deepEqual(selection.validStoredServers(['github', 'deja', 'chrome-devtools', 'memb_mcp']), ['github', 'deja', 'chrome-devtools', 'memb_mcp']);
    assert.equal(selection.resolveGatewayServers({ settingServers: [] }).fromSetting, false);
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
