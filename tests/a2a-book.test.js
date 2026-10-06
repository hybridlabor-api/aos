import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync, writeFileSync } from "node:fs";import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const tmp = mkdtempSync(join(tmpdir(), "a2a-book-"));
process.env.AOS_SESSIONS_DIR = join(tmp, "sessions");
process.env.AOS_A2A_BOOK = join(tmp, "a2abook.json");
const reg = await import("../lib/a2a-registry.mjs");
const mode = (f) => statSync(f).mode & 0o777;

test("book lists live entries with every field and a private file", () => {
  reg.register({ name: "a", harness: "claude", url: "http://127.0.0.1:1/a2a", cardUrl: "http://127.0.0.1:1/c", cwd: "/x", pid: process.pid });
  reg.heartbeat({ name: "a", status: "working" });
  const entries = reg.book();
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.name, "a");
  assert.equal(e.harness, "claude");
  assert.equal(e.url, "http://127.0.0.1:1/a2a");
  assert.equal(e.cardUrl, "http://127.0.0.1:1/c");
  assert.equal(e.cwd, "/x");
  assert.ok(e.since && e.heartbeat);
  assert.equal(e.status, "working");
  assert.equal(e.pid, process.pid);
  const dir = process.env.AOS_A2A_BOOK;
  const raw = readFileSync(dir, "utf8");
  assert.equal(mode(dir), 0o600);
  assert.ok(!raw.includes("token"));
});

test("stale ts entry is dropped from the book", () => {
  reg.register({ name: "old", harness: "opencode", pid: process.pid, url: "http://127.0.0.1:2/a2a" });
  const f = join(process.env.AOS_SESSIONS_DIR, "old.json");
  const e = JSON.parse(readFileSync(f, "utf8"));
  e.ts = new Date(Date.now() - 61_000).toISOString();
  writeFileSync(f, JSON.stringify(e));
  assert.ok(!reg.book().some((x) => x.name === "old"));
});

test("dead-pid entry is dropped from the book", () => {
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  reg.register({ name: "gone", harness: "agy", pid: dead, url: "http://127.0.0.1:3/a2a" });
  assert.ok(!reg.book().some((x) => x.name === "gone"));
});

test("heartbeat updates ts and status in the registry entry", async () => {
  reg.register({ name: "b", harness: "codex", pid: process.pid, url: "http://127.0.0.1:4/a2a" });
  const f = join(process.env.AOS_SESSIONS_DIR, "b.json");
  const before = JSON.parse(readFileSync(f, "utf8"));
  await new Promise((r) => setTimeout(r, 20));
  reg.heartbeat({ name: "b", status: "working" });
  const after = JSON.parse(readFileSync(f, "utf8"));
  assert.ok(Date.parse(after.ts) >= Date.parse(before.ts));
  assert.equal(before.status ?? "idle", "idle");
  assert.equal(after.status, "working");
});
