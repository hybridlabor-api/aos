'use strict';
// Services registry (WP2): fixed table, Windows backups, status probing,
// launchd control (bootstrap/bootout/kickstart pattern from aos-gateway
// service()), npm update checks, OpenWiki wiki discovery + viewers, log
// reading, and the `aos services` CLI.
//
// Everything a request can influence is an id that must exist in the fixed
// table; no request value ever becomes a path, a free argv token or a shell
// string. All spawns go through ctx.run (injected, shell:false). This module
// deletes nothing anywhere (destructive filesystem helpers are absent).

import { createServer as createTcpServer, connect } from 'node:net';
import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from './redact.mjs';
import { probeTrailPorts } from './routes-plans.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Real spawn used only when the caller did not inject ctx.run (CLI mode).
const realRun = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: opts.timeout ?? 10000, shell: false, windowsHide: true }, (err, stdout, stderr) => {
    if (err) resolve({ ok: false, stdout: String(stdout || ''), stderr: String(stderr || err.message || ''), code: err.code ?? null });
    else resolve({ ok: true, stdout: String(stdout || ''), stderr: '', code: 0 });
  });
});

const doRun = async (ctx, cmd, args, opts) => {
  const call = ctx && typeof ctx.run === 'function' ? ctx.run : realRun;
  let res;
  try { res = await call(cmd, args, opts); }
  catch (e) { res = { ok: false, stdout: '', stderr: e.message, code: null }; }
  return { ok: res?.ok !== false && (res?.code == null || res?.code === 0), stdout: String(res?.stdout || ''), stderr: String(res?.stderr || ''), code: res?.code ?? null };
};

// ---------------------------------------------------------------- windows
// Windows uses the VBS wrappers installed by the AOS installer for memB and
// Synapse. The process patterns are constants, never request data, so the
// registry cannot be turned into an arbitrary process launcher.
const WINDOWS_STARTUP_DIR = (ho) => process.env.APPDATA
  ? join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  : join(ho, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');

// The single source of truth. Everything the hub can see or do is here;
// there is no path by which a request adds to it.
// control: 'launchd' (mac launchd), 'observe' (never controlled), or
// 'launchdIfPlist' (plan-canvas: launchd only when its plist exists, else observe).
export const SERVICES = [
  {
    id: 'memb', name: 'memB', role: 'Persistent agent memory',
    port: 8088, url: 'http://127.0.0.1:8088', control: 'launchd', label: 'com.bdb.memb.webui',
    module: '.agents/memB', pkg: '@hybridlabor-api/memb',
    logs: (ho) => [join(ho, '.memb', 'webui.stdout.log'), join(ho, '.memb', 'webui.stderr.log')],
  },
  {
    id: 'synapse', name: 'Synapse 3D', role: 'Spatial codebase map',
    port: 7781, url: 'http://127.0.0.1:7781', control: 'launchd', label: 'com.bdb.synapse',
    module: '.agents/bdb-synapse', pkg: '@hybridlabor-api/bdb-synapse',
    logs: (ho) => [join(ho, '.synapse', 'daemon.stdout.log'), join(ho, '.synapse', 'daemon.stderr.log')],
  },
  {
    id: 'openwiki', name: 'OpenWiki', role: 'Refreshes project wikis every 2h',
    port: null, url: null, control: 'launchd', label: 'com.bdb.openwiki.daemon',
    module: null, pkg: null,
    logs: (ho) => [join(ho, '.openwiki', 'daemon.log'), join(ho, '.openwiki', 'daemon_stderr.log')],
    // The daemon is machine-global, but the graph viewer is per repository —
    // so this service offers a project list rather than one "open" button.
    projectsFile: (ho) => join(ho, '.openwiki', 'projects.json'),
  },
  {
    id: 'ao', name: 'AO Orchestrator', role: 'Agent workspace daemon',
    port: 3101, url: 'http://127.0.0.1:3101', control: 'launchd', label: 'com.bdb.ao.daemon',
    // Deliberately no module/pkg: reading the archived npm package reported a
    // version string that looked authoritative and was wrong (the running
    // binary is often a local fork build). AO reports the version of the
    // binary that is really running, and nothing else.
    module: null, pkg: null, confirm: true,
    logs: (ho) => [join(ho, '.ao', 'daemon.log')],
  },
  {
    id: 'remoteos', name: 'RemoteOS', role: 'Multi-cloud execution gateway',
    port: 9080, url: 'http://127.0.0.1:9080', control: 'launchd', label: 'com.hybridlabor.bdb-remote',
    module: '.agents/bdb-os-remote', pkg: '@hybridlabor-api/bdb-os-remote',
    logs: () => [],
  },
  {
    id: 'gateway', name: 'MCP Gateway', role: 'Token-authed MCP forwarder',
    port: 7790, url: 'http://127.0.0.1:7790', control: 'launchd', label: 'com.bdb.aos.gateway',
    module: null, pkg: null, confirm: true,
    logs: (ho) => [join(ho, '.agents', 'gateway', 'gateway.log')],
  },
  {
    id: 'plan-canvas', name: 'Plan Canvas', role: 'Shared plan artifacts',
    port: 4519, url: 'http://127.0.0.1:4519', control: 'launchdIfPlist', label: 'com.bdb.plan-canvas',
    module: null, pkg: null,
    logs: () => [],
  },
  {
    id: 'a2a', name: 'A2A Sessions', role: 'Live agent-to-agent sessions',
    port: null, url: null, control: 'observe', label: null,
    module: null, pkg: null,
    logs: () => [],
  },
  {
    id: 'agenttrail', name: 'Agenttrail', role: 'Live repo maps, one port per repo',
    port: null, url: null, control: 'observe', label: null,
    module: null, pkg: null,
    logs: () => [],
  },
  {
    id: 'hub', name: 'AOS Hub', role: 'This server',
    port: null, url: null, control: 'observe', label: null,
    module: null, pkg: null,
    logs: (ho) => [join(ho, '.aos', 'hub', 'stdout.log'), join(ho, '.aos', 'hub', 'stderr.log')],
  },
];

export const byId = new Map(SERVICES.map((s) => [s.id, s]));
export const SERVICE_IDS = SERVICES.map((s) => s.id);

// Must be called once per test run that injects a fake a2a list or a fake
// gateway status; production never calls it.
let a2aListFn = null;
let gatewayStatusFn = null;
export function setA2aListForTests(fn) { a2aListFn = fn; }
export function setGatewayStatusForTests(fn) { gatewayStatusFn = fn; }

// ------------------------------------------------------------------ probing
export function portOpen(port, timeout = 800) {
  return new Promise((resolve) => {
    if (!port) return resolve(null);
    const sock = connect({ host: '127.0.0.1', port });
    const done = (v) => { try { sock.destroy(); } catch { /* already gone */ } resolve(v); };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

export const freePort = () => new Promise((resolve, reject) => {
  const srv = createTcpServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

// launchd loaded probe (mac) or the OpenWiki ScheduledTask state (windows);
// null = not answerable on this platform.
export async function agentLoaded(ctx, label, platform) {
  const plat = platform || (ctx && ctx.platform) || process.platform;
  if (plat === 'darwin') {
    const res = await doRun(ctx, 'launchctl', ['list']);
    if (!res.ok) return null;
    return res.stdout.split('\n').some((l) => l.trim().endsWith(label));
  }
  if (plat === 'win32' && label === 'com.bdb.openwiki.daemon') {
    // The ScheduledTask state the installer registered; only these two states
    // mean the daemon is there. Constant command; request values never reach it.
    const res = await doRun(ctx, 'powershell.exe', ['-NoProfile', '-Command',
      "$task = Get-ScheduledTask -TaskName 'BDB_OpenWiki_Daemon' -ErrorAction SilentlyContinue; if ($task) { $task.State }"], { timeout: 5000 });
    const state = res.stdout.trim();
    return state === 'Ready' || state === 'Running';
  }
  return null;
}

const uidOf = (ctx) => {
  const uid = ctx ? ctx.uid : null;
  if (uid) return String(uid);
  return typeof process.getuid === 'function' ? String(process.getuid()) : '0';
};
const platformOf = (ctx) => (ctx && ctx.platform) || process.platform;

const localVersion = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')).version || null; } catch { return null; }
};

// ao: no package.json story — the binary that is running is the truth.
const aoBinary = (home) => join(home, '.local', 'bin', 'ao');
// An `ao` binary rebuilt and copied into place without being re-signed is
// SIGKILLed by AMFI on launch (exit 137). The daemon then reads as simply
// "down" with nothing in the log explaining why, so name the cause here.
// (German text from the dashboard was translated: repo rule.)
async function aoHealth(ctx) {
  const bin = aoBinary(ctx.home);
  if (!existsSync(bin)) {
    return { level: 'warn', text: 'no ao binary at ~/.local/bin/ao' };
  }
  if (platformOf(ctx) !== 'darwin') return null;
  const res = await doRun(ctx, 'codesign', ['-v', bin]);
  if (res.ok) return null;
  return { level: 'error', text: 'binary is not signed — AMFI kills it on launch (exit 137). Fix: codesign -s - -f ~/.local/bin/ao' };
}

// A port for testing/status may be overridden: ctx.portOverrides = { memb: 12345 }.
const portRow = (ctx, svc) => {
  const ov = ctx && ctx.portOverrides;
  return ov && Object.prototype.hasOwnProperty.call(ov, svc.id) ? ov[svc.id] : svc.port;
};

// ------------------------------------------------- version + update checking
// npm view costs seconds, so it never runs inside a status request. Results
// are cached for 30 minutes, and a failed lookup is reported as "uncheckable"
// rather than silently passing for "current".
const UPDATE_TTL_MS = 30 * 60 * 1000;
const updateCache = { at: 0, data: null, checking: false };
export const resetMetaCacheForTests = () => { updateCache.at = 0; updateCache.data = null; updateCache.checking = false; };

async function npmVersion(ctx, pkg) {
  const res = await doRun(ctx, 'npm', ['view', pkg, 'version'], { timeout: 12000 });
  return res.ok ? (res.stdout.trim() || null) : null;
}

const aosVersion = () => localVersion(join(ROOT, 'package.json'));

async function collectUpdates(ctx) {
  const targets = [
    { id: 'aos', pkg: '@hybridlabor-api/aos', local: aosVersion() },
    ...SERVICES.filter((s) => s.pkg)
      .map((s) => ({ id: s.id, pkg: s.pkg, local: localVersion(join(ctx.root || ROOT, s.module, 'package.json')) })),
  ];
  const out = {};
  await Promise.all(targets.map(async (t) => {
    if (!t.local) { out[t.id] = { state: 'uncheckable' }; return; }
    const remote = await npmVersion(ctx, t.pkg);
    out[t.id] = remote === null
      ? { state: 'uncheckable', local: t.local }
      : remote === t.local
        ? { state: 'current', local: t.local }
        : { state: 'outdated', local: t.local, remote };
  }));
  return out;
}

export async function serviceMeta(ctx, { force = false } = {}) {
  const now = (ctx && ctx.now ? ctx.now() : Date.now());
  const fresh = now - updateCache.at < UPDATE_TTL_MS;
  if (updateCache.data && fresh && !force) return { version: aosVersion(), updates: updateCache.data, cached: true };
  if (updateCache.checking) return { version: aosVersion(), updates: updateCache.data || {}, cached: true };
  updateCache.checking = true;
  try {
    updateCache.at = now;
    updateCache.data = await collectUpdates(ctx);
  } catch {
    updateCache.checking = false;
    return { version: aosVersion(), updates: updateCache.data || {}, cached: !!updateCache.data };
  }
  updateCache.checking = false;
  return { version: aosVersion(), updates: updateCache.data || {} };
}

// ------------------------------------------------------------- openwiki view
const viewers = new Map();

// A wiki exists wherever a repo has a .openwiki directory. projects.json is
// only what the refresh daemon has been told about — showing that list alone
// hid the fact that wikis existed and were not being refreshed.
let wikiCache = { at: 0, list: [] };
const WIKI_TTL_MS = 60 * 1000;
export const resetWikiCacheForTests = () => { wikiCache = { at: 0, list: [] }; };

export function discoverWikis(root = join((process.env.AOS_HUB_HOME || os.homedir()), 'dev'), depth = 4) {
  const out = [];
  const walk = (dir, left) => {
    if (left < 0) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isDirectory() && e.name === '.openwiki')) { out.push(dir); return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (['node_modules', 'venv', '__pycache__'].includes(e.name)) continue;
      walk(join(dir, e.name), left - 1);
    }
  };
  walk(root, depth);
  return out.sort();
}

export function openWikiProjects(ctx) {
  const now = (ctx && ctx.now ? ctx.now() : Date.now());
  if (now - wikiCache.at < WIKI_TTL_MS) return wikiCache.list;
  const home = ctx.home;
  let tracked = [];
  try { tracked = JSON.parse(readFileSync(SERVICES.find((s) => s.id === 'openwiki').projectsFile(home), 'utf8')).projects || []; } catch { /* not written yet */ }
  const trackedSet = new Set(tracked);

  const list = [...new Set([...tracked, ...discoverWikis(ctx.wikiRoot || join(home, 'dev'))])]
    .filter((p) => existsSync(join(p, '.openwiki')))
    .map((p) => {
      // Freshness comes from the wiki's own pages, which is what the daemon
      // rewrites — a repo that has not been visited shows its real age.
      let newest = 0;
      try {
        for (const f of readdirSync(join(p, '.openwiki'))) {
          if (!f.endsWith('.md')) continue;
          const m = statSync(join(p, '.openwiki', f)).mtimeMs;
          if (m > newest) newest = m;
        }
      } catch { /* unreadable is simply unknown */ }
      return { path: p, name: basename(p), tracked: trackedSet.has(p), days: newest ? Math.floor((now - newest) / 86400000) : null };
    })
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));

  wikiCache = { at: now, list };
  return list;
}

export async function startViewer(ctx, projectPath, opts = {}) {
  // Only a path this machine already tracks may be launched; nothing from the
  // request is used as a path, and the port is chosen here, not by the caller.
  const known = openWikiProjects(ctx).some((p) => p.path === projectPath);
  if (!known) throw new Error('unknown project');
  const running = viewers.get(projectPath);
  if (running && await portOpen(running.port, 250)) return { port: running.port };

  const spawnFn = opts.spawn || (ctx && ctx.spawn) || nodeSpawn;
  const port = await freePort();
  const child = spawnFn('openwiki', ['visualize', projectPath, '--port', String(port), '--no-open'], {
    stdio: 'ignore', shell: false, detached: false,
  });
  try {
    child.on('exit', () => { if (viewers.get(projectPath)?.child === child) viewers.delete(projectPath); });
  } catch { /* test doubles without .on */ }
  viewers.set(projectPath, { port, child });

  const probe = opts.probe || portOpen;
  const delay = opts.probeDelay ?? 250;
  for (let i = 0; i < 40; i++) {                 // up to ~10s for it to bind
    if (await probe(port, 250)) return { port };
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error('visualizer did not start — is `openwiki` on the PATH?');
}

export const stopViewers = () => { for (const { child } of viewers.values()) { try { child.kill(); } catch { /* already gone */ } } };
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => stopViewers());
}

// ------------------------------------------------------------------ status

// a2a status reads the live registry entries only; per-session secrets are
// never opened by this module.
async function a2aStatus(ctx) {
  if (!a2aListFn) {
    const reg = await import('../a2a-registry.mjs');
    a2aListFn = reg.list;
  }
  let entries = [];
  try { entries = await a2aListFn({ prune: false }) || []; } catch { entries = []; }
  return {
    entries: entries.map((e) => ({
      name: e?.name ?? null, harness: e?.harness ?? null, url: e?.url ?? null,
      pid: e?.pid ?? null, cwd: e?.cwd ?? null,
    })),
    up: entries.length > 0,
  };
}

async function trailStatus() {
  const live = await probeTrailPorts().catch(() => []);
  return { ports: live, links: live.map((p) => ({ port: p, url: `http://127.0.0.1:${p}/` })), up: live.length > 0 };
}

async function gatewayUp(ctx, home) {
  if (gatewayStatusFn) {
    try { return !!(await gatewayStatusFn({ dir: join(home, '.agents', 'gateway') })).running; } catch { return false; }
  }
  try {
    // Import the real gatewayStatus; the bin module has import-only side
    // effects (main is argv-guarded), so this stays quiet.
    const gw = await import('../../bin/aos-gateway.mjs');
    gatewayStatusFn = gw.gatewayStatus;
    return !!(await gw.gatewayStatus({ dir: join(home, '.agents', 'gateway') })).running;
  } catch {
    // Not importable (packaged flat layout?): fall back to a TCP probe.
    return !!(await portOpen(7790));
  }
}

const launchdPlist = (home, label) => join(home, 'Library', 'LaunchAgents', `${label}.plist`);

// effectiveControl: plan-canvas is launchd-controlled only when its plist
// exists; otherwise it is observe (down is normal: 30 min idle by design).
export function effectiveControl(ctx, svc) {
  if (svc.control !== 'launchdIfPlist') return svc.control;
  if (platformOf(ctx) !== 'darwin') return 'observe';
  return existsSync(launchdPlist(ctx.home, svc.label)) ? 'launchd' : 'observe';
}

export async function statusService(ctx) {
  return Promise.all(SERVICES.map(async (s) => {
    const plat = platformOf(ctx);
    const port = portRow(ctx, s);
    const logs = [];
    for (const f of s.logs(ctx.home)) {
      if (!existsSync(f)) continue;
      let size = 0;
      try { size = statSync(f).size; } catch { /* raced with a rotate */ }
      logs.push({ name: basename(f), size });
    }
    const row = {
      id: s.id, name: s.name, role: s.role,
      port, url: s.url, control: effectiveControlFor(ctx, s), confirm: !!s.confirm,
      version: s.pkg ? localVersion(join(ctx.home, s.module || '/', 'package.json')) : null,
      logs, installed: s.module ? existsSync(join(ctx.home, s.module)) : true,
      observe: s.control === 'observe' || (s.control === 'launchdIfPlist' && effectiveControlFor(ctx, s) === 'observe'),
      projects: null, viewers: null, extra: null, health: null,
    };
    if (s.id === 'ao') {
      if (existsSync(aoBinary(ctx.home))) {
        const v = await doRun(ctx, aoBinary(ctx.home), ['--version']);
        row.version = v.ok ? (v.stdout.trim().replace(/^ao version\s*/i, '') || null) : null;
      } else row.version = null;
      try { row.health = await aoHealth(ctx); } catch { /* a health probe must never sink the page */ }
    }
    if (port) {
      row.up = await portOpen(port);
      // Non-benign case: also ask launchd whether the agent is loaded so
      // "down but loaded" (starting up, crashed) stays visible.
      if (row.up) row.loaded = true;
      else row.loaded = await agentLoadedWillBeChecked(ctx, s, plat);
    } else if (s.id === 'openwiki') {
      row.loaded = await agentLoaded(ctx, s.label, plat);
      row.up = row.loaded;
      row.projects = openWikiProjects(ctx);
      row.viewers = [...viewers.entries()].map(([p, v]) => ({ project: p, port: v.port }));
    } else if (s.id === 'a2a') {
      const a2a = await a2aStatus(ctx);
      row.up = a2a.up; row.loaded = a2a.up; row.sessions = a2a.entries;
    } else if (s.id === 'agenttrail') {
      const t = await trailStatus();
      row.up = t.up; row.loaded = t.up; row.ports = t.ports; row.links = t.links;
    } else if (s.id === 'hub') {
      row.up = true; row.loaded = true;/* the hub itself is answering this request */
    } else {
      row.up = null; row.loaded = null;
    }
    if (s.id === 'gateway') {
      row.up = await gatewayUp(ctx, ctx.home) || await portOpen(port, 400);
      row.loaded = row.up;
    }
    return row;
  }));
}

// Non-port launchd services also get a loaded probe where answerable. Kept as
// a small helper so the snapshot stays flat.
const agentLoadedWillBeChecked = async (ctx, s, plat) =>
  (s.label && (plat === 'darwin' || (plat === 'win32' && s.label === 'com.bdb.openwiki.daemon')))
    ? await agentLoaded(ctx, s.label, plat) : null;

function effectiveControlFor(ctx, s) {
  if (s.control !== 'launchdIfPlist') return s.control;
  return existsSync(launchdPlist(ctx.home, s.label)) ? 'launchd' : 'observe';
}

// ------------------------------------------------------------------ control
// launchd: bootstrap gui/<uid> <plist> | bootout gui/<uid>/<label> |
// kickstart -k gui/<uid>/<label> (the aos-gateway service() pattern).
// Errors "already loaded"/"not loaded" count as success after a status
// re-probe. The plist must exist or influence nothing: no spawn happens at
// all. `observe` services are never controlled.
const BENIGN = /already (loaded|bootstrapped)|not loaded|no such process|boot-out failed/i;

export async function controlService(ctx, id, action) {
  const svc = byId.get(id);
  if (!svc) throw new Error('unknown service');
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('unknown action');
  const plat = platformOf(ctx);
  const ho = ctx.home;

  // Windows: only wrapped/task-backed daemons are controllable.
  if (plat === 'win32') {
    if (id === 'openwiki') {
      // Straight port of the dashboard branch (which read `process.platform === 'win32' && id === 'openwiki'`). The task name is a constant, never request data.
      // OpenWiki's refresh daemon is registered as a Scheduled Task on
      // Windows, not as a launchd plist. Keep the command allowlisted and
      // pass only that constant to PowerShell.
      const runPs = async (command) => {
        const res = await doRun(ctx, 'powershell.exe', ['-NoProfile', '-Command', command], { timeout: 10000 });
        if (!res.ok) throw new Error((res.stderr || res.stdout || 'scheduled task control failed').trim());
      };
      if (action === 'stop' || action === 'restart') {
        await runPs("Stop-ScheduledTask -TaskName 'BDB_OpenWiki_Daemon' -ErrorAction SilentlyContinue");
      }
      if (action === 'start' || action === 'restart') {
        await runPs("Start-ScheduledTask -TaskName 'BDB_OpenWiki_Daemon' -ErrorAction Stop");
      }
      return { ok: true };
    }
    const daemon = WINDOWS_DAEMONS[id];
    if (!daemon) throw new Error('start/stop is not available on this platform for this service');
    const vbsPath = join(WINDOWS_STARTUP_DIR(ho), daemon.vbs);
    if (!existsSync(vbsPath)) throw new Error(`no Windows startup wrapper installed for ${svc.name}`);
    const runPs = async (command) => {
      const res = await doRun(ctx, 'powershell.exe', ['-NoProfile', '-Command', command], { timeout: 10000 });
      if (!res.ok) throw new Error((res.stderr || res.stdout || 'process stop failed').trim());
    };
    if (action === 'stop' || action === 'restart') {
      const escapedPattern = daemon.processPattern.replace(/'/g, "''");
      await runPs(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match '${escapedPattern}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
    }
    if (action === 'start' || action === 'restart') {
      const ws = await doRun(ctx, 'wscript.exe', [vbsPath], { timeout: 10000 });
      if (!ws.ok) throw new Error((ws.stderr || 'wscript failed').trim());
    }
    return { ok: true };
  }

  if (plat !== 'darwin') throw new Error('start/stop is not available on this platform for this service');

  const ctl = effectiveControlFor(ctx, svc);
  if (ctl === 'observe') throw new Error('observe services cannot be controlled');

  const plist = launchdPlist(ho, svc.label);
  if (!existsSync(plist)) throw new Error(`no LaunchAgent installed for ${svc.name}`);

  const uid = uidOf(ctx);
  const target = `gui/${uid}/${svc.label}`;
  // restart on launchd: bootout (stop) then bootstrap (start). kickstart -k
  // stays the gateway CLI's own restart path; the hub restarts via
  // bootout+bootstrap so a stopped service can also be started again.
  if (action === 'stop' || action === 'restart') {
    const res = await doRun(ctx, 'launchctl', ['bootout', target]).catch((e) => ({ ok: false, stderr: e.message, stdout: '' }));
    if (!res.ok && !BENIGN.test(`${res.stderr} ${res.stdout}`)) {
      throw new Error(String(res.stderr || res.stdout || 'launchctl bootout failed').trim());
    }
  }
  if (action === 'start' || action === 'restart') {
    const res = await doRun(ctx, 'launchctl', ['bootstrap', `gui/${uid}`, plist]);
    if (!res.ok && !BENIGN.test(`${res.stderr} ${res.stdout}`)) {
      throw new Error(String(res.stderr || res.stdout || 'launchctl bootstrap failed').trim());
    }
  }
  // Success just means the commands were accepted; the UI re-probes status.
  return { ok: true };
}

const WINDOWS_DAEMONS = {
  memb: { vbs: 'com.bdb.memb.webui.vbs', processPattern: 'src[\\\\/]backend[\\\\/]server\\.py' },
  synapse: { vbs: 'com.bdb.synapse.vbs', processPattern: 'synapse\\.js.*serve' },
};

// ------------------------------------------------------------------- logs
export async function readServiceLog(ctx, id, name) {
  const svc = byId.get(id);
  if (!svc) throw new Error('unknown service');
  // A log file is matched against the service's own declared logs only; a
  // basename from the request is never joined or resolved.
  if (!/^[A-Za-z0-9_.-]+$/.test(String(name || ''))) throw new Error('bad log name');
  const file = svc.logs(ctx.home).find((f) => basename(f) === name);
  if (!file) throw new Error('unknown log');
  const text = await readFile(file, 'utf8').catch(() => '');
  return redact(text.split('\n').slice(-400).join('\n') || '(empty)');
}

// --------------------------------------------------------------------- CLI
// `aos services status [--json] | start <id> | stop <id> --confirm <id> |
// restart <id> --confirm <id>`. Exit 0 ok / 1 failed / 2 usage or unknown id.
// Uses the same functions as the routes.
const confirmArg = (argv, flag) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] !== undefined ? String(argv[i + 1]) : null;
};

export async function cli(argv = [], ctx = {}) {
  const ctxFull = {
    ...ctx,
    root: ctx.root || ROOT,
    home: ctx.home || process.env.AOS_HUB_HOME || os.homedir(),
    cwd: ctx.cwd || process.cwd(),
    now: ctx.now || (() => Date.now()),
  };
  const args = argv.map(String);
  const rest = args.filter((a) => a && !a.startsWith('--'));
  const json = args.includes('--json');

  if (!args.length) {
    (ctxFull.log || console.log)('usage: aos services status [--json] | start <id> | stop <id> --confirm <id> | restart <id> --confirm <id>');
    return 2;
  }

  if (rest[0] === 'status' || (rest[0] === undefined && json)) {
    const services = await statusService(ctxFull);
    if (json) (ctxFull.log || console.log)(JSON.stringify({ services }, null, 2));
    else {
      for (const s of services) {
        const state = s.up === null ? '?' : s.up ? 'up' : 'down';
        (ctxFull.log || console.log)(`${state}  ${s.id}  ${s.version ? `v${s.version}` : ''}  ${s.url || ''}`.trim());
      }
    }
    return 0;
  }

  const action = rest[0];
  if (!['start', 'stop', 'restart'].includes(action)) {
    (ctxFull.log || console.log)('usage: aos services status [--json] | start <id> | stop <id> --confirm <id> | restart <id> --confirm <id>');
    return 2;
  }
  const id = rest[1];
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !byId.has(id)) {
    (ctxFull.log || console.log)(`unknown service id: ${id || '(missing)'}`);
    return 2;
  }
  if (action !== 'start') {
    const got = confirmArg(args, '--confirm') || confirmArg(args, '-c');
    if (got !== id) {
      (ctxFull.log || console.log)(`typed confirm required: --confirm ${id}`);
      return 2;
    }
  }
  try {
    const res = await controlService(ctxFull, id, action);
    (ctxFull.log || console.log)(`${action} ${id}: ${res.ok ? 'done' : 'failed'}`);
    return res.ok ? 0 : 1;
  } catch (e) {
    (ctx.log || console.error)(`aos services: ${e.message}`);
    return 1;
  }
}
