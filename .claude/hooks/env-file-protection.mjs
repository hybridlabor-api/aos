#!/usr/bin/env node
// PreToolUse gate that refuses writes and edits to .env files, across harnesses:
// - Claude Code (.claude/hooks/env-file-protection.mjs)
// - Antigravity / Gemini CLI (hooks.json PreToolUse)
//
// Why: a .env is a live secret store. An agent that rewrites one to "add a
// variable" routinely reorders it, drops a line, or writes an empty value
// straight over a real credential — and the file is usually gitignored, so
// nothing catches it until something fails to authenticate in production.
//
// Upstream (davila7/claude-code-templates, MIT) does this as an inline `echo`
// guarded by a matcher `if` field. That is Claude-Code-only: Antigravity and
// the Gemini CLI ignore `if`, so the same entry would fire on every single
// Write and block all file creation. Implemented as a script with the path
// check in code, so one implementation behaves correctly on both.
//
// Deliberately fails OPEN. A hook that cannot read its input must not wedge
// every write in the session; missing a protection is recoverable, freezing
// the agent is not.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

// Templates are committed on purpose and hold no live secret. Blocking them
// would contradict this hook's own advice below ("write it to .env.example").
const TEMPLATE_FILE = /^\.env\.(example|sample|template|dist)$/i;
const ENV_FILE = /^\.env(\..*)?$/i;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function respond(isAgy, allowed, reason = "") {
  if (isAgy) {
    console.log(JSON.stringify(allowed ? { decision: "allow" } : { decision: "deny", reason }));
    process.exit(0);
  } else {
    if (allowed) {
      process.exit(0);
    } else {
      process.stderr.write(`${reason}\n`);
      process.exit(2);
    }
  }
}

function reasonFor(filePath) {
  return [
    "Blocked by env-file-protection hook: writes to .env files are protected.",
    "",
    `Target: ${filePath}`,
    "",
    "A .env holds live credentials and is almost always gitignored, so an",
    "overwrite fails silently and surfaces later as an auth error. To change",
    "one anyway, either:",
    "",
    `  1. Edit it yourself outside the agent session, or`,
    "  2. Ask for the new value to be written to .env.example (safe to commit)",
    "     and set the real value from your own shell.",
    "",
    "If the repo keeps a checked-in env template with a different name, this",
    "hook does not apply to it -- only to .env and .env.*.",
  ].join("\n");
}

function main() {
  const rawInput = readStdin();
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch {
      respond(true, true);
      return;
    }
  }

  const isAgy = !!(input?.toolCall || input?.conversationId || input?.artifactDirectoryPath || input?.workspacePaths);

  const filePath =
    input?.toolCall?.args?.filePath ||
    input?.toolCall?.args?.file_path ||
    input?.tool_input?.file_path ||
    input?.file_path ||
    "";

  if (typeof filePath !== "string" || !filePath.trim()) {
    respond(isAgy, true);
    return;
  }

  // basename(), so a path like /srv/app/.env matches but /srv/app/env-notes.md does not.
  const name = basename(filePath);
  if (!ENV_FILE.test(name) || TEMPLATE_FILE.test(name)) {
    respond(isAgy, true);
    return;
  }

  respond(isAgy, false, reasonFor(filePath));
}

main();
