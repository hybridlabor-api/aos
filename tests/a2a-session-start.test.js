// WP-HOOK: session-start sidecar starter (unit tests with an injected spawnImpl).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.AOS_SESSIONS_DIR = mkdtempSync(join(tmpdir(), "aos-a2a-sess-"));

const { ensureSidecar, sessionName } = await import("../lib/a2a-session.mjs");
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
