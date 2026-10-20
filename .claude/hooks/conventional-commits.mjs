#!/usr/bin/env node
// PreToolUse gate that enforces Conventional Commits on `git commit` across harnesses:
// - Claude Code (.claude/hooks/conventional-commits.mjs)
// - Antigravity / Gemini CLI (hooks.json PreToolUse)
// - Codex (config.toml PreToolUse; exit 2 + stderr is its deny shape)
//
// Why this exists: release-please (.github/workflows/release-please.yml) parses
// commit subjects to compute the version bump and the changelog. It only reads
// Conventional Commit prefixes, so an unprefixed subject is invisible to it —
// exactly the prefix used for a user-facing addition decides a minor bump.
//
// Ported from davila7/claude-code-templates (MIT), which ships this as
// conventional-commits.py. Ported to .mjs rather than vendored verbatim: every
// other AOS hook is .mjs, node is already a hard install dependency, and
// `python3` does not exist on a stock Windows install — where the AOS installer
// does run — so a python hook would break every commit there.
//
// Deliberately fails OPEN, unlike go-gate. A regex that cannot read the message
// must not block a legitimate commit; blocking a human's work is the worse
// failure here, because the consequence (history AOS does not recognise) is
// recoverable with a rebase, and a wedged commit flow is not.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "chore", "ci", "build", "revert"];

const CONVENTIONAL = new RegExp(`^(${TYPES.join("|")})(\\(.+\\))?:\\s.+`);

// Command position only (start of line or after ; && || |): text that merely mentions the command is not a commit.
const COMMIT = /(?:^|[;&|\n])[ \t]*(?:\w+=\S+[ \t]+)*git(?:[ \t]+(?:-[Cc][ \t]+\S+|--no-pager))*[ \t]+commit\b/;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function respond(isAgy, allowed, reason = "") {
  if (isAgy) {
    if (allowed) {
      console.log(JSON.stringify({ decision: "allow" }));
    } else {
      console.log(JSON.stringify({ decision: "deny", reason }));
    }
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

// Returns the commit message, or null when it cannot be read. Null means
// "cannot tell" and must be treated as allowed.
function extractMessage(command) {
  const at = command.search(COMMIT);
  const tail = at < 0 ? command : command.slice(at);

  // Heredoc form first: the inline form below would read the opening of the substitution as the message.
  const heredoc = tail.match(/(?:-[a-zA-Z]*m|--message)(?:\s+|=)"?\$\(cat\s+<<-?\s*['"]?(\w+)['"]?[ \t]*\n([\s\S]+?)\n[ \t]*\1\b/);
  if (heredoc) return heredoc[2].trim();

  // -m "msg", -am 'msg', --message "msg", --message="msg"
  const inline = tail.match(/(?:-[a-zA-Z]*m|--message)(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
  if (inline) {
    const msg = inline[1] ?? inline[2];
    return msg.startsWith("$(") ? null : msg;
  }

  // Plain commit (editor) or a message the hook cannot see: fail open.
  return null;
}

function reasonFor(message) {
  return [
    "Blocked by conventional-commits hook: this commit subject is not in Conventional Commits format.",
    "",
    `Your message: ${message.slice(0, 120)}`,
    "",
    "Required: type(scope): description",
    `Types: ${TYPES.join(", ")}`,
    "",
    "Good:  feat: add user authentication",
    "Good:  fix(api): handle null responses",
    "Bad:   Added new feature   (no type)",
    "Bad:   feature: add login  (wrong type, use 'feat')",
    "",
    "AOS reserves feat: for user-facing additions -- it always bumps the minor",
    "version, however small. Housekeeping belongs under chore: or fix:.",
  ].join("\n");
}

export function checkConventionalCommit(command) {
  if (typeof command !== "string" || !COMMIT.test(command)) return null;
  const message = extractMessage(command);
  return message === null || CONVENTIONAL.test(message) ? null : reasonFor(message);
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

function main() {
  const rawInput = readStdin();
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch {
      // Unparseable input: fail open, no stdout (isAgy unknown).
      process.exit(0);
    }
  }

  const isAgy = !!(input?.toolCall || input?.conversationId || input?.artifactDirectoryPath || input?.workspacePaths);

  const command =
    input?.toolCall?.args?.CommandLine ||
    input?.toolCall?.args?.command ||
    input?.tool_input?.command ||
    input?.tool_input?.cmd || // Codex exec_command
    input?.command ||
    "";

  const reason = checkConventionalCommit(command);
  respond(isAgy, !reason, reason || "");
}

if (isMain()) main();
