#!/usr/bin/env node
// aos-hook-version: 1
// Re-injects the "Destructive Actions" rules on every prompt so context compaction cannot drop them.
// Text comes from lib/destructive-rules.js (single source): the repo copy when run from a checkout,
// else ~/.agents/lib (the installer puts it there). Output shapes are the ones memb-inject.mjs
// already uses: hookSpecificOutput.additionalContext (Claude Code, Codex), injectSteps (agy).
// Fails open: any error prints nothing and exits 0; it never blocks a prompt.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
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

export function rulesText() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // here/../../lib is only trusted inside an AOS checkout (package.json names it), never from ~/.claude/hooks.
  const inCheckout = (() => { try { return JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).name === '@hybridlabor-api/aos'; } catch { return false; } })();
  for (const p of [...(inCheckout ? [path.join(here, '..', '..', 'lib', 'destructive-rules.js')] : []), path.join(os.homedir(), '.agents', 'lib', 'destructive-rules.js')]) {
    if (!existsSync(p)) continue;
    try {
      const { BLOCK, START, END } = createRequire(import.meta.url)(p);
      return BLOCK.replace(START, '').replace(END, '').trim();
    } catch { /* try the next location */ }
  }
  return '';
}

export function hookOutput(eventData, text, homeDir = os.homedir()) {
  if (!text) return null;
  if (fileAlreadyHoldsBlock(eventData, homeDir)) return null;
  const isAgy = !eventData.hook_event_name && (Array.isArray(eventData.workspacePaths) || !!eventData.conversationId);
  return isAgy
    ? { injectSteps: [{ ephemeralMessage: text }] }
    : { hookSpecificOutput: { hookEventName: eventData.hook_event_name || 'UserPromptSubmit', additionalContext: text } };
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  try {
    let eventData = {};
    try { eventData = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { /* no or bad stdin: still inject */ }
    const out = hookOutput(eventData, rulesText());
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  } catch { /* fail open */ }
  process.exit(0);
}
