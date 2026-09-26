#!/usr/bin/env node
// PreToolUse gate that enforces Conventional Commits on `git commit` across harnesses:
// - Claude Code (.claude/hooks/conventional-commits.mjs)
// - Antigravity / Gemini CLI (hooks.json PreToolUse)
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

import { readFileSync } from "node:fs";

const TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "chore", "ci", "build", "revert"];

const CONVENTIONAL = new RegExp(`^(${TYPES.join("|")})(\\(.+\\))?:\\s.+`);

const COMMIT = /git\s+commit\b/;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function respond(isAgy, allowed, reason = "", message = "") {
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
  // -m "msg" / -m 'msg'
  const inline = command.match(/git\s+commit[\s\S]*?-m\s+["']([^"']+)["']/);
  if (inline) return inline[1];

  // -m "$(cat <<'EOF' ... EOF)"
  const heredoc = command.match(/git\s+commit[\s\S]*?-m\s+"?\$\(cat\s+<<['"]?EOF['"]?\s*\n([\s\S]+?)\nEOF/);
  if (heredoc) return heredoc[1].trim();

  // Plain `git commit` (editor) or a message the hook cannot see: fail open.
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

function main() {
  const rawInput = readStdin();
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch {
      // Unparseable input: fail open, same reasoning as an unreadable message.
      respond(true, true);
      return;
    }
  }

  const isAgy = !!(input?.toolCall || input?.conversationId || input?.artifactDirectoryPath || input?.workspacePaths);

  const command =
    input?.toolCall?.args?.CommandLine ||
    input?.toolCall?.args?.command ||
    input?.tool_input?.command ||
    input?.command ||
    "";

  if (typeof command !== "string" || !COMMIT.test(command)) {
    respond(isAgy, true);
    return;
  }

  const message = extractMessage(command);
  if (message === null || CONVENTIONAL.test(message)) {
    respond(isAgy, true);
    return;
  }

  respond(isAgy, false, reasonFor(message), message);
}

main();
