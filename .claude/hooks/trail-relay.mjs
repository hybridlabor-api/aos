#!/usr/bin/env node
// Relays a hook event to a running agenttrail live map (skills/global_config/agenttrail).
// Best-effort telemetry: nothing is read, spawned or sent unless a map is running. A map is "running" when
// ~/.aos/endpoints.json lists it with a live pid (announceTrail writes that on listen and removes it on exit)
// or when AGENTTRAIL_PORT names a port. Errors are swallowed; it never blocks or fails the agent.
// Usage: node trail-relay.mjs --agent <claude|agy|codex> [--event <HookEventName>]
// aos-hooks.mjs calls hook() in-process: no detached worker, one bounded POST per running map.

import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NONE = { code: 0, stdout: '', stderr: '' };
const RANGE = Array.from({ length: 15 }, (_, i) => 5330 + i);

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return true; // no pid recorded: trust the entry
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

// Ports of the maps that announced themselves and still run. [] when the file is missing or unreadable.
export function announcedPorts(env = process.env) {
  try {
    const file = path.join(env.HOME || os.homedir(), '.aos', 'endpoints.json');
    const list = JSON.parse(readFileSync(file, 'utf8'))?.agenttrail;
    return (Array.isArray(list) ? list : []).filter((m) => m && Number.isInteger(m.port) && alive(m.pid)).map((m) => m.port);
  } catch { return []; }
}

// Where an event goes. AGENTTRAIL_PORT=1 switches the relay off, another value targets that one port,
// AGENTTRAIL_LEGACY=1 adds the whole per-repo range (older maps never announced themselves).
export function relayPorts(env = process.env) {
  const explicit = Number(env.AGENTTRAIL_PORT) || 0;
  if (explicit === 1) return [];
  const legacy = env.AGENTTRAIL_LEGACY === '1' ? RANGE : [];
  const base = explicit ? [explicit] : announcedPorts(env);
  return [...new Set([...base, ...legacy])];
}

export async function post(body, ports, timeoutMs = 500) {
  await Promise.allSettled(ports.map((p) => fetch(`http://127.0.0.1:${p}/hook`, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) }).catch(() => {})));
}

// Attribution: AOS_TRAIL_NODE env wins (dispatcher intent); a [trail-node:<id>]
// marker anywhere in the payload (subagent prompt/brief) is the fallback.
// stampTrailNode lives in the agenttrail lib; the hook dir may sit next to it
// (repo checkout) or detached (installed copies), so try the known homes.
async function prepare(input, { agent, event, env }) {
  const ev = { ...input };
  ev.agent = agent || ev.agent || 'claude';
  ev.hook_event_name ||= event;
  ev.cwd ||= process.cwd();
  let stampTrailNode = ({ env: e } = {}) => {
    if (e?.AOS_TRAIL_NODE && !ev.task) ev.task = { id: e.AOS_TRAIL_NODE, status: 'doing', ...(e.AOS_TRAIL_PLAN ? { plan: e.AOS_TRAIL_PLAN } : {}) };
  };
  for (const rel of ['../global_config/agenttrail/lib/events.mjs', '../../skills/global_config/agenttrail/lib/events.mjs', './lib/events.mjs']) {
    try {
      ({ stampTrailNode } = await import(new URL(rel, import.meta.url)));
      break;
    } catch {}
  }
  stampTrailNode(ev, { env });
  return JSON.stringify(ev);
}

// Windows caps a command line at 32767 chars, so bigger bodies cannot travel in argv.
const ARGV_BODY_MAX = 30000;

// The caller never holds a socket: a process that exits with a fetch in flight trips a libuv
// assertion on Windows (#197). Bodies too big for argv go through a stdin pipe, except on
// Windows, where they are dropped (best-effort telemetry; a pipe is a handle at exit too).
function spawnWorker(body, env = process.env) {
  const here = fileURLToPath(import.meta.url);
  const opts = { detached: true, windowsHide: true, env };
  if (body.length < ARGV_BODY_MAX) {
    spawn(process.execPath, [here, '--relay-worker', '--relay-send', body], { ...opts, stdio: 'ignore' }).unref();
  } else if (process.platform !== 'win32') {
    const child = spawn(process.execPath, [here, '--relay-worker'], { ...opts, stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.end(body);
    child.unref();
  }
}

// In-process entry. No running map: returns before anything is imported, spawned or sent.
export async function hook(input, { agent = 'claude', event, env = process.env } = {}) {
  try {
    if (!relayPorts(env).length || !input || typeof input !== 'object') return NONE;
    spawnWorker(await prepare(input, { agent, event, env }), env);
  } catch {}
  return NONE;
}

async function readStdinBounded(maxMs = 150, maxBytes = 256 * 1024) {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let buf = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      try { process.stdin.pause(); } catch {}
      resolve(buf);
    };
    const to = setTimeout(finish, maxMs);
    if (to.unref) to.unref();

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
      if (buf.length >= maxBytes) {
        finish();
      } else {
        try {
          JSON.parse(buf);
          finish();
        } catch {}
      }
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    process.stdin.resume();
  });
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

if (isMain()) {
  // Fail-open safety timer: never let the hook linger or block the caller.
  const timer = setTimeout(() => process.exit(0), 1500);
  if (timer.unref) timer.unref();

  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));

  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

  // Detached worker path: executes slow network I/O in the background.
  if (process.argv.includes('--relay-worker')) {
    let workerBody = '';
    const sendIdx = process.argv.indexOf('--relay-send');
    if (sendIdx !== -1 && process.argv[sendIdx + 1]) {
      workerBody = process.argv[sendIdx + 1];
    } else {
      try { for await (const c of process.stdin) workerBody += c; } catch {}
    }
    const ports = relayPorts();
    if (workerBody && ports.length) await post(workerBody, ports);
    process.exit(0);
  }

  const raw = await readStdinBounded(150);
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  if (!input || typeof input !== 'object') process.exit(0);

  // Checked before anything is spawned: no running map, no worker process.
  if (!relayPorts().length) process.exit(0);

  const body = await prepare(input, { agent: arg('--agent'), event: arg('--event'), env: process.env });

  // Detach slow network I/O: spawn a background worker so the hook returns immediately.
  try { spawnWorker(body); } catch {}
  process.exit(0);
}
