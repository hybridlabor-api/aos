#!/usr/bin/env node
'use strict';
// AOS Hub CLI: `aos-hub [start] [--port 7900] [--tab id] [--no-open]` |
// `stop` | `status [--json]`. On demand: the start path probes /api/health;
// when up it only opens the browser, otherwise it spawns itself detached
// (cwd = home) and records hub.json (mode 600, dir 700). `stop` prefers the
// token-authed POST /api/shutdown and only falls back to ps+SIGTERM, failing
// closed when ps is unavailable.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir as osHome } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');
const DEFAULT_PORT = 7900;

// All paths come from the injectable home (tests use a temp dir).
export const homeDir = () => process.env.AOS_HUB_HOME || osHome();
export const hubPaths = (home = homeDir()) => ({ dir: join(home, '.aos', 'hub'), file: join(home, '.aos', 'hub', 'hub.json') });

export function parseArgv(argv) {
  const out = { cmd: 'start', port: DEFAULT_PORT, tab: undefined, noOpen: false, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'start' || a === 'stop' || a === 'status') out.cmd = a;
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) out.port = Number(a.split('=')[1]);
    else if (a === '--tab') out.tab = argv[++i];
    else if (a.startsWith('--tab=')) out.tab = a.split('=')[1];
    else if (a === '--serve') out.serve = true;
    else if (a === '--no-open') out.noOpen = true;
    else if (a === '--json') out.json = true;
    else rest.push(a);
  }
  if (out.tab !== undefined && !/^[a-z]+$/.test(out.tab)) throw new Error(`invalid --tab: ${out.tab}`);
  if (rest.length) out.cmd = rest[0];
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) throw new Error(`invalid --port: ${out.port}`);
  return out;
}

const fetchJson = async (url, { method = 'GET', headers = {}, body, timeoutMs = 1500 } = {}) => {
  const res = await fetch(url, { method, headers, ...(body !== undefined ? { body } : {}), signal: AbortSignal.timeout(timeoutMs) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

export const probeHealth = async (port, timeoutMs = 1500) => {
  try {
    const { status, json } = await fetchJson(`http://127.0.0.1:${port}/api/health`, { timeoutMs });
    return status === 200 && json.ok === true && json.service === 'aos-hub';
  } catch { return false; }
};

export const openBrowser = (url) => {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: false });
    child.on('error', () => {});
    child.unref();
  } catch { /* best effort */ }
};

export const writeHubJson = (home, { pid, port, version, token }) => {
  const { dir, file } = hubPaths(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, JSON.stringify({ pid, port, version, token }, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return file;
};

export const readHubJson = (home = homeDir()) => {
  try { return JSON.parse(readFileSync(hubPaths(home).file, 'utf8')); } catch { return null; }
};

const packageVersion = () => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version; }
  catch { return 'unknown'; }
};

async function cmdStart(opts) {
  if (await probeHealth(opts.port)) {
    console.log(`AOS Hub already running: http://127.0.0.1:${opts.port}/`);
    if (!opts.noOpen) openBrowser(`http://127.0.0.1:${opts.port}/${opts.tab ? `?tab=${opts.tab}` : ''}`);
    return 0;
  }
  const env = { ...process.env, AOS_HUB_SERVE: '1', AOS_HUB_TOKEN: randomBytes(32).toString('hex') };
  const child = spawn(process.execPath, [SELF, '--serve', '--port', String(opts.port)], {
    detached: true, stdio: 'ignore', cwd: homeDir(), env, shell: false,
  });
  child.unref();
  console.log(`AOS Hub starting: http://127.0.0.1:${opts.port}/ (pid ${child.pid})`);
  // Only the process that actually bound the port writes hub.json (the child,
  // after listen() succeeds). A start attempt that fails with EADDRINUSE
  // never overwrites a live hub's record. The parent waits for a health
  // probe of up to ~5 s and reports failure, but leaves the record alone.
  // Hard wall-clock budget for the whole wait: each probe can burn its full
  // timeout (e.g. a port that accepts but never answers), so the loop is
  // bounded by a deadline instead of a fixed iteration count.
  const up = await (async () => {
    const deadline = Date.now() + 5000;
    let probe = 0;
    while (Date.now() < deadline) {
      if (probe++ > 0) await new Promise((ok) => setTimeout(ok, 250));
      if (await probeHealth(opts.port, 700)) return true;
    }
    return false;
  })();
  if (!up) {
    console.error(`AOS Hub did not come up on 127.0.0.1:${opts.port} within 5 s.`);
    return 1;
  }
  return 0;
}

// Secondary kill path: SIGTERM hub.json.pid ONLY when `ps -p <pid> -o command=`
// succeeds (spawn with args array, shell:false) and the output contains
// 'aos-hub.mjs', the '--serve' marker and `--port <hub.json.port>`. hub.json is
// untrusted input: pid must be a positive integer and never this process's own
// pid. If ps is missing or fails: print the pid, kill nothing, exit 1.
export async function killViaPs(pid, { runPs, selfPid = process.pid, port = null } = {}) {
  pid = Number(pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === selfPid) return false;
  const doPs = () => (runPs
    ? runPs(pid)
    : new Promise((ok) => {
      const child = spawn('ps', ['-p', String(pid), '-o', 'command='], { shell: false });
      let text = '';
      let settled = false;
      const done = (ok_) => { if (!settled) { settled = true; ok(ok_); } };
      child.on('error', () => done({ ok: false }));
      child.stdout.on('data', (d) => { text += String(d); });
      child.on('close', (code) => done(code === 0 ? { ok: true, text } : { ok: false, text }));
      setTimeout(() => done({ ok: false }), 3000).unref();
    }));
  const r = await doPs();
  if (!r || !r.ok) return false;
  // Command line must identify this exact hub child: the binary, the serve
  // marker and the same --port recorded in hub.json.
  const line = String(r.text || '');
  if (!line.includes('aos-hub.mjs')) return false;
  if (!line.includes('--serve')) return false;
  if (port != null && !new RegExp(`--port\\s*${String(Number(port))}\\b`).test(line)) return false;
  try { process.kill(pid, 'SIGTERM'); return true; }
  catch { return false; }
}

async function cmdStop() {
  const home = homeDir();
  const { file } = hubPaths(home);
  const rec = readHubJson(home);
  // Primary: token-authed shutdown.
  if (rec?.token) {
    try {
      const res = await fetchJson(`http://127.0.0.1:${rec.port}/api/shutdown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-aos-hub-token': rec.token },
        body: JSON.stringify({ confirm: 'hub' }),
        timeoutMs: 1500,
      });
      if (res.status === 200) {
        try { unlinkSync(file); } catch { /* server removes it too */ }
        console.log('AOS Hub stopped.');
        return 0;
      }
    } catch { /* hub not answering; fall through */ }
  }
  // Secondary: only via a verified ps command match; fail closed otherwise.
  if (!rec?.pid) {
    console.log('AOS Hub is not running (no hub.json).');
    return 0;
  }
  // hub.json is untrusted input: pid must be a positive integer, not ours.
  const pidNum = Number(rec.pid);
  const ok = await killViaPs(pidNum, {
    selfPid: process.pid,
    port: Number.isInteger(pidNum) ? rec.port : null,
  });
  if (!ok) {
    console.log(`Could not verify the hub process with ps. Kill nothing. PID: ${rec.pid} (hub.json: ${file})`);
    return 1;
  }
  console.log(`AOS Hub (pid ${rec.pid}) sent SIGTERM.`);
  return 0;
}

async function cmdStatus(opts) {
  const rec = readHubJson();
  const up = rec?.port ? await probeHealth(rec.port) : false;
  const out = { running: up, pid: rec?.pid ?? null, port: rec?.port ?? null, version: rec?.version ?? null };
  if (opts.json) { console.log(JSON.stringify(out)); return 0; }
  console.log(out.running ? `AOS Hub running on 127.0.0.1:${out.port} (pid ${out.pid}, v${out.version})` : 'AOS Hub is not running.');
  return 0;
}

export async function cli(argv = process.argv.slice(2)) {
  const opts = parseArgv(argv);
  if (opts.cmd === 'stop') return cmdStop();
  if (opts.cmd === 'status') return cmdStatus(opts);
  return cmdStart(opts);
}

// Child mode: serve until /api/shutdown (or a signal). The token comes from
// the parent via env when spawned detached; otherwise it is fresh per process.
if (process.env.AOS_HUB_SERVE === '1' && !process.env.AOS_HUB_CHILD_DONE) {
  process.env.AOS_HUB_CHILD_DONE = '1';
  const hubToken = process.env.AOS_HUB_TOKEN || undefined;
  if (process.env.AOS_HUB_TOKEN !== undefined) delete process.env.AOS_HUB_TOKEN;
  const { createHub } = await import(join(ROOT, 'lib', 'hub', 'server.mjs'));
  const { routes: planRoutes } = await import(join(ROOT, 'lib', 'hub', 'routes-plans.mjs'));
  const { routes: serviceRoutes } = await import(join(ROOT, 'lib', 'hub', 'routes-services.mjs'));
  const { routes: catalogRoutes } = await import(join(ROOT, 'lib', 'hub', 'routes-catalog.mjs'));
  const { routes: storeRoutes } = await import(join(ROOT, 'lib', 'hub', 'routes-store.mjs'));
  const home = homeDir();
  const routes = [...planRoutes, ...serviceRoutes, ...catalogRoutes, ...storeRoutes];
  const hub = createHub({
    port: parseArgv(process.argv.slice(2)).port,
    home,
    routes,
    ctx: { root: ROOT, hubJsonPath: hubPaths(home).file, tokenEnv: hubToken },
  });
  await hub.listen();
  // Only the process that actually bound the port writes hub.json. A failed
  // bind (EADDRINUSE) rejects listen() before this line, so a live hub's
  // record is never clobbered by a losing start attempt.
  writeHubJson(home, { pid: process.pid, port: hub.server.address().port, version: packageVersion(), token: hub.token });
  console.log(`AOS Hub: http://127.0.0.1:${hub.server.address().port}/`);
  const stopped = async () => {
    try { unlinkSync(hubPaths(home).file); } catch { /* already gone */ }
    await hub.close();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  let stopping = false;
  const bye = () => { if (!stopping) { stopping = true; stopped(); } };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === SELF;
if (invokedDirectly && process.env.AOS_HUB_SERVE !== '1') {
  cli().then((code) => process.exit(code ?? 0)).catch((e) => {
    console.error(`hub: ${e.message}`);
    process.exit(2);
  });
}
