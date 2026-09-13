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
import { connect } from 'node:net';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);
const HOME = os.homedir();
const h = (...p) => path.join(HOME, ...p);
const IS_MAC = process.platform === 'darwin';

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
    id: 'memb', name: 'memB Vector Memory', role: 'Persistent agent memory',
    port: 8088, url: 'http://127.0.0.1:8088', agent: 'com.bdb.memb.webui',
    module: h('.agents', 'memB'),
    logs: [h('.memb', 'webui.stdout.log'), h('.memb', 'webui.stderr.log')],
  },
  {
    id: 'synapse', name: 'Synapse 3D', role: 'Spatial codebase map',
    port: 7781, url: 'http://127.0.0.1:7781', agent: 'com.bdb.synapse',
    module: h('.agents', 'bdb-synapse'),
    logs: [h('.synapse', 'daemon.stdout.log'), h('.synapse', 'daemon.stderr.log')],
  },
  {
    id: 'openwiki', name: 'OpenWiki Daemon', role: 'Refreshes project wikis every 2h',
    port: null, url: null, agent: 'com.bdb.openwiki.daemon',
    module: null,
    logs: [h('.openwiki', 'daemon.log'), h('.openwiki', 'daemon_stderr.log')],
    extra: [{ label: 'projects.json', file: h('.openwiki', 'projects.json') }],
  },
  {
    id: 'ao', name: 'AO Orchestrator', role: 'Agent workspace daemon',
    port: 3101, url: 'http://127.0.0.1:3101', agent: 'com.bdb.ao.daemon',
    module: h('.agents', 'bdb-os-agent-workspace'),
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
    id: 'remoteos', name: 'RemoteOS Gateway', role: 'Multi-cloud execution gateway',
    port: 9080, url: 'http://127.0.0.1:9080', agent: 'com.hybridlabor.bdb-remote',
    module: h('.agents', 'bdb-os-remote'),
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

async function agentLoaded(label) {
  if (!IS_MAC) return null;
  try {
    const { stdout } = await execFileP('launchctl', ['list']);
    return stdout.split('\n').some((l) => l.trim().endsWith(label));
  } catch { return null; }
}

async function moduleVersion(dir) {
  if (!dir) return null;
  try { return JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')).version || null; }
  catch { return null; }
}

async function snapshot() {
  return Promise.all(SERVICES.map(async (s) => {
    const [listening, loaded, version] = await Promise.all([
      portOpen(s.port), agentLoaded(s.agent), moduleVersion(s.module),
    ]);
    // A port-less service (OpenWiki) can only be judged by its LaunchAgent.
    const up = s.port ? listening : loaded;
    const logs = [];
    for (const f of s.logs) {
      if (!existsSync(f)) continue;
      let size = 0;
      try { size = (await stat(f)).size; } catch { /* raced with a rotate */ }
      logs.push({ name: path.basename(f), size });
    }
    const extra = (s.extra || []).filter((e) => existsSync(e.file)).map((e) => e.label);
    let health = null;
    if (s.health) { try { health = await s.health(); } catch { /* a health probe must never sink the page */ } }
    return { id: s.id, name: s.name, role: s.role, port: s.port, url: s.url, up, loaded, version, logs, extra, health, installed: !s.module || existsSync(s.module) };
  }));
}

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
  const file = svc.logs.find((f) => path.basename(f) === name)
    || (svc.extra || []).map((e) => e.file).find((f) => path.basename(f) === name);
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
  :root{--bg:#0a0a0a;--panel:#141414;--line:#262626;--fg:#fff;--dim:#8a8a8a;--accent:#9b30c4;--up:#4ade80;--down:#f87171}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,-apple-system,system-ui,sans-serif}
  header{padding:28px 24px 18px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
  h1{margin:0;font-size:18px;font-weight:600;letter-spacing:.02em}
  .accent{color:var(--accent)}
  .meta{color:var(--dim);font-size:12px}
  main{padding:20px 24px;display:grid;gap:12px;max-width:900px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
  .row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
  .up{background:var(--up)}.down{background:var(--down)}.unknown{background:var(--dim)}
  .name{font-weight:600}
  .role{color:var(--dim);font-size:12px;width:100%;margin-top:2px}
  .spacer{flex:1}
  a,button{font:inherit}
  a.btn,button{background:transparent;color:var(--fg);border:1px solid var(--line);border-radius:6px;
    padding:5px 11px;cursor:pointer;text-decoration:none;transition:border-color .15s,background .15s}
  a.btn:hover,button:hover{border-color:var(--accent);background:rgba(155,48,196,.12)}
  button:disabled{opacity:.35;cursor:not-allowed}
  .tag{color:var(--dim);font-size:12px;font-variant-numeric:tabular-nums}
  pre{background:#000;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;
    max-height:340px;font-size:12px;margin:12px 0 0;white-space:pre-wrap;word-break:break-word}
  .err{color:var(--down);font-size:12px}
  .health{width:100%;margin-top:8px;padding:8px 10px;border-radius:6px;font-size:12px;line-height:1.45}
  .health.error{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.35);color:#fca5a5}
  .health.warn{background:rgba(155,48,196,.1);border:1px solid rgba(155,48,196,.4);color:#d8b4fe}
  footer{padding:14px 24px 28px;color:var(--dim);font-size:12px}
</style></head><body>
<header>
  <h1>BDB <span class="accent">Agent OS</span> · Dashboard</h1>
  <span class="meta" id="meta">lädt …</span>
</header>
<main id="list"></main>
<footer>Aktualisiert alle 5 s · nur über 127.0.0.1 erreichbar · Beenden mit Strg-C im Terminal</footer>
<script>
const list = document.getElementById('list');
const openLogs = new Set();

async function api(p, opts) {
  const r = await fetch(p, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
const kb = (n) => n < 1024 ? n + ' B' : (n / 1024).toFixed(0) + ' KB';

function card(s) {
  const state = s.up === null ? 'unknown' : s.up ? 'up' : 'down';
  const label = s.up === null ? 'unbekannt' : s.up ? 'läuft' : 'gestoppt';
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = \`
    <div class="row">
      <span class="dot \${state}"></span>
      <span class="name">\${s.name}</span>
      <span class="tag">\${[s.version && 'v' + s.version, s.port && ':' + s.port, label].filter(Boolean).join(' · ')}</span>
      <span class="spacer"></span>
      \${s.url && s.up ? \`<a class="btn" href="\${s.url}" target="_blank" rel="noopener">Öffnen</a>\` : ''}
      <button data-act="\${s.up ? 'stop' : 'start'}" data-id="\${s.id}">\${s.up ? 'Stop' : 'Start'}</button>
      \${s.up ? \`<button data-act="restart" data-id="\${s.id}">Neustart</button>\` : ''}
      \${s.logs.map(l => \`<button data-log="\${l.name}" data-id="\${s.id}">\${l.name} (\${kb(l.size)})</button>\`).join('')}
      <div class="role">\${s.role}\${s.installed ? '' : ' — Modul nicht installiert'}\${s.extra.length ? ' · ' + s.extra.join(', ') : ''}</div>
      \${s.health ? \`<div class="health \${s.health.level}">\${s.health.text}</div>\` : ''}
    </div>\`;
  const key = s.id;
  if (openLogs.has(key)) {
    const pre = document.createElement('pre');
    pre.id = 'log-' + key; pre.textContent = 'lädt …';
    el.appendChild(pre);
  }
  return el;
}

async function refresh() {
  try {
    const data = await api('/api/status');
    list.replaceChildren(...data.services.map(card));
    document.getElementById('meta').textContent =
      data.services.filter(s => s.up).length + ' von ' + data.services.length + ' aktiv · ' +
      new Date().toLocaleTimeString('de-DE');
    for (const id of openLogs) loadLog(id, openLogs.get?.(id));
  } catch (e) {
    document.getElementById('meta').textContent = 'Server nicht erreichbar';
  }
}

const logChoice = new Map();
async function loadLog(id) {
  const pre = document.getElementById('log-' + id);
  if (!pre) return;
  try {
    const r = await api('/api/log?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(logChoice.get(id)));
    pre.textContent = r.text;
    pre.scrollTop = pre.scrollHeight;
  } catch (e) { pre.textContent = 'Log nicht lesbar: ' + e.message; }
}

list.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.log) {
    if (openLogs.has(id) && logChoice.get(id) === b.dataset.log) { openLogs.delete(id); }
    else { openLogs.add(id); logChoice.set(id, b.dataset.log); }
    await refresh();
    return;
  }
  b.disabled = true; b.textContent = '…';
  try { await api('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action: b.dataset.act }) }); }
  catch (e) { alert(e.message); }
  setTimeout(refresh, 1200);
});

refresh();
setInterval(refresh, 5000);
</script></body></html>`;

// ------------------------------------------------------------------ server
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (url.pathname === '/api/status') {
      return json(res, 200, { services: await snapshot() });
    }
    if (url.pathname === '/api/log') {
      const text = await readLog(url.searchParams.get('id'), url.searchParams.get('name'));
      return json(res, 200, { text });
    }
    if (url.pathname === '/api/control' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) { req.destroy(); return; }
      }
      const { id, action } = JSON.parse(raw || '{}');
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

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`AOS Dashboard: ${url}   (Strg-C beendet)`);
  if (!OPEN) return;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  execFile(opener, [url], () => { /* no browser is not an error */ });
});
