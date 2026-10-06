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

export function hookOutput(eventData, text) {
  if (!text) return null;
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
