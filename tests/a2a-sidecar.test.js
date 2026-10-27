import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";

const tmp = mkdtempSync(join(tmpdir(), "a2a-sidecar-"));
process.env.AOS_SESSIONS_DIR = join(tmp, "sessions");

const profile = () => ({
  orchestrator: { harness: "claude", model: "opus" },
  roles: {
    research: { harness: "claude", model: "flash", write: false, mode: "spawn" },
    build: { harness: "opencode", model: "sonnet", write: true, mode: "spawn" },
  },
  default: { harness: "claude", model: "opus", write: true, mode: "live" },
});

const reg = await import("../lib/a2a-registry.mjs");
const sidecar = await import("../lib/a2a-sidecar.mjs");

const rpc = (url, token, params) => fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "A2A-Version": "1.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params }),
});

const sendText = (text) => ({
  message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text }] },
});

test("two echo sidecars: card has profile skills and bearer security scheme", async () => {
  const a = await sidecar.startSidecar({ name: "s1", harness: "claude", profile: profile() });
  const b = await sidecar.startSidecar({ name: "s2", harness: "claude", profile: profile() });
  const card = await (await fetch(a.cardUrl)).json();
  assert.ok(Array.isArray(card.skills) && card.skills.length >= 1);
  assert.ok(card.skills.some((s) => s.id === "research"));
  const schemes = card.securitySchemes ? Object.values(card.securitySchemes) : [];
  const found = schemes.some((entry) => {
    const candidates = [
      entry?.scheme?.value?.scheme,
      entry?.scheme?.scheme,
      entry?.httpAuthSecurityScheme?.scheme,
      entry?.scheme,
    ];
    return candidates.some(
      (c) => typeof c === "string" && c.toLowerCase() === "bearer",
    );
  });
  assert.ok(found, JSON.stringify(card.securitySchemes));
  a.stop(); b.stop();
});

test("SendMessage with right bearer returns completed task with artifact text", async () => {
  const s = await sidecar.startSidecar({ name: "s3", harness: "claude", profile: profile() });
  const res = await rpc(s.url, s.token, sendText("hello world"));
  assert.equal(res.status, 200);
  const body = await res.json();
  const task = body.result?.task ?? body.result;
  assert.ok(task, JSON.stringify(body));
  assert.match(String(task.status?.state ?? task.state), /TASK_STATE_COMPLETED/);
  const artText = JSON.stringify(task.artifacts ?? []);
  assert.ok(artText.includes("hello world"), artText);
  s.stop();
});

test("wrong bearer and missing bearer get 401", async () => {
  const s = await sidecar.startSidecar({ name: "s4", harness: "claude", profile: profile() });
  const wrong = await rpc(s.url, "0".repeat(64), sendText("x"));
  assert.equal(wrong.status, 401);
  const missing = await rpc(s.url, null, sendText("x"));
  assert.equal(missing.status, 401);
  s.stop();
});

test("host 0.0.0.0 is rejected", async () => {
  await assert.rejects(
    sidecar.startSidecar({ name: "s5", harness: "claude", profile: profile(), host: "0.0.0.0" }),
    /non-loopback/,
  );
});

test("body over 8 KiB gets 413", async () => {
  const s = await sidecar.startSidecar({ name: "s6", harness: "claude", profile: profile() });
  const res = await rpc(s.url, s.token, sendText("x".repeat(9000)));
  assert.equal(res.status, 413);
  s.stop();
});

const rawGet = (url, host) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname, headers: { Host: host } }, (res) => {
    res.resume();
    res.on("end", () => resolve(res.statusCode));
  });
  req.on("error", reject);
  req.end();
});

test("m1: a non-loopback Host header is refused (DNS rebinding), loopback names pass", async () => {
  const s = await sidecar.startSidecar({ name: "s10", harness: "claude", profile: profile() });
  try {
    assert.equal(await rawGet(s.cardUrl, "evil.example.com"), 403);
    assert.equal(await rawGet(s.cardUrl, `evil.example.com:${s.port}`), 403);
    assert.equal(await rawGet(s.cardUrl, `localhost:${s.port}`), 200);
    assert.equal(await rawGet(s.cardUrl, `127.0.0.1:${s.port}`), 200);
  } finally { s.stop(); }
});

test("m2: the bearer check runs before the body parser; the agent card stays public", async () => {
  const s = await sidecar.startSidecar({ name: "s11", harness: "claude", profile: profile() });
  try {
    const big = await rpc(s.url, null, sendText("x".repeat(9000)));
    assert.equal(big.status, 401, "an unauthenticated oversize body must not reach the parser");
    assert.equal((await fetch(s.cardUrl)).status, 200);
  } finally { s.stop(); }
});

test("m2: the registered url is the address the server is bound to", async () => {
  const s = await sidecar.startSidecar({ name: "s12", harness: "claude", profile: profile() });
  try {
    const entry = reg.list().find((e) => e.name === "s12");
    assert.ok(entry);
    assert.equal(entry.url, s.url);
    assert.ok(s.url.startsWith(`http://127.0.0.1:${s.port}/`), s.url);
  } finally { s.stop(); }
});

test("stop() removes the registry entry", async () => {
  const s = await sidecar.startSidecar({ name: "s7", harness: "claude", profile: profile() });
  assert.ok(reg.list().some((e) => e.name === "s7"));
  s.stop();
  assert.ok(!reg.list().some((e) => e.name === "s7"));
});

test("parentPid death unregisters within 12s", async (t) => {
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"]);
  const s = await sidecar.startSidecar({ name: "s8", harness: "claude", profile: profile(), parentPid: child.pid });
  assert.ok(reg.list().some((e) => e.name === "s8"));
  child.kill("SIGKILL");
  const deadline = Date.now() + 12000;
  let gone = false;
  while (Date.now() < deadline) {
    if (!reg.list().some((e) => e.name === "s8")) { gone = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(gone, "registry entry should be removed after parent death");
  s.stop();
});

// 5.4.2: a codex sidecar follows its real Codex process (the hook resolves it past shell wrappers): owner gone -> exit,
// unregister and drop its pidfile. agy (shared app host) keeps the idle reaper only.
test("a codex sidecar stops, unregisters and removes its pidfile when the owner exits", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"]);
  const { sessionsDir } = reg;
  const pidfile = join(sessionsDir(), "s-codex-owner.pid");
  mkdirSync(sessionsDir(), { recursive: true });
  const s = await sidecar.startSidecar({ name: "s-codex-owner", harness: "codex", profile: profile(), parentPid: child.pid });
  writeFileSync(pidfile, String(process.pid));
  assert.ok(reg.list().some((e) => e.name === "s-codex-owner"));
  child.kill("SIGKILL");
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && existsSync(join(sessionsDir(), "s-codex-owner.json"))) await new Promise((r) => setTimeout(r, 300));
  try {
    assert.ok(!existsSync(join(sessionsDir(), "s-codex-owner.json")), "registration removed");
    assert.ok(!existsSync(pidfile), "pidfile removed");
    assert.ok(!reg.list({ includeStale: true }).some((e) => e.name === "s-codex-owner"));
  } finally { s.stop(); }
});

test("an agy sidecar with an exited parentPid stays up (shared host, idle reaper only)", async () => {
  const child = spawn(process.execPath, ["-e", "0"]);
  await new Promise((r) => child.once("exit", r));
  const s = await sidecar.startSidecar({ name: "s-agy-dead", harness: "agy", profile: profile(), parentPid: child.pid });
  try {
    await new Promise((r) => setTimeout(r, 6500));
    assert.ok(reg.list().some((e) => e.name === "s-agy-dead"), "agy sidecar must survive a dead owner pid");
  } finally { s.stop(); }
});

test("list hides and prunes a live sidecar whose owner pid is dead (codex), but not agy", async () => {
  const child = spawn(process.execPath, ["-e", "0"]);
  await new Promise((r) => child.once("exit", r));
  reg.register({ name: "s-orphan-codex", harness: "codex", pid: process.pid, parentPid: child.pid, url: "http://127.0.0.1:1/", cardUrl: "http://127.0.0.1:1/c" });
  reg.register({ name: "s-orphan-agy", harness: "agy", pid: process.pid, parentPid: child.pid, url: "http://127.0.0.1:1/", cardUrl: "http://127.0.0.1:1/c" });
  const names = reg.list({ prune: true }).map((e) => e.name);
  assert.ok(!names.includes("s-orphan-codex"));
  assert.ok(names.includes("s-orphan-agy"));
  reg.unregister("s-orphan-agy");
});

test("AOS_A2A_SIDECAR=off rejects", async () => {
  process.env.AOS_A2A_SIDECAR = "off";
  try {
    await assert.rejects(
      sidecar.startSidecar({ name: "s9", harness: "claude", profile: profile() }),
      /disabled/,
    );
  } finally {
    delete process.env.AOS_A2A_SIDECAR;
  }
});

// B1: a sibling sidecar under the same parent pid is only swept for claude (one process per session). Shared hosts
// (agy, codex) and opencode (one process, many sessions) keep their live siblings. The sibling is a real process.
const sleeper = () => spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"]);
for (const harness of ["codex", "agy", "opencode"]) {
  test(`two ${harness} sidecars sharing one parentPid both survive`, async () => {
    const owner = sleeper();
    const sibling = sleeper();
    try {
      reg.register({ name: `sib-${harness}`, harness, pid: sibling.pid, parentPid: owner.pid, url: "http://127.0.0.1:1/a2a", cardUrl: "http://127.0.0.1:1/c", token: "t" });
      const s = await sidecar.startSidecar({ name: `new-${harness}`, harness, profile: profile(), parentPid: owner.pid });
      try {
        await new Promise((r) => setTimeout(r, 300));
        assert.doesNotThrow(() => process.kill(sibling.pid, 0), "sibling must not be signalled");
        assert.equal(sibling.killed, false);
      } finally { s.stop(); }
    } finally { owner.kill("SIGKILL"); sibling.kill("SIGKILL"); reg.unregister(`sib-${harness}`); }
  });
}

test("a claude sidecar replaces the stale-but-fresh sibling of the same claude process (/clear)", async () => {
  const owner = sleeper();
  const sibling = sleeper();
  try {
    reg.register({ name: "sib-claude", harness: "claude", pid: sibling.pid, parentPid: owner.pid, url: "http://127.0.0.1:1/a2a", cardUrl: "http://127.0.0.1:1/c", token: "t" });
    const s = await sidecar.startSidecar({ name: "new-claude", harness: "claude", profile: profile(), parentPid: owner.pid });
    try {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && sibling.exitCode === null && sibling.signalCode === null) await new Promise((r) => setTimeout(r, 50));
      assert.ok(sibling.signalCode === "SIGTERM" || sibling.exitCode !== null, "claude sibling is swept");
    } finally { s.stop(); }
  } finally { owner.kill("SIGKILL"); sibling.kill("SIGKILL"); reg.unregister("sib-claude"); }
});
