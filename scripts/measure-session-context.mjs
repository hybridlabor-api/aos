#!/usr/bin/env node
// Sums the text a fresh Claude Code session gets injected from files under a HOME (same sources as
// ~/.aos/briefs/session-context-viewer.html): CLAUDE.md, MEMORY.md, skill and agent listings, and the
// output of the context hooks (SessionStart, first prompt, later prompts). Tokens = chars / 4.
// Not measurable from files: Claude Code's own system prompt, built-in tool schemas, MCP server
// instructions and MCP/connector tool names.
// Usage: node scripts/measure-session-context.mjs --home DIR [--cwd DIR] [--prompts N] [--json]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const home = path.resolve(String(arg('home', process.env.HOME)));
const cwd = path.resolve(String(arg('cwd', home)));
const prompts = Math.max(1, Number(arg('prompts', 10)));
const json = process.argv.includes('--json');
const tok = (c) => Math.ceil(c / 4);
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const ls = (d) => { try { return readdirSync(d, { withFileTypes: true }); } catch { return []; } };

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) { key = kv[1]; out[key] = /^[>|][+-]?$/.test(kv[2]) ? '' : kv[2].replace(/^["']|["']$/g, ''); }
    else if (key && /^\s+\S/.test(line)) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  return out;
}

function listing(files) {
  let chars = 0;
  for (const f of files) { const fm = frontmatter(read(f)); chars += `- ${fm.name || path.basename(path.dirname(f))}: ${fm.description || ''}\n`.length; }
  return { count: files.length, chars };
}

const skillFiles = [];
const agentFiles = [];
const walk = (dir, depth, hit) => { for (const e of ls(dir)) { const p = path.join(dir, e.name); if (e.isDirectory() && depth > 0) walk(p, depth - 1, hit); else hit(p, e); } };
for (const e of ls(path.join(home, '.claude', 'skills'))) if (e.isDirectory() || e.isSymbolicLink()) { const f = path.join(home, '.claude', 'skills', e.name, 'SKILL.md'); if (existsSync(f)) skillFiles.push(f); }
for (const e of ls(path.join(home, '.claude', 'agents'))) if (e.name.endsWith('.md')) agentFiles.push(path.join(home, '.claude', 'agents', e.name));
walk(path.join(home, '.claude', 'plugins', 'cache'), 7, (p) => {
  if (path.basename(p) === 'SKILL.md') skillFiles.push(p);
  else if (p.endsWith('.md') && path.basename(path.dirname(p)) === 'agents') agentFiles.push(p);
});

const slug = cwd.replace(/[/\\.]/g, '-');
const claudeMd = [path.join(home, 'CLAUDE.md'), path.join(home, '.claude', 'CLAUDE.md')].map(read).join('');
const memoryMd = read(path.join(home, '.claude', 'projects', slug, 'memory', 'MEMORY.md'));

// Only scripts that print model context run; gates and daemons never do. AOS_* switches keep the run side-effect free.
const CONTEXT_SCRIPTS = ['memb-inject.mjs', 'rules-inject.mjs', 'aos-session-hint.mjs'];
const settings = (() => { try { return JSON.parse(read(path.join(home, '.claude', 'settings.json'))); } catch { return {}; } })();
const commandsFor = (event) => (settings.hooks?.[event] || []).flatMap((e) => (e.hooks || []).map((h) => h.command)).filter((c) => typeof c === 'string' && CONTEXT_SCRIPTS.some((s) => c.includes(s)));

function runHooks(event, input) {
  let chars = 0;
  const per = {};
  for (const cmd of commandsFor(event)) {
    const r = spawnSync('sh', ['-c', cmd], { input: JSON.stringify({ hook_event_name: event, cwd, ...input }), encoding: 'utf8', timeout: 15000, cwd,
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, AOS_TEST_SANDBOX: '1', AOS_A2A_SIDECAR: 'off', CLAUDE_PROJECT_DIR: cwd } });
    let text = r.stdout || '';
    try { const o = JSON.parse(text); text = o.hookSpecificOutput?.additionalContext ?? o.injectSteps?.map((s) => s.ephemeralMessage).join('') ?? ''; } catch { /* raw */ }
    const name = CONTEXT_SCRIPTS.find((s) => cmd.includes(s));
    per[name] = (per[name] || 0) + text.length;
    chars += text.length;
  }
  return { chars, per };
}

const sid = `measure-${process.pid}`;
const start = runHooks('SessionStart', { session_id: sid, source: 'startup' });
const turns = Array.from({ length: prompts }, () => runHooks('UserPromptSubmit', { session_id: sid, prompt: 'hello' }));
const rows = [
  ['CLAUDE.md', claudeMd.length],
  ['MEMORY.md', memoryMd.length],
  [`skill listing (${listing(skillFiles).count})`, listing(skillFiles).chars],
  [`agent listing (${listing(agentFiles).count})`, listing(agentFiles).chars],
  ['SessionStart hooks', start.chars],
  ['UserPromptSubmit hooks, prompt 1', turns[0].chars],
];
const later = turns.slice(1).reduce((a, t) => a + t.chars, 0);
const firstTurnChars = rows.reduce((a, [, c]) => a + c, 0);
const result = {
  home, prompts,
  rows: rows.map(([name, chars]) => ({ name, chars, tokens: tok(chars) })),
  freshSession: { chars: firstTurnChars, tokens: tok(firstTurnChars) },
  laterPromptsHooks: { chars: later, tokens: tok(later), perPromptChars: prompts > 1 ? Math.round(later / (prompts - 1)) : 0 },
  afterNPrompts: { chars: firstTurnChars + later, tokens: tok(firstTurnChars + later) },
  perPromptHookChars: turns.map((t) => t.chars),
  hookDetail: { SessionStart: start.per, prompt1: turns[0].per },
};
if (json) console.log(JSON.stringify(result, null, 2));
else {
  for (const r of result.rows) console.log(`${r.name.padEnd(36)} ${String(r.chars).padStart(8)} chars  ~${String(r.tokens).padStart(6)} tok`);
  console.log(`${'fresh session (first prompt)'.padEnd(36)} ${String(result.freshSession.chars).padStart(8)} chars  ~${String(result.freshSession.tokens).padStart(6)} tok`);
  console.log(`prompts 2..${prompts}: hooks add ${result.laterPromptsHooks.chars} chars (~${result.laterPromptsHooks.tokens} tok), ${result.laterPromptsHooks.perPromptChars} chars/prompt`);
  console.log(`after ${prompts} prompts: ${result.afterNPrompts.chars} chars (~${result.afterNPrompts.tokens} tok)`);
  console.log('Not measured (Claude Code itself): system prompt, built-in tool schemas, MCP instructions, MCP/connector tool names.');
}
