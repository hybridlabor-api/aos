#!/usr/bin/env node
// aos-hook-version: 1
// Injects the "Destructive Actions" and "Tool routing (automatic)" blocks once per session (first prompt),
// and again after /clear or compaction (SessionStart source clear/compact drops the session marker). Text comes from lib/destructive-rules.js and
// lib/routing-rules.js (shared sources): the repo copies when run from a checkout, else
// ~/.agents/lib (the installer puts them there). Output shapes are the ones memb-inject.mjs
// already uses: hookSpecificOutput.additionalContext (Claude Code, Codex), injectSteps (agy).
// Bounded I/O: reads stdin with a timeout so it never hangs if the parent stream stays open.
// Fails open: any error prints nothing and exits 0; it never blocks a prompt.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const START = '<!-- aos:destructive-actions:start -->';

const INSTRUCTION_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'RULES.md',
  'GEMINI.md',
  path.join('.codex-plugin', 'system.md'),
  path.join('.github', 'copilot-instructions.md'),
  path.join('.cursor', 'rules', '000_global_rules.mdc'),
];

export function fileAlreadyHoldsBlock(eventData, homeDir = os.homedir()) {
  try {
    const holds = (filePath) => {
      try {
        if (!existsSync(filePath)) return false;
        return readFileSync(filePath, 'utf8').includes(START);
      } catch {
        return false;
      }
    };

    const candidateDirs = Array.isArray(eventData?.workspacePaths) && eventData.workspacePaths.length > 0
      ? eventData.workspacePaths
      : (eventData?.cwd ? [eventData.cwd] : []);

    const resolvedHome = homeDir ? path.resolve(homeDir) : null;

    for (const dir of candidateDirs) {
      if (!dir) continue;
      let cur = path.resolve(dir);
      while (cur && cur !== path.dirname(cur)) {
        for (const f of INSTRUCTION_FILES) {
          if (holds(path.join(cur, f))) return true;
        }
        if (resolvedHome && cur === resolvedHome) break;
        if (existsSync(path.join(cur, '.git')) || existsSync(path.join(cur, '.agents')) || existsSync(path.join(cur, '.aos'))) {
          break;
        }
        cur = path.dirname(cur);
      }
    }

    if (resolvedHome) {
      const isHomeCwd = candidateDirs.length > 0 && candidateDirs.some((d) => path.resolve(d) === resolvedHome);
      if (candidateDirs.length === 0 || isHomeCwd) {
        if (holds(path.join(resolvedHome, 'AGENTS.md'))) return true;
        if (holds(path.join(resolvedHome, 'RULES.md'))) return true;
        if (holds(path.join(resolvedHome, '.gemini', 'RULES.md'))) return true;
      }
      if (holds(path.join(resolvedHome, 'CLAUDE.md'))) return true;
    }

    return false;
  } catch {
    return false;
  }
}

const MARKER_TTL_MS = 7 * 24 * 3600 * 1000;
const markerDir = (home) => path.join(home, '.aos', 'state', 'rules-seen');
const sessionKey = (e) => String(e?.session_id || e?.sessionId || e?.conversationId || '').replace(/[^\w.-]/g, '_').slice(0, 80);

export function rulesSeen(id, home = os.homedir()) {
  if (!id) return false;
  try { return existsSync(path.join(markerDir(home), id)); } catch { return false; }
}

export function markRulesSeen(id, home = os.homedir()) {
  if (!id) return;
  try {
    const dir = markerDir(home);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(dir, id), String(Date.now()));
    for (const f of readdirSync(dir)) {
      try { if (Date.now() - statSync(path.join(dir, f)).mtimeMs > MARKER_TTL_MS) unlinkSync(path.join(dir, f)); } catch {}
    }
  } catch { /* marker is best effort: without it the rules just repeat */ }
}

export function forgetRules(id, home = os.homedir()) {
  if (!id) return;
  try { unlinkSync(path.join(markerDir(home), id)); } catch {}
}

function loadBlock(name) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // here/../../lib is only trusted inside an AOS checkout (package.json names it), never from ~/.claude/hooks.
  const inCheckout = (() => { try { return JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).name === '@hybridlabor-api/aos'; } catch { return false; } })();
  for (const p of [...(inCheckout ? [path.join(here, '..', '..', 'lib', name)] : []), path.join(os.homedir(), '.agents', 'lib', name)]) {
    if (!existsSync(p)) continue;
    try {
      const { BLOCK, START, END } = createRequire(import.meta.url)(p);
      return BLOCK.replace(START, '').replace(END, '').trim();
    } catch { /* try the next location */ }
  }
  return '';
}

export function rulesText() {
  const destructive = loadBlock('destructive-rules.js');
  const routing = loadBlock('routing-rules.js');
  if (!destructive && !routing) return '';
  return [destructive, routing].filter(Boolean).join('\n\n');
}

export function hookOutput(eventData, text, homeDir = os.homedir()) {
  if (!text) return null;
  if (fileAlreadyHoldsBlock(eventData, homeDir)) return null;
  const isAgy = !eventData.hook_event_name && (Array.isArray(eventData.workspacePaths) || !!eventData.conversationId);
  return isAgy
    ? { injectSteps: [{ ephemeralMessage: text }] }
    : { hookSpecificOutput: { hookEventName: eventData.hook_event_name || 'UserPromptSubmit', additionalContext: text } };
}

async function readStdinBounded(maxMs = 100, maxBytes = 64 * 1024) {
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
  const safety = setTimeout(() => process.exit(0), 1000);
  if (safety.unref) safety.unref();

  try {
    let eventData = {};
    try {
      const raw = await readStdinBounded(100);
      eventData = raw ? (JSON.parse(raw) || {}) : {};
    } catch { /* no or bad stdin: still inject */ }
    const id = sessionKey(eventData);
    if (eventData.hook_event_name === 'SessionStart') {
      if (eventData.source === 'clear' || eventData.source === 'compact') forgetRules(id);
    } else if (!rulesSeen(id)) {
      const out = hookOutput(eventData, rulesText());
      if (out) { process.stdout.write(JSON.stringify(out) + '\n'); markRulesSeen(id); }
    }
  } catch { /* fail open */ }
  process.exit(0);
}
