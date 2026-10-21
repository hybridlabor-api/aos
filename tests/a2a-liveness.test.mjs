// Sidecar liveness rules (lib/a2a-liveness.mjs) with a fake clock and an injected kill: no real pids are signalled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  usableOwnerPid, ownerGone, idleExpired, idleLimitMs, usesIdleReaper, touchSeen, seenAt, DEFAULT_IDLE_MIN,
} from "../lib/a2a-liveness.mjs";

test("owner pid: pid 1 and garbage are not an owner", () => {
  assert.equal(usableOwnerPid(1), null);
  assert.equal(usableOwnerPid(0), null);
  assert.equal(usableOwnerPid("abc"), null);
  assert.equal(usableOwnerPid(undefined), null);
  assert.equal(usableOwnerPid("4242"), 4242);
});

test("ownerGone fires only on ESRCH; EPERM means alive", () => {
  const esrch = () => { const e = new Error("no"); e.code = "ESRCH"; throw e; };
  const eperm = () => { const e = new Error("nope"); e.code = "EPERM"; throw e; };
  assert.equal(ownerGone(77, esrch), true);
  assert.equal(ownerGone(77, eperm), false);
  assert.equal(ownerGone(77, () => true), false);
});

test("idle reaper: exits only after the quiet window, never while a task runs", () => {
  const idleMs = idleLimitMs({ AOS_A2A_IDLE_MIN: "2" });
  assert.equal(idleMs, 120_000);
  const t0 = 1_000_000;
  assert.equal(idleExpired({ now: t0 + 119_999, lastActivity: t0, inFlight: 0, idleMs }), false);
  assert.equal(idleExpired({ now: t0 + 120_000, lastActivity: t0, inFlight: 0, idleMs }), true);
  assert.equal(idleExpired({ now: t0 + 999_999, lastActivity: t0, inFlight: 1, idleMs }), false);
});

test("idle window: default, and bad env values fall back to the default", () => {
  assert.equal(idleLimitMs({}), DEFAULT_IDLE_MIN * 60_000);
  assert.equal(idleLimitMs({ AOS_A2A_IDLE_MIN: "nope" }), DEFAULT_IDLE_MIN * 60_000);
  assert.equal(idleLimitMs({ AOS_A2A_IDLE_MIN: "-5" }), DEFAULT_IDLE_MIN * 60_000);
});

test("which harnesses get the idle reaper", () => {
  // per-session owner process (claude, opencode): the pid watch alone decides
  assert.equal(usesIdleReaper("claude", true), false);
  assert.equal(usesIdleReaper("opencode", true), false);
  // shared host owner (agy app, codex app-server): reaper too
  assert.equal(usesIdleReaper("agy", true), true);
  assert.equal(usesIdleReaper("codex", true), true);
  // no owner at all: reaper
  assert.equal(usesIdleReaper("claude", false), true);
});

test("seen touch: the mtime records the owner's last sign of life", () => {
  const dir = mkdtempSync(join(tmpdir(), "a2a-liveness-"));
  assert.equal(seenAt(dir, "agy-x"), 0);
  const t = 1_700_000_000_000;
  touchSeen(dir, "agy-x", t);
  assert.equal(seenAt(dir, "agy-x"), t);
  touchSeen(dir, "agy-x", t + 60_000);
  assert.equal(seenAt(dir, "agy-x"), t + 60_000);
});
