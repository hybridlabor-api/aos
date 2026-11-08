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
const { createHub, reapStaleChildren, idleMsOf, maxUpstreamsOf, CHILDREN_FILE, loadSidecar, warm } = require('../lib/gateway/hub.js');
const { hubSplit, writeGatewayConfig, gatewayConfigTexts, SIDECAR_FILE } = require('../lib/gateway/config.js');
const { gatewayStatus, hubText } = await import('../bin/aos-gateway.mjs');

const TOKEN = 'a'.repeat(64);
const FAKE = `
const fs = require('fs');
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, process.pid + '\\n');
if (process.env.FAKE_STDERR) fs.writeSync(2, process.env.FAKE_STDERR + '\\n');
if (process.env.FAKE_CRASH) process.exit(3);
if (process.env.FAKE_GRANDCHILD) {
  const g = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  fs.writeFileSync(process.env.FAKE_GRANDCHILD, String(g.pid));
}
const desc = process.env.FAKE_DESC || 'echo';
let buf = '';
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.id === undefined) continue;
    const out = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
    if (m.method === 'initialize') out({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } });
    else if (m.method === 'tools/list') out({ tools: [{ name: 'echo', description: desc, inputSchema: { type: 'object' } }, { name: 'sleep', inputSchema: { type: 'object' } }] });
    else if (m.method === 'tools/call' && m.params.name === 'die') process.exit(0);
    else if (m.method === 'tools/call' && m.params.name === 'big') process.stdout.write('x'.repeat(5000) + '\\n');
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
    const hub = createHub({ dir, token: TOKEN, port: 0, spawnFn: (...a) => { spawns++; return spawn(...a); }, ...opts });
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
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { old: { type: 'http', url: 'http://127.0.0.1:7792/old/mcp', headers: { Authorization: `Bearer ${TOKEN}` } }, gh: { command: 'x', env: { PATH: '/secret-path' } } } }));
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
    // The backup keeps the shape but never the token or env values.
    const prevText = fs.readFileSync(path.join(dir, 'mcp.json.prev'), 'utf8');
    assert.ok(!prevText.includes(TOKEN) && !prevText.includes('/secret-path'));
    assert.deepEqual(JSON.parse(prevText).mcpServers.gh, { command: 'x', env: { PATH: '' } });
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
    const longer = spawn(process.execPath, [s.script, 'github', 'extra'], { stdio: ['pipe', 'ignore', 'ignore'] });
    const restarted = spawn(process.execPath, [s.script, 'github'], { stdio: ['pipe', 'ignore', 'ignore'] });
    const own = { name: 'github', command: process.execPath, args: [s.script, 'github'], argv: [process.execPath, s.script, 'github'] };
    try {
        await new Promise((r) => setTimeout(r, 100));
        fs.writeFileSync(path.join(s.dir, CHILDREN_FILE), JSON.stringify({
            [foreign.pid]: own, // same record, foreign command line
            [ours.pid]: own,
            [longer.pid]: own, // the record is a prefix of its argv: not exact, left alone
            [restarted.pid]: { ...own, started: 'Thu Jan  1 00:00:00 1970' }, // pid reused by a later start
            1: { name: 'github', command: 'init', args: [], argv: ['init'] },
        }));
        const killed = [];
        const reaped = reapStaleChildren(s.dir, { kill: (pid, sig, group) => { killed.push([pid, group]); process.kill(pid, 'SIGKILL'); } });
        if (process.platform !== 'win32') {
            assert.deepEqual(reaped, [ours.pid]);
            assert.deepEqual(killed, [[ours.pid, false]], 'not a group leader (pgid != pid): only the pid');
            for (const p of [foreign, longer, restarted]) assert.ok(alive(p.pid));
        }
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir, CHILDREN_FILE), 'utf8')), {});

        // The record must also match the current sidecar entry: a changed sidecar leaves the pid alone.
        fs.writeFileSync(path.join(s.dir, CHILDREN_FILE), JSON.stringify({ [longer.pid]: { ...own, args: [s.script, 'github', 'extra'], argv: [process.execPath, s.script, 'github', 'extra'] } }));
        assert.deepEqual(reapStaleChildren(s.dir, { kill: () => assert.fail('signalled a pid the sidecar does not name') }), []);
    } finally { for (const p of [foreign, ours, longer, restarted]) p.kill('SIGKILL'); }
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

const writeSidecar = (s, names, env = {}) => fs.writeFileSync(path.join(s.dir, SIDECAR_FILE), JSON.stringify({ servers: Object.fromEntries(names.map((n) => [n, { command: process.execPath, args: [s.script, n], env: { FAKE_LOG: s.log, ...env }, inheritParentEnv: false }])) }), { mode: 0o600 });

test('(2) a leader that exits on its own takes its process group with it (POSIX)', { skip: process.platform === 'win32' }, async () => {
    const s = setup(['github']);
    const gfile = path.join(s.dir, 'grandchild.pid');
    writeSidecar(s, ['github'], { FAKE_GRANDCHILD: gfile });
    const { hub, rpc } = await startHub(s.dir);
    try {
        await rpc('github', 'tools/call', { name: 'echo' });
        const g = Number(fs.readFileSync(gfile, 'utf8'));
        assert.ok(alive(g));
        const r = await rpc('github', 'tools/call', { name: 'die' });
        assert.match(r.body.error.message, /exited/);
        assert.ok(await until(() => !alive(g)), 'grandchild swept with the group');
    } finally { await hub.close(); }
});

test('(3) stderr secrets are redacted in JSON-RPC errors and /status', async () => {
    const s = setup(['bad'], { bad: { FAKE_CRASH: '1', FAKE_STDERR: 'auth failed for ghp_abcdefghijklmnop1234 Bearer abc.def' } });
    const { hub, rpc } = await startHub(s.dir);
    try {
        const r = await rpc('bad', 'tools/call', { name: 'echo' });
        assert.match(r.body.error.message, /auth failed for \*\*\*/);
        const all = JSON.stringify(r.body) + JSON.stringify(hub.statusOf());
        assert.ok(!all.includes('ghp_abcdefghijklmnop1234') && !all.includes('abc.def'), all);
    } finally { await hub.close(); }
});

test('(4) sidecar rejection reasons; hub entries without a sidecar still bind the hub first, warn, and a taken hub port refuses the start', async () => {
    const s = setup(['github']);
    if (process.platform !== 'win32') {
        fs.chmodSync(path.join(s.dir, SIDECAR_FILE), 0o644);
        assert.match(loadSidecar(s.dir).error, /group\/others/);
        fs.chmodSync(path.join(s.dir, SIDECAR_FILE), 0o600);
    }
    fs.writeFileSync(path.join(s.dir, SIDECAR_FILE), '{nope', { mode: 0o600 });
    assert.match(loadSidecar(s.dir).error, /not valid JSON/);
    fs.unlinkSync(path.join(s.dir, SIDECAR_FILE));
    assert.match(loadSidecar(s.dir).error, /missing/);

    const { startServe } = await import('../bin/aos-gateway.mjs');
    fs.writeFileSync(path.join(s.dir, 'token'), TOKEN, { mode: 0o600 });
    fs.writeFileSync(path.join(s.dir, 'mcp.json'), JSON.stringify({ mcpServers: { github: { type: 'http', url: 'http://127.0.0.1:7792/github/mcp' } } }));
    const free = () => new Promise((resolve) => { const srv = http.createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); }); });
    const upstreamPort = await free();
    const one = path.join(s.dir, 'one.js');
    fs.writeFileSync(one, `require('http').createServer((q,r)=>{r.writeHead(200);r.end('{}');}).listen(${upstreamPort},'127.0.0.1');`);
    const logs = [];
    const h = await startServe({ dir: s.dir, port: 0, upstreamPort, hubPort: 0, entry: 'x', log: (m) => logs.push(m), spawnFn: (c, a, o) => spawn(process.execPath, [one], o) });
    try {
        assert.ok(h.hubPort > 0, 'hub bound although the sidecar is missing');
        assert.ok(logs.some((m) => /WARNING mcp.json routes github to the on-demand hub/.test(m)), logs.join('\n'));
        await new Promise((r) => setTimeout(r, 300));
        const st = await gatewayStatus({ dir: s.dir, port: h.port, upstreamPort, hubPort: h.hubPort });
        assert.match(st.hubWarning, /routes github to the on-demand hub, but its sidecar has no entry \(.*missing\)/);
    } finally { await h.stop(); }
    const squat = http.createServer();
    await new Promise((r) => squat.listen(0, '127.0.0.1', r));
    try {
        await assert.rejects(startServe({ dir: s.dir, port: 0, upstreamPort, hubPort: squat.address().port, entry: 'x', log: () => {}, spawnFn: () => assert.fail('1mcp must not start') }), /on-demand hub\) in use/);
    } finally { squat.close(); }
});

test('(5) a changed tool is logged and flagged, never swapped in silently; warm accepts it', async () => {
    const s = setup(['github'], { github: { FAKE_DESC: 'v1' } });
    let h = await startHub(s.dir);
    await h.rpc('github', 'tools/list');
    await h.hub.close();
    assert.ok(readHash(s.dir));
    writeSidecar(s, ['github'], { FAKE_DESC: 'v2' });
    const logs = [];
    h = await startHub(s.dir, { log: (m) => logs.push(m) });
    try {
        await h.rpc('github', 'tools/call', { name: 'echo' });
        assert.ok(logs.includes('aos-gateway hub: catalog changed: github: echo'), logs.join('\n'));
        assert.equal(h.hub.statusOf().servers.github.catalogChanged, true);
        assert.match(hubText(h.hub.statusOf().servers.github), /catalog changed/);
    } finally { await h.hub.close(); }
    const cat = await warm(s.dir, 'github');
    assert.equal(cat.changed, undefined);
    assert.equal(cat.tools[0].description, 'v2');
});
const readHash = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'catalog', 'github.json'), 'utf8')).toolHashes.echo;

test('(6) the cap slot is reserved synchronously: concurrent waiters never overshoot', async () => {
    const s = setup(['a', 'b', 'c', 'd']);
    let live = 0, peak = 0;
    const { hub, rpc } = await startHub(s.dir, { maxUpstreams: 1, spawnFn: (...x) => { const c = spawn(...x); live++; peak = Math.max(peak, live); c.once('exit', () => live--); return c; } });
    try {
        const slow = rpc('a', 'tools/call', { name: 'sleep' });
        await new Promise((r) => setTimeout(r, 100));
        const lists = await Promise.all(['b', 'c', 'd'].map((n) => rpc(n, 'tools/list')));
        for (const l of lists) assert.equal(l.body.result.tools.length, 2);
        await slow;
        assert.equal(peak, 1);
    } finally { await hub.close(); }
});

test('(7) __proto__/constructor/prototype stay eager and are reported, never dropped or routed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwhub-names-'));
    fs.writeFileSync(path.join(dir, 'token'), TOKEN, { mode: 0o600 });
    const servers = JSON.parse('{"__proto__": {"command": "node", "args": ["p.js"]}, "constructor": {"command": "node", "args": ["c.js"]}, "ok": {"command": "node", "args": ["o.js"]}}');
    const logs = [];
    writeGatewayConfig(dir, servers, {}, (m) => logs.push(m));
    const mcp = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).mcpServers;
    assert.ok(Object.prototype.hasOwnProperty.call(mcp, '__proto__'));
    assert.deepEqual(mcp.__proto__, { command: 'node', args: ['p.js'] });
    assert.deepEqual(mcp.constructor, { command: 'node', args: ['c.js'] });
    assert.equal(mcp.ok.type, 'http');
    assert.match(logs.join('\n'), /__proto__, constructor cannot be served on demand/);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, SIDECAR_FILE), 'utf8')).servers), ['ok']);
});

test('(8) an oversized stdout line fails the call at once; an oversized catalog keeps the previous one', async () => {
    const s = setup(['github']);
    let h = await startHub(s.dir, { maxLine: 1000 });
    try {
        const r = await h.rpc('github', 'tools/call', { name: 'big' });
        assert.match(r.body.error.message, /sent a line over 1000 bytes/);
        assert.ok((await h.rpc('github', 'tools/call', { name: 'echo' }, { id: 2 })).body.result, 'the child keeps serving after the dropped line');
    } finally { await h.hub.close(); }
    const before = fs.readFileSync(path.join(s.dir, 'catalog', 'github.json'), 'utf8');
    writeSidecar(s, ['github'], { FAKE_DESC: 'huge' });
    const logs = [];
    h = await startHub(s.dir, { maxCatalog: 10, log: (m) => logs.push(m) });
    try {
        await h.rpc('github', 'tools/call', { name: 'echo' });
        assert.equal(fs.readFileSync(path.join(s.dir, 'catalog', 'github.json'), 'utf8'), before);
        assert.ok(logs.some((m) => /catalog over 10 bytes; kept the previous catalog/.test(m)), logs.join('\n'));
    } finally { await h.hub.close(); }
});
