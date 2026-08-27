#!/usr/bin/env node
// PreToolUse gate for outward-facing / hard-to-reverse Bash commands.
//
// Scope (deliberately narrow — see audit-agents.md F-01/F-03): git push, npm
// publish, npm version, and recursive rm. Plain Write/Edit/git commit are NOT
// gated here — Claude Code checkpoints those and they're locally reversible;
// gating them too would just re-create the "over-scoped rule nobody reads"
// problem this hook exists to fix.
//
// Gate validity: open only if the LAST user message in the transcript is the
// literal word "GO" (case-insensitive, trimmed). Any other message closes it
// again — matches "no silent retries" / "a fresh GO per action" from CLAUDE.md.
//
// Fails closed: if the transcript can't be read or parsed, block rather than
// guess.
//
// Why a PreToolUse hook and not a CLAUDE.md rule: per
// code.claude.com/docs/en/hooks-guide, "PreToolUse hooks fire before any
// permission-mode check, in every permission mode, including dontAsk. A hook
// that returns permissionDecision: 'deny' blocks the tool even in
// bypassPermissions mode or with --dangerously-skip-permissions." Exiting 2
// blocks unconditionally the same way. So this gate cannot be sidestepped by
// switching permission modes -- which prose in CLAUDE.md never could
// guarantee. (Hooks can tighten restrictions but not loosen them: a hook
// returning "allow" still can't override a deny rule from settings.)

import { readFileSync } from "node:fs";

const GUARDED_PATTERNS = [
  /^\s*git\s+push\b/i,
  /^\s*npm\s+publish\b/i,
  /^\s*npm\s+version\b/i,
  // recursive rm in any flag order/style: -r, -R, -rf, -fr, --recursive
  /^\s*rm\s+(-\w*[rR]\w*|--recursive)\b/i,
];

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function block(reason) {
  process.stderr.write(`Blocked by go-gate hook: ${reason}\n`);
  process.exit(2);
}

function allow() {
  process.exit(0);
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

function lastUserMessageIsGo(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch (e) {
    return { ok: false, reason: `could not read transcript (${e.message})` };
  }

  const lines = raw.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue; // tolerate partial/trailing lines from an in-progress write
    }
    if (entry.role !== "user") continue;
    const text = extractText(entry.content).trim();
    return { ok: text.toUpperCase() === "GO", reason: `last user message was: ${JSON.stringify(text)}` };
  }
  return { ok: false, reason: "no user message found in transcript" };
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch (e) {
    block(`could not parse hook input (${e.message})`);
    return;
  }

  const command = input?.tool_input?.command;
  if (typeof command !== "string") {
    allow(); // not a Bash call with a command string; nothing for this hook to check
    return;
  }

  const isGuarded = GUARDED_PATTERNS.some((re) => re.test(command));
  if (!isGuarded) {
    allow();
    return;
  }

  const transcriptPath = input?.transcript_path;
  if (!transcriptPath) {
    block("no transcript_path in hook input — cannot verify GO");
    return;
  }

  const result = lastUserMessageIsGo(transcriptPath);
  if (result.ok) {
    allow();
  } else {
    block(
      `command "${command.slice(0, 80)}" requires a fresh, literal "GO" as your last message. ${result.reason}.`
    );
  }
}

main();
