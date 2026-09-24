#!/usr/bin/env node
// Relays a hook event to any running agenttrail live map (skills/global_config/agenttrail).
// Best-effort telemetry: 300 ms cap, errors swallowed, never blocks or fails the agent.
// Usage: node trail-relay.mjs --agent <claude|agy|codex> [--event <HookEventName>]
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

let raw = '';
try { for await (const c of process.stdin) raw += c; } catch {}
let ev;
try { ev = JSON.parse(raw); } catch { process.exit(0); }

ev.agent = arg('--agent') || ev.agent || 'claude';
ev.hook_event_name ||= arg('--event');
ev.cwd ||= process.cwd();

const ports = process.env.AGENTTRAIL_PORT ? [Number(process.env.AGENTTRAIL_PORT)] : Array.from({ length: 15 }, (_, i) => 5330 + i);
const body = JSON.stringify(ev);
await Promise.allSettled(ports.map((p) => fetch(`http://127.0.0.1:${p}/hook`, { method: 'POST', body, signal: AbortSignal.timeout(300) })));
