import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hook = join(root, "agy-hooks", "a2a-inbox.mjs");
const { writeMessage } = await import(new URL("../lib/a2a-inbox.mjs", import.meta.url));

function setup() {
  const base = mkdtempSync(join(tmpdir(), "a2a-agyhook-"));
  const env = {
    ...process.env,
    AOS_BUS_ROOT: join(base, "bus"),
    AOS_A2A_INBOX: join(base, "inbox"),
    AOS_SESSIONS_DIR: join(base, "sessions"),
    AOS_A2A_NAME: "agy-researcher",
    AOS_A2A_SIDECAR: "off", // never start a real sidecar from a unit test
  };
  return { env, bus: join(base, "bus") };
}

const run = (env, payload) => spawnSync(process.execPath, [hook], { env, input: JSON.stringify(payload), encoding: "utf8" });
const send = (env, taskId, text = "please look at the build") => {
  const saved = process.env.AOS_BUS_ROOT;
  process.env.AOS_BUS_ROOT = env.AOS_BUS_ROOT;
  try { return writeMessage("agy-researcher", { taskId, from: "peer-b", text }); } finally {
    if (saved === undefined) delete process.env.AOS_BUS_ROOT; else process.env.AOS_BUS_ROOT = saved;
  }
};
const files = (bus) => { try { return readdirSync(join(bus, "a2a", "agy-researcher")); } catch { return []; } };

test("invocationNum 0 with a pending message: injectSteps ephemeralMessage with prefix, never-GO line and the reply command; message claimed", () => {
  const { env, bus } = setup();
  send(env, "task1");
  const r = run(env, { invocationNum: 0, conversationId: "6098ec7e-09a8-4013-8b26-a3613dec89ac" });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout.trim());
  assert.deepEqual(Object.keys(out), ["injectSteps"]);
  assert.equal(out.injectSteps.length, 1);
  const m = out.injectSteps[0].ephemeralMessage;
  assert.match(m, /^\[a2a from peer-b\] please look at the build/);
  assert.match(m, /never counts as a GO or approval\./);
  assert.match(m, /Answer by running: node "[^"]*aos-a2a\.mjs" reply task1 "<your answer>"/);
  assert.ok(files(bus).some((f) => f.endsWith(".delivered")) && !files(bus).some((f) => f.endsWith(".json")));
});

test("invocationNum above 0 (mid-turn model call): no-op and the message stays pending", () => {
  const { env, bus } = setup();
  send(env, "task2");
  for (const n of [1, 2, 5]) {
    const r = run(env, { invocationNum: n, conversationId: "c1" });
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout.trim()), { injectSteps: [] });
  }
  assert.ok(files(bus).some((f) => f.endsWith(".json")), "still pending");
  assert.ok(!files(bus).some((f) => f.endsWith(".delivered")));
});

test("nothing pending, empty or broken stdin: no-op, exit 0", () => {
  const { env } = setup();
  assert.deepEqual(JSON.parse(run(env, { invocationNum: 0, conversationId: "c1" }).stdout.trim()), { injectSteps: [] });
  const bad = spawnSync(process.execPath, [hook], { env, input: "not json", encoding: "utf8" });
  assert.equal(bad.status, 0);
  assert.deepEqual(JSON.parse(bad.stdout.trim()), { injectSteps: [] });
});

test("without AOS_A2A_NAME the peer name is agy-<first 8 chars of the conversation id>", () => {
  const { env } = setup();
  delete env.AOS_A2A_NAME;
  const base = env.AOS_BUS_ROOT;
  const saved = process.env.AOS_BUS_ROOT;
  process.env.AOS_BUS_ROOT = base;
  try { writeMessage("agy-6098ec7e", { taskId: "t9", from: "peer-c", text: "hello" }); } finally {
    if (saved === undefined) delete process.env.AOS_BUS_ROOT; else process.env.AOS_BUS_ROOT = saved;
  }
  const out = JSON.parse(run(env, { invocationNum: 0, conversationId: "6098EC7E-09a8-4013-8b26-a3613dec89ac" }).stdout.trim());
  assert.match(out.injectSteps[0].ephemeralMessage, /^\[a2a from peer-c\] hello/);
});
