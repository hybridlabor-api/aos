import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// All state under one temp root, set BEFORE the dynamic imports below.
const tmp = mkdtempSync(join(tmpdir(), "a2a-watch-"));
if (!tmp.startsWith(tmpdir())) throw new Error(`bad temp root: ${tmp}`);
process.env.AOS_SESSIONS_DIR = join(tmp, "a2a-sessions");
process.env.AOS_BUS_ROOT = join(tmp, "a2a-bus");
process.env.AOS_A2A_INBOX = join(tmp, "a2a-inbox");
process.env.AOS_A2A_BOOK = join(tmp, "book.json");

const reg = await import("../lib/a2a-registry.mjs");
const inbox = await import("../lib/a2a-inbox.mjs");
const { watch } = await import("../lib/a2a-watch.mjs");

const collect = (lines) => (s) => {
  for (const l of String(s).split("\n")) lines.push(l);
  return true;
};

// Capture helper: an AbortController that aborts itself after `abortMs` as a safety
// net; the timeout is unref'd so that even an uncleared timer can never keep the
// test run alive (which was what hung the whole file).
function capture(abortMs = 200, pollMs = 5) {
  const lines = [];
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), abortMs);
  t.unref?.();
  return { lines, signal: ac.signal, stop: () => clearTimeout(t) };
}

function fakeRegister(name) {
  return reg.register({ name, harness: "claude", pid: process.pid, url: `http://127.0.0.1:1/a2a-${name}`, cwd: tmp });
}

test("header shows registry fields for a live peer", async () => {
  fakeRegister("avy");
  const cap = capture(200, 10);
  try {
    const code = await watch({ name: "avy", once: false, out: { write: collect(cap.lines) }, pollMs: 20, signal: cap.signal });
    const text = cap.lines.filter(Boolean).join("\n");
    assert.equal(code, 2);
    assert.ok(text.includes("peer avy"));
    assert.ok(text.includes("harness=claude"));
    assert.ok(text.includes("url=http://127.0.0.1:1/a2a-avy"));
    assert.ok(text.includes("pid="));
    assert.ok(text.includes("last heartbeat"));
  } finally {
    cap.signal.aborted || cap.stop();
  }
});

test("missing peer: header says not registered, --once exits non-zero", async () => {
  const out = [];
  const ac = new AbortController();
  try {
    const code = await watch({ name: "ghosty", once: false, out: { write: collect(out) }, signal: ac.signal });
    assert.equal(code, 1);
    assert.equal(out.filter(Boolean)[0], "not registered");
  } finally {
    ac.abort();
  }
  const onceCode = await watch({ name: "ghosty", once: true, out: { write: collect(out) } });
  assert.ok(onceCode !== 0);
  assert.equal(out.filter(Boolean).pop(), "not registered");
});

test("--once snapshot lists last log lines and pending/delivered counts", async () => {
  reg.register({ name: "snap1", harness: "claude", pid: process.pid });
  appendFileSync(join(reg.sessionsDir(), "snap1.log"), "line1\nline2\n");
  inbox.writeMessage("snap1", { taskId: "t1", from: "other", text: "hello there" });
  mkdirSync(inbox.replyDir("snap1"), { recursive: true });
  writeFileSync(join(inbox.replyDir("snap1"), "t2.reply"), "answer");
  const out = [];
  const code = await watch({ name: "snap1", once: true, out: { write: collect(out) } });
  const text = out.filter(Boolean).join("\n");
  assert.equal(code, 0);
  assert.ok(text.includes("line2"));
  assert.ok(/inbox pending=1 delivered=0/.test(text));
  assert.ok(!text.includes("hello there")); // never the full message text
});

test("live follow: log tail, inbox arrival (looks, never claims), delivered rename, reply file", async () => {
  reg.register({ name: "follow1", harness: "claude", pid: process.pid });
  const log = join(reg.sessionsDir(), "follow1.log");
  appendFileSync(log, "early line\n");
  const lines = [];
  const ac = new AbortController();
  try {
    const w = watch({ name: "follow1", once: false, out: { write: collect(lines) }, pollMs: 8, signal: ac.signal });
    await new Promise((r) => setTimeout(r, 30));
    appendFileSync(log, "later line\n");
    // 80 visible chars (the preview) followed by a tail that must never be printed
    const msgFile = inbox.writeMessage("follow1", { taskId: "task-1", from: "callerX", text: `${"A".repeat(80)}TAILSECRET` });
    assert.equal(inbox.pending("follow1").length, 1); // written and unclaimed
    await new Promise((r) => setTimeout(r, 25));
    inbox.claim(msgFile); // the PEER's own claim (rename); the watcher only observes
    mkdirSync(inbox.replyDir("follow1"), { recursive: true }); // the real client creates it with 0700
    writeFileSync(join(inbox.replyDir("follow1"), "task-1.reply"), "replybody");
    await new Promise((r) => setTimeout(r, 60));
    ac.abort();
    const code = await w;
    const text = lines.filter(Boolean).join("\n");
    assert.equal(code, 2);
    assert.ok(text.includes("early line"), `early line missing in: ${text}`);
    assert.ok(text.includes("later line"), `later line missing in: ${text}`);
    assert.ok(text.includes("from=callerX") && text.includes("task=task-1"), `inbox line missing in: ${text}`);
    assert.ok(text.includes("delivered task-1"), `delivered line missing in: ${text}`);
    assert.ok(text.includes("reply   task=task-1 ("), `reply line missing in: ${text}`);
    assert.ok(text.includes("A".repeat(80)) && !text.includes("TAILSECRET"), `preview must be the first 80 chars only: ${text}`);
    assert.equal(text.split("early line").length - 1, 1, `the early log line must be printed exactly once: ${text}`);
    assert.ok(!/token/i.test(text), `word token in: ${text}`);
  } finally {
    ac.abort(); // never leave a follow loop running past the test
  }
});

test("abort signal stops the watcher", async () => {
  reg.register({ name: "abrt1", harness: "claude", pid: process.pid });
  const ac = new AbortController();
  const stopT = setTimeout(() => ac.abort(), 120);
  stopT.unref?.();
  const lines = [];
  try {
    const start = Date.now();
    const code = await watch({ name: "abrt1", once: false, out: { write: collect(lines) }, pollMs: 50, signal: ac.signal });
    assert.equal(code, 2);
    assert.ok(Date.now() - start < 5000);
  } finally {
    ac.abort();
    clearTimeout(stopT);
  }
});

test("watch never writes, claims or renames in the watched inbox", async () => {
  reg.register({ name: "snap2", harness: "claude", pid: process.pid });
  inbox.writeMessage("snap2", { taskId: "a", from: "x", text: "t" });
  const inboxDir = join(process.env.AOS_BUS_ROOT, "a2a", "snap2");
  const code = await watch({ name: "snap2", once: true, out: { write: collect([]) } });
  assert.equal(code, 0);
  assert.equal(readdirSync(inboxDir).length, 1); // no .delivered rename by the watcher
  assert.ok(JSON.parse(readFileSync(join(inboxDir, readdirSync(inboxDir)[0]), "utf8")).taskId === "a");
});

test("no output line ever contains the word token", async () => {
  // Neutral peer name: even the header line must never contain the word "token".
  reg.register({ name: "quiet-peer-1", harness: "claude", pid: process.pid, token: "bearery-9f2d4c1a-s3cr3t" });
  const out = [];
  await watch({ name: "quiet-peer-1", once: true, out: { write: collect(out) } });
  for (const l of out) if (l) assert.ok(!/token/i.test(l), l);
  // The bearer value stored next to the registry entry must never appear either.
  const tokenValue = reg.readToken("quiet-peer-1") ?? "";
  assert.ok(tokenValue.length > 0); // a token really is on disk next to the entry
  for (const l of out) if (l) assert.ok(!l.includes(tokenValue), "leaked bearer value");
});
