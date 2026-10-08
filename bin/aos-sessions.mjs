#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TAIL_BYTES = 65536;
const SIX_HOURS = 6 * 3600 * 1000;
const TEN_MIN = 10 * 60 * 1000;

export function ageStr(ms) {
  if (ms == null || Number.isNaN(ms)) return '-';
  if (ms < 0) ms = 0;
  if (ms < 45 * 1000) return ms < 5000 ? 'now' : `${Math.floor(ms / 1000)}s`;
  if (ms < 3600 * 1000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h`;
}

export function harnessLabel(h) {
  const s = String(h ?? '').toLowerCase();
  if (['claude', 'codex', 'agy', 'opencode'].includes(s)) return s;
  if (s === 'kimi') return 'kimi (via trail)';
  return 'other';
}

function tsOf(e) {
  const t = Date.parse(e?.ts ?? '');
  return Number.isNaN(t) ? null : t;
}

export function summarizeAcpLog(lines, now = Date.now()) {
  let lastStart = -1, lastDone = null, lastSend = -1, lastPermPending = -1, lastPermDenied = -1, lastTs = -1;
  let adapter = null, stopReason = '', lastEvent = '';
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const t = tsOf(e);
    if (t == null) continue;
    if (t > lastTs) { lastTs = t; lastEvent = e.event ?? ''; }
    if (e.adapter && (lastStart < 0 || t >= lastStart)) adapter = e.adapter;
    switch (e.event) {
      case 'start': if (t >= lastStart) { lastStart = t; } break;
      case 'done': lastDone = { t, reason: e.stopReason ?? e.reason ?? '' }; break;
      case 'send': if (t > lastSend) lastSend = t; break;
      case 'permission_pending': if (t > lastPermPending) lastPermPending = t; break;
      case 'permission':
        if (e.allow === false && e.guarded === true && t > lastPermDenied) lastPermDenied = t;
        break;
      default: break;
    }
  }
  if (lastTs < 0) return { state: 'stalled', detail: 'empty log', ageMs: null, adapter };
  const ageMs = now - lastTs;
  if (lastDone && lastDone.t > lastStart) {
    return { state: 'done', detail: lastDone.reason || 'done', ageMs, adapter, stopReason: lastDone.reason || 'done' };
  }
  const goTs = Math.max(lastPermPending, lastPermDenied);
  if ((lastPermPending >= 0 && lastPermPending >= lastSend && lastEvent !== 'send') || (lastPermDenied >= 0 && lastPermDenied > lastSend)) {
    void goTs;
    return { state: 'GO needed', detail: lastPermPending >= lastPermDenied ? 'GO needed (permission_pending)' : 'GO needed (permission denied)', ageMs, adapter };
  }
  if (ageMs < TEN_MIN) return { state: 'running', detail: 'running', ageMs, adapter };
  return { state: 'stalled', detail: 'stalled', ageMs, adapter };
}

export function normalizeHubModel(model, now = Date.now()) {
  const rows = [];
  const sessions = model?.sessions ?? [];
  for (const s of sessions) {
    const h = s.harness ?? (Array.isArray(s.harnesses) ? s.harnesses[0] : undefined) ?? 'unknown';
    const state = String(s.state ?? 'idle').toLowerCase();
    const waiting = Boolean(s.waiting);
    let section = 'idle';
    if (waiting || state === 'waiting') section = 'needs';
    else if (state === 'working' || state === 'running' || state === 'busy') section = 'working';
    const detail = s.currentTask ?? s.currentTool ?? s.lastFile ?? (waiting ? String(s.waiting) : '') ?? state;
    const t = tsOf({ ts: s.ts ?? s.updatedAt ?? s.lastActivity }) ?? now;
    rows.push({
      source: 'hub', id: s.id ?? s.name, name: s.name ?? s.id ?? '?', harness: harnessLabel(h),
      rawHarness: String(h ?? ''), cwd: s.cwd ?? '', pid: s.pid ?? null,
      state, waiting, section, detail: String(detail ?? state), ageMs: now - t, ts: t,
    });
  }
  rows.sort((a, b) => a.ageMs - b.ageMs);
  return rows;
}

export function normalizeRegistry(entries, isAlive, now = Date.now()) {
  const rows = [];
  for (const e of entries ?? []) {
    const alive = isAlive ? Boolean(isAlive(e)) : true;
    rows.push({
      source: 'registry', id: e.name, name: e.name ?? '?', harness: harnessLabel(e.harness),
      rawHarness: String(e.harness ?? ''), cwd: e.cwd ?? '', pid: e.pid ?? null, url: e.url ?? '',
      alive, state: alive ? 'idle' : 'dead', waiting: false,
      section: alive ? 'idle' : 'dead', detail: alive ? 'idle' : 'dead', ageMs: 0, ts: now,
    });
  }
  return rows;
}

export function mergeSessions(hubRows = [], regRows = [], acpRows = []) {
  const out = [];
  const used = new Set();
  const key = (r) => `${r.name}||${r.pid ?? ''}||${r.cwd ?? ''}`;
  const regByName = new Map();
  for (const r of regRows) {
    if (!regByName.has(r.name)) regByName.set(r.name, []);
    regByName.get(r.name).push(r);
  }
  for (const h of hubRows) {
    const m = { ...h };
    const cands = regByName.get(h.name) ?? [];
    const hit = cands.find((r) => (h.pid != null && r.pid === h.pid) || (h.cwd && r.cwd === h.cwd)) ?? cands[0];
    if (hit) { m.alive = hit.alive; m.url = hit.url; used.add(hit); }
    out.push(m);
  }
  for (const r of regRows) {
    if (used.has(r)) continue;
    if (hubRows.some((h) => h.name === r.name || (h.pid != null && h.pid === r.pid))) continue;
    out.push({ ...r });
  }
  for (const a of acpRows) {
    if (hubRows.some((h) => h.name === a.name)) continue;
    out.push({ ...a });
  }
  void key;
  return out;
}

export function readTailLines(filePath, maxBytes = TAIL_BYTES) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    return text.split('\n');
  } finally {
    fs.closeSync(fd);
  }
}

export function collectAcp(aosHome, now = Date.now()) {
  const dir = path.join(aosHome, 'acp');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  const rows = [];
  for (const f of files) {
    const fp = path.join(dir, f);
    let st;
    try { st = fs.statSync(fp); } catch { continue; }
    if (now - st.mtimeMs > SIX_HOURS) continue;
    let lines;
    try { lines = readTailLines(fp); } catch { continue; }
    const name = path.basename(f, '.jsonl');
    let adapter = null, cwd = '';
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (e.event === 'start') { adapter = e.adapter ?? adapter; cwd = e.cwd ?? cwd; break; }
      } catch { /* skip */ }
    }
    // find adapter from any line if start was cut off
    if (!adapter) {
      for (const line of lines) {
        try { const e = JSON.parse(line); if (e.adapter) { adapter = e.adapter; break; } } catch { /* skip */ }
      }
    }
    const s = summarizeAcpLog(lines, now);
    const section = s.state === 'GO needed' ? 'needs' : 'acp';
    rows.push({
      source: 'acp', id: name, name, harness: harnessLabel(adapter ?? 'other'),
      rawHarness: String(adapter ?? ''), cwd, pid: null, state: s.state,
      waiting: s.state === 'GO needed', section, detail: s.detail, ageMs: s.ageMs ?? (now - st.mtimeMs), ts: now - (s.ageMs ?? (now - st.mtimeMs)),
    });
  }
  rows.sort((a, b) => (a.ageMs ?? 0) - (b.ageMs ?? 0));
  return rows;
}

export function collectRegistry(aosHome, now = Date.now()) {
  const dir = path.join(aosHome, 'sessions');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const entries = [];
  for (const f of files) {
    try { entries.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* skip */ }
  }
  const isAlive = (e) => {
    if (e.pid == null) return false;
    try { process.kill(Number(e.pid), 0); return true; } catch { return false; }
  };
  return normalizeRegistry(entries, isAlive, now);
}

export async function fetchHubModel(baseUrl) {
  const url = String(baseUrl).replace(/\/$/, '') + '/v1/model';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(t); }
}

export function buildOverview({ aosHome, hubModel = null, now = Date.now(), isAlive = null } = {}) {
  let regRows = [];
  if (isAlive) {
    let entries = [];
    try {
      const dir = path.join(aosHome, 'sessions');
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        try { entries.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* skip */ }
      }
    } catch { /* missing dir */ }
    regRows = normalizeRegistry(entries, isAlive, now);
  } else if (aosHome) {
    regRows = collectRegistry(aosHome, now);
  }
  const hubRows = hubModel ? normalizeHubModel(hubModel, now) : [];
  const acpRows = aosHome ? collectAcp(aosHome, now) : [];
  const hubUp = hubModel != null;
  const sessions = mergeSessions(hubRows, regRows, acpRows);
  return { now, hub: hubUp ? 'running' : 'down', sessions, acp: acpRows };
}

function fmtRow(r, w) {
  const acpIcon = { done: '✓', stalled: '◌', 'GO needed': '▲' };
  const icon = r.section === 'acp' ? (acpIcon[r.state] ?? '●') : r.section === 'needs' ? '▲' : r.section === 'working' ? '●' : r.section === 'idle' ? '○' : '●';
  const left = `  ${icon} ${r.harness.padEnd(18).slice(0, 18)} ${(r.name ?? '').padEnd(22).slice(0, 22)} `;
  const age = ageStr(r.ageMs);
  const avail = Math.max(10, w - left.length - age.length - 1);
  let detail = r.section === 'acp' && r.state === 'done' ? `done (${r.stopReason || r.detail || 'done'})` : String(r.detail ?? r.state ?? '');
  if (detail.length > avail) detail = detail.slice(0, Math.max(0, avail - 1)) + (avail > 1 ? '…' : '');
  const gap = ' '.repeat(Math.max(1, w - left.length - detail.length - age.length));
  return left + detail + gap + age;
}

export function renderText(overview, { width = 80, color = false } = {}) {
  const w = width || 80;
  const sess = (overview.sessions ?? []).filter((s) => s.section !== 'acp');
  const acp = (overview.acp ?? []).slice().sort((a, b) => a.ageMs - b.ageMs);
  const acpGo = acp.filter((r) => r.state === 'GO needed').map((r) => ({ ...r, section: 'needs' }));
  const needs = [...sess.filter((s) => s.section === 'needs'), ...acpGo].sort((a, b) => a.ageMs - b.ageMs);
  const working = sess.filter((s) => s.section === 'working').sort((a, b) => a.ageMs - b.ageMs);
  const idle = sess.filter((s) => s.section === 'idle').sort((a, b) => a.ageMs - b.ageMs);
  const dt = new Date(overview.now).toISOString().slice(0, 16).replace('T', ' ');
  const active = sess.filter((s) => s.section !== 'dead').length + acp.filter((r) => r.state !== 'done').length;
  const hub = overview.hub === 'running' ? 'running' : 'not running';
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const lines = [];
  lines.push(`AOS sessions · ${dt} · hub: ${hub} · ${active} active`);
  lines.push('');
  lines.push(c('31', `NEEDS YOU (${needs.length})`));
  for (const r of needs) lines.push(fmtRow(r, w));
  lines.push(c('32', `WORKING (${working.length})`));
  for (const r of working) lines.push(fmtRow(r, w));
  lines.push(c('36', `IDLE (${idle.length})`));
  for (const r of idle) lines.push(fmtRow(r, w));
  const counts = {};
  for (const r of acp) counts[r.state] = (counts[r.state] ?? 0) + 1;
  const sum = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none';
  lines.push(`ACP WORKERS (${acp.length})  ${sum}`);
  for (const r of acp.filter((x) => x.state !== 'GO needed')) lines.push(fmtRow({ ...r, section: 'acp' }, w));
  return lines.join('\n');
}

function printHelp() {
  console.log(`aos-sessions — read-only overview of active sessions
Usage: aos-sessions [--json] [--section needs|working|idle|acp] [--no-hub] [--help]
Env: AOS_HOME overrides ~/.aos, AGENTTRAIL_URL overrides hub base URL.`);
}

export async function main(argv = process.argv.slice(2)) {
  let json = false, section = null, noHub = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--no-hub') noHub = true;
    else if (a === '--help' || a === '-h') { printHelp(); return 0; }
    else if (a === '--section') {
      section = argv[++i];
      if (!['needs', 'working', 'idle', 'acp'].includes(section)) { console.error(`unknown section: ${section}`); return 2; }
    } else if (a.startsWith('--section=')) {
      section = a.split('=')[1];
      if (!['needs', 'working', 'idle', 'acp'].includes(section)) { console.error(`unknown section: ${section}`); return 2; }
    } else { console.error(`unknown flag: ${a}`); return 2; }
  }
  const aosHome = process.env.AOS_HOME ?? path.join(os.homedir(), '.aos');
  const now = Date.now();
  let hubModel = null;
  if (!noHub) {
    const base = process.env.AGENTTRAIL_URL ?? `http://127.0.0.1:${process.env.AGENTTRAIL_PORT ?? '5350'}`;
    hubModel = await fetchHubModel(base);
  }
  const ov = buildOverview({ aosHome, hubModel, now });
  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const width = process.stdout.columns || 80;
  if (json) {
    let sessions = ov.sessions;
    if (section === 'acp') sessions = ov.acp;
    else if (section) sessions = sessions.filter((s) => s.section === section);
    console.log(JSON.stringify({ now: ov.now, hub: ov.hub, sessions, acp: ov.acp }));
  } else {
    let view = ov;
    if (section === 'acp') view = { ...ov, sessions: [] };
    else if (section) view = { ...ov, sessions: ov.sessions.filter((s) => s.section === section) };
    console.log(renderText(view, { width, color }));
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => process.exit(code ?? 0));
}
