// `aos doctor --resources`: read-only census of AOS-owned processes (ps on macOS/Linux, Get-CimInstance on Windows).
// Parsing and judging are pure functions over a snapshot so every OS is testable from fixture output.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TARGETS = { maxProcesses: 12, maxRssMb: 700, orphans: 0, duplicateMcp: 0, idleCpuPct: 2 };

const PS_ARGS = ['-axo', 'pid=,ppid=,rss=,time=,command='];
const WIN_QUERY = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime,CommandLine | ConvertTo-Json -Compress';

// ps cumulative CPU time: "[[dd-]hh:]mm:ss[.cc]" (Linux hh:mm:ss, macOS m:ss.cc) -> ms
export function cpuMsOf(text) {
  const [d, rest] = String(text).includes('-') ? String(text).split('-') : [0, String(text)];
  const parts = rest.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  const sec = parts.reduce((a, n) => a * 60 + n, 0);
  return Math.round((Number(d) * 86400 + sec) * 1000);
}

// -> [{ pid, ppid, rssKb, cpuMs, command }]
export function parsePs(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*\S)\s*$/.exec(line);
    if (m) out.push({ pid: +m[1], ppid: +m[2], rssKb: +m[3], cpuMs: cpuMsOf(m[4]), command: m[5] });
  }
  return out;
}

export function parseWindows(json) {
  let rows;
  try { rows = JSON.parse(String(json).replace(/^﻿/, '')); } catch { return []; }
  return (Array.isArray(rows) ? rows : [rows]).filter((r) => r && r.ProcessId > 0).map((r) => ({
    pid: r.ProcessId,
    ppid: r.ParentProcessId || 0,
    rssKb: Math.round(Number(r.WorkingSetSize || 0) / 1024),
    cpuMs: Math.round((Number(r.KernelModeTime || 0) + Number(r.UserModeTime || 0)) / 10000), // 100 ns units
    command: String(r.CommandLine || ''),
  }));
}

export function snapshot({ platform = process.platform, run = execFileSync } = {}) {
  const opts = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] };
  if (platform === 'win32') return parseWindows(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_QUERY], opts));
  return parsePs(run('ps', PS_ARGS, opts));
}

const norm = (s) => String(s).replace(/\\/g, '/').toLowerCase();
const OWNED = ['/.agents/', '/.gemini/config/mcps/', 'aos-gateway', 'aos-a2a', 'aos-hub', 'aos-mcp-env', 'aos-plan-canvas', 'plan-canvas.js',
  'agenttrail', 'trail-hub', '@1mcp/agent', '@hybridlabor-api/aos', '/_npx/'];
export const isOwned = (p) => OWNED.some((m) => norm(p.command).includes(m));

// Owned by marker, or a descendant of an owned process (the real server behind npm exec / uv run / the secret launcher).
export function ownedSet(procs) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const hit = (p, depth = 0) => isOwned(p) || (depth < 8 && byPid.has(p.ppid) && hit(byPid.get(p.ppid), depth + 1));
  return procs.filter((p) => hit(p));
}

const DAEMON = /(aos-gateway|aos-hub|plan-canvas|agenttrail|trail-hub|@1mcp\/agent)/;
const STRAY_PATH = /(\/aos-wt-|\/tmp\/|\/var\/folders\/|\/private\/|\/appdata\/local\/temp\/)/;
const MCP = /(mcp|server-github|computer-use|\bdeja\b.*\bmcp\b|mcps\/)/;
const parentOf = (p) => { const m = /--parent-pid\s+(\d+)/.exec(p.command); return m ? +m[1] : null; };

// Why this owned process counts as an orphan, or null. Daemons and sidecars are detached (ppid 1) by design,
// so they are judged by their own contract: a sidecar by its --parent-pid, a daemon by where it runs from.
export function orphanReason(p, byPid) {
  const cmd = norm(p.command);
  if (cmd.includes('aos-a2a') && cmd.includes(' serve')) {
    const parent = parentOf(p);
    if (parent === null) return 'a2a sidecar without --parent-pid';
    return byPid.has(parent) ? null : `a2a sidecar, parent ${parent} is gone`;
  }
  if (DAEMON.test(cmd)) return STRAY_PATH.test(cmd) ? 'server started from a worktree/temp dir and left running' : null;
  if (p.ppid === 1 || (p.ppid > 1 && !byPid.has(p.ppid))) return 'parent process is gone';
  return null;
}

// Same server started twice: identical command line among MCP-looking owned processes.
export function duplicateMcp(owned) {
  const groups = new Map();
  for (const p of owned) {
    const cmd = norm(p.command);
    if (!MCP.test(cmd) || DAEMON.test(cmd) || cmd.includes('aos-a2a')) continue;
    const key = cmd.replace(/^\S*[/\\]/, '');
    groups.set(key, [...(groups.get(key) || []), p]);
  }
  return [...groups.entries()].filter(([, l]) => l.length > 1).map(([key, l]) => ({ key, pids: l.map((p) => p.pid) }));
}

// a2a sidecars of one live parent: only the newest session id is reachable.
export function duplicateSidecars(owned) {
  const by = new Map();
  for (const p of owned) {
    const parent = /aos-a2a/.test(norm(p.command)) ? parentOf(p) : null;
    if (parent) by.set(parent, [...(by.get(parent) || []), p.pid]);
  }
  return [...by.entries()].filter(([, l]) => l.length > 1).map(([parent, pids]) => ({ parent, pids }));
}

// A workspace-level agy config in HOME (cwd of most agy sessions) makes agy spawn every server it lists, next to the gateway.
export function legacyAgyTemplate(home) {
  const file = join(home, '.agents', 'mcp_config.json');
  if (!existsSync(file)) return null;
  try {
    const servers = Object.keys(JSON.parse(readFileSync(file, 'utf8')).mcpServers || {});
    return servers.length > 1 ? { file, servers: servers.length } : null;
  } catch { return null; }
}

export function cpuPct(before, after, wallMs, ownedPids) {
  const prev = new Map(before.map((p) => [p.pid, p.cpuMs]));
  let ms = 0;
  for (const p of after) if (ownedPids.has(p.pid) && prev.has(p.pid)) ms += Math.max(0, p.cpuMs - prev.get(p.pid));
  return wallMs > 0 ? (ms / wallMs) * 100 : 0;
}

// -> { checks: [{ name, status, detail, target }], summary }. `after` + `wallMs` (a second snapshot) enable the CPU check.
export function evaluate({ procs, selfPids = [], after, wallMs, home, targets = TARGETS }) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const self = new Set(selfPids);
  const owned = ownedSet(procs).filter((p) => !self.has(p.pid));
  const orphans = owned.map((p) => ({ p, why: orphanReason(p, byPid) })).filter((o) => o.why);
  const dupes = duplicateMcp(owned);
  const sidecars = duplicateSidecars(owned);
  const rssMb = Math.round(owned.reduce((a, p) => a + p.rssKb, 0) / 1024);
  const checks = [];
  const add = (name, ok, detail, target) => checks.push({ name, status: ok ? 'PASS' : 'WARN', detail, target });
  add('AOS processes', owned.length <= targets.maxProcesses, String(owned.length), `<= ${targets.maxProcesses}`);
  add('AOS resident memory', rssMb <= targets.maxRssMb, `${rssMb} MB`, `<= ${targets.maxRssMb} MB`);
  add('Orphans', orphans.length <= targets.orphans, orphans.length ? orphans.map((o) => `${o.p.pid} (${o.why})`).join('; ') : '0', `${targets.orphans}`);
  add('Duplicate MCP servers', dupes.length <= targets.duplicateMcp && sidecars.length === 0,
    dupes.length || sidecars.length ? [...dupes.slice(0, 5).map((d) => `${d.pids.length}x ${d.key.slice(0, 80)}`), ...(dupes.length > 5 ? [`+${dupes.length - 5} more`] : []), ...sidecars.map((s) => `${s.pids.length} a2a sidecars for parent ${s.parent}`)].join('; ') : '0', `${targets.duplicateMcp}`);
  if (after) {
    const pct = cpuPct(procs, after, wallMs, new Set(owned.map((p) => p.pid)));
    add('Idle CPU', pct < targets.idleCpuPct, `${pct.toFixed(1)}% of one core over ${Math.round(wallMs / 1000)} s`, `< ${targets.idleCpuPct}%`);
  }
  const legacy = home ? legacyAgyTemplate(home) : null;
  if (legacy) add('Legacy agy MCP template', false, `${legacy.file} lists ${legacy.servers} servers; agy started in HOME spawns them all next to the gateway. Run aos update (it moves the file aside).`, 'absent');
  return { checks, summary: { processes: owned.length, rssMb, orphans: orphans.length, duplicates: dupes.length + sidecars.length } };
}

export const format = ({ checks }) => checks.map((c) => `${c.status}  ${c.name}: ${c.detail} (target ${c.target})`).join('\n');

// Entry used by `aos doctor --resources [--sample <seconds>] [--json]`.
export async function runResources({ sampleSec = 10, home, platform = process.platform, run = execFileSync, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const t0 = now();
  const procs = snapshot({ platform, run });
  let after;
  let wallMs;
  if (sampleSec > 0) {
    await sleep(sampleSec * 1000);
    after = snapshot({ platform, run });
    wallMs = now() - t0;
  }
  return evaluate({ procs, selfPids: [process.pid, process.ppid], after, wallMs, home });
}
