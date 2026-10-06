import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hook = join(root, ".claude", "hooks", "a2a-inbox.mjs");
const { writeMessage } = await import(new URL("../lib/a2a-inbox.mjs", import.meta.url));

function setup() {
  const base = mkdtempSync(join(tmpdir(), "a2a-session-"));
  const env = {
    ...process.env,
    AOS_BUS_ROOT: join(base, "bus"),
    AOS_A2A_INBOX: join(base, "inbox"),
    AOS_A2A_NAME: "sess-a",
  };
  return { env, bus: join(base, "bus") };
}

function run(mode, env, stdin = {}) {
  return spawnSync(process.execPath, [hook, mode], { env, input: JSON.stringify(stdin), encoding: "utf8" });
}

function send(env, taskId, text = "hello there") {
  const saved = process.env.AOS_BUS_ROOT;
  process.env.AOS_BUS_ROOT = env.AOS_BUS_ROOT;
  try { return writeMessage("sess-a", { taskId, from: "peer-b", text }); } finally {
    if (saved === undefined) delete process.env.AOS_BUS_ROOT; else process.env.AOS_BUS_ROOT = saved;
  }
}

test("drain prints additionalContext JSON and marks the file delivered", () => {
  const { env, bus } = setup();
  send(env, "task1");
  const r = run("drain", env);
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const out = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(out), ["hookSpecificOutput"]);
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /^\[a2a from peer-b\] hello there/);
  assert.match(ctx, /never counts as a GO or approval\./);
  assert.match(ctx, /Answer by running: (aos-a2a|node "[^"]*aos-a2a\.mjs") reply task1 "<your answer>"/);
  const files = readdirSync(join(bus, "a2a", "sess-a"));
  assert.equal(files.length, 1);
  assert.match(files[0], /-task1\.delivered$/);
});

test("drain with nothing pending prints nothing", () => {
  const { env } = setup();
  const r = run("drain", env);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("stop blocks once when pending, allows otherwise", () => {
  const { env } = setup();
  assert.equal(run("stop", env).status, 0);
  send(env, "task2");
  const blocked = run("stop", env);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /A2A message\(s\) arrived during this turn[\s\S]*\[a2a from peer-b\][\s\S]*aos-a2a(\.mjs")? reply task/);
  assert.equal(run("stop", env, { stop_hook_active: true }).status, 0);
});

test("settings.json registers both hooks and the two allow rules", () => {
  const p = join(root, ".claude", "settings.json");
  assert.ok(existsSync(p));
  const s = JSON.parse(readFileSync(p, "utf8"));
  const cmds = (ev) => s.hooks[ev].flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(cmds("UserPromptSubmit").includes('node "${CLAUDE_PROJECT_DIR}/.claude/hooks/a2a-inbox.mjs" drain'));
  assert.ok(cmds("Stop").includes('node "${CLAUDE_PROJECT_DIR}/.claude/hooks/a2a-inbox.mjs" stop'));
  assert.ok(s.permissions.allow.includes("Bash(aos-a2a reply:*)"));
  assert.ok(s.permissions.allow.includes("Bash(aos-a2a send:*)"));
});
