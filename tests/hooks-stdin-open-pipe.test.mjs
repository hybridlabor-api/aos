// Codex on Windows leaves the hook's stdin pipe open: every hook must still answer from one JSON payload,
// and go-gate must deny (as on unparseable input) when no payload arrives at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude", "hooks");
const LIMIT_MS = 5000;

function runOpenPipe(file, args, payload) {
  const home = mkdtempSync(join(tmpdir(), "aos-stdin-pipe-"));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AOS_A2A_SIDECAR: "off", AOS_TRAIL_BIN: join(home, "no-trail.mjs") };
  delete env.AOS_GATE_DEBUG;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [file.includes("/") ? join(HOOKS, "..", "..", file) : join(HOOKS, file), ...args], { cwd: home, env, stdio: "pipe", windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const kill = setTimeout(() => child.kill("SIGKILL"), LIMIT_MS);
    child.on("exit", (code) => {
      clearTimeout(kill);
      child.stdin.destroy();
      rmSync(home, { recursive: true, force: true });
      resolve({ code, ms: Date.now() - started, stdout, stderr });
    });
    if (payload !== undefined) child.stdin.write(`${JSON.stringify(typeof payload === "function" ? payload(home) : payload)}\n`);
  });
}

const CASES = [
  ["go-gate.mjs", [], { tool_name: "Bash", tool_input: { command: "ls" }, session_id: "pipe-test" }],
  ["graph-gate.mjs", [], (home) => ({ cwd: home, session_id: "pipe-test" })],
  ["env-file-protection.mjs", [], (home) => ({ tool_name: "Write", tool_input: { file_path: join(home, "a.txt"), content: "x" } })],
  ["conventional-commits.mjs", [], { tool_name: "Bash", tool_input: { command: "ls" } }],
  ["go-token.mjs", [], { prompt: "hello", session_id: "pipe-test" }],
  ["go-grant.mjs", [], { prompt: "hello", session_id: "pipe-test" }],
  ["a2a-session.mjs", [], { hook_event_name: "SessionStart", session_id: "pipe-test" }],
  ["a2a-inbox.mjs", ["drain"], { hook_event_name: "UserPromptSubmit", session_id: "pipe-test" }],
  ["memb-inject.mjs", [], (home) => ({ hook_event_name: "UserPromptSubmit", prompt: "hello", cwd: home, session_id: "pipe-test" })],
  ["aos-session-hint.mjs", [], { hook_event_name: "SessionStart", session_id: "pipe-test" }],
  ["trail-autostart.mjs", [], { tool_name: "Read", session_id: "pipe-test" }],
  ["memb-session-save.mjs", [], (home) => ({ session_id: "pipe-test", transcript_path: join(home, "missing.jsonl") })],
  // Repo-relative: the Codex UserPromptSubmit workflow and the agy PreInvocation hook read stdin the same way.
  [".claude/workflows/fabric-dispatch.mjs", [], { hook_event_name: "UserPromptSubmit", prompt: "hello", session_id: "pipe-test" }],
  ["agy-hooks/a2a-inbox.mjs", [], { invocationNum: 1, conversationId: "pipe-test" }],
];

for (const [file, args, payload] of CASES) {
  test(`${file} answers one JSON payload on an open stdin pipe`, async () => {
    const r = await runOpenPipe(file, args, payload);
    assert.ok(r.ms < LIMIT_MS, `${file} hung on an open pipe (${r.ms} ms)`);
    assert.equal(r.code, 0, `${file} exit ${r.code}: ${r.stderr}`);
  });
}

test("go-gate denies like unparseable input when an open pipe carries no payload", async () => {
  const r = await runOpenPipe("go-gate.mjs", [], undefined);
  assert.ok(r.ms < LIMIT_MS, `go-gate hung on an open pipe (${r.ms} ms)`);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /"decision":"deny".*could not parse hook input/);
  assert.match(r.stderr, /Blocked by go-gate hook: could not parse hook input/);
});

test("go-gate denies a partial payload on an open pipe", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-stdin-pipe-"));
  try {
    const child = spawn(process.execPath, [join(HOOKS, "go-gate.mjs")], { cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: "pipe", windowsHide: true });
    const kill = setTimeout(() => child.kill("SIGKILL"), LIMIT_MS);
    child.stdin.write('{"tool_name":"Bash","tool_input":{"command":"git push');
    const code = await new Promise((resolve) => child.on("exit", resolve));
    clearTimeout(kill);
    child.stdin.destroy();
    assert.equal(code, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("env-file-protection still denies unreadable input that names the gate store on an open pipe", async () => {
  const home = mkdtempSync(join(tmpdir(), "aos-stdin-pipe-"));
  try {
    const child = spawn(process.execPath, [join(HOOKS, "env-file-protection.mjs")], { cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: "pipe", windowsHide: true });
    const kill = setTimeout(() => child.kill("SIGKILL"), LIMIT_MS);
    child.stdin.write('{"tool_input":{"file_path":"/u/.aos/gate/x.json"');
    const code = await new Promise((resolve) => child.on("exit", resolve));
    clearTimeout(kill);
    child.stdin.destroy();
    assert.equal(code, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
