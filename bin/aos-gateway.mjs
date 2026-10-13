#!/usr/bin/env node
// Local MCP gateway: token-checking forwarder on 127.0.0.1:7790 in front of @1mcp/agent on 127.0.0.1:7791.
// Usage: aos-gateway serve | start | stop | restart | status [--json] | enable | direct | adopt [--dry-run] [--json]
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
const { enable, disable } = req('../lib/gateway/harness.js');
const { shippedPresets, livePresets } = req('../lib/v5/pkg-gateway.js');
const { harnessMcpFiles, shippedServers } = req('../lib/mcp-secrets.js');
const adoptApi = req('../lib/gateway/adopt.js');

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
    // 1mcp answers slowly while it rebuilds its capability catalog (uv upstreams take minutes): one longer retry,
    // and a timeout after that is "busy", not "down" (F14). Refused or a non-200 answer stays a failure.
    let inner = running ? await get(upstreamPort, '/health') : null;
    if (inner && inner.error === 'ETIMEDOUT') inner = await get(upstreamPort, '/health', 10000);
    const busy = !!inner && inner.error === 'ETIMEDOUT';
    const problem = inUse ? `port ${port} in use by another process` : !running ? 'gateway not running' : null;
    const upstreams = upstreamNames(dir).map((name) => {
        if (problem) return { name, ok: false, error: problem };
        if (inner.status === 200) return { name, ok: true };
        if (busy) return { name, ok: false, busy: true, error: `1mcp busy on ${upstreamPort} (no answer in 12 s, likely a catalog refresh); check again in a minute` };
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

// A SIGKILLed gateway leaves its 1mcp child holding the upstream port. Stop it only if the recorded pid is
// still a 1mcp of ours (command line carries this entry script and this config dir); anything else is foreign.
export async function reapOrphan(dir, script, upstreamPort, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
    let pid;
    try { pid = Number(fs.readFileSync(path.join(dir, 'upstream.pid'), 'utf8')); } catch { return false; }
    if (!Number.isInteger(pid) || pid <= 1) return false;
    const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', shell: false });
    const cmd = ps.status === 0 ? ps.stdout : '';
    if (!cmd.includes(script) || !cmd.includes(dir)) return false;
    try { process.kill(pid, 'SIGTERM'); } catch { return false; }
    for (let i = 0; i < 20; i++) {
        await sleep(250);
        if ((await get(upstreamPort, '/health')).error === 'ECONNREFUSED') return true;
    }
    return false;
}

// Core of `serve`, testable: no process-wide handlers, no process.exit. Rejects when it must refuse to start.
export async function startServe({ dir, port = GATEWAY_PORT, upstreamPort = UPSTREAM_PORT, spawnFn = spawn, log = (m) => console.error(m), backoffMs = 1000, entry } = {}) {
    const token = readToken(dir);
    const script = entry || oneMcpEntry(dir);
    let probe = await get(upstreamPort, '/health');
    if (probe.error !== 'ECONNREFUSED' && await reapOrphan(dir, script, upstreamPort)) probe = { error: 'ECONNREFUSED' };
    if (probe.error !== 'ECONNREFUSED') throw new Error(`port ${upstreamPort} is already in use (not by this gateway's 1mcp); refusing to forward to a foreign process`);

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
        if (child && child.pid) try { fs.writeFileSync(path.join(dir, 'upstream.pid'), String(child.pid), { mode: 0o600 }); } catch { /* best effort */ }
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
            for (const u of s.upstreams) console.log(`  ${u.ok ? 'ok  ' : u.busy ? 'BUSY' : 'FAIL'} ${u.name}${u.error ? ` - ${u.error}` : ''}`);
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
                : enable({ home, files, token: readToken(gatewayDir(home)), shipped: shippedServers(aosRoot), presets: livePresets(gatewayDir(home), shippedPresets(aosRoot)) });
        } catch (e) { console.error(`aos-gateway ${cmd}: ${e.message}`); process.exit(1); }
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
    console.error('usage: aos-gateway serve | start | stop | restart | status [--json] | enable | direct | adopt [--dry-run] [--json]');
    process.exit(2);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
    main().catch((e) => { console.error(`aos-gateway: ${e.message}`); process.exit(1); });
}
