'use strict';
// On-demand upstream hub (#255), run inside `aos-gateway serve`. 1mcp reaches each stdio upstream as an HTTP server at
// 127.0.0.1:HUB_PORT/<name>/mcp. initialize and the list calls come from a cached catalog; any other request starts the
// real stdio process (from the owner-only sidecar file, never from the request), forwards it and keeps the process until
// it has been idle for idleMs. At most maxUpstreams run at once.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createHash, timingSafeEqual } = require('crypto');
const { HUB_PORT, SIDECAR_FILE, HUB_NAME } = require('./config');

const MAX_BODY = 4 << 20;
const PROTOCOL = '2025-06-18';
const LISTS = { 'tools/list': 'tools', 'prompts/list': 'prompts', 'resources/list': 'resources', 'resources/templates/list': 'resourceTemplates' };
const CHILDREN_FILE = 'hub-children.json';

const intEnv = (v, min, max, def) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : def; };
const idleMsOf = (env = process.env) => intEnv(env.AOS_GATEWAY_IDLE_MS, 30000, 86400000, 600000);
const maxUpstreamsOf = (env = process.env) => intEnv(env.AOS_GATEWAY_MAX_UPSTREAMS, 1, 32, 4);

// The MCP SDK's default environment for a stdio child (1mcp starts from it too when inheritParentEnv is false).
const SAFE_ENV = process.platform === 'win32'
    ? ['APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PROCESSOR_ARCHITECTURE', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'USERNAME', 'USERPROFILE', 'PROGRAMFILES']
    : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'];
const childEnv = (entry, parent = process.env) => {
    const base = entry.inheritParentEnv ? { ...parent } : Object.fromEntries(SAFE_ENV.filter((k) => parent[k] !== undefined && !parent[k].startsWith('()')).map((k) => [k, parent[k]]));
    return { ...base, ...(entry.env || {}) };
};

// Owner-only, like the token: the hub runs whatever this file names.
function readSidecar(dir) {
    const file = path.join(dir, SIDECAR_FILE);
    try {
        if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o077)) return {};
        const s = JSON.parse(fs.readFileSync(file, 'utf8')).servers;
        const out = {};
        for (const [name, e] of Object.entries(s && typeof s === 'object' ? s : {})) {
            if (HUB_NAME.test(name) && e && typeof e.command === 'string' && e.command && Array.isArray(e.args) && e.args.every((a) => typeof a === 'string')) out[name] = e;
        }
        return out;
    } catch { return {}; }
}

const catalogFile = (dir, name) => path.join(dir, 'catalog', `${name}.json`);
const readCatalog = (dir, name) => { try { return JSON.parse(fs.readFileSync(catalogFile(dir, name), 'utf8')); } catch { return null; } };
function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
}

// Windows: npx/uv are .cmd shims that spawn() cannot run without a shell. Resolve them on the child's PATH and run them
// through cmd.exe /d /s /c. shortcut: no cmd metacharacter escaping (args come from the owner-only sidecar), upgrade to cross-spawn's rules if a server needs it.
function spawnArgs(entry, env, platform = process.platform) {
    if (platform !== 'win32' || /\.exe$/i.test(entry.command)) return [entry.command, entry.args, {}];
    const exts = path.win32.extname(entry.command) ? [''] : ['.exe', '.cmd', '.bat'];
    const dirs = path.win32.isAbsolute(entry.command) ? [''] : String(env.PATH || env.Path || '').split(';').filter(Boolean);
    for (const d of dirs) for (const x of exts) {
        const f = d ? path.win32.join(d, entry.command + x) : entry.command + x;
        if (!fs.existsSync(f)) continue;
        if (/\.exe$/i.test(f)) return [f, entry.args, {}];
        const q = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
        return [env.ComSpec || process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[f, ...entry.args].map(q).join(' ')}"`], { windowsVerbatimArguments: true }];
    }
    return [entry.command, entry.args, {}];
}

// Command line of a live pid, '' when gone or unreadable. Windows has no ps: one CIM query for that pid.
function commandLineOf(pid, platform = process.platform) {
    const r = platform === 'win32'
        ? spawnSync(require('../win-bin').winBin('powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
        : spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', shell: false, windowsHide: true });
    return r.status === 0 ? String(r.stdout || '').trim() : '';
}

// The whole tree: npx/uv start the real server as their own child. POSIX children run in their own process group.
function killTree(pid, signal = 'SIGTERM', platform = process.platform) {
    if (platform === 'win32') {
        try { require('../stop-module-processes').killTree(pid); } catch { /* gone */ }
        return;
    }
    try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } }
}

// A recorded pid is ours only while its command line still carries the command and the first args the hub started it with.
const ownsCmd = (cmd, rec) => !!cmd && !!rec && typeof rec.command === 'string' && cmd.includes(path.basename(rec.command).replace(/\.(exe|cmd|bat)$/i, ''))
    && (rec.args || []).slice(0, 3).every((a) => cmd.includes(a));

// Hub start: stop children a crashed hub left behind. Never signals a pid whose command line does not match the record.
function reapStaleChildren(dir, { cmdOf = commandLineOf, kill = killTree } = {}) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(dir, CHILDREN_FILE), 'utf8')); } catch { return []; }
    const reaped = [];
    for (const [pidText, r] of Object.entries(rec && typeof rec === 'object' ? rec : {})) {
        const pid = Number(pidText);
        if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
        if (!ownsCmd(cmdOf(pid), r)) continue;
        kill(pid, 'SIGKILL');
        reaped.push(pid);
    }
    try { writeJson(path.join(dir, CHILDREN_FILE), {}); } catch { /* best effort */ }
    return reaped;
}

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

function createHub({ dir, token, port = HUB_PORT, host = '127.0.0.1', env = process.env, spawnFn = spawn, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout, idleMs = idleMsOf(env), maxUpstreams = maxUpstreamsOf(env),
    startTimeoutMs = 60000, callTimeoutMs = 120000, maxStartsPerMinute = 3, onStderr = () => {}, log = () => {}, kill = killTree, cmdOf = commandLineOf, recordPids = true } = {}) {
    if (!token) throw new Error('token required');
    const want = createHash('sha256').update(token).digest();
    const ups = new Map(); // name -> { child, state, lastUse, inflight, idleTimer, starts, startPromise, lastError, pending, nextId, buf }
    const waiters = new Set();
    const children = {};
    let boundPort = null;
    let closing = false;

    const up = (name) => {
        if (!ups.has(name)) ups.set(name, { child: null, state: 'idle', lastUse: null, inflight: 0, idleTimer: null, starts: [], startPromise: null, lastError: null, pending: new Map(), nextId: 1 });
        return ups.get(name);
    };
    const saveChildren = () => { if (recordPids) try { writeJson(path.join(dir, CHILDREN_FILE), children); } catch { /* best effort */ } };
    const running = () => [...ups.values()].filter((u) => u.child).length;
    const wake = () => { for (const w of [...waiters]) w(); };

    const send = (u, msg) => { try { u.child.stdin.write(JSON.stringify(msg) + '\n'); } catch { /* exit handler rejects */ } };
    const request = (u, method, params, timeoutMs) => new Promise((resolve, reject) => {
        if (!u.child) return reject(Object.assign(new Error('upstream not running'), { crashed: true }));
        const id = u.nextId++;
        const t = setTimer(() => { u.pending.delete(id); reject(new Error(`no answer to ${method} within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
        u.pending.set(id, { resolve: (v) => { clearTimer(t); resolve(v); }, reject: (e) => { clearTimer(t); reject(e); } });
        send(u, { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
    });
    const onLine = (name, u, line) => {
        let m;
        try { m = JSON.parse(line); } catch { return; }
        if (!m || typeof m !== 'object') return;
        if (m.method && m.id !== undefined) return send(u, rpcError(m.id, -32601, `${m.method} is not supported through the on-demand gateway hub`));
        const p = m.id !== undefined && u.pending.get(m.id);
        if (!p) return;
        u.pending.delete(m.id);
        if (m.error) p.reject(Object.assign(new Error(m.error.message || 'upstream error'), { rpc: m.error }));
        else p.resolve(m.result);
    };

    const stopChild = (name, u) => new Promise((resolve) => {
        clearTimer(u.idleTimer);
        u.idleTimer = null;
        const c = u.child;
        if (!c) return resolve();
        u.stopping = true;
        const hard = setTimer(() => kill(c.pid, 'SIGKILL'), 3000);
        const done = () => { clearTimer(hard); resolve(); };
        c.once('exit', done);
        c.once('error', done);
        kill(c.pid, 'SIGTERM');
    });

    const armIdle = (name, u) => {
        clearTimer(u.idleTimer);
        u.idleTimer = null;
        if (u.child && u.inflight === 0) u.idleTimer = setTimer(() => { log(`aos-gateway hub: ${name} idle, stopping`); stopChild(name, u); }, idleMs);
    };

    async function record(name, u, init) {
        const cat = { initialize: { protocolVersion: init.protocolVersion, capabilities: init.capabilities || {}, serverInfo: init.serverInfo || { name }, ...(init.instructions ? { instructions: init.instructions } : {}) } };
        const caps = cat.initialize.capabilities;
        const all = async (method, key) => {
            const items = [];
            let cursor;
            for (let i = 0; i < 50; i++) {
                const r = await request(u, method, cursor ? { cursor } : {}, startTimeoutMs);
                items.push(...((r && r[key]) || []));
                if (!r || !r.nextCursor) break;
                cursor = r.nextCursor;
            }
            return items;
        };
        cat.tools = await all('tools/list', 'tools');
        if (caps.prompts) cat.prompts = await all('prompts/list', 'prompts');
        if (caps.resources) { cat.resources = await all('resources/list', 'resources'); cat.resourceTemplates = await all('resources/templates/list', 'resourceTemplates').catch(() => []); }
        const prev = readCatalog(dir, name);
        if (JSON.stringify(prev) !== JSON.stringify(cat)) {
            try { writeJson(catalogFile(dir, name), cat); log(`aos-gateway hub: ${prev ? 'refreshed' : 'recorded'} catalog of ${name} (${cat.tools.length} tools)`); } catch (e) { log(`aos-gateway hub: cannot write the catalog of ${name}: ${e.code || e.message}`); }
        }
        return cat;
    }

    // A slot under the cap: evicts the least recently used idle child; wait=true (catalog recording) waits for one instead of failing.
    async function slot(name, wait) {
        const deadline = now() + callTimeoutMs;
        for (;;) {
            if (running() < maxUpstreams) return;
            const idle = [...ups.entries()].filter(([n, u]) => n !== name && u.child && u.state === 'running' && u.inflight === 0).sort((a, b) => a[1].lastUse - b[1].lastUse)[0];
            if (idle) { log(`aos-gateway hub: cap ${maxUpstreams} reached, stopping least recently used ${idle[0]}`); await stopChild(idle[0], idle[1]); continue; }
            if (!wait || now() >= deadline) throw Object.assign(new Error(`gateway cap reached (${running()} running); retry later`), { cap: true });
            await new Promise((r) => { const t = setTimer(() => { waiters.delete(r); r(); }, 250); waiters.add(() => { clearTimer(t); waiters.delete(r); r(); }); });
        }
    }

    function ensureChild(name, entry, { wait = false } = {}) {
        const u = up(name);
        if (u.child && u.state === 'running') return Promise.resolve(u);
        if (u.startPromise) return u.startPromise;
        u.startPromise = (async () => {
            u.starts = u.starts.filter((t) => now() - t < 60000);
            if (u.starts.length >= maxStartsPerMinute) throw new Error(`upstream ${name} failed to start ${u.starts.length} times in the last minute; retry later${u.lastError ? ` (last: ${u.lastError})` : ''}`);
            await slot(name, wait);
            if (closing) throw new Error('gateway hub is stopping');
            u.starts.push(now());
            u.state = 'starting';
            const cenv = childEnv(entry, env);
            const [cmd, args, extra] = spawnArgs(entry, cenv);
            let c;
            try {
                c = spawnFn(cmd, args, { cwd: entry.cwd || undefined, env: cenv, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: process.platform !== 'win32', ...extra });
            } catch (e) { throw Object.assign(new Error(`cannot start ${name}: ${e.code || e.message}`), { crashed: true }); }
            u.child = c;
            u.stopping = false;
            if (c.pid) { children[c.pid] = { name, command: entry.command, args: entry.args.slice(0, 3) }; saveChildren(); }
            let buf = '';
            c.stdout.on('data', (d) => {
                buf += d;
                if (buf.length > 64 << 20) buf = '';
                let i;
                while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(name, u, line); }
            });
            let ebuf = '';
            c.stderr.on('data', (d) => {
                ebuf = (ebuf + d).slice(-65536);
                const parts = ebuf.split('\n');
                ebuf = parts.pop();
                for (const l of parts) if (l.trim()) { u.lastErrLine = l.trim().slice(0, 300); onStderr(name, l); }
            });
            c.stdin.on('error', () => {});
            const exited = new Promise((resolve) => {
                const done = (why) => {
                    if (u.child !== c) return resolve();
                    u.child = null;
                    delete children[c.pid];
                    saveChildren();
                    clearTimer(u.idleTimer);
                    u.idleTimer = null;
                    const err = Object.assign(new Error(`upstream ${name} exited (${why})${u.lastErrLine ? `: ${u.lastErrLine}` : ''}`), { crashed: true });
                    for (const p of u.pending.values()) p.reject(err);
                    u.pending.clear();
                    if (u.stopping) { u.state = 'idle'; } else { u.state = 'failed'; u.lastError = err.message; log(`aos-gateway hub: ${err.message}`); }
                    wake();
                    resolve(err);
                };
                c.once('exit', (code, sig) => done(sig ? `signal ${sig}` : `code ${code}`));
                c.once('error', (e) => done(e.code || e.message));
            });
            try {
                const init = await Promise.race([
                    request(u, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'aos-gateway-hub', version: '1' } }, startTimeoutMs),
                    exited.then((e) => { throw e || Object.assign(new Error(`upstream ${name} exited`), { crashed: true }); }),
                ]);
                send(u, { jsonrpc: '2.0', method: 'notifications/initialized' });
                await record(name, u, init);
                u.state = 'running';
                u.lastError = null;
                return u;
            } catch (e) {
                if (u.child === c) { u.state = 'failed'; u.lastError = e.message; await stopChild(name, u); u.state = 'failed'; }
                throw e.crashed ? e : Object.assign(e, { crashed: true });
            }
        })().finally(() => { u.startPromise = null; });
        return u.startPromise;
    }

    // Starts (at most one restart when the start itself fails), forwards one request, then arms the idle timer.
    async function forward(name, entry, msg, { wait = false } = {}) {
        const u = up(name);
        u.inflight++;
        u.lastUse = now();
        clearTimer(u.idleTimer);
        try {
            for (let attempt = 0; ; attempt++) {
                try {
                    await ensureChild(name, entry, { wait });
                    break;
                } catch (e) {
                    if (attempt >= 1 || e.cap || !e.crashed || /times in the last minute/.test(e.message)) throw e;
                    log(`aos-gateway hub: ${name} did not start (${e.message}); one more try`);
                }
            }
            return msg ? await request(u, msg.method, msg.params, callTimeoutMs) : null;
        } finally {
            u.inflight--;
            u.lastUse = now();
            armIdle(name, u);
            wake();
        }
    }

    async function handle(name, entry, msg) {
        const id = msg.id;
        if (msg.method === 'initialize') {
            const cat = readCatalog(dir, name);
            const init = cat && cat.initialize;
            return { jsonrpc: '2.0', id, result: { protocolVersion: (msg.params && msg.params.protocolVersion) || PROTOCOL, capabilities: (init && init.capabilities) || { tools: {} }, serverInfo: (init && init.serverInfo) || { name, version: 'on-demand' }, ...(init && init.instructions ? { instructions: init.instructions } : {}) } };
        }
        if (msg.method === 'ping' || msg.method === 'logging/setLevel') return { jsonrpc: '2.0', id, result: {} };
        if (LISTS[msg.method]) {
            let cat = readCatalog(dir, name);
            if (!cat) { await forward(name, entry, null, { wait: true }); cat = readCatalog(dir, name) || {}; }
            return { jsonrpc: '2.0', id, result: { [LISTS[msg.method]]: cat[LISTS[msg.method]] || [] } };
        }
        const result = await forward(name, entry, msg);
        return { jsonrpc: '2.0', id, result };
    }

    const statusOf = () => {
        const out = {};
        for (const name of Object.keys(readSidecar(dir))) {
            const u = ups.get(name);
            out[name] = { state: u ? (u.child ? (u.state === 'running' ? 'running' : 'starting') : u.state) : 'idle', lastUse: u && u.lastUse ? new Date(u.lastUse).toISOString() : null, catalog: !!readCatalog(dir, name), ...(u && u.state === 'failed' && u.lastError ? { error: u.lastError } : {}) };
        }
        return { cap: maxUpstreams, idleMs, running: running(), servers: out };
    };

    const tokenOk = (req) => {
        const raw = req.headers['x-aos-token'] ?? String(req.headers.authorization || '').replace(/^Bearer /i, '');
        return timingSafeEqual(createHash('sha256').update(String(raw)).digest(), want);
    };
    const reply = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

    const server = http.createServer((req, res) => {
        if (![`127.0.0.1:${boundPort}`, `localhost:${boundPort}`].includes(req.headers.host || '') || req.headers.origin !== undefined) return reply(res, 403, 'forbidden', 'text/plain');
        if (!tokenOk(req)) return reply(res, 401, 'unauthorized', 'text/plain');
        const url = String(req.url || '').split('?')[0];
        if (url === '/status' && req.method === 'GET') return reply(res, 200, statusOf());
        const m = /^\/([^/]+)\/mcp$/.exec(url);
        const sidecar = readSidecar(dir);
        if (!m || !HUB_NAME.test(m[1]) || !Object.prototype.hasOwnProperty.call(sidecar, m[1])) return reply(res, 404, 'unknown server', 'text/plain');
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end(); }
        const name = m[1];
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY) { reply(res, 413, 'request too large', 'text/plain'); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', async () => {
            if (size > MAX_BODY) return;
            let body;
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, rpcError(null, -32700, 'parse error')); }
            const batch = Array.isArray(body);
            const msgs = (batch ? body : [body]).filter((x) => x && typeof x === 'object');
            const out = await Promise.all(msgs.map(async (msg) => {
                if (typeof msg.method !== 'string') return null; // a response to us: nothing is ever asked of 1mcp
                if (msg.id === undefined || msg.id === null) return null; // notification
                try { return await handle(name, sidecar[name], msg); } catch (e) {
                    return e.rpc ? { jsonrpc: '2.0', id: msg.id, error: e.rpc } : rpcError(msg.id, -32603, `aos-gateway hub: ${e.message}`);
                }
            }));
            const answers = out.filter(Boolean);
            if (!answers.length) { res.writeHead(202); return res.end(); }
            reply(res, 200, batch ? answers : answers[0]);
        });
    });
    server.requestTimeout = callTimeoutMs + startTimeoutMs + 10000;

    return {
        server,
        statusOf,
        forward,
        listen: () => new Promise((resolve, reject) => {
            try { const r = reapStaleChildren(dir, { cmdOf, kill }); if (r.length) log(`aos-gateway hub: stopped ${r.length} stale upstream process(es) of an earlier run`); } catch { /* best effort */ }
            server.once('error', reject);
            server.listen(port, host, () => { boundPort = server.address().port; server.removeListener('error', reject); resolve(boundPort); });
        }),
        killNow() { for (const u of ups.values()) if (u.child) kill(u.child.pid, 'SIGKILL'); },
        async close() {
            closing = true;
            await Promise.all([...ups.entries()].map(([n, u]) => stopChild(n, u)));
            saveChildren();
            await new Promise((resolve) => { if (!server.listening) return resolve(); server.close(() => resolve()); server.closeAllConnections(); });
        },
    };
}

// `aos-gateway warm <name>`: start the server once outside the running hub, record its catalog, stop it.
async function warm(dir, name, opts = {}) {
    const entry = readSidecar(dir)[name];
    if (!entry) throw new Error(`${name} is not an on-demand upstream (see ${path.join(dir, SIDECAR_FILE)})`);
    const hub = createHub({ dir, token: 'warm', maxUpstreams: 1, recordPids: false, ...opts });
    try { await hub.forward(name, entry, null); return readCatalog(dir, name); } finally { await hub.close(); }
}

module.exports = { createHub, warm, readSidecar, readCatalog, reapStaleChildren, ownsCmd, commandLineOf, killTree, spawnArgs, idleMsOf, maxUpstreamsOf, CHILDREN_FILE };
