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

import { realpathSync, readFileSync, fstatSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "chore", "ci", "build", "revert"];

const CONVENTIONAL = new RegExp(`^(${TYPES.join("|")})(\\(.+\\))?:\\s.+`);

// Command position only (start of line or after ; && || |): text that merely mentions the command is not a commit.
const COMMIT = /(?:^|[;&|\n])[ \t]*(?:\w+=\S+[ \t]+)*git(?:[ \t]+(?:-[Cc][ \t]+\S+|--no-pager))*[ \t]+commit\b/;

// Bounded stdin read, same as rules-inject.mjs readStdinBounded: an open stdin pipe (Codex on Windows) must not hang
// the hook. Stops on end, first complete JSON, byte cap or timeout; null = nothing read before a timeout or an error.
function readStdinBounded(maxMs, maxBytes = 64 << 20) {
  // A regular file or directory never blocks: read it at once. A read error (EISDIR, closed fd) is null, which go-gate denies.
  let st;
  try { st = fstatSync(0); } catch { return Promise.resolve(null); }
  if (st.isFile() || st.isDirectory()) { try { return Promise.resolve(readFileSync(0, "utf8")); } catch { return Promise.resolve(null); } }
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let buf = "";
    let settled = false;
    const finish = (incomplete) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      // pause() alone keeps an open pipe ref'd: a hook that ends without process.exit (a2a-session) would hang.
      try { process.stdin.pause(); process.stdin.unref?.(); } catch {}
      resolve(incomplete === true && !buf ? null : buf);
    };
    const to = setTimeout(finish, maxMs, true);
    if (to.unref) to.unref();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      if (buf.length >= maxBytes) return finish();
      if (buf.trimEnd().endsWith("}")) try { JSON.parse(buf); finish(); } catch {}
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", () => finish(true));
    process.stdin.resume();
  });
}

// Decision as { code, stdout, stderr }: shared by the script entry and the in-process dispatcher (aos-hooks.mjs).
function decision(isAgy, allowed, reason = "") {
  if (isAgy) return { code: 0, stdout: `${JSON.stringify(allowed ? { decision: "allow" } : { decision: "deny", reason })}\n`, stderr: "" };
  return allowed ? { code: 0, stdout: "", stderr: "" } : { code: 2, stdout: "", stderr: `${reason}\n` };
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

export function hook(rawInput) {
  let input = {};
  if (String(rawInput ?? "").trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch {
      // Unparseable input: fail open, no stdout (isAgy unknown).
      return { code: 0, stdout: "", stderr: "" };
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
  return decision(isAgy, !reason, reason || "");
}

async function main() {
  // Hard wall-clock budget: ~70 % of this hook's 10 s timeout. Past it: exit 0, as for unparseable input.
  setTimeout(() => process.exit(0), 7000 - process.uptime() * 1000).unref();
  const r = hook((await readStdinBounded(2000)) ?? "");
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.code);
}

if (isMain()) await main();
