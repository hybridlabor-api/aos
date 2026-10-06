#!/usr/bin/env node
// Local MCP gateway: token-checking forwarder on 127.0.0.1:7790 in front of @1mcp/agent on 127.0.0.1:7791.
// Usage: aos-gateway serve | start | stop | restart | status [--json] | direct
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { gatewayDir, GATEWAY_PORT, UPSTREAM_PORT } = req('../lib/gateway/config.js');
const { createForwarder } = req('../lib/gateway/forwarder.js');

export const LABEL = 'com.bdb.aos.gateway';
export const WIN_TASK = 'AOS MCP Gateway';

// Always resolves: response, error, abnormal close or the overall timeout, whichever comes first.
const get = (port, urlPath, timeoutMs = 2000) => new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const r = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
        res.resume();
        res.on('end', () => finish({ status: res.statusCode, headers: res.headers }));
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

// 1mcp's /health is the path the S1 spike polled (200 = up). Per-upstream health is UNVERIFIED: every
// upstream reports the state of 1mcp as a whole until a per-server endpoint is confirmed.
export async function gatewayStatus({ dir, port = GATEWAY_PORT, upstreamPort = UPSTREAM_PORT }) {
    const fw = await get(port, '/healthcheck');
    const running = fw.status === 200 && fw.headers['x-aos-gateway'] === '1';
    const inUse = !running && fw.error !== 'ECONNREFUSED';
    const inner = running ? await get(upstreamPort, '/health') : null;
    const problem = inUse ? `port ${port} in use by another process` : !running ? 'gateway not running' : null;
    const upstreams = upstreamNames(dir).map((name) => {
        if (problem) return { name, ok: false, error: problem };
        if (inner.status === 200) return { name, ok: true };
        return { name, ok: false, error: inner.error ? `1mcp not reachable on ${upstreamPort} (${inner.error})` : `1mcp health returned ${inner.status}` };
    });
    // Upstream values are the state of 1mcp as a whole, not per-server health.
    return { running, pid: running ? readPid(dir) : null, port, upstreamsScope: 'global', upstreams, ...(inUse ? { error: problem } : {}) };
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

// Core of `serve`, testable: no process-wide handlers, no process.exit. Rejects when it must refuse to start.
export async function startServe({ dir, port = GATEWAY_PORT, upstreamPort = UPSTREAM_PORT, spawnFn = spawn, log = (m) => console.error(m), backoffMs = 1000, entry } = {}) {
    const token = readToken(dir);
    const probe = await get(upstreamPort, '/health');
    if (probe.error !== 'ECONNREFUSED') throw new Error(`port ${upstreamPort} is already in use (not by this gateway's 1mcp); refusing to forward to a foreign process`);
    const script = entry || oneMcpEntry(dir);

    const forwarder = createForwarder({ port, upstreamPort, token });
    try { await forwarder.listen(); } catch (e) {
        throw new Error(e.code === 'EADDRINUSE' ? `port ${port} in use by another process` : `cannot listen: ${e.message}`);
    }
    const pidFile = path.join(dir, 'gateway.pid');
    fs.writeFileSync(pidFile, String(process.pid), { mode: 0o600 });

    const args = [script, 'serve', '-c', path.join(dir, 'mcp.json'), '--config-dir', dir, '--host', '127.0.0.1', '--port', String(upstreamPort),
        '--no-enable-session-persistence', '--enable-enhanced-security', '--log-level', 'warn'];
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
        try { child = spawnFn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'], shell: false }); } catch (e) {
            log(`aos-gateway: cannot start 1mcp: ${e.code || e.message}`);
            return schedule();
        }
        child.on('error', (e) => { log(`aos-gateway: cannot start 1mcp: ${e.code || e.message}`); schedule(); });
        child.on('exit', schedule);
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
        },
    };
}

async function serve() {
    let handle;
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
    const run = (c, a) => out(spawnSync(c, a, { encoding: 'utf8' }));
    if (process.platform === 'darwin') {
        const uid = process.getuid();
        const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
        const target = `gui/${uid}/${LABEL}`;
        if (cmd === 'start') return run('launchctl', ['bootstrap', `gui/${uid}`, plist]);
        if (cmd === 'stop') return run('launchctl', ['bootout', target]);
        const kicked = run('launchctl', ['kickstart', '-k', target]);
        return kicked === 0 ? 0 : run('launchctl', ['bootstrap', `gui/${uid}`, plist]);
    }
    if (process.platform === 'win32') {
        // UNVERIFIED: schtasks task "AOS MCP Gateway" is not created by the installer yet and not tested on Windows.
        if (cmd === 'start') return run('schtasks', ['/Run', '/TN', WIN_TASK]);
        if (cmd === 'stop') return run('schtasks', ['/End', '/TN', WIN_TASK]);
        const stopped = run('schtasks', ['/End', '/TN', WIN_TASK]);
        return stopped === 0 ? run('schtasks', ['/Run', '/TN', WIN_TASK]) : stopped;
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
            for (const u of s.upstreams) console.log(`  ${u.ok ? 'ok  ' : 'FAIL'} ${u.name}${u.error ? ` - ${u.error}` : ''}`);
        }
        process.exit(s.running ? 0 : 1);
    }
    if (cmd === 'direct') {
        console.error('aos-gateway direct: not implemented yet (planned for stage 2: restores the direct stdio entries in the harness configs).');
        process.exit(2);
    }
    console.error('usage: aos-gateway serve | start | stop | restart | status [--json] | direct');
    process.exit(2);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
    main().catch((e) => { console.error(`aos-gateway: ${e.message}`); process.exit(1); });
}
