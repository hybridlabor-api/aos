// On-demand upstream hub (#255): fakes only. A tiny stdio MCP server script stands in for real upstreams; no 1mcp runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createHub, reapStaleChildren, idleMsOf, maxUpstreamsOf, CHILDREN_FILE } = require('../lib/gateway/hub.js');
const { hubSplit, writeGatewayConfig, gatewayConfigTexts, SIDECAR_FILE } = require('../lib/gateway/config.js');
const { gatewayStatus, hubText } = await import('../bin/aos-gateway.mjs');

const TOKEN = 'a'.repeat(64);
const FAKE = `
const fs = require('fs');
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, process.pid + '\\n');
if (process.env.FAKE_CRASH) process.exit(3);
let buf = '';
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.id === undefined) continue;
    const out = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
    if (m.method === 'initialize') out({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } });
    else if (m.method === 'tools/list') out({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }, { name: 'sleep', inputSchema: { type: 'object' } }] });
    else if (m.method === 'tools/call') setTimeout(() => out({ content: [{ type: 'text', text: 'pid ' + process.pid }] }), m.params.name === 'sleep' ? 600 : 0);
    else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } }) + '\\n');
  }
});
process.stdin.on('end', () => process.exit(0));
`;

function setup(names, extraEnv = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwhub-'));
    const script = path.join(dir, 'fake-mcp.js');
    fs.writeFileSync(script, FAKE);
    const log = path.join(dir, 'starts.log');
    fs.writeFileSync(log, '');
    const servers = Object.fromEntries(names.map((n) => [n, { command: process.execPath, args: [script, n], env: { FAKE_LOG: log, ...(extraEnv[n] || {}) }, inheritParentEnv: false }]));
    fs.writeFileSync(path.join(dir, SIDECAR_FILE), JSON.stringify({ servers }), { mode: 0o600 });
    return { dir, script, log, starts: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(Number) };
}

async function startHub(dir, opts = {}) {
    let spawns = 0;
    const hub = createHub({ dir, token: TOKEN, port: 0, spawnFn: (...a) => { spawns++; return spawn(...a); }, cmdOf: () => '', ...opts });
    const port = await hub.listen();
    const rpc = async (name, method, params, { token = TOKEN, id = 1 } = {}) => {
        const r = await fetch(`http://127.0.0.1:${port}/${name}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) });
        const text = await r.text();
        return { status: r.status, body: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null };
    };
    return { hub, port, rpc, spawns: () => spawns };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); } return fn(); };

test('env ranges: invalid idle/cap values fall back to the defaults', () => {
    assert.equal(idleMsOf({}), 600000);
    assert.equal(idleMsOf({ AOS_GATEWAY_IDLE_MS: '1000' }), 600000);
    assert.equal(idleMsOf({ AOS_GATEWAY_IDLE_MS: '30000' }), 30000);
    assert.equal(idleMsOf({ AOS_GATEWAY_IDLE_MS: 'x' }), 600000);
    assert.equal(maxUpstreamsOf({ AOS_GATEWAY_MAX_UPSTREAMS: '33' }), 4);
    assert.equal(maxUpstreamsOf({ AOS_GATEWAY_MAX_UPSTREAMS: '8' }), 8);
});

test('mcp.json rewrite: stdio -> hub http, http/sse/disabled untouched, sidecar 0600, backup, ONDEMAND=0 stays eager', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwhub-cfg-'));
    fs.writeFileSync(path.join(dir, 'token'), TOKEN, { mode: 0o600 });
    const servers = {
        github: { type: 'stdio', command: 'node', args: ['l.js', '--', 'npx', 'gh'], env: { PATH: '/bin', HOME: '/h' }, inheritParentEnv: false, tags: ['aos', 'github'], restartOnExit: true },
        remote: { type: 'http', url: 'https://example.invalid/mcp' },
        stream: { type: 'sse', url: 'https://example.invalid/sse' },
        off: { type: 'stdio', command: 'node', args: ['x.js'], disabled: true },
        adopted_one: { type: 'stdio', command: 'uvx', args: ['thing'], cwd: '/tmp', env: { PATH: '/bin' }, tags: ['aos', 'adopted_one'] },
    };
    fs.writeFileSync(path.join(dir, 'mcp.json'), 'old\n');
    writeGatewayConfig(dir, servers, {});
    const mcp = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).mcpServers;
    assert.deepEqual(mcp.github, { type: 'http', url: 'http://127.0.0.1:7792/github/mcp', headers: { Authorization: `Bearer ${TOKEN}` }, tags: ['aos', 'github'], requestTimeout: 180000 });
    assert.equal(mcp.adopted_one.url, 'http://127.0.0.1:7792/adopted_one/mcp');
    assert.deepEqual(mcp.remote, servers.remote);
    assert.deepEqual(mcp.stream, servers.stream);
    assert.deepEqual(mcp.off, servers.off);
    const side = JSON.parse(fs.readFileSync(path.join(dir, SIDECAR_FILE), 'utf8')).servers;
    assert.deepEqual(Object.keys(side).sort(), ['adopted_one', 'github']);
    assert.deepEqual(side.adopted_one, { command: 'uvx', args: ['thing'], cwd: '/tmp', env: { PATH: '/bin' }, inheritParentEnv: true });
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, SIDECAR_FILE)).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(dir, 'mcp.json.prev'), 'utf8'), 'old\n');
    assert.equal(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'), gatewayConfigTexts(dir, servers, {}).mcp);

    writeGatewayConfig(dir, servers, { AOS_GATEWAY_ONDEMAND: '0' });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).mcpServers, servers);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, SIDECAR_FILE), 'utf8')).servers, {});
    // No token yet: nothing is rewritten (the hub could not authenticate 1mcp).
    assert.deepEqual(hubSplit(servers, { token: null }).servers, servers);
    assert.equal(hubSplit({ 'bad/name': servers.github }, { token: TOKEN }).servers['bad/name'], servers.github);
});

test('catalog is served without starting the child; first tools/call starts exactly one', async () => {
    const s = setup(['github']);
    const { hub, rpc, spawns } = await startHub(s.dir);
    try {
        // No catalog yet: the first tools/list starts the real server once to record it.
        let r = await rpc('github', 'tools/list');
        assert.deepEqual(r.body.result.tools.map((t) => t.name), ['echo', 'sleep']);
        assert.equal(spawns(), 1);
        assert.ok(fs.existsSync(path.join(s.dir, 'catalog', 'github.json')));
        await hub.close();
    } finally { await hub.close(); }

    const h2 = await startHub(s.dir);
    try {
        let r = await h2.rpc('github', 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
        assert.equal(r.body.result.serverInfo.name, 'fake');
        r = await h2.rpc('github', 'tools/list');
        assert.equal(r.body.result.tools.length, 2);
        assert.equal((await h2.rpc('github', 'prompts/list')).body.result.prompts.length, 0);
        assert.equal(h2.spawns(), 0, 'catalog answers must not start the server');
        assert.equal(h2.hub.statusOf().servers.github.state, 'idle');
        r = await h2.rpc('github', 'tools/call', { name: 'echo', arguments: {} });
        assert.match(r.body.result.content[0].text, /^pid \d+$/);
        await h2.rpc('github', 'tools/call', { name: 'echo', arguments: {} });
        assert.equal(h2.spawns(), 1);
        assert.equal(h2.hub.statusOf().servers.github.state, 'running');
        assert.equal(h2.hub.statusOf().running, 1);
    } finally { await h2.hub.close(); }
});

test('idle timer stops the child; status goes back to idle with a last use', async () => {
    const s = setup(['github']);
    const { hub, rpc } = await startHub(s.dir, { idleMs: 150 });
    try {
        await rpc('github', 'tools/call', { name: 'echo', arguments: {} });
        const [pid] = s.starts();
        assert.ok(alive(pid));
        assert.ok(await until(() => !alive(pid)), 'idle child stopped');
        const st = hub.statusOf().servers.github;
        assert.equal(st.state, 'idle');
        assert.ok(st.lastUse);
        assert.match(hubText(st), /^idle \(stopped after idle, last use /);
    } finally { await hub.close(); }
});

test('cap: evicts the least recently used idle child, errors when all are busy', async () => {
    const s = setup(['a', 'b', 'c']);
    const { hub, rpc } = await startHub(s.dir, { maxUpstreams: 1 });
    try {
        await rpc('a', 'tools/call', { name: 'echo' });
        await rpc('b', 'tools/call', { name: 'echo' });
        const [pa, pb] = s.starts();
        assert.ok(await until(() => !alive(pa)), 'a evicted');
        assert.ok(alive(pb));
        const slow = rpc('b', 'tools/call', { name: 'sleep' });
        await new Promise((r) => setTimeout(r, 100));
        const r = await rpc('c', 'tools/call', { name: 'echo' }, { id: 7 });
        assert.equal(r.body.id, 7);
        assert.match(r.body.error.message, /gateway cap reached \(1 running\); retry later/);
        assert.ok((await slow).body.result);
        assert.equal(s.starts().length, 2, 'c never started');
    } finally { await hub.close(); }
});

test('crash at start: one restart, then a clear error; the hub keeps serving', async () => {
    const s = setup(['bad', 'good'], { bad: { FAKE_CRASH: '1' } });
    const { hub, rpc } = await startHub(s.dir);
    try {
        const r = await rpc('bad', 'tools/call', { name: 'echo' });
        assert.match(r.body.error.message, /upstream bad exited \(code 3\)/);
        assert.equal(s.starts().length, 2);
        assert.equal(hub.statusOf().servers.bad.state, 'failed');
        assert.match(hubText(hub.statusOf().servers.bad), /^failed/);
        // Respawn guard: the next calls inside a minute stop after 3 starts in total.
        await rpc('bad', 'tools/call', { name: 'echo' });
        const r3 = await rpc('bad', 'tools/call', { name: 'echo' });
        assert.match(r3.body.error.message, /times in the last minute/);
        assert.equal(s.starts().length, 3);
        assert.ok((await rpc('good', 'tools/call', { name: 'echo' })).body.result);
    } finally { await hub.close(); }
});

test('shutdown kills every child', async () => {
    const s = setup(['a', 'b']);
    const { hub, rpc } = await startHub(s.dir);
    await rpc('a', 'tools/call', { name: 'echo' });
    await rpc('b', 'tools/call', { name: 'echo' });
    const pids = s.starts();
    assert.equal(pids.length, 2);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(s.dir, CHILDREN_FILE), 'utf8'))).map(Number).sort(), [...pids].sort());
    await hub.close();
    for (const p of pids) assert.ok(await until(() => !alive(p)), `pid ${p} gone`);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir, CHILDREN_FILE), 'utf8')), {});
});

test('token, host and name validation; only sidecar names, never a command from the request', async () => {
    const s = setup(['github']);
    const { hub, port, rpc, spawns } = await startHub(s.dir);
    try {
        assert.equal((await rpc('github', 'tools/list', null, { token: null })).status, 401);
        assert.equal((await rpc('github', 'tools/list', null, { token: 'b'.repeat(64) })).status, 401);
        assert.equal((await rpc('nope', 'tools/list')).status, 404);
        assert.equal((await rpc('__proto__', 'tools/list')).status, 404);
        assert.equal((await rpc('..%2Fx', 'tools/list')).status, 404);
        const host = await new Promise((resolve) => http.request({ host: '127.0.0.1', port, path: '/github/mcp', method: 'POST', headers: { host: 'evil.test', authorization: `Bearer ${TOKEN}` } }, (res) => { res.resume(); resolve(res.statusCode); }).end('{}'));
        assert.equal(host, 403);
        const big = await fetch(`http://127.0.0.1:${port}/github/mcp`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: 'x'.repeat(5 << 20) }).then((r) => r.status).catch(() => 413);
        assert.equal(big, 413);
        assert.equal(spawns(), 0);
    } finally { await hub.close(); }
});

test('stale pid cleanup signals only pids whose command line matches the record', async () => {
    const s = setup(['github']);
    const foreign = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    const ours = spawn(process.execPath, [s.script, 'github'], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
        fs.writeFileSync(path.join(s.dir, CHILDREN_FILE), JSON.stringify({
            [foreign.pid]: { name: 'github', command: process.execPath, args: [s.script, 'github'] },
            [ours.pid]: { name: 'github', command: process.execPath, args: [s.script, 'github'] },
            1: { name: 'github', command: 'init', args: [] },
        }));
        const killed = [];
        const reaped = reapStaleChildren(s.dir, { kill: (pid) => { killed.push(pid); process.kill(pid, 'SIGKILL'); } });
        if (process.platform !== 'win32') {
            assert.deepEqual(reaped, [ours.pid]);
            assert.deepEqual(killed, [ours.pid]);
            assert.ok(alive(foreign.pid));
        }
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir, CHILDREN_FILE), 'utf8')), {});
    } finally { foreign.kill('SIGKILL'); ours.kill('SIGKILL'); }
});

test('status: a never-started on-demand server is ok "idle (starts on first call)", a failed one WARN, never FAIL', async () => {
    const s = setup(['github', 'bad'], { bad: { FAKE_CRASH: '1' } });
    fs.writeFileSync(path.join(s.dir, 'token'), TOKEN, { mode: 0o600 });
    fs.writeFileSync(path.join(s.dir, 'mcp.json'), JSON.stringify({ mcpServers: { github: {}, bad: {} } }));
    const listen = (handler) => new Promise((resolve) => { const srv = http.createServer(handler); srv.listen(0, '127.0.0.1', () => resolve(srv)); });
    const fw = await listen((req, res) => { res.writeHead(200, { 'x-aos-gateway': '1' }); res.end('{}'); });
    // 1mcp view: it lists both, but neither is "available" (e.g. its connect raced the hub).
    const one = await listen((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(req.url === '/api/v1/servers' ? JSON.stringify({ servers: [{ server: 'github', status: 'error', available: false }, { server: 'bad', status: 'error', available: false }] }) : '{}'); });
    const { hub, port: hubPort, rpc } = await startHub(s.dir);
    try {
        await rpc('bad', 'tools/call', { name: 'echo' });
        const st = await gatewayStatus({ dir: s.dir, port: fw.address().port, upstreamPort: one.address().port, hubPort });
        const by = Object.fromEntries(st.upstreams.map((u) => [u.name, u]));
        assert.equal(by.github.ok, true);
        assert.equal(hubText(by.github.hub), 'idle (starts on first call)');
        assert.equal(by.bad.ok, false);
        assert.equal(by.bad.degraded, true);
        assert.match(by.bad.error, /^failed/);
        assert.equal(st.hub.cap, 4);
    } finally { await hub.close(); fw.close(); one.close(); }
});

test('serve starts the hub before 1mcp when the sidecar has entries, and stop() kills the hub children', async () => {
    const { startServe } = await import('../bin/aos-gateway.mjs');
    const s = setup(['github']);
    fs.writeFileSync(path.join(s.dir, 'token'), TOKEN, { mode: 0o600 });
    const free = () => new Promise((resolve) => { const srv = http.createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
    const upstreamPort = await free();
    const fake1mcp = path.join(s.dir, 'one.js');
    fs.writeFileSync(fake1mcp, `require('http').createServer((q,r)=>{r.writeHead(200);r.end('{}');}).listen(${upstreamPort},'127.0.0.1');`);
    const h = await startServe({ dir: s.dir, port: 0, upstreamPort, hubPort: 0, entry: 'x', log: () => {}, spawnFn: (c, a, o) => spawn(process.execPath, [fake1mcp], o) });
    try {
        assert.ok(h.hubPort > 0);
        const r = await fetch(`http://127.0.0.1:${h.hubPort}/github/mcp`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo' } }) }).then((x) => x.json());
        assert.ok(r.result);
    } finally { await h.stop(); }
    const [pid] = s.starts();
    assert.ok(await until(() => !alive(pid)), 'hub child stopped with the gateway');
    // No sidecar entries (AOS_GATEWAY_ONDEMAND=0): no hub at all.
    fs.writeFileSync(path.join(s.dir, SIDECAR_FILE), JSON.stringify({ servers: {} }), { mode: 0o600 });
    const h2 = await startServe({ dir: s.dir, port: 0, upstreamPort, hubPort: 0, entry: 'x', log: () => {}, spawnFn: (c, a, o) => spawn(process.execPath, [fake1mcp], o) });
    assert.equal(h2.hubPort, null);
    await h2.stop();
});
