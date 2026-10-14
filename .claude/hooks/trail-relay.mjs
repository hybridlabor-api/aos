#!/usr/bin/env node
// Relays a hook event to any running agenttrail live map (skills/global_config/agenttrail).
// Best-effort telemetry: bounded I/O stdin read, detached background fetch, errors swallowed,
// never blocks or fails the agent (the hook timeout is 3 s).
// Usage: node trail-relay.mjs --agent <claude|agy|codex> [--event <HookEventName>]

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Fail-open safety timer: never let the hook linger or block the caller.
const timer = setTimeout(() => process.exit(0), 1500);
if (timer.unref) timer.unref();

process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));

// Detached worker path: executes slow network I/O in the background.
if (process.argv.includes('--relay-worker')) {
  let workerBody = '';
  const sendIdx = process.argv.indexOf('--relay-send');
  if (sendIdx !== -1 && process.argv[sendIdx + 1]) {
    workerBody = process.argv[sendIdx + 1];
  } else {
    try { for await (const c of process.stdin) workerBody += c; } catch {}
  }
  if (!workerBody) process.exit(0);
  const hubPort = Number(process.env.AGENTTRAIL_PORT) || 5350;
  if (hubPort === 1) process.exit(0);
  const legacy = process.env.AGENTTRAIL_LEGACY === '1';
  const legacyPorts = legacy ? Array.from({ length: 15 }, (_, i) => 5330 + i).filter((p) => p !== hubPort) : [];
  const targets = [{ url: `http://127.0.0.1:${hubPort}/hook`, body: workerBody }, ...legacyPorts.map((p) => ({ url: `http://127.0.0.1:${p}/hook`, body: workerBody }))];
  try {
    await Promise.allSettled(targets.map((t) => fetch(t.url, { method: 'POST', body: t.body, signal: AbortSignal.timeout(500) }).catch(() => {})));
  } catch {}
  process.exit(0);
}

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

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

const raw = await readStdinBounded(150);
let ev;
try { ev = JSON.parse(raw); } catch { process.exit(0); }
if (!ev || typeof ev !== 'object') process.exit(0);

ev.agent = arg('--agent') || ev.agent || 'claude';
ev.hook_event_name ||= arg('--event');
ev.cwd ||= process.cwd();
// A dispatcher sets AOS_TRAIL_NODE (+ AOS_TRAIL_PLAN) when it starts a worker: the node is live on the map.
if (process.env.AOS_TRAIL_NODE && !ev.task) {
  ev.task = { id: process.env.AOS_TRAIL_NODE, status: 'doing', ...(process.env.AOS_TRAIL_PLAN ? { plan: process.env.AOS_TRAIL_PLAN } : {}) };
}
const body = JSON.stringify(ev);

// Detach slow network I/O: spawn a background worker so the hook returns immediately.
const hubPort = Number(process.env.AGENTTRAIL_PORT) || 5350;
if (hubPort !== 1) {
  try {
    const here = fileURLToPath(import.meta.url);
    if (body.length < 65536) {
      const child = spawn(process.execPath, [here, '--relay-worker', '--relay-send', body], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
    } else {
      const child = spawn(process.execPath, [here, '--relay-worker'], {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        env: process.env,
      });
      child.stdin.end(body);
      child.unref();
    }
  } catch {}
}
process.exit(0);
