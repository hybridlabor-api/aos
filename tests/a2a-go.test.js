// GO-over-A2A: verify (read-only) and consume (single use) of human minted references via
// the existing test seam (temp dirs under os.tmpdir(); tokens ONLY written through the
// seam into a temp store). Nothing in this file, and nothing in the executor path, may
// create a token — test (g) asserts that invariant end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "a2a-go-"));
process.env.AOS_SESSIONS_DIR = path.join(tmp, "sessions");
process.env.AOS_BUS_ROOT = path.join(tmp, "bus");
process.env.AOS_A2A_INBOX = path.join(tmp, "a2a-inbox");
process.env.AOS_A2A_BOOK = path.join(tmp, "a2abook.json");
delete process.env.AOS_WORKER_PROXY_URL;
process.env.AOS_A2A_MAX_DEPTH = "1";
process.env.AOS_A2A_POLL_THRESHOLD_MS = "0"; // client.send always uses the non-blocking + poll path

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const a2aGo = await import("../lib/a2a-go.mjs");
const { spawnExecutor } = await import("../lib/a2a-spawn.mjs");
const { liveExecutor } = await import("../lib/a2a-live.mjs");
const { startSidecar } = await import("../lib/a2a-sidecar.mjs");
const a2aClient = await import("../lib/a2a-client.mjs");
const { TaskState } = await import("@a2a-js/sdk");

// same live-style profile shape tests/a2a-spawn.test.js uses for real sidecar runs
const profile = {
  orchestrator: { harness: "claude", model: "opus" },
  roles: { spawn: { harness: "claude", model: "opus", write: false, mode: "spawn" } },
  default: { harness: "claude", model: "opus", write: false, mode: "spawn" },
};

const store = fs.mkdtempSync(path.join(os.tmpdir(), "a2a-go-store-"));
const goDir = path.join(store, ".aos", "go");
const tokenPath = (s) => path.join(goDir, `${s}.token`);
const jsonl = (...e) => e.map((x) => JSON.stringify(x)).join("\n") + "\n";
const goFiles = () => (fs.existsSync(goDir) ? fs.readdirSync(goDir) : []);
const consumedRefsFile = () => path.join(goDir, ".a2a-consumed");
const consumedRefs = () => { try { return fs.readFileSync(consumedRefsFile(), "utf8"); } catch { return ""; } };

const writeToken = (session, over = {}) => {
  const master = path.join(store, `master-${session}.jsonl`);
  fs.writeFileSync(master, jsonl({ type: "user", uuid: `u-${session}`, message: { role: "user", content: `GO ${session}` } }));
  fs.mkdirSync(goDir, { recursive: true, mode: 0o700 });
  const body = { target: session, issued_at: new Date().toISOString(), master_transcript: master, master_session: "master", ...over };
  fs.writeFileSync(tokenPath(session), JSON.stringify(body), { mode: 0o600 });
  return body;
};
const refOf = (session) =>
  crypto.createHash("sha256").update(fs.readFileSync(tokenPath(session), "utf8")).digest("hex").slice(0, 12);

// Bus stub: one call drives the executor directly (the sidecar wiring is covered by the
// other a2a tests); states are compared through the SDK constants only.
const call = async (executor, { text, meta, taskId }) => {
  const events = [];
  let fin;
  const finP = new Promise((r) => { fin = r; });
  const bus = { publish: (e) => events.push(e), finished: () => { fin(); return Promise.resolve(); } };
  await executor.execute({
    taskId, contextId: "ctx-1",
    userMessage: {
      parts: [{ content: { $case: "text", value: text } }],
      metadata: { aos: { caller: "caller", depth: 0, ...(meta ?? {}) } },
    },
  }, bus).catch((e) => events.push({ thrown: String(e?.message ?? e) }));
  await finP;
  return events;
};
const states = (events) => events.filter((e) => e.status?.state && !("artifacts" in e)).map((e) => e.status.state);
const lastState = (events) => states(events).at(-1) ?? null;
const lastMessage = (events) => {
  const e = [...events].reverse().find((e) => e.status?.message?.parts);
  return e ? e.status.message.parts.map((p) => p.content.value).join("") : "";
};

const AUTH_STR = "TASK_STATE_AUTH_REQUIRED";
const COMPLETED_STR = "TASK_STATE_COMPLETED";
const NOT_FINAL = new Set(["TASK_STATE_UNSPECIFIED", "TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"]);

// Real sidecar traffic: raw JSON-RPC over fetch, exactly like l2Send in tests/a2a-repair.test.js.
const rpc = async (s, method, params, id) => {
  const res = await fetch(s.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0", Authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: id ?? 1, method, params }),
  });
  const body = await res.json().catch(() => ({ jsonrpc: "2.0", error: { code: -1, message: "non-JSON response" } }));
  return body;
};
const sendMsg = async (s, { text, taskId, contextId, meta, caller = "caller", depth = 0 }, id) => {
  const message = {
    messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text }],
    ...(taskId ? { taskId } : {}), ...(contextId ? { contextId } : {}),
    metadata: { aos: { caller, depth, ...(meta ?? {}) } },
  };
  return rpc(s, "SendMessage", { message }, id);
};
// blocking SendMessage and GetTask both answer with a Task object
// (defensively also tolerate the {task: {...}} envelope of the non-blocking path)
const taskOf = (body) => body.result?.task ?? body.result;
const getState = (body) =>
  body.error ? `jsonrpc-error-${body.error.code}: ${body.error.message}`
    : taskOf(body)?.status?.state ?? null;
const statusTextOf = (body) =>
  (taskOf(body)?.status?.message?.parts ?? [])
    .map((p) => p.text ?? p.content?.value ?? "")
    .join("");
// A follow-up repeats the SAME taskId AND contextId of the response the follow-up resumes.
const followUp = (firstBody) => {
  const t = taskOf(firstBody) ?? {};
  return { taskId: t.id, contextId: t.contextId };
};
const pollUntil = async (s, taskId, deadlineMs = 10000) => {
  const end = Date.now() + deadlineMs;
  for (;;) {
    const body = await rpc(s, "GetTask", { id: taskId }, 2);
    const state = getState(body);
    if (body.error || !NOT_FINAL.has(state) || Date.now() > end) return body;
    await new Promise((r) => setTimeout(r, 50));
  }
};
const cancelRpc = async (s, taskId) => {
  try { await rpc(s, "CancelTask", { id: taskId }, 3); } catch { /* already settled */ }
};

// Fake worker that prints exactly `mark` on stdout and exits 0.
const fakeSpawn = (mark) => (file, args, opts) => ({
  pid: process.pid,
  stdout: { on: (ev, cb) => process.nextTick(() => cb(Buffer.from(mark))) },
  stderr: { on: () => {} },
  on: (ev, cb) => { if (ev === "close") process.nextTick(() => cb(0)); },
});

test("(a) a valid reference for the right session verifies (read-only) and consumes once; the second consume is replayed", async () => {
  writeToken("worker-1");
  const ref = refOf("worker-1");
  const v = await a2aGo.verifyGoRef({ session: "worker-1", ref, storeDir: store });
  assert.deepEqual(v, { ok: true, reason: "GO ref valid (not consumed)" });
  assert.ok(fs.existsSync(tokenPath("worker-1")), "verify keeps the token");

  const c1 = await a2aGo.consumeGoRef({ session: "worker-1", ref, storeDir: store });
  assert.equal(c1.ok, true, JSON.stringify(c1));
  assert.ok(!fs.existsSync(tokenPath("worker-1")), "consume removes the token");
  const c2 = await a2aGo.consumeGoRef({ session: "worker-1", ref, storeDir: store });
  assert.deepEqual(c2, { ok: false, reason: "replayed" }, JSON.stringify(c2));
});

test("(b) a forged reference is denied", async () => {
  const v = await a2aGo.verifyGoRef({ session: "worker-1", ref: "deadbeef1234", storeDir: store });
  assert.deepEqual(v, { ok: false, reason: "forged" });
});

test("(c) a reference for another session is denied (wrong-target) and stays untouched", async () => {
  writeToken("worker-2", { target: "worker-2" });
  const r = fs.readFileSync(tokenPath("worker-2"));
  const v = await a2aGo.verifyGoRef({ session: "worker-1", ref: refOf("worker-2"), storeDir: store });
  assert.deepEqual(v, { ok: false, reason: "wrong-target" });
  assert.equal(fs.readFileSync(tokenPath("worker-2")).toString(), r.toString(), "the wrong-target token stays untouched");
});

test("(d) an expired reference is denied", async () => {
  writeToken("worker-3", { issued_at: new Date(Date.now() - 11 * 60000).toISOString() });
  const v = await a2aGo.verifyGoRef({ session: "worker-3", ref: refOf("worker-3"), storeDir: store });
  assert.deepEqual(v, { ok: false, reason: "expired" });
});

test("(e) malformed reference ids are denied without touching the store", async () => {
  writeToken("keeper");
  const before = goFiles();
  for (const bad of ["", "abc", "../x", "../../etc/passwd", "x".repeat(13), "a/b/c/d/e", "zzzzzzzzzzzz", "G".repeat(12)]) {
    const v = await a2aGo.verifyGoRef({ session: "keeper", ref: bad, storeDir: store });
    assert.deepEqual(v, { ok: false, reason: "malformed" }, JSON.stringify(bad));
    const c = await a2aGo.consumeGoRef({ session: "keeper", ref: bad, storeDir: store });
    assert.equal(c.ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(goFiles(), before, "the store is untouched");
});

const AUTH = TaskState.TASK_STATE_AUTH_REQUIRED;
const COMPLETED = TaskState.TASK_STATE_COMPLETED;
const authBack = { claude: () => ({ file: "/no/such/real/exec", args: [] }) };

test("(f) a follow-up whose TEXT is GO <session> carries no goRef: it is logged, dropped, never consumes", async () => {
  writeToken("f-target");
  const spawnCalls = [];
  const s = await startSidecar({
    name: "f-side", harness: "claude", profile,
    executor: spawnExecutor({
      session: "f-target", harness: "claude", write: false, repo: tmp, goRefStore: store,
      backends: { claude: (o) => { spawnCalls.push(o); return { file: "/no/such/real/exec", args: [] }; } },
      spawnImpl: fakeSpawn("AOS-AUTH-REQUIRED: git push -u origin main\n"),
    }),
  });
  const ref = refOf("f-target");
  const refsBefore = consumedRefs();
  try {
    const first = await sendMsg(s, { text: "do the thing" });
    assert.equal(getState(first), AUTH_STR, JSON.stringify(first));
    assert.match(statusTextOf(first), /blocked pending a human GO.*f-target/s, JSON.stringify(taskOf(first)?.status));
    const { taskId, contextId } = followUp(first);
    const before = goFiles();
    const warns = [];
    const realWarn = console.warn;
    console.warn = (line) => { warns.push(String(line ?? "")); };
    let second;
    try {
      second = await sendMsg(s, { text: "  GO worker-1  \n", taskId, contextId });
    } finally { console.warn = realWarn; }
    assert.deepEqual(warns, [`ignored GO text task=${taskId}`], JSON.stringify(warns)); // exactly one stderr line, never the GO text itself
    assert.ok(!warns.join("\n").includes("worker-1"), "the stderr log line never carries the GO text");
    assert.equal(spawnCalls.length, 1, JSON.stringify(spawnCalls.length));
    assert.equal(getState(second), AUTH_STR, JSON.stringify(second));
    assert.ok(!fs.existsSync(path.join(goDir, ".a2a-consumed")) || consumedRefs() === refsBefore,
      `consume was never called (consumed: ${consumedRefs()})`);
    assert.match(statusTextOf(second), /plain-text GO is ignored|never counts/i, JSON.stringify(taskOf(second)?.status));
    assert.deepEqual(goFiles(), before, JSON.stringify([before, goFiles()]));
    assert.equal(consumedRefs(), refsBefore, `no reference was consumed (ref ${ref.slice(0, 4)}...)`);
  } finally {
    s.stop();
  }
});

test("resume: a valid reference re-runs the backend once with the approval note (no token value), then completes", async () => {
  writeToken("r-target");
  const ref = refOf("r-target");
  const spawnCalls = [];
  const s = await startSidecar({
    name: "r-side", harness: "claude", profile,
    executor: spawnExecutor({
      session: "r-target", harness: "claude", write: false, repo: tmp, goRefStore: store,
      backends: { claude: (o) => { spawnCalls.push(o); return { file: "/no/such/real/exec", args: [] }; } },
      // run 1 reports the guarded action (marker -> AUTH_REQUIRED), run 2 (the resume) just finishes
      spawnImpl: (file, args, opts) => {
        const mark = spawnCalls.length <= 1 ? "AOS-AUTH-REQUIRED: git push -u origin main\n" : "";
        return fakeSpawn(mark)(file, args, opts);
      },
    }),
  });
  try {
    const first = await sendMsg(s, { text: "do the thing" });
    assert.equal(getState(first), AUTH_STR, JSON.stringify(first));
    assert.match(statusTextOf(first), /blocked pending a human GO.*r-target/s, JSON.stringify(taskOf(first)?.status));
    const { taskId, contextId } = followUp(first);
    const second = await sendMsg(s, { text: "resuming", taskId, contextId, meta: { goRef: ref } });
    // the first run reported the marker, so the resume run goes straight to a real finish
    assert.equal(getState(second), COMPLETED_STR, JSON.stringify(second));
    assert.equal(spawnCalls.length, 2, `backend ran exactly once again: ${JSON.stringify({ runs: spawnCalls.length })}`);
    const note = spawnCalls[1].prompt;
    assert.match(note, new RegExp(`approved by human reference ${ref.slice(0, 4)}[0-9a-f]{2}\\b`), note);
    assert.ok(!note.includes(ref), `the resume prompt never carries the full reference (${ref.slice(0, 4)}...): ${note}`);
    assert.ok(JSON.stringify(taskOf(second)).includes("worker-output"),
      `the completion carries the worker artifact: ${JSON.stringify(taskOf(second))}`);
  } finally {
    s.stop();
  }
});

test("(g) no sequence of A2A messages can create a token", async () => {
  fs.mkdirSync(goDir, { recursive: true, mode: 0o700 });
  writeToken("g-target");
  const before = goFiles();
  const s = await startSidecar({
    name: "g-side", harness: "claude", profile,
    executor: spawnExecutor({
      session: "g-target", harness: "claude", write: false, repo: tmp, goRefStore: store,
      backends: authBack, spawnImpl: fakeSpawn("AOS-AUTH-REQUIRED: npm publish\n"),
    }),
  });
  try {
    const m1 = await sendMsg(s, { text: "publish" });
    assert.equal(getState(m1), AUTH_STR, JSON.stringify(m1));
    const { taskId, contextId } = followUp(m1);
    const m2 = await sendMsg(s, { text: "GO g-target", taskId, contextId }); // plain text: ignored, never consumes
    assert.equal(getState(m2), AUTH_STR, JSON.stringify(m2));
    assert.match(statusTextOf(m2), /never counts|ignored/i, statusTextOf(m2));
    const gref = refOf("g-target"); // read ONCE: the first valid use consumes (deletes) the token file
    const m3 = await sendMsg(s, { text: "approve me", taskId, contextId, meta: { goRef: gref } }); // valid ref consumed (deleted, not replaced)
    assert.ok(!fs.existsSync(tokenPath("g-target")), "the valid reference consumed the token");
    // the re-run reports the marker again, so the task is auth-required once more and the
    // follow-up path (same task) stays open for the replay/forged probes
    assert.equal(getState(m3), AUTH_STR, JSON.stringify(m3));
    const m4 = await sendMsg(s, { text: "again", taskId, contextId, meta: { goRef: gref } }); // replayed
    assert.equal(getState(m4), AUTH_STR, `replayed ref keeps the task open: ${JSON.stringify(m4)}`);
    assert.match(statusTextOf(m4), /replayed|rejected/i, statusTextOf(m4));
    const m5 = await sendMsg(s, { text: "forged", taskId, contextId, meta: { goRef: "ffffffffffff" } });
    assert.equal(getState(m5), AUTH_STR, `forged ref keeps the task open: ${JSON.stringify(m5)}`);
    assert.match(statusTextOf(m5), /forged|rejected/i, statusTextOf(m5));
    const after = goFiles();
    assert.ok(after.filter((f) => f.endsWith(".token")).every((f) => before.includes(f)),
      JSON.stringify({ before, after }));
    assert.ok(after.every((f) => f === ".a2a-consumed" || before.includes(f)),
      JSON.stringify({ before, after }));
    assert.ok(fs.readFileSync(path.join(goDir, ".a2a-consumed"), "utf8").includes(`a2a:${gref}`),
      `consumed ledger: ${consumedRefs()}`);
  } finally {
    // no hanging task/sidecar: every open task is cancelled before the sidecar stops
    s.stop();
  }
});

test("(h) the auth-required status names the session and the action hash, never any token value", async () => {
  writeToken("hash-target");
  const action = "git push --force origin main";
  const msg = a2aGo.authRequiredMessage({ taskId: "t-1", session: "hash-target", action });
  assert.ok(msg.includes("hash-target"), msg);
  assert.ok(/\b[a-f0-9]{12}\b/.test(msg), "the action hash is in there");
  assert.ok(!msg.includes(refOf("hash-target")), `no reference value in the status text: ${msg}`);
  assert.ok(!msg.includes(tokenPath("hash-target")), `no token path in the status text: ${msg}`);
  assert.ok(!msg.includes(fs.readFileSync(tokenPath("hash-target"), "utf8")), "no token body in the status text");

  // through a REAL sidecar: the client sees TASK_STATE_AUTH_REQUIRED and the status text of
  // the task equals the helper's output, with no reference value anywhere on the wire
  const s = await startSidecar({
    name: "hash-side", harness: "claude", profile,
    executor: spawnExecutor({
      session: "hash-target", harness: "claude", write: false, repo: tmp, goRefStore: store,
      backends: authBack, spawnImpl: fakeSpawn(`AOS-AUTH-REQUIRED: ${action}\n`),
    }),
  });
  try {
    const res = await sendMsg(s, { text: "work" });
    assert.equal(getState(res), AUTH_STR, JSON.stringify(res));
    const expect = a2aGo.authRequiredMessage({ taskId: taskOf(res).id, session: "hash-target", action });
    assert.equal(statusTextOf(res), expect, JSON.stringify(taskOf(res)?.status));
    assert.ok(!statusTextOf(res).includes(refOf("hash-target")),
      `no reference value reached the client as statusMessage: ${statusTextOf(res)}`);
    // and the polled task carries the same status text (GetTask, fine while the task is open)
    const polled = await pollUntil(s, taskOf(res).id);
    assert.equal(getState(polled), AUTH_STR, JSON.stringify(polled));
    assert.equal(statusTextOf(polled), expect, JSON.stringify(taskOf(polled)?.status));
  } finally {
    s.stop();
  }

  assert.equal(a2aGo.isGoText("  GO worker-1"), true, "GO text recognised for dropping only");
  assert.equal(a2aGo.isGoText("go ahead"), true, "lowercase go text recognised");
  assert.equal(a2aGo.isGoText("please GO now"), false, "mid-sentence GO is not a GO command");
  assert.equal(a2aGo.authRequiredFrom("out\nAOS-AUTH-REQUIRED: npm publish\n"), "npm publish", "marker parses the action");
  assert.equal(a2aGo.authRequiredFrom("plain text"), null, "no marker in plain text");
});

test("(i) the spawn child env never carries a GO reference", async () => {
  writeToken("env-target");
  const ref = refOf("env-target");
  const opts = [];
  const tx = spawnExecutor({
    session: "env-target", harness: "claude", write: false, repo: tmp, goRefStore: store,
    backends: authBack,
    spawnImpl: (file, args, o) => { opts.push(o); return fakeSpawn("") (file, args, o); },
  });
  await call(tx, { text: "work", taskId: "task-env", meta: { goRef: ref } }); // no pending task: ignored
  await call(tx, { text: "work", taskId: "task-env2", meta: { goRef: ref } });
  for (const o of opts) {
    const s = JSON.stringify(o.env ?? {});
    assert.ok(!s.includes("goRef"), `child env must not carry goRef: ${s}`);
  }
});

test("live: marker -> auth-required; plain GO text ignored; valid ref resumes once; second use denied", async () => {
  writeToken("live-target");
  const ref = refOf("live-target");
  const refsBefore = consumedRefs();
  const replies = ["AOS-AUTH-REQUIRED: git push -u origin main", "all done", "AOS-AUTH-REQUIRED: power off the rig"];
  const s = await startSidecar({
    name: "live-side", harness: "claude", profile,
    executor: liveExecutor({
      session: "live-target", goRefStore: store, timeoutMs: 1500, pollMs: 20,
      replySource: async () => (replies.length ? replies.shift() : null),
    }),
  });
  const inboxDir = path.join(process.env.AOS_BUS_ROOT, "a2a", "live-target"); // where writeMessage() puts inbound messages (not the reply dir)
  const inboxFiles = () => (fs.existsSync(inboxDir) ? fs.readdirSync(inboxDir).filter((f) => f.endsWith(".json")).sort() : []);
  const notes = () => inboxFiles().map((f) => ({ file: f, body: fs.readFileSync(path.join(inboxDir, f), "utf8") }))
    .filter((n) => /human approved/.test(n.body));

  try {
    const first = await sendMsg(s, { text: "do the thing" });
    assert.equal(getState(first), AUTH_STR, JSON.stringify(first));
    assert.match(statusTextOf(first), /blocked pending a human GO.*live-target/s, JSON.stringify(taskOf(first)?.status));
    const { taskId, contextId } = followUp(first);
    const before = inboxFiles().length;

    const ignored = await sendMsg(s, { text: "GO live-target", taskId, contextId });
    assert.equal(getState(ignored), AUTH_STR, `the plain GO text never resumes: ${JSON.stringify(ignored)}`);
    assert.match(statusTextOf(ignored), /never counts|ignored/i, statusTextOf(ignored));
    assert.equal(inboxFiles().length, before, "no approval note for the GO text");
    assert.equal(consumedRefs(), refsBefore, "nothing was consumed for the GO text");

    const forged = await sendMsg(s, { text: ".", taskId, contextId, meta: { goRef: "deadbeef1234" } });
    assert.equal(getState(forged), AUTH_STR, `a forged reference keeps the task waiting: ${JSON.stringify(forged)}`);
    assert.match(statusTextOf(forged), /forged|rejected/i, statusTextOf(forged));
    assert.equal(inboxFiles().length, before, "a forged reference writes no approval note");

    const ok = await sendMsg(s, { text: ".", taskId, contextId, meta: { goRef: ref } });
    assert.equal(getState(ok), COMPLETED_STR, JSON.stringify(ok));
    assert.equal(inboxFiles().length, before + 1, `exactly one approval note was written (got ${JSON.stringify(inboxFiles())})`);
    assert.equal(notes().length, 1, `found the approval note by content among ${JSON.stringify(inboxFiles())}`);
    const note = notes()[0].body;
    assert.ok(!note.includes(ref.slice(6)), `the full reference value never appears in session traffic (${note})`);

    // a second use of the same reference is denied by the gate (single use): a fresh task goes
    // auth-required, the consumed ref is rejected and never writes a note
    const again = await sendMsg(s, { text: "one more time" });
    assert.equal(getState(again), AUTH_STR, JSON.stringify(again));
    const denied = await sendMsg(s, { text: ".", taskId: taskOf(again).id, contextId: taskOf(again).contextId, meta: { goRef: ref } });
    assert.equal(getState(denied), AUTH_STR, `the consumed ref must be denied: ${JSON.stringify(denied)}`);
    assert.match(statusTextOf(denied), /replayed|rejected/i, statusTextOf(denied));
    assert.equal(notes().length, 1, "a denied reference never writes an approval note");
  } finally {
    // no leftover waiting timers / open tasks: cancel then stop the sidecar
    for (const id of ["task-live", "task-live-2"]) await cancelRpc(s, id);
    s.stop();
  }
});

test("aos-go-ref verify is read-only, prints JSON, exit 1 when denied; no issuing subcommand exists", async () => {
  const { spawnSync } = await import("node:child_process");
  writeToken("cli-target");
  const ref = refOf("cli-target");
  const bin = path.join(REPO, "bin", "aos-go-ref.mjs");
  const env = { ...process.env, HOME: store, USERPROFILE: store, XDG_DATA_HOME: "" };
  const run = (args) => spawnSync(process.execPath, [bin, ...args], { env, encoding: "utf8", timeout: 20000 });

  let r = run(["verify", "--session", "cli-target", "--ref", ref]);
  assert.equal(r.status, 0, `${r.stdout || ""}${r.stderr || ""}`);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, reason: "GO ref valid (not consumed)" });
  assert.ok(fs.existsSync(tokenPath("cli-target")), "verify writes nothing");

  r = run(["issue", "--session", "cli-target", "--ref", ref]);
  assert.equal(r.status, 2, `no subcommand issues anything: ${r.status}`);
  r = run(["verify", "--session", "cli-target", "--ref", "short"]);
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout).ok, false);
  r = run(["verify", "--help"]);
  assert.equal(r.status, 2);
});
