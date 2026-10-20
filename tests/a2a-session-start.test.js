// WP-HOOK: session-start sidecar starter (unit tests with an injected spawnImpl).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.AOS_SESSIONS_DIR = mkdtempSync(join(tmpdir(), "aos-a2a-sess-"));

const { ensureSidecar, sessionName, resolveHarnessPid } = await import("../lib/a2a-session.mjs");
const { sessionsDir } = await import("../lib/a2a-registry.mjs");

const SESSION_ID = "ABCD1234-efgh";
const harness = "opencode";

const fakeChild = (pid = 424242) => ({ pid, unref: () => {} });

test("sessionName honours AOS_A2A_NAME and the harness-8ch default", () => {
  assert.equal(sessionName({ harness, sessionId: SESSION_ID, env: {} }), "opencode-abcd1234");
  assert.equal(sessionName({ harness, sessionId: SESSION_ID, env: { AOS_A2A_NAME: "my-peer" } }), "my-peer");
  // lowercased, non [a-z0-9._-] stripped
  const n = sessionName({ harness: "Claude", sessionId: "ABC!DEF12XYZ", env: {} });
  assert.equal(n, "claude-abcdef12");
  assert.match(n, /^[a-z0-9._-]+$/);
});

test("spawn args: detached, stdio ignore, exact args, proxy vars stripped, unref called", () => {
  const calls = [];
  const r = ensureSidecar({
    harness,
    sessionId: SESSION_ID,
    parentPid: 123,
    env: { HTTP_PROXY: "http://p:1", https_proxy: "http://p:2", ALL_PROXY: "x", HOME: "/tmp/h", PATH: "/bin" },
    spawnImpl: (cmd, args, opts) => {
      calls.push({ cmd, args, opts, child: fakeChild() });
      return calls[calls.length - 1].child;
    },
    binPath: "/repo/bin/aos-a2a.mjs",
  });
  assert.equal(r.started, true);
  assert.equal(r.name, "opencode-abcd1234");
  assert.equal(r.pid, 424242);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.cmd, process.execPath);
  assert.deepEqual(c.args, ["/repo/bin/aos-a2a.mjs", "serve", "--name", "opencode-abcd1234", "--harness", "opencode", "--mode", "live", "--parent-pid", "123"]);
  assert.equal(c.opts.detached, true);
  assert.equal(c.opts.stdio[0], "ignore"); // stdout/stderr go to <name>.log (a fd), never to the harness
  assert.equal(c.opts.stdio[1], c.opts.stdio[2]);
  assert.equal(c.opts.env.HTTP_PROXY, undefined);
  assert.equal(c.opts.env.https_proxy, undefined);
  assert.equal(c.opts.env.ALL_PROXY, undefined);
  assert.equal(c.opts.env.PATH, "/bin");
  let unrefd = false;
  // unref was called on the returned child
  const child2 = { pid: 5, unref: () => { unrefd = true; } };
  ensureSidecar({ harness, sessionId: "OTHER-session-2", env: {}, spawnImpl: () => child2, binPath: "/b" });
  assert.equal(unrefd, true);
});

test("skips when AOS_A2A_SIDECAR=off or AOS_DELEGATE_DEPTH>0", () => {
  const spawnImpl = () => { throw new Error("must not spawn"); };
  assert.ok(ensureSidecar({ harness, sessionId: SESSION_ID, env: { AOS_A2A_SIDECAR: "off" }, spawnImpl }).skipped);
  assert.ok(ensureSidecar({ harness, sessionId: SESSION_ID, env: { AOS_DELEGATE_DEPTH: "1" }, spawnImpl }).skipped);
});

test("idempotent: live pidfile → skipped 'running'; dead pid → spawn and overwrite", () => {
  const dir = sessionsDir();
  const name = "opencode-livepidx";
  const pidfile = join(dir, `${name}.pid`);
  writeFileSync(pidfile, String(process.pid), { mode: 0o600 });
  chmodSync(pidfile, 0o600);
  let spawned = 0;
  const r1 = ensureSidecar({ harness, sessionId: "livepidxx", env: {}, spawnImpl: () => { spawned++; return fakeChild(); }, binPath: "/b" });
  assert.equal(r1.skipped, "running");
  assert.equal(r1.name, name);
  assert.equal(spawned, 0);

  writeFileSync(pidfile, "2147483646", { mode: 0o600 }); // dead pid
  const r2 = ensureSidecar({ harness, sessionId: "livepidxx", env: {}, spawnImpl: () => { spawned++; return fakeChild(777); }, binPath: "/b" });
  assert.equal(r2.started, true);
  assert.equal(spawned, 1);
  assert.equal(readFileSync(pidfile, "utf8").trim(), "777");
});

test("never throws: spawnImpl failure → {skipped:'error'}", () => {
  const r = ensureSidecar({ harness, sessionId: "boom-session", env: {}, spawnImpl: () => { throw new Error("nope"); }, binPath: "/b" });
  assert.equal(r.skipped, "error");
  assert.match(r.error, /nope/);
});

test("nodeCommand: a non-node host binary (OpenCode) falls back to `node`", async () => {
  const { nodeCommand } = await import("../lib/a2a-session.mjs");
  assert.equal(nodeCommand("/usr/local/bin/node"), "/usr/local/bin/node");
  assert.equal(nodeCommand("C:\\Program Files\\nodejs\\node.exe"), "C:\\Program Files\\nodejs\\node.exe");
  assert.equal(nodeCommand("/Users/x/.opencode/bin/opencode"), "node");
});

test("codex mode: sidecar started with --mode codex --thread <session id>; missing thread or unknown mode is refused", () => {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { pid: 9, unref: () => {} }; };
  const r = ensureSidecar({ harness: "codex", sessionId: "01a11275-5405-78a1", parentPid: 77, mode: "codex", thread: "01a11275-5405-78a1", env: {}, spawnImpl, binPath: "/b/aos-a2a.mjs" });
  assert.equal(r.started, true);
  assert.equal(r.name, "codex-01a11275");
  assert.deepEqual(calls[0].args, ["/b/aos-a2a.mjs", "serve", "--name", "codex-01a11275", "--harness", "codex", "--mode", "codex", "--parent-pid", "77", "--thread", "01a11275-5405-78a1"]);
  assert.equal(ensureSidecar({ harness: "codex", sessionId: "x1", parentPid: 1, mode: "codex", env: {}, spawnImpl }).skipped, "error");
  assert.equal(ensureSidecar({ harness: "claude", sessionId: "x2", parentPid: 1, mode: "bogus", env: {}, spawnImpl }).skipped, "error");
  assert.equal(calls.length, 1, "no spawn for the refused calls");
});

test("agy: default sidecar mode is the resume executor (--mode agy); AOS_A2A_AGY_MODE=live opts back; other harnesses stay live", async () => {
  const { defaultMode, SIDECAR_MODES } = await import("../lib/a2a-session.mjs");
  assert.deepEqual(SIDECAR_MODES, ["live", "agy", "codex"]);
  assert.equal(defaultMode("agy", {}), "agy");
  assert.equal(defaultMode("AGY", {}), "agy");
  assert.equal(defaultMode("agy", { AOS_A2A_AGY_MODE: "live" }), "live");
  assert.equal(defaultMode("agy", { AOS_A2A_AGY_MODE: "bogus" }), "agy");
  for (const h of ["claude", "opencode", "codex"]) assert.equal(defaultMode(h, {}), "live");

  const calls = [];
  const spawnImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { pid: 11, unref: () => {} }; };
  const r = ensureSidecar({ harness: "agy", sessionId: "6098ec7e-09a8", parentPid: 55, env: {}, spawnImpl, binPath: "/b/aos-a2a.mjs" });
  assert.equal(r.started, true);
  assert.equal(r.name, "agy-6098ec7e");
  assert.deepEqual(calls[0].args, ["/b/aos-a2a.mjs", "serve", "--name", "agy-6098ec7e", "--harness", "agy", "--mode", "agy", "--parent-pid", "55"]);
  assert.ok(!calls[0].args.includes("--continue"), "the sidecar never resumes the user's chat");

  ensureSidecar({ harness: "agy", sessionId: "7098ec7e-09a8", parentPid: 55, env: { AOS_A2A_AGY_MODE: "live" }, spawnImpl, binPath: "/b/aos-a2a.mjs" });
  assert.equal(calls[1].args[calls[1].args.indexOf("--mode") + 1], "live");
  ensureSidecar({ harness: "agy", sessionId: "8098ec7e-09a8", parentPid: 55, mode: "agy", env: {}, spawnImpl, binPath: "/b/aos-a2a.mjs" });
  assert.equal(calls[2].args[calls[2].args.indexOf("--mode") + 1], "agy");
});

test("the sidecar env carries its own AOS_A2A_NAME, overriding an inherited one", () => {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { pid: 12, unref: () => {} }; };
  ensureSidecar({ harness: "codex", sessionId: "01a13768-aaaa", parentPid: 1, mode: "codex", thread: "01a13768-aaaa", env: { PATH: "/bin" }, spawnImpl, binPath: "/b" });
  assert.equal(calls[0].opts.env.AOS_A2A_NAME, "codex-01a13768");
  ensureSidecar({ harness: "agy", sessionId: "x", parentPid: 1, env: { AOS_A2A_NAME: "agy-researcher" }, spawnImpl, binPath: "/b" });
  assert.equal(calls[1].opts.env.AOS_A2A_NAME, "agy-researcher");
});

test("Codex SessionStart hook prints the session's own peer name as additionalContext", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const hook = join(fileURLToPath(new URL("..", import.meta.url)), ".claude", "hooks", "a2a-session.mjs");
  // a live pidfile makes ensureSidecar return { skipped: "running", name } without spawning a real sidecar
  const pidfile = join(sessionsDir(), "codex-01a13768.pid");
  writeFileSync(pidfile, String(process.pid), { mode: 0o600 });
  const env = { ...process.env, AOS_SESSIONS_DIR: sessionsDir() };
  delete env.AOS_A2A_NAME;
  delete env.AOS_A2A_SIDECAR;
  delete env.AOS_DELEGATE_DEPTH;
  delete env.MCSC_DEPTH;
  const r = spawnSync(process.execPath, [hook, "--harness", "codex"], { env, input: JSON.stringify({ session_id: "01A13768-5405-78a1" }), encoding: "utf8" });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /Your A2A peer name is codex-01a13768\./);
  assert.match(ctx, /aos-a2a reply --name codex-01a13768 <taskId>/);
  assert.match(ctx, /never a GO/);
  assert.match(readFileSync(hook, "utf8"), /process\.exitCode = 0/);
  assert.doesNotMatch(readFileSync(hook, "utf8"), /process\.exit\(/, "process.exit can drop the identity line on a Windows pipe");

  const off = spawnSync(process.execPath, [hook, "--harness", "codex"], { env: { ...env, AOS_A2A_SIDECAR: "off" }, input: JSON.stringify({ session_id: "01A13768-5405-78a1" }), encoding: "utf8" });
  assert.equal(off.status, 0);
  assert.equal(off.stdout, "", "sidecar off: no identity line");
});

test("resolveHarnessPid: win32 skips the shell wrapper and returns the harness pid", () => {
  const chain = () => "400,cmd.exe\r\n300,bash.exe\r\n200,claude.exe\r\n100,explorer.exe\r\n";
  assert.equal(resolveHarnessPid(400, { platform: "win32", chain }), 200);
});

test("resolveHarnessPid: falls back to ppid on query failure, empty or shell-only output; POSIX never queries", () => {
  assert.equal(resolveHarnessPid(400, { platform: "win32", chain: () => { throw new Error("timeout"); } }), 400);
  assert.equal(resolveHarnessPid(400, { platform: "win32", chain: () => "" }), 400);
  assert.equal(resolveHarnessPid(400, { platform: "win32", chain: () => "400,cmd.exe" }), 400);
  assert.equal(resolveHarnessPid(400, { platform: "linux", chain: () => { throw new Error("must not be called"); } }), 400);
});
