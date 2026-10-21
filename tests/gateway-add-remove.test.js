// `aos-gateway add/remove <server>`: selection update, mcp.json rewrite, service restart skipped in AOS_TEST_SANDBOX.
// Also the doctor exposure rows (servers, live tool counts, estimate-labelled tokens). Sandbox HOME, no network.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'aos-gateway.mjs');
const cfg = require('../lib/gateway/config.js');
const profile = require('../lib/v5/profile.js');
const selection = require('../lib/gateway/selection.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwadd-'));
const env = (home) => ({ HOME: home, USERPROFILE: home, PATH: process.env.PATH, AOS_TEST_SANDBOX: '1' });
const run = (home, args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: env(home), cwd: ROOT, timeout: 30000 });

function install(home, shippedNames) {
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'token'), 'b'.repeat(64), { mode: 0o600 });
    const servers = {};
    for (const n of shippedNames) servers[n] = { type: 'stdio', command: 'node', args: [`${n}.js`], tags: ['aos', n] };
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: servers }, null, 2) + '\n', { mode: 0o600 });
    return dir;
}

describe('aos-gateway add/remove', () => {
    test('--dry-run changes nothing and names the missing name', () => {
        const home = tmp();
        install(home, ['github', 'chrome-devtools']);
        const before = fs.readFileSync(path.join(cfg.gatewayDir(home), 'mcp.json'), 'utf8');
        const r = run(home, ['add', 'nope']);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /gateway server name expected/);
        assert.equal(fs.readFileSync(path.join(cfg.gatewayDir(home), 'mcp.json'), 'utf8'), before);
    });

    test('add: absent setting is seeded from the current upstreams, then the server is added and mcp.json rewritten', () => {
        const home = tmp();
        install(home, ['github', 'chrome-devtools', 'bdb_davinci_mcp']);
        const r = run(home, ['add', 'bdb_blender_mcp']);
        assert.equal(r.status, 0);
        const st = profile.readSettings(home, () => {});
        assert.ok(st.gateway.servers.includes('bdb_blender_mcp'));
        // seed kept everything the gateway ran before (never silently dropped)
        for (const n of ['github', 'chrome-devtools', 'bdb_davinci_mcp']) assert.ok(st.gateway.servers.includes(n));
        const cfgUp = JSON.parse(fs.readFileSync(path.join(cfg.gatewayDir(home), 'mcp.json'), 'utf8')).mcpServers;
        assert.ok(cfgUp.bdb_blender_mcp, 'mcp.json rewritten with the added upstream');
        assert.ok(cfgUp.bdb_davinci_mcp, 'still-selected servers stay');
        assert.ok(r.stdout.includes('restart skipped (AOS_TEST_SANDBOX)'));
    });

    test('remove: server comes off the selection and out of mcp.json', () => {
        const home = tmp();
        install(home, ['github', 'chrome-devtools', 'bdb_resolume_mcp']);
        const r = run(home, ['remove', 'bdb_resolume_mcp']);
        assert.equal(r.status, 0);
        const st = profile.readSettings(home, () => {});
        assert.ok(!st.gateway.servers.includes('bdb_resolume_mcp'));
        assert.ok(st.gateway.servers.includes('github'));
        const up = JSON.parse(fs.readFileSync(path.join(cfg.gatewayDir(home), 'mcp.json'), 'utf8')).mcpServers;
        assert.equal(up.bdb_resolume_mcp, undefined);
        assert.ok(up.github);
    });

    test('add without a gateway install exits 1', () => {
        const home = tmp();
        const r = run(home, ['add', 'github']);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /gateway is not installed/);
    });
});

describe('doctor gatewayExposureRows', () => {
    test('preset in the harness URL narrows the exposure; estimates carry tool counts', () => {
        const { gatewayExposureRows, visibleServersFor } = require('../lib/gateway/doctor.js');
        const sel = ['github', 'chrome-devtools', 'bdb_resolume_mcp'];
        // no preset (plain URL): every selected server is visible even if other presets would exclude it
        assert.deepEqual(visibleServersFor(null, { worker: ['bdb_resolume_mcp'] }, sel).sort(), sel.slice().sort());
        assert.deepEqual(visibleServersFor('worker', { worker: ['bdb_resolume_mcp'] }, sel).sort(), ['chrome-devtools', 'github']);
        const home = tmp();
        const f = path.join(home, '.claude.json');
        fs.writeFileSync(f, JSON.stringify({ mcpServers: { aos: { type: 'http', url: 'http://127.0.0.1:7790/mcp?preset=worker' } } }, null, 2) + '\n');
        const cfgDir = cfg.gatewayDir(home);
        fs.mkdirSync(cfgDir, { recursive: true });
        fs.writeFileSync(path.join(cfgDir, 'mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2) + '\n', { mode: 0o600 });
        const rows = gatewayExposureRows({ files: [{ file: f, kind: 'claude' }], selection: sel, toolCounts: { github: 30, 'chrome-devtools': 5 }, presets: { worker: ['bdb_resolume_mcp'] } });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].preset, 'worker');
        assert.deepEqual(rows[0].servers.sort(), ['chrome-devtools', 'github']);
        assert.equal(rows[0].tools, 35);
        assert.equal(rows[0].estimatedTokens, 35 * 85);
    });

    test('gatewayToolCounts returns null without a running gateway (no throw)', async () => {
        const { gatewayToolCounts } = require('../lib/gateway/doctor.js');
        assert.equal(await gatewayToolCounts({ port: 9, token: 'x', timeoutMs: 300 }), null);
    });
});
