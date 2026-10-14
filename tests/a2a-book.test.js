import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, statSync, existsSync, readFileSync, writeFileSync, symlinkSync, unlinkSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const tmp = mkdtempSync(join(tmpdir(), "a2a-book-"));
process.env.AOS_SESSIONS_DIR = join(tmp, "sessions");
process.env.AOS_A2A_BOOK = join(tmp, "book", "a2abook.json");
const reg = await import("../lib/a2a-registry.mjs");
const mode = (f) => statSync(f).mode & 0o777;
const readBook = () => JSON.parse(readFileSync(process.env.AOS_A2A_BOOK, "utf8"));

test("book lists live sessions with whitelisted fields, 0600 file in 0700 dir", () => {
  reg.register({ name: "a1", harness: "claude", pid: process.pid, url: "http://127.0.0.1:1/a2a", cardUrl: "http://127.0.0.1:1/c", cwd: "/x", token: "sekret-token" });
  reg.register({ name: "b2", harness: "opencode", pid: process.pid, url: "http://127.0.0.1:2/a2a" });
  const entries = reg.book();
  assert.deepEqual(entries.map((e) => e.name), ["a1", "b2"]);
  const expected = ["name", "harness", "url", "cardUrl", "cwd", "since", "ts", "status", "pid", "label"];
  for (const e of entries) {
    assert.deepEqual(Object.keys(e).sort(), [...expected].sort());
    assert.equal(typeof e.ts, "number");
    assert.ok(e.since);
    assert.equal(e.status, "idle");
  }
  if (process.platform !== "win32") {
    assert.equal(mode(process.env.AOS_A2A_BOOK), 0o600);
    assert.equal(mode(join(tmp, "book")), 0o700);
  }
  assert.ok(!readFileSync(process.env.AOS_A2A_BOOK, "utf8").includes("sekret-token"));
});

test("dead-pid session is dropped from the book", () => {
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  reg.register({ name: "dead", harness: "agy", pid: dead });
  const entries = reg.book();
  assert.ok(!entries.some((e) => e.name === "dead"));
  assert.ok(existsSync(join(process.env.AOS_SESSIONS_DIR, "dead.json")), "session file not deleted");
});

test("stale ts (older than maxAgeMs) is dropped", () => {
  reg.register({ name: "stale", harness: "claude", pid: process.pid });
  reg.heartbeat("stale", { status: "idle" });
  const f = join(process.env.AOS_SESSIONS_DIR, "stale.json");
  const e = JSON.parse(readFileSync(f, "utf8"));
  e.ts = Date.now() - 10 * 60 * 1000;
  writeFileSync(f, JSON.stringify(e));
  const entries = reg.book();
  assert.ok(!entries.some((x) => x.name === "stale"));
  assert.ok(entries.some((x) => x.name === "a1"));
  assert.ok(existsSync(f));
});

test("heartbeat updates ts and status; book reflects it", () => {
  const before = reg.heartbeat("a1", { status: "working" });
  assert.equal(before.status, "working");
  const e = reg.book().find((x) => x.name === "a1");
  assert.equal(e.status, "working");
  const after = reg.heartbeat("a1", { status: "idle" });
  assert.ok(after.ts >= before.ts);
  assert.equal(reg.book().find((x) => x.name === "a1").status, "idle");
});

test("unregister removes the entry on next book; existing session files survive", () => {
  reg.unregister("b2");
  const entries = reg.book();
  assert.ok(!entries.some((e) => e.name === "b2"));
  assert.ok(existsSync(join(process.env.AOS_SESSIONS_DIR, "a1.json")));
});

test("AOS_A2A_BOOK override is honoured", () => {
  assert.equal(reg.bookPath(), process.env.AOS_A2A_BOOK);
  assert.ok(existsSync(process.env.AOS_A2A_BOOK));
});

test("register succeeds even when the book path is unwritable (a regular file in the way)", () => {
  const blocker = join(tmp, "blocker");
  writeFileSync(blocker, "x");
  process.env.AOS_A2A_BOOK = blocker;
  try {
    const f = reg.register({ name: "c3", harness: "codex", pid: process.pid });
    assert.ok(existsSync(f));
    unlinkSync(join(process.env.AOS_SESSIONS_DIR, "c3.json"));
  } finally {
    process.env.AOS_A2A_BOOK = join(tmp, "book", "a2abook.json");
  }
});

test("heartbeat refreshes the book: stale peers drop, status changes appear", () => {
  reg._bookThrottle.last = 0;
  reg.register({ name: "peer", harness: "agy", pid: process.pid });
  reg.book();
  const f = join(process.env.AOS_SESSIONS_DIR, "peer.json");
  const e = JSON.parse(readFileSync(f, "utf8"));
  e.ts = Date.now() - 10 * 60 * 1000; // age the peer out
  writeFileSync(f, JSON.stringify(e));
  reg._bookThrottle.last = 0;
  reg.heartbeat("a1", { status: "working" }); // no explicit book() call
  const entries = readBook();
  assert.ok(!entries.some((x) => x.name === "peer"), "stale peer dropped by heartbeat refresh");
  assert.equal(entries.find((x) => x.name === "a1").status, "working", "status change propagated");
});

test("book refresh is throttled to at most once per 2s per process", () => {
  reg.register({ name: "thr", harness: "claude", pid: process.pid });
  reg._bookThrottle.last = Date.now(); // a book write just happened
  reg.heartbeat("thr", { status: "working" });
  assert.equal(readBook().find((x) => x.name === "thr").status, "idle", "throttled: not rewritten");
  reg._bookThrottle.last = 0;
  reg.heartbeat("thr", { status: "working" });
  assert.equal(readBook().find((x) => x.name === "thr").status, "working", "refreshed after throttle window");
});

test("book value hygiene: url/cardUrl stripped, token-ish cwd nulled", () => {
  reg.register({ name: "hyg", harness: "claude", pid: process.pid,
    url: "http://user:pw@127.0.0.1:9/a2a?token=sekret#frag",
    cardUrl: "http://u:p@127.0.0.1:9/card.json?x=1",
    cwd: "/tmp/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" });
  reg.register({ name: "hyg2", harness: "claude", pid: process.pid,
    url: "not a url", cardUrl: undefined, cwd: "../relative/path" });
  reg.book();
  const e = readBook().find((x) => x.name === "hyg");
  assert.equal(e.url, "http://127.0.0.1:9/a2a");
  assert.equal(e.cardUrl, "http://127.0.0.1:9/card.json");
  assert.equal(e.cwd, null);
  const e2 = readBook().find((x) => x.name === "hyg2");
  assert.equal(e2.url, null);
  assert.equal(e2.cardUrl, null);
  assert.equal(e2.cwd, null);
  const raw = readFileSync(process.env.AOS_A2A_BOOK, "utf8");
  assert.ok(!raw.includes("sekret") && !raw.includes("user:pw"), "no credentials in the book");
});

test("book name comes from the session file name, not the json body", () => {
  reg.register({ name: "fnam", harness: "claude", pid: process.pid });
  const f = join(process.env.AOS_SESSIONS_DIR, "fnam.json");
  const e = JSON.parse(readFileSync(f, "utf8"));
  e.name = "totally-other-name";
  writeFileSync(f, JSON.stringify(e));
  reg.book();
  assert.ok(readBook().some((x) => x.name === "fnam"));
  assert.ok(!readBook().some((x) => x.name === "totally-other-name"));
});

test("relative AOS_A2A_BOOK resolves against the cwd (path.dirname, not slice)", () => {
  const prevCwd = process.cwd();
  const prevBook = process.env.AOS_A2A_BOOK;
  process.chdir(tmp);
  process.env.AOS_A2A_BOOK = "relbook/a2abook.json";
  try {
    reg.book();
    assert.ok(existsSync(join(tmp, "relbook", "a2abook.json")));
  } finally {
    process.chdir(prevCwd);
    process.env.AOS_A2A_BOOK = prevBook;
  }
});

test("atomic writes leave no .tmp files; session json stays 0600", () => {
  reg.register({ name: "atom", harness: "claude", pid: process.pid });
  reg.heartbeat("atom", { status: "idle" });
  reg.book();
  assert.deepEqual(readdirSync(process.env.AOS_SESSIONS_DIR).filter((f) => f.endsWith(".tmp")), []);
  assert.deepEqual(readdirSync(dirname(process.env.AOS_A2A_BOOK)).filter((f) => f.endsWith(".tmp")), []);
  if (process.platform !== "win32") assert.equal(mode(join(process.env.AOS_SESSIONS_DIR, "atom.json")), 0o600);
});

test("prune skips fresh unparseable files, prunes old corrupt ones", () => {
  const f = join(process.env.AOS_SESSIONS_DIR, "halfbaked.json");
  writeFileSync(f, '{"name":"halfbaked"');
  reg.list({ prune: true });
  assert.ok(existsSync(f), "fresh half-written file must not be unregistered");
  const old = new Date(Date.now() - 10000);
  utimesSync(f, old, old);
  reg.list({ prune: true });
  assert.ok(!existsSync(f), "old corrupt file is pruned");
});

test("user-supplied book parent is never chmod'ed; symlink dirs are not followed", () => {
  const loose = join(tmp, "loosebook");
  mkdirSync(loose, { mode: 0o755 });
  const link = join(tmp, "linkbook");
  symlinkSync(loose, link);
  process.env.AOS_A2A_BOOK = join(link, "a2abook.json");
  try {
    reg.book();
    assert.ok(existsSync(join(link, "a2abook.json")));
    if (process.platform !== "win32") {
      assert.equal(mode(loose), 0o755, "chmod never tightens a user-supplied parent");
    }
  } finally {
    process.env.AOS_A2A_BOOK = join(tmp, "book", "a2abook.json");
    try { unlinkSync(link); } catch { /* test fixture */ }
  }
});
