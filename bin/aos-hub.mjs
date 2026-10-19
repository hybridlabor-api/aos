#!/usr/bin/env node
'use strict';
// AOS Hub CLI: `aos-hub [start] [--port 7900] [--tab id] [--no-open]` |
// `stop` | `restart` | `status [--json]`. On demand: the start path probes /api/health;
// when up it only opens the browser, otherwise it spawns itself detached
// (cwd = home) and records hub.json (mode 600, dir 700). `stop` prefers the
// token-authed POST /api/shutdown and only falls back to ps+SIGTERM, failing
// closed when ps is unavailable.
import { spawn } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, realpathSync, renameSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir as osHome } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');
const DEFAULT_PORT = 7900;
const { excludedIds, readSettings } = require('../lib/v5/profile.js');

// All paths come from the injectable home (tests use a temp dir).
export const homeDir = () => process.env.AOS_HUB_HOME || osHome();
export const hubPaths = (home = homeDir()) => ({ dir: join(home, '.aos', 'hub'), file: join(home, '.aos', 'hub', 'hub.json') });

export function parseArgv(argv) {
  const out = { cmd: 'start', port: DEFAULT_PORT, tab: undefined, noOpen: process.env.AOS_NO_OPEN === '1', json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'start' || a === 'stop' || a === 'restart' || a === 'status' || a === 'open') out.cmd = a;
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) out.port = Number(a.split('=')[1]);
    else if (a === '--tab') out.tab = argv[++i];
    else if (a.startsWith('--tab=')) out.tab = a.split('=')[1];
    else if (a === '--serve') out.serve = true;
    else if (a === '--watch') out.watch = true;
    else if (a === '--no-open') out.noOpen = true;
    else if (a === '--json') out.json = true;
    else rest.push(a);
  }
  if (out.tab !== undefined && !/^[a-z]+$/.test(out.tab)) throw new Error(`invalid --tab: ${out.tab}`);
  if (out.watch && !out.serve) throw new Error('--watch is only valid together with --serve');
  if (rest.length && (rest[0] === 'open' || ['start', 'stop', 'restart', 'status'].includes(rest[0]))) out.cmd = rest[0];
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

// True when SOMETHING on 127.0.0.1:<port> accepts a TCP connection, even if
// it does not answer HTTP: that is a foreign process holding the port.
export const portConnectable = (port, timeoutMs = 800) => new Promise((resolve) => {
  const sock = netConnect({ host: '127.0.0.1', port });
  const done = (v) => { try { sock.destroy(); } catch { /* already gone */ } resolve(v); };
  sock.setTimeout(timeoutMs);
  sock.once('connect', () => done(true));
  sock.once('timeout', () => done(false));
  sock.once('error', () => done(false));
});

export const openBrowser = (url, { spawnFn = spawn } = {}) => {
  if (process.env.AOS_NO_OPEN === '1') return false;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawnFn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true, shell: false });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { /* best effort */ return false; }
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

// The service runs from ~/.agents, which has no package.json, so "has my code
// changed under me" is the newest mtime of this file and every file under lib/hub/ (subdirectories included).
const codeStamp = () => {
  let newest = 0;
  const visit = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { visit(p); continue; }
      try { newest = Math.max(newest, statSync(p).mtimeMs); } catch { /* raced with the update */ }
    }
  };
  try { newest = statSync(SELF).mtimeMs; } catch { /* raced with the update */ }
  visit(join(ROOT, 'lib', 'hub'));
  return newest;
};

const packageVersion = () => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version; }
  catch { return 'unknown'; }
};

async function cmdStart(opts) {
  if (await probeHealth(opts.port)) {
    console.log(`AOS Hub already running: http://127.0.0.1:${opts.port}/`);
    if (!opts.noOpen && process.env.AOS_NO_OPEN !== '1') openBrowser(`http://127.0.0.1:${opts.port}/${opts.tab ? `?tab=${opts.tab}` : ''}`);
    return 0;
  }
  const env = { ...process.env, AOS_HUB_SERVE: '1', AOS_HUB_TOKEN: randomBytes(32).toString('hex') };
  const childArgs = [SELF, '--serve', '--port', String(opts.port)];
  if (opts.noOpen || process.env.AOS_NO_OPEN === '1') childArgs.push('--no-open');
  const child = spawn(process.execPath, childArgs, {
    detached: true, windowsHide: true, stdio: 'ignore', cwd: homeDir(), env, shell: false,
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
    // Distinguish "the child did not start" from "a foreign process holds the
    // port": if the port accepts TCP connections after we could not health-
    // probe an aos-hub there, say exactly what is holding it.
    if (await portConnectable(opts.port)) {
      console.error(`port ${opts.port} is in use by another process (an old aos-dashboard?); stop it or use --port`);
      return 1;
    }
    console.error(`AOS Hub did not come up on 127.0.0.1:${opts.port} within 5 s.`);
    return 1;
  }
  if (!opts.noOpen && process.env.AOS_NO_OPEN !== '1') {
    openBrowser(`http://127.0.0.1:${opts.port}/${opts.tab ? `?tab=${opts.tab}` : ''}`);
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
      const child = spawn('ps', ['-p', String(pid), '-o', 'command='], { shell: false, windowsHide: true });
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

// The old process answers /api/health until its shutdown finishes (up to ~2 s),
// so wait for the port to go quiet before starting, or start would just reopen it.
async function cmdRestart(opts) {
  const code = await cmdStop();
  if (code !== 0) return code;
  for (let i = 0; i < 25 && await probeHealth(opts.port, 300); i++) await new Promise((ok) => setTimeout(ok, 200));
  return cmdStart(opts);
}

async function cmdOpen(opts) {
  if (!await probeHealth(opts.port)) {
    const code = await cmdStart({ ...opts, noOpen: true });
    if (code !== 0) return code;
  }
  if (!opts.noOpen && process.env.AOS_NO_OPEN !== '1') {
    openBrowser(`http://127.0.0.1:${opts.port}/${opts.tab ? `?tab=${opts.tab}` : ''}`);
  }
  return 0;
}

export async function cli(argv = process.argv.slice(2)) {
  const opts = parseArgv(argv);
  if (opts.cmd === 'stop') return cmdStop();
  if (opts.cmd === 'restart') return cmdRestart(opts);
  if (opts.cmd === 'status') return cmdStatus(opts);
  if (opts.cmd === 'open') return cmdOpen(opts);
  return cmdStart(opts);
}

// Service mode: launchd/systemd/Task Scheduler start `--serve --watch` directly. Serve in this
// process, so the service manager supervises the real server; a detached child (the `aos hub`
// path) would leave the manager watching a parent that already exited (seen on Windows).
// argv[1] may be an npm bin symlink; SELF is already the real path, so compare real paths.
const mainPath = (() => { try { return realpathSync(process.argv[1] || ''); } catch { return ''; } })();
const serviceMode = mainPath === SELF && process.argv.includes('--serve') && process.argv.includes('--watch');
// Windows: Task Scheduler's RestartOnFailure only covers a task that fails to start, not a server
// that dies later (Lenovo: a killed hub stayed down). So the task process stays a small watchdog
// and respawns the server; launchd and systemd restart the process themselves.
if (serviceMode && process.platform === 'win32' && !process.env.AOS_HUB_WATCHDOG_CHILD) {
  const runChild = () => {
    const child = spawn(process.execPath, process.argv.slice(1), {
      stdio: 'inherit', env: { ...process.env, AOS_HUB_WATCHDOG_CHILD: '1' }, shell: false, windowsHide: true,
    });
    // Exit 0 = deliberate stop (/api/shutdown or SIGTERM): do not revive it. Exit 3 = the hub's code
    // changed on disk: start the new code at once; a crash waits 5 s.
    child.on('exit', (code) => { if (code !== 0) setTimeout(runChild, code === 3 ? 0 : 5000); });
  };
  runChild();
} else if (serviceMode) {
  process.env.AOS_HUB_SERVE = '1';
}

// Child mode: serve until /api/shutdown (or a signal). The token comes from
// the parent via env when spawned detached; otherwise it is fresh per process.
if (process.env.AOS_HUB_SERVE === '1' && !process.env.AOS_HUB_CHILD_DONE) {
  process.env.AOS_HUB_CHILD_DONE = '1';
  const hubToken = process.env.AOS_HUB_TOKEN || undefined;
  if (process.env.AOS_HUB_TOKEN !== undefined) delete process.env.AOS_HUB_TOKEN;
  const { createHub } = await import(pathToFileURL(join(ROOT, 'lib', 'hub', 'server.mjs')).href);
  const { routes: planRoutes } = await import(pathToFileURL(join(ROOT, 'lib', 'hub', 'routes-plans.mjs')).href);
  const { routes: serviceRoutes } = await import(pathToFileURL(join(ROOT, 'lib', 'hub', 'routes-services.mjs')).href);
  const { routes: catalogRoutes } = await import(pathToFileURL(join(ROOT, 'lib', 'hub', 'routes-catalog.mjs')).href);
  const { routes: storeRoutes } = await import(pathToFileURL(join(ROOT, 'lib', 'hub', 'routes-store.mjs')).href);
  const { createProxy } = await import(pathToFileURL(join(ROOT, 'lib', 'hub', 'proxy.mjs')).href);
  const watchMod = await import(pathToFileURL(join(ROOT, 'lib', 'hub', 'routes-watch.mjs')).href);
  const home = homeDir();
  const serveArgv = parseArgv(process.argv.slice(2));
  // Read once at start: the stale check compares this snapshot against the
  // package.json on disk every round, so an update is noticed even though the
  // file changes under the running process.
  const ownVersion = packageVersion();
  const ownStamp = codeStamp();
  const hub = createHub({
    port: serveArgv.port,
    home,
    routes: [...planRoutes, ...serviceRoutes, ...catalogRoutes, ...storeRoutes, ...watchMod.routes],
    ctx: { root: ROOT, hubJsonPath: hubPaths(home).file, tokenEnv: hubToken, proxy: createProxy() },
  });
  await hub.listen();
  // Only the process that actually bound the port writes hub.json. A failed
  // bind (EADDRINUSE) rejects listen() before this line, so a live hub's
  // record is never clobbered by a losing start attempt.
  writeHubJson(home, { pid: process.pid, port: hub.server.address().port, version: ownVersion, token: hub.token });
  console.log(`AOS Hub: http://127.0.0.1:${hub.server.address().port}/`);

  // --watch: supervise the other services through their service managers. The
  // watcher shares the hub's ctx; the stale check runs at the start of every
  // round and exits 3 on purpose (the Windows task restarts only on failure).
  if (serveArgv.watch) {
    const { createWatcher } = await import(pathToFileURL(join(ROOT, 'lib', 'hub', 'watch.mjs')).href);
    const statusFile = join(home, '.aos', 'status.json');
    const watcher = createWatcher({
      ctx: hub.ctx,
      statusFile,
      onRows: async (rows) => {
        const ep = await import(pathToFileURL(join(ROOT, 'lib', 'endpoints.mjs')).href);
        const trailRepos = ep.readRaw(home).agenttrail;
        ep.updateEndpoints(home, ep.patchFromRows(rows, { hubPort: hub.server.address().port, hubVersion: ownVersion, trailRepos: Array.isArray(trailRepos) ? trailRepos : [] }));
      },
      // Never touch a service the user switched off in settings (or the profile excludes).
      isDisabled: (id) => { try { return excludedIds(readSettings(home)).has(id); } catch { return false; } },
      beforeTick: async () => {
        const diskStamp = codeStamp();
        if (diskStamp > ownStamp) {
          try {
            mkdirSync(dirname(statusFile), { recursive: true });
            const tmp = `${statusFile}.tmp`;
            writeFileSync(tmp, JSON.stringify({ staleSince: Date.now(), version: ownVersion }, null, 2));
            renameSync(tmp, statusFile);
          } catch { /* best effort; exit 3 is the signal the service manager acts on */ }
          console.error('AOS Hub: its code changed on disk; exiting so the service manager restarts it on the new code');
          process.exit(3);
        }
      },
    });
    watcher.start();
    watchMod.setWatcher(watcher);
    watcher.tick().catch(() => {});
  }

  const stopped = async () => {
    try { (await import(pathToFileURL(join(ROOT, 'lib', 'endpoints.mjs')).href)).markDown(home, 'hub'); } catch { /* best effort */ }
    try { unlinkSync(hubPaths(home).file); } catch { /* already gone */ }
    try {
      // OpenWiki graph viewers are child processes of this server: kill them
      // on the way out, on /api/shutdown AND on SIGINT/SIGTERM.
      const { stopViewers: stopVis } = await import(pathToFileURL(join(ROOT, 'lib', 'hub', 'services.mjs')).href);
      stopVis();
    } catch { /* services module unimportable; nothing viewers-side to stop */ }
    await hub.close();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  let stopping = false;
  const bye = () => { if (!stopping) { stopping = true; stopped(); } };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

const invokedDirectly = mainPath === SELF;
if (invokedDirectly && process.env.AOS_HUB_SERVE !== '1' && !serviceMode) {
  cli().then((code) => process.exit(code ?? 0)).catch((e) => {
    console.error(`hub: ${e.message}`);
    process.exit(2);
  });
}
