import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const tmp = mkdtempSync(join(tmpdir(), "a2a-reg-"));
process.env.AOS_SESSIONS_DIR = join(tmp, "sessions");
const reg = await import("../lib/a2a-registry.mjs");
const mode = (f) => statSync(f).mode & 0o777;

test("register writes 0600 json + separate 0600 token in a 0700 dir", () => {
  reg.register({ name: "w1", harness: "claude", url: "http://127.0.0.1:1/a2a", cardUrl: "http://127.0.0.1:1/c", cwd: "/x", token: "sekret" });
  const dir = process.env.AOS_SESSIONS_DIR;
  if (process.platform !== "win32") { // NTFS reports 0o666 for every file and directory
    assert.equal(mode(dir), 0o700);
    assert.equal(mode(join(dir, "w1.json")), 0o600);
    assert.equal(mode(join(dir, "w1.token")), 0o600);
  }
  const e = JSON.parse(readFileSync(join(dir, "w1.json"), "utf8"));
  assert.ok(e.started && e.ts && e.pid === process.pid);
  assert.ok(!JSON.stringify(e).includes("sekret"));
  assert.equal(reg.readToken("w1"), "sekret");
});

test("list returns live entries; prune removes only stale entry's two files", () => {
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  reg.register({ name: "dead1", harness: "agy", pid: dead, token: "t" });
  const dir = process.env.AOS_SESSIONS_DIR;
  writeFileSync(join(dir, "keep.txt"), "x");
  assert.deepEqual(reg.list().map((s) => s.name), ["w1"]);
  assert.ok(existsSync(join(dir, "dead1.json")));
  reg.list({ prune: true });
  assert.ok(!existsSync(join(dir, "dead1.json")) && !existsSync(join(dir, "dead1.token")));
  assert.ok(existsSync(join(dir, "keep.txt")) && existsSync(join(dir, "w1.json")));
});

test("pid reuse: live pid whose process started after registration is stale", () => {
  const dir = process.env.AOS_SESSIONS_DIR;
  reg.register({ name: "reused", harness: "claude", pid: process.pid });
  const f = join(dir, "reused.json");
  const e = JSON.parse(readFileSync(f, "utf8"));
  e.started = "2000-01-01T00:00:00.000Z";
  writeFileSync(f, JSON.stringify(e));
  assert.ok(!reg.list().some((s) => s.name === "reused"));
  reg.unregister("reused");
});

test("invalid names rejected", () => {
  for (const n of ["", "../x", "a/b", ".hidden", "A B", "-x", "x".repeat(65), undefined]) {
    assert.throws(() => reg.register({ name: n, harness: "claude" }), /invalid session name/, String(n));
  }
  assert.throws(() => reg.unregister("../x"), /invalid session name/);
});

test("unregister removes both files; importBusSessions is read-only and returns an array", () => {
  reg.unregister("w1");
  assert.deepEqual(reg.list(), []);
  assert.ok(Array.isArray(reg.importBusSessions()));
});
