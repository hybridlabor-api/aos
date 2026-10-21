// Liveness rules for an `aos-a2a serve` sidecar: when it must exit because its session is gone.
// Pure helpers (clock, kill and file access injectable) so the rules are testable without real processes.
import { closeSync, openSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";

// Harnesses whose --parent-pid is a long-lived SHARED host process (the agy app, the codex app-server daemon),
// not a per-session process: its liveness says nothing about one conversation, so the idle reaper applies too.
// claude and opencode run one process per session, so their owner pid is exact and the pid watch alone decides.
export const SHARED_OWNER_HARNESSES = new Set(["agy", "codex"]);

export const DEFAULT_IDLE_MIN = 120;

// AOS_A2A_IDLE_MIN overrides the idle window (minutes, > 0).
export function idleLimitMs(env = process.env) {
  const n = Number(env.AOS_A2A_IDLE_MIN);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_IDLE_MIN) * 60_000;
}

// pid 1 (launchd/init) and garbage are not an owner: a `kill(1, 0)` check answers EPERM for non-root,
// which the watch reads as "alive", so it could never fire. Such a sidecar has no owner pid.
export function usableOwnerPid(pid) {
  const n = Number(pid);
  return Number.isInteger(n) && n > 1 ? n : null;
}

// True only when the owner pid is definitely gone (ESRCH). EPERM means it exists under another user.
export function ownerGone(pid, kill = process.kill) {
  try { kill(pid, 0); return false; } catch (e) { return e?.code === "ESRCH"; }
}

// Idle reaper rule: nothing running and no activity (task finished or hook touch) for `idleMs`.
export function idleExpired({ now, lastActivity, inFlight, idleMs }) {
  return inFlight === 0 && now - lastActivity >= idleMs;
}

// The idle reaper runs for a sidecar with no owner pid, or with a shared-owner harness.
export function usesIdleReaper(harness, hasOwner) {
  return !hasOwner || SHARED_OWNER_HARNESSES.has(String(harness).toLowerCase());
}

export const seenPath = (dir, name) => join(dir, `${name}.seen`);

// Session hooks call this on every fire: the file's mtime is the owner's last sign of life.
export function touchSeen(dir, name, now = Date.now()) {
  const p = seenPath(dir, name);
  closeSync(openSync(p, "a", 0o600));
  const t = new Date(now);
  utimesSync(p, t, t);
}

// Last touch as epoch ms; 0 when never touched.
export function seenAt(dir, name) {
  try { return statSync(seenPath(dir, name)).mtimeMs; } catch { return 0; }
}
