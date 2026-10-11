import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const tmp = mkdtempSync(join(tmpdir(), "a2a-client-"));
process.env.AOS_SESSIONS_DIR = join(tmp, "sessions");
process.env.AOS_A2A_INBOX = join(tmp, "inbox");

const profile = (roleKey = "research") => ({
  orchestrator: { harness: "claude", model: "opus" },
  roles: {
    [roleKey]: { harness: "claude", model: "flash", write: false, mode: "spawn" },
  },
  default: { harness: "claude", model: "opus", write: true, mode: "live" },
});

const sidecar = await import("../lib/a2a-sidecar.mjs");
const client = await import("../lib/a2a-client.mjs");

test("send({to}) against echo sidecar completes with matching artifact", async () => {
  const s = await sidecar.startSidecar({ name: "c1", harness: "claude", profile: profile() });
  try {
    const res = await client.send({ to: "c1", text: "hello a2a" });
    assert.equal(res.state, "TASK_STATE_COMPLETED");
    assert.ok(res.artifacts.some((a) => a.text.includes("hello a2a")), JSON.stringify(res));
  } finally { s.stop(); }
});

test("send({role}) resolves via card skill id", async () => {
  const s = await sidecar.startSidecar({ name: "c2", harness: "claude", profile: profile("echo") });
  try {
    const res = await client.send({ role: "echo", text: "via role" });
    assert.equal(res.state, "TASK_STATE_COMPLETED");
    assert.ok(res.artifacts.some((a) => a.text.includes("via role")));
  } finally { s.stop(); }
});

test("depth limit rejects via AOS_DELEGATE_DEPTH and MCSC_DEPTH alone", async () => {
  const s = await sidecar.startSidecar({ name: "c3", harness: "claude", profile: profile() });
  try {
    process.env.AOS_DELEGATE_DEPTH = "1";
    await assert.rejects(client.send({ to: "c3", text: "x" }), /A2A depth limit reached/);
    delete process.env.AOS_DELEGATE_DEPTH;
    process.env.MCSC_DEPTH = "1";
    await assert.rejects(client.send({ to: "c3", text: "x" }), /A2A depth limit reached/);
    delete process.env.MCSC_DEPTH;
  } finally { s.stop(); }
});

test("send to unknown name errors quickly", async () => {
  await assert.rejects(client.send({ to: "nope", text: "x" }), /no live registry entry/);
});

test("reply() writes 0600 file and rejects > 8 KiB", () => {
  const out = client.reply({ name: "agent1", taskId: "t1", text: "the answer" });
  const mode = statSync(out.path).mode & 0o777;
  if (process.platform !== "win32") assert.equal(mode, 0o600);
  assert.throws(() => client.reply({ name: "agent1", taskId: "t2", text: "x".repeat(9000) }), /8 KiB/);
});

// Lazy-import trick: register() (node:module) installs a resolve hook (--import'ed by the child via
// NODE_OPTIONS) that throws for "@a2a-js/sdk" specifiers. list/card/--help must still exit 0 because
// they never import the SDK; send must fail with "A2A SDK missing".
test("lazy SDK import: node bin/aos-a2a.mjs help/list work with SDK unresolvable", async () => {
  const hooks = join(tmp, "sdk-block-hooks.mjs");
  writeFileSync(hooks, `export async function resolve(specifier, context, next) {
  if (specifier === "@a2a-js/sdk" || specifier.startsWith("@a2a-js/sdk/")) throw new Error("blocked: mock unresolvable SDK");
  return next(specifier, context);
}\n`);
  const register = join(tmp, "sdk-block-register.mjs");
  writeFileSync(register, `import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`);
  const env = { ...process.env, NODE_OPTIONS: `--import ${pathToFileURL(register).href}` };
  const bin = fileURLToPath(new URL("../bin/aos-a2a.mjs", import.meta.url));

  const help = await run(process.execPath, [bin, "--help"], env);
  assert.equal(help.code, 0, help.stderr);
  const list = await run(process.execPath, [bin, "list", "--json"], env);
  assert.equal(list.code, 0, list.stderr);
  const send = await run(process.execPath, [bin, "send", "--to", "x", "hi"], env);
  assert.notEqual(send.code, 0);
  assert.match(send.stderr, /A2A SDK missing/);
});

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env });
    let stdout = ""; let stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// --- WP-CLIENT-POLL: long sends must not hold one blocking request (undici headersTimeout 300 s). ---

const noSleep = () => new Promise((r) => setTimeout(r, 0));

// Sidecar executor that publishes SUBMITTED immediately, waits, then finishes (or fails) as scripted.
// Event order mirrors lib/a2a-live.mjs exactly: the FIRST event must be AgentEvent.task (the SDK's
// ResultManager.applyStatusUpdate drops status updates for a task that is not yet in the store, so a
// bare leading statusUpdate would leave the task un-persisted and the poll path would never see it).
function scriptedExecutor({ delayMs = 0, outcome = "complete", message = "", taskFile = null } = {}) {
  let contextId = "";
  return {
    async execute(ctx, bus) {
      contextId = ctx.contextId;
      if (taskFile) { try { writeFileSync(taskFile, String(ctx.taskId ?? "")); } catch { /* best effort */ } }
      const { TaskState, Role } = await import("@a2a-js/sdk");
      const { AgentEvent } = await import("@a2a-js/sdk/server");
      const base = { taskId: ctx.taskId, contextId: ctx.contextId, metadata: undefined };
      const text = (t) => ({ content: { $case: "text", value: t }, metadata: undefined, filename: "", mediaType: "text/plain" });
      bus.publish(AgentEvent.task({
        id: ctx.taskId, contextId: ctx.contextId, artifacts: [], history: [ctx.userMessage], metadata: undefined,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: new Date().toISOString() },
      }));
      await new Promise((r) => setTimeout(r, delayMs));
      const msg = {
        messageId: crypto.randomUUID(), contextId: ctx.contextId, taskId: ctx.taskId, role: Role.ROLE_AGENT,
        parts: [text(message)], metadata: undefined, extensions: [], referenceTaskIds: [],
      };
      if (outcome === "fail") {
        bus.publish(AgentEvent.statusUpdate({
          ...base, status: { state: TaskState.TASK_STATE_FAILED, message: msg, timestamp: new Date().toISOString() },
        }));
        bus.finished();
        return;
      }
      bus.publish(AgentEvent.artifactUpdate({
        ...base, append: false, lastChunk: true,
        artifact: { artifactId: crypto.randomUUID(), name: "echo", description: "echoed input", parts: [text(message)], metadata: undefined, extensions: [] },
      }));
      bus.publish(AgentEvent.statusUpdate({
        ...base, status: { state: TaskState.TASK_STATE_COMPLETED, message: msg, timestamp: new Date().toISOString() },
      }));
      bus.finished();
    },
    async cancelTask(_id, bus) {
      const { TaskState } = await import("@a2a-js/sdk");
      const { AgentEvent } = await import("@a2a-js/sdk/server");
      // _id is the bare task id; the context is lost here, so re-derive nothing — just publish canceled.
      bus.publish(AgentEvent.statusUpdate({
        taskId: _id, contextId, metadata: undefined,
        status: { state: TaskState.TASK_STATE_CANCELED, message: undefined, timestamp: new Date().toISOString() },
      }));
      bus.finished();
    },
  };
}

test("polling path: slow task completes with the same result shape as the blocking path", async () => {
  const s = await sidecar.startSidecar({
    name: "cp1", harness: "claude", profile: profile(),
    executor: scriptedExecutor({ delayMs: 1500, message: "slow hello" }),
  });
  process.env.AOS_A2A_POLL_THRESHOLD_MS = "0"; // force the polling path
  try {
    const res = await client.send({ to: "cp1", text: "poll me" });
    assert.equal(res.state, "TASK_STATE_COMPLETED", `polling result state (res=${JSON.stringify(res)})`);
    assert.ok(res.taskId, `polling result taskId (res=${JSON.stringify(res)})`);
    assert.ok(res.contextId, `polling result contextId (res=${JSON.stringify(res)})`);
    assert.ok(res.artifacts.some((a) => a.text.includes("slow hello")), `polling result artifact text (artifacts=${JSON.stringify(res.artifacts)})`);
    assert.ok(res.statusMessage, `polling result statusMessage (res=${JSON.stringify(res)})`);
  } finally { s.stop(); delete process.env.AOS_A2A_POLL_THRESHOLD_MS; }
});

test("polling path: failing task returns FAILED with its status message", async () => {
  const s = await sidecar.startSidecar({
    name: "cp2", harness: "claude", profile: profile("cpfail"),
    executor: scriptedExecutor({ delayMs: 300, outcome: "fail", message: "worker exploded" }),
  });
  process.env.AOS_A2A_POLL_THRESHOLD_MS = "0";
  try {
    const res = await client.send({ to: "cp2", text: "break" });
    assert.equal(res.state, "TASK_STATE_FAILED", `failing task state (res=${JSON.stringify(res)})`);
    assert.equal(res.statusMessage, "worker exploded", `FAILED statusMessage (res=${JSON.stringify(res)})`);
  } finally { s.stop(); delete process.env.AOS_A2A_POLL_THRESHOLD_MS; }
});

test("polling path: timeout cancels the task and throws the timeout error", async () => {
  const taskFile = join(tmp, "cp3-taskid");
  const s = await sidecar.startSidecar({
    name: "cp3", harness: "claude", profile: profile(),
    executor: scriptedExecutor({ delayMs: 4000, message: "never seen", taskFile }),
  });
  process.env.AOS_A2A_POLL_THRESHOLD_MS = "0";
  try {
    await assert.rejects(
      client.send({ to: "cp3", text: "too slow", timeoutMs: 700 }),
      (e) => { assert.equal(e?.name, "TimeoutError", `timeout error name (err=${String(e)})`); assert.match(String(e?.message), /timed out after 700 ms/, `timeout message (err=${String(e)})`); return true; },
      "send must throw the timeout error on deadline",
    );
    // let the sidecar's cancel handler settle before checking state
    await new Promise((r) => setTimeout(r, 200));
    const taskId = readFileSync(taskFile, "utf8");
    assert.ok(taskId, "executor must have written the task id to the task file");
    const st = await client.status({ to: "cp3", taskId });
    assert.equal(st.state, "TASK_STATE_CANCELED", `task state after timeout cancel (st=${JSON.stringify(st)})`);
  } finally { s.stop(); delete process.env.AOS_A2A_POLL_THRESHOLD_MS; }
});

test("withTransientRetry: retries consecutive failures, resets on success, throws past budget", async () => {
  let calls = 0;
  const ok = await client.withTransientRetry(() => {
    calls += 1;
    if (calls < 2) throw new Error("fetch failed");
    return "value";
  }, { sleepFn: noSleep });
  assert.equal(ok, "value", `transient failure is retried (calls=${calls})`);

  let n = 0;
  await assert.rejects(
    client.withTransientRetry(() => {
      n += 1; throw new Error(`down ${n}`);
    }, { maxRetries: 3, sleepFn: noSleep }),
    /down 4/,
    `4th consecutive failure must throw the last error (n=${n})`,
  );

  // consecutive-failure budget counts per retry run: two failures then a success resolves with the
  // success value (a success clears the retry loop; the budget never carries over)
  let m = 0;
  const out = await client.withTransientRetry(() => {
    m += 1;
    if (m === 1 || m === 2) throw new Error("fetch failed");
    return m;
  }, { sleepFn: noSleep });
  assert.equal(out, 3, `failures then success resolves with the success value (m=${m})`);
});

// --- WP-A2A-MCP-4 (B1): send() accepts an explicit `depth` option. Effective current depth is
// max(env depth, options.depth); the limit check (effective >= AOS_A2A_MAX_DEPTH) fires BEFORE any
// target resolution or network call, so the rejection is provably the client's own check. ---
test("send({depth}) rejects at/before AOS_A2A_MAX_DEPTH before touching the registry", async () => {
  const restore = {
    AOS_DELEGATE_DEPTH: process.env.AOS_DELEGATE_DEPTH,
    MCSC_DEPTH: process.env.MCSC_DEPTH,
    AOS_A2A_MAX_DEPTH: process.env.AOS_A2A_MAX_DEPTH,
  };
  delete process.env.AOS_DELEGATE_DEPTH;
  delete process.env.MCSC_DEPTH;
  delete process.env.AOS_A2A_MAX_DEPTH;
  try {
    // depth 1 == default max -> refused, and explicitly NOT with the unknown-peer error the call
    // would otherwise produce (proves the depth check runs first)
    await assert.rejects(client.send({ to: "no-depth-target-x", text: "x", depth: 1 }), /A2A depth limit reached/);
    await assert.rejects(client.send({ to: "no-depth-target-x", text: "x", depth: 2 }), /A2A depth limit reached/);
    // depth 0 (or unset) does not trigger the client limit: the error is the ordinary target error
    await assert.rejects(client.send({ to: "no-depth-target-x", text: "x", depth: 0 }), /no live registry entry/);
    await assert.rejects(client.send({ to: "no-depth-target-x", text: "x" }), /no live registry entry/);
    // a negative depth option cannot buy depth back: it fails plain
    await assert.rejects(client.send({ to: "no-depth-target-x", text: "x", depth: -5 }), /no live registry entry/);
  } finally {
    for (const [k, v] of Object.entries(restore)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("send({depth}) combines with the env depth (higher wins) and stamps effective + 1", async () => {
  const restore = {
    AOS_DELEGATE_DEPTH: process.env.AOS_DELEGATE_DEPTH,
    AOS_A2A_MAX_DEPTH: process.env.AOS_A2A_MAX_DEPTH,
  };
  try {
    process.env.AOS_DELEGATE_DEPTH = "0";
    process.env.AOS_A2A_MAX_DEPTH = "3";
    // env 0 + option 2 -> effective 2, stamped 3 (max 3 refuses effective 3, so 2 is the deepest send)
    const s = await sidecar.startSidecar({ name: "cpdepth", harness: "claude", profile: profile() });
    try {
      // The metadata depth is not directly observable through the echo, but send must NOT be
      // refused at effective 2 < max 3 even though env depth is only 0.
      const res = await client.send({ to: "cpdepth", text: "depth via option", depth: 2 });
      assert.equal(res.state, "TASK_STATE_COMPLETED", `depth-option send below max must complete (res=${JSON.stringify(res)})`);
    } finally { s.stop(); }
    process.env.AOS_DELEGATE_DEPTH = "3";
    await assert.rejects(client.send({ to: "cpdepth-gone", text: "x" }), /A2A depth limit reached/);
  } finally {
    for (const [k, v] of Object.entries(restore)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
