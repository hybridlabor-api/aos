// lib/a2a-permissions.mjs — worktree-scoped permission decisions for A2A
// workers driven over ACP (--allow-default scoped in bin/aos-acp.mjs).
//
// decide(toolCall, { cwd }) classifies one session/request_permission request
// against the job worktree (cwd):
//   - file-write tools (edit/delete/move kind) are allowed only when the
//     realpath target lands inside cwd; symlinks are resolved, `..` escapes
//     and paths that resolve outside are denied; a target that does not exist
//     yet is resolved through its existing parent directory.
//   - shell commands (execute kind) are allowed only when the go-gate neither
//     hard-blocks nor guards them and the command's cwd is inside the
//     worktree. Guarded commands come back as { guarded: true } so the caller
//     can route them through the existing GO path unchanged.
//   - everything else is denied with a reason string.
// No token store is read here; GO tokens stay in bin/aos-acp.mjs and the
// go-gate exports.

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, basename, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const loadFrom = async (candidates) => {
  const f = candidates.find((c) => existsSync(c));
  return f ? import(pathToFileURL(f).href) : null;
};

const gateMod = await loadFrom([
  join(dirname(fileURLToPath(import.meta.url)), "..", ".claude", "hooks", "go-gate.mjs"),
  join(homedir(), ".aos", "bin", "go-gate.mjs"),
  join(homedir(), ".claude", "hooks", "go-gate.mjs"),
]);
if (!gateMod) throw new Error("go-gate.mjs not found: refusing scoped permission decisions without the gate exports");
const { isGuardedCommand, hardBlockReason } = gateMod;

export const WRITE_KINDS = new Set(["edit", "delete", "move"]);

// Same extraction as bin/aos-acp.mjs commandOf, duplicated so this module has
// no import cycle back into the binary.
export function commandOf(toolCall = {}) {
  const r = toolCall.rawInput || {};
  const c = r.command ?? r.cmd ?? r.script ?? r.CommandLine ?? "";
  return Array.isArray(c) ? c.join(" ") : typeof c === "string" ? c : "";
}

// Resolves a candidate path to a concrete filesystem target and reports
// whether it stays inside root (already realpathed). Nonexistent targets are
// resolved through their closest existing ancestor.
export function resolveSafeTarget(root, p) {
  if (typeof p !== "string" || !p.trim()) return { ok: false, reason: "the permission request carries no usable path" };
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  let base = abs;
  const suffix = [];
  while (base !== dirname(base) && !existsSync(base)) {
    suffix.unshift(basename(base));
    base = dirname(base);
  }
  let real;
  try { real = realpathSync(base); } catch { return { ok: false, reason: "the target path cannot be resolved on disk" }; }
  const target = suffix.length ? join(real, ...suffix) : real;
  return { ok: target === root || target.startsWith(root + sep), target };
}

export function decide(toolCall = {}, { cwd } = {}) {
  if (!cwd) return { allow: false, reason: "no worktree cwd configured for this worker; denying" };
  let root;
  try { root = realpathSync(cwd); } catch { root = resolve(cwd); }
  const kind = String(toolCall.kind || "").toLowerCase();

  if (kind === "execute" || commandOf(toolCall)) {
    const cmd = commandOf(toolCall);
    if (!cmd) return { allow: false, reason: "command in the permission request is not readable text; the gate cannot verify it" };
    const hard = hardBlockReason(cmd);
    if (hard) return { allow: false, reason: hard };
    if (isGuardedCommand(cmd)) return { allow: false, guarded: true, reason: "guarded command; needs a human GO" };
    const shellCwd = typeof toolCall.rawInput?.cwd === "string" && toolCall.rawInput.cwd.trim() ? toolCall.rawInput.cwd : root;
    const r = resolveSafeTarget(root, shellCwd);
    if (!r.ok) return { allow: false, reason: "the command runs outside the job worktree" };
    return { allow: true, reason: "unguarded command inside the job worktree" };
  }

  if (WRITE_KINDS.has(kind)) {
    const paths = (toolCall.locations || []).map((l) => l?.path).filter((x) => typeof x === "string" && x.trim());
    if (!paths.length) return { allow: false, reason: `file ${kind} without a target path; cannot verify the worktree boundary` };
    for (const p of paths) {
      const r = resolveSafeTarget(root, p);
      if (!r.ok) return { allow: false, reason: "the file target is outside the job worktree" };
    }
    return { allow: true, reason: "file target inside the job worktree" };
  }

  return { allow: false, reason: `tool kind "${kind || "unknown"}" is not permitted in a worktree-scoped session` };
}
