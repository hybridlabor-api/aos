#!/usr/bin/env node
// AOS Dashboard — one page showing every BDB service, live, with start/stop
// and log access. Zero dependencies: node:http plus a TCP probe.
//
//   aos-dashboard [--port 7900] [--no-open]
//
// Binds to 127.0.0.1 only. Control actions run launchctl against a fixed
// service table — the request never reaches a shell, and an id that is not in
// the table is refused, so nothing a browser sends can widen what this can do.

import { createServer } from 'node:http';
import { connect, createServer as createTcpServer } from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);
const HOME = os.homedir();
const h = (...p) => path.join(HOME, ...p);
const IS_MAC = process.platform === 'darwin';
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_DIR = path.join(PKG_ROOT, 'assets', 'brand');

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(argOf('--port', 7900));
const OPEN = !process.argv.includes('--no-open');

// The single source of truth. Everything the dashboard can see or do is here;
// there is no path by which a request adds to it.
const SERVICES = [
  {
    id: 'memb', name: 'memB', role: 'Persistent agent memory',
    mark: 'memb-crystal-mark.svg',
    port: 8088, url: 'http://127.0.0.1:8088', agent: 'com.bdb.memb.webui',
    module: h('.agents', 'memB'), pkg: '@hybridlabor-api/memb',
    logs: [h('.memb', 'webui.stdout.log'), h('.memb', 'webui.stderr.log')],
  },
  {
    id: 'synapse', name: 'Synapse 3D', role: 'Spatial codebase map',
    mark: 'bdb-core-mark.svg', muted: true,
    port: 7781, url: 'http://127.0.0.1:7781', agent: 'com.bdb.synapse',
    module: h('.agents', 'bdb-synapse'), pkg: '@hybridlabor-api/bdb-synapse',
    logs: [h('.synapse', 'daemon.stdout.log'), h('.synapse', 'daemon.stderr.log')],
  },
  {
    id: 'openwiki', name: 'OpenWiki', role: 'Refreshes project wikis every 2h',
    mark: 'bdb-core-mark.svg', muted: true,
    port: null, url: null, agent: 'com.bdb.openwiki.daemon',
    module: null, pkg: null,
    logs: [h('.openwiki', 'daemon.log'), h('.openwiki', 'daemon_stderr.log')],
    // The daemon is machine-global, but the graph viewer is per repository —
    // so this card offers a project list rather than one "open" button.
    projectsFile: h('.openwiki', 'projects.json'),
  },
  {
    id: 'ao', name: 'AO Orchestrator', role: 'Agent workspace daemon',
    mark: 'ao-ant-mark.svg',
    port: 3101, url: 'http://127.0.0.1:3101', agent: 'com.bdb.ao.daemon',
    module: h('.agents', 'bdb-os-agent-workspace'), pkg: '@hybridlabor-api/bdb-os-agent-workspace',
    logs: [h('.ao', 'daemon.log')],
    // An `ao` binary rebuilt and copied into place without being re-signed is
    // SIGKILLed by AMFI on launch (exit 137). The daemon then reads as simply
    // "down" with nothing in the log explaining why, so name the cause here.
    health: async () => {
      const bin = h('.local', 'bin', 'ao');
      if (!existsSync(bin)) return { level: 'warn', text: 'kein ao-Binary unter ~/.local/bin/ao' };
      if (!IS_MAC) return null;
      try {
        await execFileP('codesign', ['-v', bin]);
        return null;
      } catch {
        return { level: 'error', text: 'Binary ist nicht signiert — AMFI beendet es beim Start (Exit 137). Beheben: codesign -s - -f ~/.local/bin/ao' };
      }
    },
  },
  {
    id: 'remoteos', name: 'RemoteOS', role: 'Multi-cloud execution gateway',
    mark: 'bdb-core-mark.svg', muted: true,
    port: 9080, url: 'http://127.0.0.1:9080', agent: 'com.hybridlabor.bdb-remote',
    module: h('.agents', 'bdb-os-remote'), pkg: '@hybridlabor-api/bdb-os-remote',
    logs: [],
  },
];

const byId = new Map(SERVICES.map((s) => [s.id, s]));

// ------------------------------------------------------------------ probing
function portOpen(port, timeout = 800) {
  return new Promise((resolve) => {
    if (!port) return resolve(null);
    const sock = connect({ host: '127.0.0.1', port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

const freePort = () => new Promise((resolve, reject) => {
  const srv = createTcpServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

async function agentLoaded(label) {
  if (!IS_MAC) return null;
  try {
    const { stdout } = await execFileP('launchctl', ['list']);
    return stdout.split('\n').some((l) => l.trim().endsWith(label));
  } catch { return null; }
}

const localVersion = (dir) => {
  if (!dir) return null;
  try { return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null; }
  catch { return null; }
};

// ------------------------------------------------- version + update checking
// npm view costs seconds, so it never runs inside a status request. The page
// renders from local state immediately and asks for this separately; results
// are cached, and a failed lookup is reported as "not checkable" rather than
// silently passing for "current" — the mistake that let stale modules sit
// unnoticed for releases.
const UPDATE_TTL_MS = 30 * 60 * 1000;
let updateCache = { at: 0, data: null, checking: false };

async function npmVersion(pkg) {
  try {
    const { stdout } = await execFileP('npm', ['view', pkg, 'version'], { timeout: 12000 });
    return stdout.trim() || null;
  } catch { return null; }
}

const AOS_VERSION = localVersion(PKG_ROOT);

async function collectUpdates() {
  const targets = [
    { id: 'aos', pkg: '@hybridlabor-api/aos', local: AOS_VERSION },
    ...SERVICES.filter((s) => s.pkg).map((s) => ({ id: s.id, pkg: s.pkg, local: localVersion(s.module) })),
  ];
  const out = {};
  await Promise.all(targets.map(async (t) => {
    if (!t.local) { out[t.id] = { state: 'unknown' }; return; }
    const remote = await npmVersion(t.pkg);
    out[t.id] = remote === null
      ? { state: 'uncheckable', local: t.local }
      : remote === t.local
        ? { state: 'current', local: t.local }
        : { state: 'outdated', local: t.local, remote };
  }));
  return out;
}

async function updates({ force = false } = {}) {
  const fresh = Date.now() - updateCache.at < UPDATE_TTL_MS;
  if (updateCache.data && fresh && !force) return updateCache.data;
  if (updateCache.checking) return updateCache.data || {};
  updateCache.checking = true;
  try {
    updateCache = { at: Date.now(), data: await collectUpdates(), checking: false };
  } catch {
    updateCache.checking = false;
  }
  return updateCache.data || {};
}

// ------------------------------------------------------------------ status
async function snapshot() {
  return Promise.all(SERVICES.map(async (s) => {
    const [listening, loaded] = await Promise.all([portOpen(s.port), agentLoaded(s.agent)]);
    // A port-less service (OpenWiki) can only be judged by its LaunchAgent.
    const up = s.port ? listening : loaded;
    const logs = [];
    for (const f of s.logs) {
      if (!existsSync(f)) continue;
      let size = 0;
      try { size = (await stat(f)).size; } catch { /* raced with a rotate */ }
      logs.push({ name: path.basename(f), size });
    }
    let health = null;
    if (s.health) { try { health = await s.health(); } catch { /* a health probe must never sink the page */ } }
    return {
      id: s.id, name: s.name, role: s.role, mark: s.mark, muted: !!s.muted,
      port: s.port, url: s.url, up, loaded, version: localVersion(s.module),
      logs, health, installed: !s.module || existsSync(s.module),
      projects: s.projectsFile ? openWikiProjects() : null,
      viewers: s.id === 'openwiki' ? [...viewers.entries()].map(([p, v]) => ({ project: p, port: v.port })) : null,
    };
  }));
}

// ------------------------------------------------------------- openwiki view
const viewers = new Map();   // project path -> { port, child }

// A wiki exists wherever a repo has a .openwiki directory. projects.json is
// only what the refresh daemon has been told about — showing that list alone
// hid the fact that 31 wikis existed and 3 were being refreshed.
let wikiCache = { at: 0, list: [] };
const WIKI_TTL_MS = 60 * 1000;

function discoverWikis(root = path.join(HOME, 'dev'), depth = 4) {
  const out = [];
  const walk = (dir, left) => {
    if (left < 0) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isDirectory() && e.name === '.openwiki')) { out.push(dir); return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (['node_modules', 'venv', '__pycache__'].includes(e.name)) continue;
      walk(path.join(dir, e.name), left - 1);
    }
  };
  walk(root, depth);
  return out.sort();
}

function openWikiProjects() {
  if (Date.now() - wikiCache.at < WIKI_TTL_MS) return wikiCache.list;
  const svc = byId.get('openwiki');
  let tracked = [];
  try { tracked = JSON.parse(readFileSync(svc.projectsFile, 'utf8')).projects || []; } catch { /* not written yet */ }
  const trackedSet = new Set(tracked);

  const list = [...new Set([...tracked, ...discoverWikis()])]
    .filter((p) => existsSync(path.join(p, '.openwiki')))
    .map((p) => {
      // Freshness comes from the wiki's own pages, which is what the daemon
      // rewrites — a repo that has not been visited shows its real age.
      let newest = 0;
      try {
        for (const f of readdirSync(path.join(p, '.openwiki'))) {
          if (!f.endsWith('.md')) continue;
          const m = statSync(path.join(p, '.openwiki', f)).mtimeMs;
          if (m > newest) newest = m;
        }
      } catch { /* unreadable is simply unknown */ }
      return { path: p, name: path.basename(p), tracked: trackedSet.has(p), days: newest ? Math.floor((Date.now() - newest) / 86400000) : null };
    })
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));

  wikiCache = { at: Date.now(), list };
  return list;
}

async function startViewer(projectPath) {
  // Only a path this machine already tracks may be launched; nothing from the
  // request is used as a path, and the port is chosen here, not by the caller.
  const known = openWikiProjects().some((p) => p.path === projectPath);
  if (!known) throw new Error('unbekanntes Projekt');
  const running = viewers.get(projectPath);
  if (running && await portOpen(running.port)) return { port: running.port };

  const port = await freePort();
  const child = spawn('openwiki', ['visualize', projectPath, '--port', String(port), '--no-open'], {
    stdio: 'ignore', detached: false,
  });
  child.on('exit', () => { if (viewers.get(projectPath)?.child === child) viewers.delete(projectPath); });
  viewers.set(projectPath, { port, child });

  for (let i = 0; i < 40; i++) {                 // up to ~10s for it to bind
    if (await portOpen(port, 250)) return { port };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Visualizer ist nicht gestartet — läuft `openwiki` auf dem PATH?');
}

const stopViewers = () => { for (const { child } of viewers.values()) { try { child.kill(); } catch { /* already gone */ } } };

// ------------------------------------------------------------------ control
async function control(id, action) {
  const svc = byId.get(id);
  if (!svc) throw new Error('unknown service');
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('unknown action');
  if (!IS_MAC) throw new Error('start/stop is wired for launchd (macOS) only');

  const plist = h('Library', 'LaunchAgents', `${svc.agent}.plist`);
  if (!existsSync(plist)) throw new Error(`no LaunchAgent installed for ${svc.name}`);

  const run = (args) => execFileP('launchctl', args).catch((e) => { throw new Error(e.stderr?.trim() || e.message); });
  if (action === 'stop' || action === 'restart') await run(['unload', plist]).catch(() => {});
  if (action === 'start' || action === 'restart') await run(['load', '-w', plist]);
  return { ok: true };
}

async function readLog(id, name) {
  const svc = byId.get(id);
  if (!svc) throw new Error('unknown service');
  // Match against the service's own declared logs; a path from the request is
  // never joined or resolved.
  const file = svc.logs.find((f) => path.basename(f) === name);
  if (!file) throw new Error('unknown log');
  const text = await readFile(file, 'utf8').catch(() => '');
  return text.split('\n').slice(-400).join('\n') || '(leer)';
}

// ------------------------------------------------------------------ page
const PAGE = `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AOS Dashboard</title>
<style>
  :root{
    --bg:#0a0a0a; --card:#141414; --line:#262626; --line-soft:#1d1d1d;
    --fg:#fff; --dim:#8a8a8a; --dimmer:#5f5f5f;
    --accent:#9b30c4; --plum:#51116F; --pill:#180524;
    --up:#4ade80; --down:#f87171;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
    font:14px/1.5 ui-sans-serif,-apple-system,"SF Pro Display",Inter,system-ui,sans-serif}

  header{display:flex;align-items:center;gap:16px;padding:22px 28px;
    border-bottom:1px solid var(--line);flex-wrap:wrap}
  header img{width:34px;height:34px;flex:0 0 auto}
  .brand{display:flex;flex-direction:column;line-height:1.2}
  .brand b{font-size:16px;font-weight:700;letter-spacing:.01em}
  .brand span{font-size:11px;color:var(--dim);letter-spacing:.08em;text-transform:uppercase}
  .grow{flex:1}
  .ver{font:600 12px/1 ui-monospace,"SF Mono",monospace;color:var(--dim);
    border:1px solid var(--line);border-radius:999px;padding:6px 11px}
  .badge{font:700 11px/1 ui-monospace,"SF Mono",monospace;letter-spacing:.04em;
    background:var(--pill);border:1px solid var(--accent);color:#fff;
    border-radius:999px;padding:6px 12px;text-decoration:none;display:inline-block}
  .badge.muted{border-color:var(--line);color:var(--dim);background:transparent}

  main{padding:22px 28px;display:grid;gap:10px;max-width:960px}

  .card{background:var(--card);border:1px solid var(--line);border-radius:12px}
  .head{display:grid;grid-template-columns:38px minmax(0,1fr) auto auto;
    align-items:center;gap:14px;padding:15px 18px}
  .mark{width:38px;height:38px;display:grid;place-items:center;
    background:#0e0e0e;border:1px solid var(--line-soft);border-radius:9px;overflow:hidden}
  .mark img{width:26px;height:26px;display:block}
  .mark img.muted{opacity:.42;filter:grayscale(1)}
  .ident{min-width:0}
  .ident b{display:block;font-size:14.5px;font-weight:650}
  .ident span{display:block;font-size:12px;color:var(--dim);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .state{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dim);
    font-variant-numeric:tabular-nums;white-space:nowrap}
  .dot{width:8px;height:8px;border-radius:50%}
  .up{background:var(--up)}.down{background:var(--down)}.unknown{background:var(--dimmer)}
  .acts{display:flex;gap:6px;justify-self:end}

  a.btn,button{font:inherit;font-size:12.5px;background:transparent;color:var(--fg);
    border:1px solid var(--line);border-radius:7px;padding:5px 11px;cursor:pointer;
    text-decoration:none;white-space:nowrap;transition:border-color .14s,background .14s}
  a.btn:hover,button:hover{border-color:var(--accent);background:rgba(155,48,196,.13)}
  button:disabled{opacity:.35;cursor:not-allowed}
  button.primary{border-color:var(--accent)}

  .sub{border-top:1px solid var(--line-soft);padding:11px 18px;
    display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .sub .lbl{font-size:11px;color:var(--dimmer);letter-spacing:.06em;
    text-transform:uppercase;margin-right:4px}
  .health{margin:0 18px 14px;padding:9px 11px;border-radius:8px;font-size:12px;line-height:1.45}
  .health.error{background:rgba(248,113,113,.09);border:1px solid rgba(248,113,113,.34);color:#fca5a5}
  .health.warn{background:var(--pill);border:1px solid rgba(155,48,196,.45);color:#d8b4fe}
  pre{background:#000;border:1px solid var(--line);border-radius:8px;padding:12px;
    margin:0 18px 16px;overflow:auto;max-height:320px;font-size:12px;
    white-space:pre-wrap;word-break:break-word}
  footer{padding:16px 28px 30px;color:var(--dimmer);font-size:12px}

  @media (max-width:640px){
    .head{grid-template-columns:38px minmax(0,1fr);row-gap:10px}
    .state,.acts{grid-column:1/-1;justify-self:start}
  }
</style></head><body>
<header>
  <img src="/brand/bdb-core-mark.svg" alt="">
  <div class="brand"><b>Agent OS</b><span>Dashboard</span></div>
  <div class="grow"></div>
  <span class="ver" id="ver">—</span>
  <span id="update"></span>
</header>
<main id="list"></main>
<footer>Aktualisiert alle 5 s · nur über 127.0.0.1 erreichbar · Beenden mit Strg-C im Terminal</footer>
<script>
const list = document.getElementById('list');
const openLog = new Map();      // service id -> log name

async function api(p, opts) {
  const r = await fetch(p, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
const kb = (n) => n < 1024 ? n + ' B' : (n / 1024).toFixed(0) + ' KB';
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let upd = {};

function card(s) {
  const state = s.up === null ? 'unknown' : s.up ? 'up' : 'down';
  const label = s.up === null ? 'unbekannt' : s.up ? 'läuft' : 'gestoppt';
  const u = upd[s.id];
  const verBits = [s.version && 'v' + s.version, s.port && ':' + s.port].filter(Boolean).join(' · ');

  const el = document.createElement('div');
  el.className = 'card';

  const logRow = s.logs.length ? \`<div class="sub"><span class="lbl">Logs</span>\${
    s.logs.map(l => \`<button data-log="\${esc(l.name)}" data-id="\${s.id}">\${esc(l.name)} · \${kb(l.size)}</button>\`).join('')
  }</div>\` : '';

  const wikiRow = s.projects ? \`<div class="sub"><span class="lbl">Wikis</span>\${
    s.projects.length
      ? s.projects.map(p => {
          const v = (s.viewers || []).find(x => x.project === p.path);
          return v
            ? \`<a class="btn primary" href="http://127.0.0.1:\${v.port}" target="_blank" rel="noopener">\${esc(p.name)} · :\${v.port}</a>\`
            : \`<button data-wiki="\${esc(p.path)}">\${esc(p.name)}</button>\`;
        }).join('')
      : '<span style="color:var(--dimmer);font-size:12px">keine Projekte in projects.json</span>'
  }</div>\` : '';

  el.innerHTML = \`
    <div class="head">
      <span class="mark"><img src="/brand/\${s.mark}" class="\${s.muted ? 'muted' : ''}" alt=""></span>
      <span class="ident"><b>\${esc(s.name)}</b><span>\${esc(s.role)}\${s.installed ? '' : ' — Modul nicht installiert'}</span></span>
      <span class="state"><span class="dot \${state}"></span>\${label}\${verBits ? ' · ' + verBits : ''}\${
        u && u.state === 'outdated' ? ' · <span style="color:var(--accent)">v' + esc(u.remote) + ' verfügbar</span>' :
        u && u.state === 'uncheckable' ? ' · <span title="npm nicht erreichbar">nicht prüfbar</span>' : ''
      }</span>
      <span class="acts">
        \${s.url && s.up ? \`<a class="btn" href="\${s.url}" target="_blank" rel="noopener">Öffnen</a>\` : ''}
        <button data-act="\${s.up ? 'stop' : 'start'}" data-id="\${s.id}">\${s.up ? 'Stop' : 'Start'}</button>
        \${s.up ? \`<button data-act="restart" data-id="\${s.id}">Neustart</button>\` : ''}
      </span>
    </div>
    \${s.health ? \`<div class="health \${s.health.level}">\${esc(s.health.text)}</div>\` : ''}
    \${wikiRow}\${logRow}\`;

  if (openLog.has(s.id)) {
    const pre = document.createElement('pre');
    pre.id = 'log-' + s.id; pre.textContent = 'lädt …';
    el.appendChild(pre);
  }
  return el;
}

async function refresh() {
  try {
    const data = await api('/api/status');
    list.replaceChildren(...data.services.map(card));
    for (const id of openLog.keys()) loadLog(id);
  } catch { document.getElementById('ver').textContent = 'Server weg'; }
}

async function loadMeta(force) {
  try {
    const m = await api('/api/meta' + (force ? '?force=1' : ''));
    document.getElementById('ver').textContent = 'AOS v' + (m.version || '?');
    const a = m.updates && m.updates.aos;
    const box = document.getElementById('update');
    if (a && a.state === 'outdated') {
      box.innerHTML = '<span class="badge">Update auf v' + esc(a.remote) + '</span>';
    } else if (a && a.state === 'uncheckable') {
      box.innerHTML = '<span class="badge muted">npm nicht erreichbar</span>';
    } else if (a && a.state === 'current') {
      box.innerHTML = '<span class="badge muted">aktuell</span>';
    }
    upd = m.updates || {};
    refresh();
  } catch { /* the page stays useful without version info */ }
}

list.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;

  if (b.dataset.wiki) {
    b.disabled = true; b.textContent = 'startet …';
    try { await api('/api/openwiki/visualize', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: b.dataset.wiki }) }); }
    catch (e) { alert(e.message); }
    return refresh();
  }

  const id = b.dataset.id;
  if (b.dataset.log) {
    if (openLog.get(id) === b.dataset.log) openLog.delete(id);
    else openLog.set(id, b.dataset.log);
    return refresh();
  }

  b.disabled = true; b.textContent = '…';
  try { await api('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action: b.dataset.act }) }); }
  catch (e) { alert(e.message); }
  setTimeout(refresh, 1200);
});

async function loadLog(id) {
  const pre = document.getElementById('log-' + id);
  if (!pre) return;
  try {
    const r = await api('/api/log?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(openLog.get(id)));
    pre.textContent = r.text;
  } catch (e) { pre.textContent = 'Log nicht lesbar: ' + e.message; }
}

refresh();
loadMeta(false);
setInterval(refresh, 5000);
setInterval(() => loadMeta(false), 30 * 60 * 1000);
</script></body></html>`;

// ------------------------------------------------------------------ server
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8192) { req.destroy(); throw new Error('body too large'); }
  }
  return JSON.parse(raw || '{}');
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (url.pathname.startsWith('/brand/')) {
      // Served by basename against the shipped directory — a request cannot
      // reach outside it.
      const file = path.join(BRAND_DIR, path.basename(url.pathname));
      if (!existsSync(file)) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' });
      return res.end(await readFile(file));
    }
    if (url.pathname === '/api/status') {
      return json(res, 200, { services: await snapshot() });
    }
    if (url.pathname === '/api/meta') {
      return json(res, 200, { version: AOS_VERSION, updates: await updates({ force: url.searchParams.has('force') }) });
    }
    if (url.pathname === '/api/log') {
      return json(res, 200, { text: await readLog(url.searchParams.get('id'), url.searchParams.get('name')) });
    }
    if (url.pathname === '/api/openwiki/visualize' && req.method === 'POST') {
      const { project } = await readBody(req);
      return json(res, 200, await startViewer(project));
    }
    if (url.pathname === '/api/control' && req.method === 'POST') {
      const { id, action } = await readBody(req);
      return json(res, 200, await control(id, action));
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} ist belegt. Anderen Port wählen: aos-dashboard --port 7901`);
    process.exit(1);
  }
  throw e;
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopViewers(); process.exit(0); });
}

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`AOS Dashboard v${AOS_VERSION || '?'}: ${url}   (Strg-C beendet)`);
  if (!OPEN) return;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  execFile(opener, [url], () => { /* no browser is not an error */ });
});
