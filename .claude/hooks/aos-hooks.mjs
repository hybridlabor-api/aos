#!/usr/bin/env node
// One node process per Claude Code hook event: runs the AOS hook modules in-process.
// Usage: node aos-hooks.mjs <EventName> <module.mjs>...   (the module list is data in settings.json, so
// the installer can drop a module by dropping its name; names this file does not know are ignored)
//
// Order and blocking:
//   - gate modules (can answer exit 2) run first, then the rest; each group keeps the listed order.
//   - go-gate fails closed (an internal error or an unloadable module is exit 2, like `node go-gate.mjs || exit 2`);
//     every other module fails open: a throw or a timeout is dropped and never hides a block.
//   - any block => exit 2 with the blocking modules' stderr. On PreToolUse the first block ends the gate run;
//     on Stop every gate runs (a graph-gate block and an A2A hand-over are both delivered).
// Output (exit 0): the additionalContext of every module is merged into ONE hookSpecificOutput object.
// The script entry modules (node go-gate.mjs, node memb-inject.mjs, ...) keep working for the other harnesses.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASH = new Set(['Bash']);
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SUBAGENT = new Set(['Agent', 'Task']);

// gate: may block. tools: PreToolUse tool names it applies to (absent = every event/tool).
// budgetMs bounds the async part of a slow module so it cannot eat the whole hook timeout.
export const REGISTRY = {
  'go-gate.mjs': { gate: true, closed: true, tools: BASH, run: async (c) => (await import('./go-gate.mjs')).hook(c.raw) },
  'conventional-commits.mjs': { gate: true, tools: BASH, run: async (c) => (await import('./conventional-commits.mjs')).hook(c.raw) },
  'env-file-protection.mjs': { gate: true, tools: FILE_TOOLS, run: async (c) => (await import('./env-file-protection.mjs')).hook(c.raw) },
  'graph-gate.mjs': { gate: true, run: async (c) => (await import('./graph-gate.mjs')).hook(c.raw) },
  'a2a-inbox.mjs': { gate: true, budgetMs: 4000, run: async (c) => (await import('./a2a-inbox.mjs')).hook(c.event === 'Stop' ? 'stop' : 'drain', c.input) },
  'go-token.mjs': { run: async (c) => (await import('./go-token.mjs')).hook(c.input) },
  'go-grant.mjs': { run: async (c) => (await import('./go-grant.mjs')).hook(c.input) },
  'memb-inject.mjs': { budgetMs: 8000, run: async (c) => (await import('./memb-inject.mjs')).hook(c.input) },
  'rules-inject.mjs': { run: async (c) => (await import('./rules-inject.mjs')).hook(c.input) },
  'aos-session-hint.mjs': { budgetMs: 3000, run: async (c) => (await import('./aos-session-hint.mjs')).hook(c.input) },
  'a2a-session.mjs': { budgetMs: 4000, run: async (c) => (await import('./a2a-session.mjs')).hook(c.input, { harness: 'claude' }) },
  'trail-autostart.mjs': { tools: SUBAGENT, run: async (c) => (await import('./trail-autostart.mjs')).hook(c.input) },
  'trail-relay.mjs': { budgetMs: 1500, run: async (c) => (await import('./trail-relay.mjs')).hook(c.input, { agent: 'claude', event: c.event }) },
};

const NONE = { code: 0, stdout: '', stderr: '' };
const parse = (raw) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch { return null; } };

function withBudget(promise, ms) {
  if (!ms) return promise;
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); })])
    .finally(() => clearTimeout(timer));
}

// One valid JSON object for stdout: additionalContext of every emitter concatenated, other keys last-wins.
export function mergeOutputs(parts) {
  let merged = null;
  const context = [];
  for (const part of parts) {
    const obj = parse(part);
    if (!obj) continue;
    merged ||= {};
    const { hookSpecificOutput: hso, ...top } = obj;
    Object.assign(merged, top);
    if (hso && typeof hso === 'object') {
      const { additionalContext, ...rest } = hso;
      merged.hookSpecificOutput = { ...rest, ...merged.hookSpecificOutput };
      if (typeof additionalContext === 'string' && additionalContext) context.push(additionalContext);
    }
  }
  if (!merged) return '';
  if (context.length) merged.hookSpecificOutput = { ...merged.hookSpecificOutput, additionalContext: context.join('\n\n') };
  return `${JSON.stringify(merged)}\n`;
}

// Runs the named modules for one event and answers { code, stdout, stderr }; never throws.
export async function dispatch(event, names, raw, registry = REGISTRY) {
  const input = parse(raw);
  const tool = typeof input?.tool_name === 'string' ? input.tool_name : '';
  const picked = names.map((n) => [n, registry[n]]).filter(([, m]) => m);
  // Unparseable input on PreToolUse: only the gates run, and they decide on the raw text (go-gate denies).
  const wanted = picked.filter(([, m]) => (input || !m || m.gate)
    && !(event === 'PreToolUse' && tool && m.tools && !m.tools.has(tool)));
  const ordered = [...wanted.filter(([, m]) => m.gate), ...wanted.filter(([, m]) => !m.gate)];

  const blocks = [];
  const outs = [];
  let err = '';
  for (const [name, m] of ordered) {
    if (blocks.length && event === 'PreToolUse' && m.gate) continue;
    let r;
    try {
      const ctx = { event, raw, input: input ? { hook_event_name: event, ...input } : null };
      r = (await withBudget(m.run(ctx), m.budgetMs)) || NONE;
    } catch (e) {
      r = m.closed ? { code: 2, stdout: '', stderr: `Blocked by ${name.replace(/\.mjs$/, '')} hook: ${String(e?.message || e).slice(0, 200)}\n` } : NONE;
    }
    if (r.stderr) err += r.stderr;
    if (r.code === 2 || (m.closed && r.code !== 0)) blocks.push(r);
    else if (r.stdout) outs.push(r.stdout);
  }
  if (blocks.length) return { code: 2, stdout: blocks.map((b) => b.stdout).join(''), stderr: err };
  return { code: 0, stdout: mergeOutputs(outs), stderr: err };
}

function flush({ code, stdout, stderr }) {
  const done = () => process.exit(code);
  const out = () => (stdout ? process.stdout.write(stdout, done) : done());
  process.stdout.on('error', done);
  process.stderr.on('error', () => {});
  if (stderr) process.stderr.write(stderr, out); else out();
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

if (isMain()) {
  const [event = '', ...rest] = process.argv.slice(2);
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* unreadable stdin: the gates see an empty payload */ }
  flush(await dispatch(event, rest.filter((a) => a.endsWith('.mjs')), raw));
}
