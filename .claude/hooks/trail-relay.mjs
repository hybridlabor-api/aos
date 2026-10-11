#!/usr/bin/env node
// Relays a hook event to any running agenttrail live map (skills/global_config/agenttrail).
// Best-effort telemetry: 500 ms fetch cap, 1.5 s safety exit, errors swallowed, never blocks or fails the agent (the hook timeout is 3 s).
// Usage: node trail-relay.mjs --agent <claude|agy|codex> [--event <HookEventName>]

// Fail-open safety timer: never let the hook linger or block the caller.
const timer = setTimeout(() => process.exit(0), 1500);
if (timer.unref) timer.unref();

process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

let raw = '';
try { for await (const c of process.stdin) raw += c; } catch {}
let ev;
try { ev = JSON.parse(raw); } catch { process.exit(0); }
if (!ev || typeof ev !== 'object') process.exit(0);

ev.agent = arg('--agent') || ev.agent || 'claude';
ev.hook_event_name ||= arg('--event');
ev.cwd ||= process.cwd();
const body = JSON.stringify(ev);

// v2: the hub first, on one named port. The legacy per-repo range is only tried
// when AGENTTRAIL_LEGACY=1, so it can be switched off once every repo is migrated.
const hubPort = Number(process.env.AGENTTRAIL_PORT) || 5350;
const legacy = process.env.AGENTTRAIL_LEGACY === '1';
const legacyPorts = legacy ? Array.from({ length: 15 }, (_, i) => 5330 + i).filter((p) => p !== hubPort) : [];
const targets = [{ url: `http://127.0.0.1:${hubPort}/hook`, body }, ...legacyPorts.map((p) => ({ url: `http://127.0.0.1:${p}/hook`, body }))];
try {
  await Promise.allSettled(targets.map((t) => fetch(t.url, { method: 'POST', body: t.body, signal: AbortSignal.timeout(500) }).catch(() => {})));
} catch {}
process.exit(0);

