#!/usr/bin/env node
// Local MCP gateway: token-checking forwarder on 127.0.0.1:7790 in front of @1mcp/agent on 127.0.0.1:7791.
// Usage: aos-gateway serve | start | stop | restart | status [--json] | enable | direct | adopt [--dry-run] [--json] | inspect [target] | run <server>/<tool> --args '<json>'
import '../lib/cli-help-guard.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { gatewayDir, lazyLoadingOn, asyncLoadingOn, RUNTIME_FILE, GATEWAY_PORT, UPSTREAM_PORT, GATEWAY_SERVERS } = req('../lib/gateway/config.js');
const { createForwarder } = req('../lib/gateway/forwarder.js');
const { enable, disable } = req('../lib/gateway/harness.js');
const { shippedPresets, livePresets } = req('../lib/v5/pkg-gateway.js');
const { contextProfileOf } = req('../lib/v5/context-profiles.js');
const profile = req('../lib/v5/profile.js');
const { harnessMcpFiles, shippedServers } = req('../lib/mcp-secrets.js');
const adoptApi = req('../lib/gateway/adopt.js');

export const lazyText = (s) => !s.running ? 'not running' : s.lazyLoading === null ? 'unknown (restart the gateway to record it)'
    : `${s.lazyLoading ? 'on (meta-tools tool_list/tool_schema/tool_invoke)' : 'off'}${s.restartPending ? `; restart pending (gateway.json says ${s.lazyLoading ? 'off' : 'on'}; run aos-gateway restart)` : ''}`;

export const asyncText = (s) => !s.running ? 'not running'
    : `${s.asyncLoading ? 'on (--enable-async-loading)' : 'off'}${s.asyncRestartPending ? `; restart pending (gateway.json says ${s.asyncLoading ? 'off' : 'on'}; run aos-gateway restart)` : ''}`;

// First non-flag argument, skipping the value of every 1mcp option that takes one (`--args '{"q":"x"}'` must not be the target).
const VALUE_FLAGS = new Set(['--args', '--format', '--limit', '--cursor', '--preset', '-p', '--tag-filter', '-f', '--tags', '--context', '--url', '-u']);
export function firstPositional(argv) {
    for (let i = 0; i < argv.length; i++) {
        if (VALUE_FLAGS.has(argv[i])) { i++; continue; }
        if (!argv[i].startsWith('-')) return argv[i];
    }
    return undefined;
}

export const LABEL = 'com.bdb.aos.gateway';
export const WIN_TASK = 'AOS MCP Gateway';

// Always resolves: response, error, abnormal close or the overall timeout, whichever comes first.
const get = (port, urlPath, timeoutMs = 2000) => new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const r = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
        let body = '';
        res.on('data', (c) => { if (body.length < 1e6) body += c; });
        res.on('end', () => finish({ status: res.statusCode, headers: res.headers, body }));
        res.on('error', (e) => finish({ error: e.code || e.message }));
        res.on('close', () => finish({ error: 'ECONNRESET' }));
    });
    timer = setTimeout(() => { r.destroy(); finish({ error: 'ETIMEDOUT' }); }, timeoutMs);
    r.on('error', (e) => finish({ error: e.code || e.message }));
});

function readPid(dir) {
    try {
        const pid = Number(fs.readFileSync(path.join(dir, 'gateway.pid'), 'utf8'));
        process.kill(pid, 0);
        return pid;
    } catch { return null; }
}

function upstreamNames(dir) {
    try { return Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).mcpServers || {}); } catch { return []; }
}

// 1mcp 0.38.2 connects every upstream at startup (lazy loading only changes how tools are exposed). A server whose spawn
// failed, that exited early or did not answer MCP initialize in 60 s (3 tries) stays "unknown" until the next start: nothing
// retries it, and `1mcp mcp restart` needs an admin login AOS never sets up. The reason is in 1mcp's own log line.
const NEVER_CONNECTED = new Set(['unknown', 'disconnected', 'error']);
export function redactLine(text) {
    return String(text)
        .replace(/\b(gh[pousr]_|github_pat_|sk-|AIza)[\w-]{8,}/g, '***')
        .replace(/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer ***')
        .replace(/\bBasic\s+[A-Za-z0-9+/=_-]{6,}/g, 'Basic ***')
        .replace(/\/\/[^\s/@:]+:[^\s/@]+@/g, '//***@')
        .replace(/("(?:[\w-]*(?:token|api_?key|secret|passw(?:or)?d|credential)[\w-]*)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"***"')
        .replace(/([?&;]|\b)((?:[\w-]*(?:token|key|secret|passw(?:or)?d|pat|auth|credential)[\w-]*))=[^&\s"';]+/gi, '$1$2=***');
}
export function redactLog(text) {
    return redactLine(text).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}
// Redacts whole lines before they reach the log; a partial trailing line waits for its newline.
export function lineRedactor(write) {
    let rest = '';
    const feed = (chunk) => {
        const parts = (rest + chunk.toString()).split('\n');
        rest = parts.pop();
        if (rest.length > 65536) { parts.push(rest); rest = ''; }
        if (parts.length) write(parts.map(redactLine).join('\n') + '\n');
    };
    feed.flush = () => { if (rest) { write(redactLine(rest) + '\n'); rest = ''; } };
    return feed;
}
export function connectFailures(dir) {
    const out = new Map();
    let text = '';
    try {
        const fd = fs.openSync(path.join(dir, 'gateway.log'), 'r');
        try {
            const size = fs.fstatSync(fd).size, len = Math.min(size, 1 << 20), buf = Buffer.alloc(len);
            fs.readSync(fd, buf, 0, len, size - len);
            text = buf.toString('utf8');
        } finally { fs.closeSync(fd); }
    } catch { /* no log */ }
    for (const m of text.matchAll(/\[ERROR\] message="Failed to connect to ([\w-]+): ([^"]*)"/g)) out.set(m[1], redactLog(m[2]));
    return out;
}
export const neverConnected = (name, failures) =>
    `not connected since the gateway started (${failures.get(name) ? `1mcp log: ${failures.get(name)}` : 'spawn failed, early exit or no MCP answer within 60 s; see gateway.log'}). Fix the cause, then run: aos-gateway restart`;

// 1mcp's recovery command for a dead server is `1mcp mcp restart`, which needs an admin session AOS never creates.
export function runHint(output) {
  const m = /Recovery: 1mcp mcp restart (\S+)/.exec(String(output));
  return m ? `aos-gateway: "1mcp mcp restart ${m[1]}" needs an admin login that AOS does not set up. Run \`aos-gateway status\` to see why ${m[1]} is not connected, fix the cause, then \`aos-gateway restart\`.` : null;
}

// 1mcp's /health is the path the S1 spike polled (200 = up). Per-upstream health is UNVERIFIED: every
// upstream reports the state of 1mcp as a whole until a per-server endpoint is confirmed.
export async function gatewayStatus({ dir, port = GATEWAY_PORT, upstreamPort = UPSTREAM_PORT }) {
    const fw = await get(port, '/healthcheck');
    const running = fw.status === 200 && fw.headers['x-aos-gateway'] === '1';
    const inUse = !running && fw.error !== 'ECONNREFUSED';
    // 1mcp answers slowly while it rebuilds its capability catalog (uv upstreams take minutes): one longer retry,
    // and a timeout after that is "busy", not "down" (F14). Refused or a non-200 answer stays a failure.
    let inner = running ? await get(upstreamPort, '/health') : null;
    if (inner && inner.error === 'ETIMEDOUT') inner = await get(upstreamPort, '/health', 10000);
    const busy = !!inner && inner.error === 'ETIMEDOUT';
    const problem = inUse ? `port ${port} in use by another process` : !running ? 'gateway not running' : null;
    const details = new Map();
    try { for (const d of JSON.parse(inner && inner.body).servers.details) details.set(d.name, d); } catch { /* no per-server body */ }
    // /api/v1/servers (1mcp build/transport/http/routes/inspectRoutes.js): per-server { server, status, available }.
    // /health/ready can say "ready" with serverCount 0, so it is not used (#178).
    const listed = new Map();
    let apiServers = null;
    if (running && inner && !inner.error) {
        const api = await get(upstreamPort, '/api/v1/servers');
        try { if (api.status === 200) apiServers = JSON.parse(api.body).servers; } catch { /* not the expected JSON */ }
        if (Array.isArray(apiServers)) for (const e of apiServers) if (e && typeof e.server === 'string') listed.set(e.server, e);
    }
    const configured = upstreamNames(dir);
    let failureMap = null;
    const failures = () => failureMap || (failureMap = connectFailures(dir));
    const upstreams = configured.map((name) => {
        if (problem) return { name, ok: false, error: problem };
        if (Array.isArray(apiServers)) {
            const e = listed.get(name);
            if (e && e.available === true) return { name, ok: true };
            // Nothing listed at all is not "degraded": verify must not call that gateway ready.
            if (listed.size === 0) return { name, ok: false, error: `1mcp lists 0 servers while ${configured.length} are configured` };
            if (!e) return { name, ok: false, degraded: true, error: '1mcp does not list this server' };
            if (['pending', 'loading', 'initializing'].includes(e.status)) return { name, ok: false, busy: true, error: `upstream ${e.status}: 1mcp is still starting it (cold npx/uv starts take a minute); check again shortly` };
            return { name, ok: false, degraded: true, error: `upstream ${e.status || 'not connected'}${NEVER_CONNECTED.has(e.status) ? `: ${neverConnected(name, failures())}` : ''}` };
        }
        // 1mcp answers 503 once at most half of its upstreams are connected, but the body still lists each one:
        // a reachable 1mcp with failing upstreams is degraded (warn), not down.
        const d = details.get(name);
        if (d) return d.healthy ? { name, ok: true } : { name, ok: false, degraded: true, error: d.lastError || d.status || 'upstream not connected' };
        if (inner.status === 200) return { name, ok: true };
        if (busy) return { name, ok: false, busy: true, error: `1mcp busy on ${upstreamPort} (no answer in 12 s, likely a catalog refresh); check again in a minute` };
        if (inner.status === 503) return { name, ok: false, degraded: true, error: '1mcp health returned 503 without per-server details (some upstreams not connected)' };
        return { name, ok: false, error: inner.error ? `1mcp not reachable on ${upstreamPort} (${inner.error})` : `1mcp health returned ${inner.status}` };
    });
    // Upstream values are the state of 1mcp as a whole, not per-server health.
    // Effective = what the running serve recorded when it started 1mcp; configured = gateway.json now.
    let lazyLoading = null;
    if (running) try { const r = JSON.parse(fs.readFileSync(path.join(dir, RUNTIME_FILE), 'utf8')); if (typeof r.lazyLoading === 'boolean') lazyLoading = r.lazyLoading; } catch { /* unknown */ }
    const restartPending = lazyLoading !== null && lazyLoading !== lazyLoadingOn(dir);
    let asyncLoading = false;
    if (running) try { asyncLoading = JSON.parse(fs.readFileSync(path.join(dir, RUNTIME_FILE), 'utf8')).asyncLoading === true; } catch { /* unknown counts as off */ }
    const asyncRestartPending = running && asyncLoading !== asyncLoadingOn(dir);
    let toolCount = null;
    let nodeCount = null;
    let sizeWarning = null;
    if (running) {
        try {
            const tokenFile = path.join(dir, 'token');
            if (fs.existsSync(tokenFile)) {
                const token = fs.readFileSync(tokenFile, 'utf8').trim();
                if (TOKEN_RE.test(token)) {
                    const { gatewaySizeMetrics } = await import('../lib/gateway/doctor.js');
                    const metrics = await gatewaySizeMetrics({ port, token });
                    if (metrics) {
                        toolCount = metrics.toolCount;
                        nodeCount = metrics.nodeCount;
                        sizeWarning = metrics.warning;
                    }
                }
            }
        } catch { /* metrics unavailable */ }
    }
    return { running, pid: running ? readPid(dir) : null, lazyLoading, restartPending, asyncLoading, asyncRestartPending, port, upstreamsScope: 'global', upstreams, toolCount, nodeCount, sizeWarning, ...(inUse ? { error: problem } : {}) };
}

const TOKEN_RE = /^[0-9a-f]{64}$/;

function readToken(dir) {
    const file = path.join(dir, 'token');
    let token;
    try {
        const st = fs.statSync(file);
        if (process.platform !== 'win32' && (st.mode & 0o077)) throw new Error(`${file} must not be accessible by group/others (chmod 600)`);
        token = fs.readFileSync(file, 'utf8').trim();
    } catch (e) {
        if (e.code === 'ENOENT') throw new Error(`no token in ${file}; run the gateway installer first`);
        if (e.code) throw new Error(`cannot read ${file} (${e.code})`);
        throw e;
    }
    if (!TOKEN_RE.test(token)) throw new Error(`token in ${file} is empty or invalid; re-run the gateway installer`);
    return token;
}

// Runs 1mcp via node and its JS entry (no .cmd shim, no shell) so kill() reaches 1mcp itself on every platform.
function oneMcpEntry(dir) {
    const pkgDir = path.join(dir, 'node_modules', '@1mcp', 'agent');
    let bin;
    try { bin = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).bin; } catch { /* reported below */ }
    const rel = typeof bin === 'string' ? bin : bin && (bin['1mcp'] || Object.values(bin)[0]);
    if (typeof rel !== 'string') throw new Error(`cannot find the 1mcp entry in ${pkgDir}/package.json; re-run the gateway installer`);
    return path.join(pkgDir, rel);
}

// A SIGKILLed gateway leaves its 1mcp child holding the upstream port. Stop it only if the recorded pid is
// still a 1mcp of ours (command line carries this entry script and this config dir); anything else is foreign.
export async function reapOrphan(dir, script, upstreamPort, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
    let pid;
    try { pid = Number(fs.readFileSync(path.join(dir, 'upstream.pid'), 'utf8')); } catch { return false; }
    if (!Number.isInteger(pid) || pid <= 1) return false;
    const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', shell: false, windowsHide: true });
    const cmd = ps.status === 0 ? ps.stdout : '';
    if (!cmd.includes(script) || !cmd.includes(dir)) return false;
    try { process.kill(pid, 'SIGTERM'); } catch { return false; }
    for (let i = 0; i < 20; i++) {
        await sleep(250);
        if ((await get(upstreamPort, '/health')).error === 'ECONNREFUSED') return true;
    }
    return false;
}

// gateway.log: AOS's own lines plus 1mcp's output, on every platform (the Windows hidden .vbs start has no stdout at all).
// 0600, rotated to gateway.log.1 once it passes maxBytes. Never throws: a log that cannot be written must not stop the gateway.
export function openLog(dir, maxBytes = 5 << 20) {
    const file = path.join(dir, 'gateway.log');
    let fd = null, size = 0;
    const open = (force = false) => {
        try {
            try { if (force || fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`); } catch { /* none yet */ }
            fd = fs.openSync(file, 'a', 0o600);
            size = fs.fstatSync(fd).size;
            if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
        } catch { fd = null; }
    };
    open();
    return {
        write(chunk) {
            if (fd === null) return;
            try {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                if (size + buf.length > maxBytes) { fs.closeSync(fd); fd = null; open(true); if (fd === null) return; }
                fs.writeSync(fd, buf);
                size += buf.length;
            } catch { /* best effort */ }
        },
        close() { if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ } fd = null; },
    };
}

// Core of `serve`, testable: no process-wide handlers, no process.exit. Rejects when it must refuse to start.
export async function startServe({ dir, port = GATEWAY_PORT, upstreamPort = UPSTREAM_PORT, spawnFn = spawn, log: logIn, backoffMs = 1000, entry, logMaxBytes } = {}) {
    const token = readToken(dir);
    let logFile = { write() {}, close() {} }; // opened once the start is not refused
    const log = logIn || ((m) => { logFile.write(`${new Date().toISOString()} ${m}\n`); if (process.stderr.isTTY) console.error(m); });
    const script = entry || oneMcpEntry(dir);
    let probe = await get(upstreamPort, '/health');
    if (probe.error !== 'ECONNREFUSED' && await reapOrphan(dir, script, upstreamPort)) probe = { error: 'ECONNREFUSED' };
    if (probe.error !== 'ECONNREFUSED') throw new Error(`port ${upstreamPort} is already in use (not by this gateway's 1mcp); refusing to forward to a foreign process`);

    logFile = openLog(dir, logMaxBytes);
    const forwarder = createForwarder({ port, upstreamPort, token });
    try { await forwarder.listen(); } catch (e) {
        throw new Error(e.code === 'EADDRINUSE' ? `port ${port} in use by another process` : `cannot listen: ${e.message}`);
    }
    const pidFile = path.join(dir, 'gateway.pid');
    fs.writeFileSync(pidFile, String(process.pid), { mode: 0o600 });

    const lazy = lazyLoadingOn(dir, log);
    const asyncLoad = asyncLoadingOn(dir);
    const args = [script, 'serve', '-c', path.join(dir, 'mcp.json'), '--config-dir', dir, '--host', '127.0.0.1', '--port', String(upstreamPort),
        '--no-enable-session-persistence', '--enable-enhanced-security', '--log-level', 'warn',
        ...(lazy ? ['--enable-lazy-loading', '--lazy-fallback-on-error', 'full'] : []),
        ...(asyncLoad ? ['--enable-async-loading'] : [])];
    const runtimeFile = path.join(dir, RUNTIME_FILE);
    try { fs.writeFileSync(runtimeFile, JSON.stringify({ lazyLoading: lazy, asyncLoading: asyncLoad, pid: process.pid }), { mode: 0o600 }); } catch { /* status shows unknown */ }
    let child = null;
    let stopping = false;
    let timer = null;
    let delay = backoffMs;
    let startedAt = 0;
    const alive = () => !!child && child.exitCode === null && child.signalCode === null;
    const schedule = () => {
        if (stopping || timer) return;
        if (Date.now() - startedAt > 60000) delay = backoffMs;
        log(`aos-gateway: 1mcp stopped, restarting in ${delay / 1000}s`);
        timer = setTimeout(() => { timer = null; start(); }, delay);
        delay = Math.min(delay * 2, 30000);
    };
    const start = () => {
        if (stopping) return;
        startedAt = Date.now();
        try { child = spawnFn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true }); } catch (e) {
            log(`aos-gateway: cannot start 1mcp: ${e.code || e.message}`);
            return schedule();
        }
        if (child && child.pid) try { fs.writeFileSync(path.join(dir, 'upstream.pid'), String(child.pid), { mode: 0o600 }); } catch { /* best effort */ }
        const feeds = [];
        for (const out of [child.stdout, child.stderr]) if (out && out.on) { const feed = lineRedactor((s) => logFile.write(s)); feeds.push(feed); out.on('data', feed); }
        child.on('error', (e) => { log(`aos-gateway: cannot start 1mcp: ${e.code || e.message}`); schedule(); });
        child.on('exit', () => { feeds.forEach((f) => f.flush()); schedule(); });
    };
    start();

    return {
        port: forwarder.server.address().port,
        killNow() { if (alive()) { try { child.kill('SIGKILL'); } catch { /* already gone */ } } },
        async stop() {
            if (stopping) return;
            stopping = true;
            clearTimeout(timer);
            await forwarder.close();
            if (alive()) {
                await new Promise((resolve) => {
                    const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
                    child.once('exit', () => { clearTimeout(kill); resolve(); });
                    child.kill('SIGTERM');
                });
            }
            try { fs.unlinkSync(pidFile); } catch { /* already gone */ }
            try { fs.unlinkSync(runtimeFile); } catch { /* already gone */ }
            logFile.close();
        },
    };
}

async function serve() {
    let handle;
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 24) console.error(`aos-gateway: warning: bdb_after_effects_mcp (mcp-aftereffects) needs Node >= 24, this gateway runs on ${process.version}; the AE upstream will not start`);
    try { handle = await startServe({ dir: gatewayDir(os.homedir()) }); } catch (e) {
        console.error(`aos-gateway: ${e.message}`);
        process.exit(1);
    }
    let down = false;
    const shutdown = async (code = 0) => {
        if (down) return;
        down = true;
        try { await handle.stop(); } catch { /* exiting anyway */ }
        process.exit(code);
    };
    process.on('exit', () => handle.killNow());
    for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => shutdown(0));
    process.on('uncaughtException', (e) => { console.error(`aos-gateway: ${e && e.stack || e}`); shutdown(1); });
    process.on('unhandledRejection', (e) => { console.error(`aos-gateway: unhandled rejection: ${e && e.stack || e}`); shutdown(1); });
}

function service(cmd) {
    const out = (r) => {
        if (r.stdout) process.stdout.write(r.stdout);
        if (r.stderr) process.stderr.write(r.stderr);
        return r.status ?? 1;
    };
    const run = (c, a) => out(spawnSync(c, a, { encoding: 'utf8', windowsHide: true }));
    if (process.platform === 'darwin') {
        const uid = process.getuid();
        const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
        const target = `gui/${uid}/${LABEL}`;
        if (cmd === 'start') return run('launchctl', ['bootstrap', `gui/${uid}`, plist]);
        if (cmd === 'stop') return run('launchctl', ['bootout', target]);
        const kicked = run('launchctl', ['kickstart', '-k', target]);
        return kicked === 0 ? 0 : run('launchctl', ['bootstrap', `gui/${uid}`, plist]);
    }
    if (process.platform === 'linux') {
        const unit = `${LABEL}.service`;
        if (cmd === 'start') return run('systemctl', ['--user', 'start', unit]);
        if (cmd === 'stop') return run('systemctl', ['--user', 'stop', unit]);
        return run('systemctl', ['--user', 'restart', unit]);
    }
    if (process.platform === 'win32') {
        // The installer registers a hidden Startup-folder .vbs (lib/v5/win-startup.js): schtasks needs admin rights.
        // Inline on purpose: this file also runs from ~/.agents/bin, which has no lib/ next to it.
        const vbs = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'com.bdb.aos.gateway.vbs');
        const start = () => (fs.existsSync(vbs) ? run('wscript.exe', [vbs]) : (console.error(`aos-gateway start: ${vbs} missing; run the AOS installer or "aos-gateway serve"`), 1));
        const stop = () => run('powershell', ['-NoProfile', '-Command',
            "Get-CimInstance Win32_Process | Where-Object { $c = $_.CommandLine; $_.ProcessId -ne $PID -and $c -and $c.Contains('aos-gateway.mjs') -and $c.Contains(' serve') -and $(($o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue) -and $o.User -and (($o.Domain + '\\' + $o.User) -eq ($env:USERDOMAIN + '\\' +$env:USERNAME))) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"]);
        if (cmd === 'start') return start();
        if (cmd === 'stop') return stop();
        stop();
        return start();
    }
    console.error(`aos-gateway ${cmd}: no service manager support on ${process.platform}; use "aos-gateway serve"`);
    return 2;
}

async function main() {
    const [cmd, ...rest] = process.argv.slice(2);
    if (cmd === 'serve') return serve();
    if (cmd === 'start' || cmd === 'stop' || cmd === 'restart') process.exit(service(cmd));
    if (cmd === 'status') {
        const s = await gatewayStatus({ dir: gatewayDir(os.homedir()) });
        if (rest.includes('--json')) console.log(JSON.stringify(s));
        else {
            console.log(`gateway: ${s.running ? `running${s.pid ? ` (pid ${s.pid})` : ''}` : 'not running'} on 127.0.0.1:${s.port}${s.error ? ` - ${s.error}` : ''}`);
            console.log(`  lazy loading: ${lazyText(s)}`);
            console.log(`  async loading: ${asyncText(s)}`);
            if (s.running && s.toolCount !== null && s.toolCount !== undefined) {
                console.log(`  tools: ${s.toolCount} tool${s.toolCount === 1 ? '' : 's'} (~${s.nodeCount} JSON nodes)`);
            }
            if (s.sizeWarning) {
                console.log(`  WARN size: ${s.sizeWarning}`);
            }
            for (const u of s.upstreams) console.log(`  ${u.ok ? 'ok  ' : u.busy ? 'BUSY' : u.degraded ? 'WARN' : 'FAIL'} ${u.name}${u.error ? ` - ${u.error}` : ''}`);
            if (process.platform === 'linux') console.log(`  service: ${spawnSync('systemctl', ['--user', 'is-active', `${LABEL}.service`], { encoding: 'utf8' }).stdout.trim() || 'unknown'}`);
        }
        process.exit(s.running ? 0 : 1);
    }
    if (cmd === 'direct' || cmd === 'enable') {
        const home = os.homedir();
        const files = harnessMcpFiles(home, process.env, process.platform, home);
        const aosRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        let report;
        try {
            report = cmd === 'direct'
                ? disable({ home, files })
                : enable({ home, files, token: readToken(gatewayDir(home)), shipped: shippedServers(aosRoot), presets: livePresets(gatewayDir(home), shippedPresets(aosRoot)), contextProfile: contextProfileOf(profile.readSettings(home, () => {})) });
        } catch (e) { console.error(`aos-gateway ${cmd}: ${e.message}`); process.exit(1); }
        if (cmd === 'enable') {
            try {
                const dup = adoptApi.removeAdoptedDuplicates({ home, token: readToken(gatewayDir(home)), shipped: shippedServers(aosRoot), files });
                report.push(...(dup.files || []).filter((f) => f.removed && f.removed.length));
            } catch (e) { console.error(`aos-gateway enable: adopted-server cleanup failed: ${e.message}`); }
        }
        for (const r of report) {
            const bits = r.error ? [`ERROR ${r.error}`] : r.skipped ? [`skipped: ${r.skipped}`] : [
                ...(r.removed || []).map((n) => `removed ${n}`), ...(r.restored || []).map((n) => `restored ${n}`),
                ...(r.added ? ['added aos'] : []), ...(r.updated ? ['updated aos'] : []), ...(r.removedAos ? ['removed aos'] : []),
                ...(r.kept || []).map((k) => `kept ${k.name} (${k.reason})`), ...(r.conflicts || []), ...(r.conflict ? [`CONFLICT ${r.conflict}`] : []),
            ];
            console.log(`${r.file} [${r.kind}]: ${bits.join('; ') || 'no change'}`);
        }
        process.exit(report.some((r) => r.error) ? 1 : 0);
    }
    if (cmd === 'inspect' || cmd === 'run') {
        // CLI mode: the bundled 1mcp client talks to the upstream on loopback (7791). Its own bearer auth is OAuth only and
        // unused here; the AOS token guards the forwarder on 7790 and is never read or printed by this command.
        const dir = gatewayDir(os.homedir());
        if (!readPid(dir)) { console.error(`aos-gateway ${cmd}: the gateway is not running (aos-gateway start)`); process.exit(1); }
        const target = firstPositional(rest);
        if (cmd === 'run' && !(target && /^[^/]+\/[^/]+$/.test(target))) { console.error('usage: aos-gateway run <server>/<tool> --args \'<json>\''); process.exit(2); }
        const ai = rest.indexOf('--args');
        if (ai >= 0) try { JSON.parse(rest[ai + 1]); } catch { console.error('aos-gateway run: --args must be a JSON object string'); process.exit(2); }
        let entry;
        try { entry = oneMcpEntry(dir); } catch (e) { console.error(`aos-gateway ${cmd}: ${e.message}`); process.exit(1); }
        const go = (args) => spawnSync(process.execPath, [entry, ...args, '-u', `http://127.0.0.1:${UPSTREAM_PORT}/mcp`], { stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 26, shell: false, windowsHide: true });
        const text = (x) => `${x.stdout || ''}${x.stderr || ''}`;
        let r = go([cmd, ...rest]);
        // A server 1mcp is still starting: wait for it (1mcp's own wait command), then run once more.
        const w = cmd === 'run' && /server_loading[\s\S]*?Recovery: 1mcp wait (\S+)/.exec(text(r));
        if (w) { go(['wait', w[1]]); r = go([cmd, ...rest]); }
        process.stdout.write(r.stdout || '');
        process.stderr.write(r.stderr || '');
        const hint = runHint(text(r));
        if (hint) console.error(hint);
        process.exit(r.status ?? 1);
    }
    if (cmd === 'adopt') {
        const home = os.homedir();
        const dryRun = rest.includes('--dry-run');
        const json = rest.includes('--json');
        const files = harnessMcpFiles(home, process.env, process.platform, home);
        const shipped = shippedServers(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
        let report;
        try {
            if (dryRun) {
                report = adoptApi.applyAdopt({ home, files, shipped, dryRun: true });
            } else {
                const dir = gatewayDir(home);
                try { fs.statSync(path.join(dir, 'token')); } catch {
                    console.error('aos-gateway adopt: gateway is not installed (run the gateway install first)');
                    process.exit(1);
                }
                report = adoptApi.applyAdopt({ home, files, token: readToken(dir), shipped });
            }
        } catch (e) { console.error(`aos-gateway adopt: ${e.message}`); process.exit(1); }
        if (json) {
            console.log(JSON.stringify(report));
        } else {
            const adoptedLines = dryRun
                ? report.adoptable.map((a) => `adopt ${a.name} (${a.sources.map((s) => s.file).join(', ')})`)
                : report.adopted.map((n) => `adopt ${n} (${report.files.filter((f) => (f.removed || []).includes(n)).map((f) => f.file).join(', ')})`);
            for (const line of adoptedLines) console.log(line);
            for (const s of report.skipped || []) {
                if (s.name === null && !s.error) continue;
                console.log(`skip ${s.name}: ${s.reason}`);
            }
            for (const f of report.files || []) {
                if (f.conflict) console.log(`conflict ${f.file}: ${f.conflict}`);
                if (f.error) console.log(`error ${f.file}: ${f.error}`);
            }
            if (!dryRun && report.adopted.length) console.log('restart the gateway to load the adopted servers: aos-gateway restart');
        }
        process.exit((report.files || []).some((f) => f.error) ? 1 : 0);
    }
    if (cmd === 'add' || cmd === 'remove') {
        const home = os.homedir();
        const aosRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const server = rest.find((a) => !a.startsWith('-'));
        if (!server) { console.error(`aos-gateway ${cmd}: a server name is required (one of: ${GATEWAY_SERVERS.join(', ')})`); process.exit(2); }
        const dryRun = rest.includes('--dry-run');
        let result;
        try {
            result = req('../lib/gateway/selection.js').applyServerChange({
                home, aosRoot, platform: process.platform, nodePath: process.execPath, env: process.env,
                add: cmd === 'add' ? server : undefined, remove: cmd === 'remove' ? server : undefined,
                dryRun,
                log: (m) => console.log(m),
            });
        } catch (e) { console.error(`aos-gateway ${cmd}: ${e.message}`); process.exit(1); }
        if (dryRun) process.exit(0);
        // A running gateway must load the new mcp.json: restart via the service manager (best effort;
        // in test sandboxes the service may not exist, so a restart failure is a warning, not an error).
        if (process.env.AOS_TEST_SANDBOX === '1') console.log('restart skipped (AOS_TEST_SANDBOX)');
        else {
            const r = service('restart');
            if (r !== 0) console.log(`gateway config updated; service restart reported ${r}; run "aos-gateway restart" and check "aos-gateway status"`);
        }
        if (cmd === 'remove') console.log(`${server} disappears from every harness on the next "aos update" (or "aos-gateway enable") and the gateway no longer starts it`);
        console.log(`${cmd} ${server}: ${result.selected.length} servers selected (${result.dryRun ? 'dry-run' : 'mcp.json rewritten'}); run "aos-gateway status" to confirm`);
        process.exit(0);
    }
    console.error('usage: aos-gateway serve | start | stop | restart | status [--json] | enable | direct | add | remove | adopt [--dry-run] [--json] | inspect [target] | run <server>/<tool> --args <json>');
    process.exit(2);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
    main().catch((e) => { console.error(`aos-gateway: ${e.message}`); process.exit(1); });
}
