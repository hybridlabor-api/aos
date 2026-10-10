// Live facts about the pinned 1mcp the gateway relies on (presets per harness). Opt-in: needs the npm registry.
// Run: AOS_TEST_SANDBOX=container AOS_TEST_1MCP_LIVE=1 node --test tests/gateway-1mcp-live.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { PIN } = require('../lib/v5/pkg-gateway');

const live = process.env.AOS_TEST_SANDBOX === 'container' && process.env.AOS_TEST_1MCP_LIVE === '1';
const PORT = 7791;

test('1mcp presets: idempotent create, filter syntax, --config-dir, server-side ?preset= enforcement', { skip: !live, timeout: 300000 }, async () => {
    const w = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-1mcp-'));
    const cfg = path.join(w, 'cfg');
    const home = path.join(w, 'home');
    fs.mkdirSync(cfg);
    fs.mkdirSync(home);
    assert.strictEqual(spawnSync('npm', ['i', PIN, '--no-audit', '--no-fund'], { cwd: w, encoding: 'utf8' }).status, 0, 'npm install of the pinned 1mcp');
    const bin = path.join(w, 'node_modules', '.bin', '1mcp');
    const env = { ...process.env, HOME: home };
    const run = (...a) => spawnSync(bin, a, { cwd: w, env, encoding: 'utf8', timeout: 60000 });
    const fake = path.join(__dirname, 'fixtures', '1mcp-live', 'fake-upstream.js');
    const up = (name, tags) => ({ type: 'stdio', command: process.execPath, args: [fake, name], ...(tags ? { tags } : {}) });
    fs.writeFileSync(path.join(cfg, 'mcp.json'), JSON.stringify({ mcpServers: { tagged: up('tagged', ['tagged']), untagged: up('untagged'), other: up('other', ['other']) } }));

    assert.strictEqual(run('preset', 'create', 'p-or', '--filter', 'tagged,other', '--config-dir', cfg).status, 0);
    assert.strictEqual(run('preset', 'create', 'p-or', '--filter', 'tagged,other', '--config-dir', cfg).status, 0, 'same name again: upsert');
    assert.notStrictEqual(run('preset', 'create', 'p-not', '--filter', 'NOT other', '--config-dir', cfg).status, 0, 'a standalone NOT is rejected');
    assert.strictEqual(run('preset', 'create', 'p-and', '--filter', 'tagged AND NOT other', '--config-dir', cfg).status, 0);
    const presets = JSON.parse(fs.readFileSync(path.join(cfg, 'presets.json'), 'utf8')).presets;
    assert.deepStrictEqual(Object.keys(presets).sort(), ['p-and', 'p-or'], '--config-dir is where presets.json lands');

    const serve = spawn(bin, ['serve', '--config', path.join(cfg, 'mcp.json'), '--config-dir', cfg, '--port', String(PORT), '--host', '127.0.0.1'], { cwd: w, env, stdio: 'ignore' });
    try {
        const tools = async (q) => {
            const url = `http://127.0.0.1:${PORT}/mcp${q}`;
            const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
            const body = (t) => { const m = /^data: (.*)$/m.exec(t); return JSON.parse(m ? m[1] : t); };
            const r1 = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) });
            if (r1.status !== 200) return r1.status;
            await r1.text();
            h['mcp-session-id'] = r1.headers.get('mcp-session-id');
            await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
            const r2 = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
            return body(await r2.text()).result.tools.map((t) => t.name.split('_1mcp_')[0]).sort();
        };
        let all;
        for (let i = 0; i < 30 && !Array.isArray(all); i++) { try { all = await tools(''); } catch { await new Promise((r) => setTimeout(r, 1000)); } }
        assert.deepStrictEqual(all, ['other', 'tagged', 'untagged'], 'no preset: every upstream');
        assert.deepStrictEqual(await tools('?preset=p-or'), ['other', 'tagged'], 'an untagged upstream matches no positive term');
        assert.deepStrictEqual(await tools('?preset=p-and'), ['tagged']);
        assert.strictEqual(await tools('?preset=missing'), 400, 'an unknown preset breaks the whole client session');
    } finally { serve.kill(); }
});
