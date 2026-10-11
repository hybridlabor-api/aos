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
// Deliberately fails OPEN for the .env check. A hook that cannot read its input must not wedge
// every write in the session; missing a protection is recoverable, freezing
// the agent is not. The go-gate store check is the exception: unparseable input that names the
// store is denied.

import { readFileSync, realpathSync, lstatSync, readlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, resolve } from "node:path";

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

// The go-gate store (~/.aos/gate: modes and grants, ~/.aos/go: GO tokens) is
// written only by the AOS hooks. Same honest limit as go-gate's Bash guard: a
// same-uid agent running its own code can still write there; the store is
// worthless without the matching human transcript entry the gate re-verifies.
// /i: APFS and NTFS are case-insensitive, so ~/.AOS/Gate is the same directory.
const GATE_STORE = /(?:^|[\\/])\.aos[\\/](?:gate|go)(?:[\\/]|$)/i;

// Where a write to `p` would really land: the realpath of the deepest existing ancestor (so a symlinked directory
// anywhere up the chain counts, also when the leaf and some parents do not exist yet) plus the missing tail; a dangling
// symlink is followed to its target. Bounded: 40 link hops; beyond that (a real loop, or an absurd chain) it fails
// closed by answering with a path inside the store.
const HOP_LIMIT = 40;
// `p` is NOT normalized by the caller or here: `link/../x` means "the parent of what link points to", which only the OS
// (realpath.native) resolves correctly, so `..` is never collapsed textually before the existing prefix is resolved.
function landing(p, hops = 0) {
  const tail = [];
  let cur = p;
  for (;;) {
    try { return resolve(realpathSync.native(cur), ...tail); } catch { /* not resolvable here */ }
    let link = false;
    try { link = lstatSync(cur).isSymbolicLink(); } catch { /* not a link either */ }
    if (link) {
      if (hops >= HOP_LIMIT) return "/.aos/gate/symlink-hop-limit";
      try {
        const t = readlinkSync(cur);
        return landing((isAbsolute(t) ? t : `${dirname(cur)}/${t}`) + (tail.length ? `/${tail.join("/")}` : ""), hops + 1);
      } catch { return "/.aos/gate/symlink-unreadable"; }
    }
    const parent = dirname(cur);
    if (parent === cur) return p;
    tail.unshift(basename(cur));
    cur = parent;
  }
}

function gateStoreTarget(filePath, cwd = "") {
  const expanded = filePath.replace(/^~(?=\/|$)/, process.env.HOME || "~");
  const base = resolve(cwd || process.cwd());
  const raw = isAbsolute(expanded) ? expanded : `${base}/${expanded}`; // un-normalized: see landing()
  const abs = resolve(base, expanded);
  return GATE_STORE.test(abs) || GATE_STORE.test(landing(raw)) || GATE_STORE.test(landing(abs)) || GATE_STORE.test(`${abs}/`);
}

export function envFileReason(filePath, cwd = "") {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  if (gateStoreTarget(filePath, cwd)) {
    return `Blocked by env-file-protection hook: ${filePath} is in the AOS go-gate store. Modes and grants are set only by the human typing a plain "gogate ..." message; agents may read the status, never write it.`;
  }
  // basename(), so a path like /srv/app/.env matches but /srv/app/env-notes.md does not.
  const name = basename(filePath);
  return !ENV_FILE.test(name) || TEMPLATE_FILE.test(name) ? null : reasonFor(filePath);
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

function main() {
  const rawInput = readStdin();
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch {
      // Not decidable, but not blind either: input that names the go-gate store anywhere (JSON escapes `\/` and
      // `\\` included) is denied; any other unparseable input still passes so the hook cannot wedge every write.
      if (GATE_STORE.test(rawInput.replace(/\\+\//g, "/").replace(/\\{2,}/g, "\\"))) {
        const reason = "Blocked by env-file-protection hook: unreadable hook input that names the AOS go-gate store.";
        console.log(JSON.stringify({ decision: "deny", reason }));
        process.stderr.write(`${reason}\n`);
        process.exit(2);
      }
      process.exit(0);
    }
  }
  if (!input || typeof input !== "object") input = {};

  const isAgy = !!(input?.toolCall || input?.conversationId || input?.artifactDirectoryPath || input?.workspacePaths);
  const cwd = typeof input.cwd === "string" ? input.cwd : "";

  for (const filePath of targetsOf(input)) {
    const reason = envFileReason(filePath, cwd);
    if (reason) return respond(isAgy, false, reason);
  }
  respond(isAgy, true);
}

// Every path-like argument a file tool may carry, across harnesses: Claude Code (file_path, notebook_path), OpenCode
// (filePath, patchText of apply_patch), agy (toolCall.args). The agy/OpenCode extra key names are best-effort and
// deny-only: reading more keys can add a block, never remove one.
// No caps on count, path length or patch size (a cap would be a way to hide a path). [ \t]* cannot cross a line, so the
// patch regex is linear even on huge input.
const PATH_KEYS = ["file_path", "filePath", "notebook_path", "path", "target_file", "TargetFile", "AbsolutePath"];
const PATCH_KEYS = ["patchText", "patch", "input"];
const PATCH_FILE = /^[ \t]*\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;
export function targetsOf(input) {
  const out = [];
  if (!input || typeof input !== "object") return out;
  for (const src of [input.tool_input, input.toolCall?.args, input.args, input]) {
    if (!src || typeof src !== "object") continue;
    for (const k of PATH_KEYS) if (typeof src[k] === "string" && src[k]) out.push(src[k]);
    for (const k of PATCH_KEYS) {
      if (typeof src[k] !== "string") continue;
      for (const m of src[k].matchAll(PATCH_FILE)) out.push(m[1].trim());
    }
  }
  return out;
}

if (isMain()) main();
