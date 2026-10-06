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

const get = (port, urlPath) => new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: 2000 }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    r.on('timeout', () => r.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    r.on('error', (e) => resolve({ error: e.code || e.message }));
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
    return { running, pid: running ? readPid(dir) : null, port, upstreams, ...(inUse ? { error: problem } : {}) };
}

async function serve() {
    const dir = gatewayDir(os.homedir());
    let token = '';
    try { token = fs.readFileSync(path.join(dir, 'token'), 'utf8').trim(); } catch { /* reported below */ }
    if (!token) { console.error(`aos-gateway: no token in ${path.join(dir, 'token')}; run the gateway installer first`); process.exit(1); }

    const forwarder = createForwarder({ port: GATEWAY_PORT, upstreamPort: UPSTREAM_PORT, token });
    try { await forwarder.listen(); } catch (e) {
        console.error(e.code === 'EADDRINUSE' ? `aos-gateway: port ${GATEWAY_PORT} in use by another process` : `aos-gateway: cannot listen: ${e.message}`);
        process.exit(1);
    }
    const pidFile = path.join(dir, 'gateway.pid');
    fs.writeFileSync(pidFile, String(process.pid), { mode: 0o600 });

    const win = process.platform === 'win32';
    // Windows: the .cmd shim needs a shell. UNVERIFIED (not tested on Windows).
    const bin = path.join(dir, 'node_modules', '.bin', win ? '1mcp.cmd' : '1mcp');
    const args = ['serve', '-c', path.join(dir, 'mcp.json'), '--config-dir', dir, '--host', '127.0.0.1', '--port', String(UPSTREAM_PORT),
        '--no-enable-session-persistence', '--enable-enhanced-security', '--log-level', 'warn'];

    let child = null;
    let stopping = false;
    let timer = null;
    let delay = 1000;
    let startedAt = 0;
    const schedule = () => {
        if (stopping || timer) return;
        if (Date.now() - startedAt > 60000) delay = 1000;
        console.error(`aos-gateway: 1mcp stopped, restarting in ${delay / 1000}s`);
        timer = setTimeout(() => { timer = null; start(); }, delay);
        delay = Math.min(delay * 2, 30000);
    };
    const start = () => {
        startedAt = Date.now();
        child = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'], shell: win });
        child.on('error', (e) => { console.error(`aos-gateway: cannot start 1mcp: ${e.code || e.message}`); schedule(); });
        child.on('exit', schedule);
    };
    start();

    const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        clearTimeout(timer);
        await forwarder.close();
        if (child && child.exitCode === null && child.signalCode === null) {
            await new Promise((resolve) => {
                const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
                child.once('exit', () => { clearTimeout(kill); resolve(); });
                child.kill('SIGTERM');
            });
        }
        try { fs.unlinkSync(pidFile); } catch { /* already gone */ }
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
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
        return run('launchctl', ['kickstart', '-k', target]);
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
