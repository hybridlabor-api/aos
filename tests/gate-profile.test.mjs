import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readProfile, LIMITS, RELEASE_CLASS, PROFILES } from "../lib/gate-profile.mjs";
import { setProfile, setGrant, revokeGrant, status, gateDir, touchId, widenRefusal } from "../bin/aos-gate.mjs";

const H = 3600000;
const NOW = Date.parse("2026-10-09T12:00:00Z");
const iso = (t) => new Date(t).toISOString();
const uid = process.getuid?.() ?? 0; // no uid on Windows; the POSIX mode/owner cases still need a win32 skip
const tmp = () => mkdtempSync(join(tmpdir(), "gate-profile-"));
const cfg = (o = {}) => ({ version: 1, profile: "work", set_at: iso(NOW - H), expires_at: iso(NOW + H), set_by: { uid, method: "cli" }, ...o });

function put(dir, content, mode = 0o600) {
  const f = join(dir, "config.json");
  writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content));
  chmodSync(f, mode);
  return f;
}
const read = (file, extra = {}) => readProfile({ file, now: NOW, uid, ...extra });

test("valid work and strict configs are honoured", () => {
  const d = tmp();
  assert.equal(read(put(d, cfg())).profile, "work");
  assert.equal(read(put(d, cfg({ profile: "strict", expires_at: null }))).profile, "strict");
});

test("global grants in config are parsed by readProfile", () => {
  const d = tmp();
  const r = read(put(d, cfg({
    grants: [
      { scope: "merge", expires_at: iso(NOW + H) },
      { scope: "publish", expires_at: iso(NOW - H) }, // expired, should be filtered
    ]
  })));
  assert.equal(r.profile, "work");
  assert.equal(r.grants.length, 1);
  assert.equal(r.grants[0].scope, "merge");
});

const bad = [
  ["wrong mode", (d) => put(d, cfg(), 0o644), /mode/],
  ["wrong uid", (d) => put(d, cfg()), /owner/, { uid: uid + 1 }],
  ["corrupt JSON", (d) => put(d, "{nope"), /corrupt/],
  ["future set_at", (d) => put(d, cfg({ set_at: iso(NOW + H) })), /future/],
  ["expired", (d) => put(d, cfg({ expires_at: iso(NOW - 1) })), /expired/],
  ["unknown profile", (d) => put(d, cfg({ profile: "root" })), /unknown/],
  ["off is unknown profile", (d) => put(d, cfg({ profile: "off", set_at: iso(NOW - H), expires_at: iso(NOW + H) })), /unknown/],
  ["missing", (d) => join(d, "config.json"), /no config/],
  ["work without expiry", (d) => put(d, cfg({ expires_at: null })), /expiry/],
  ["work beyond 24h", (d) => put(d, cfg({ set_at: iso(NOW - H), expires_at: iso(NOW - H + 25 * H) })), /maximum/],
  ["wrong version", (d) => put(d, cfg({ version: 2 })), /schema/],
  ["oversize", (d) => put(d, JSON.stringify(cfg()) + " ".repeat(5000)), /large/],
  ["symlink", (d) => { const t = put(d, cfg()); const l = join(d, "link.json"); symlinkSync(t, l); return l; }, /symlink/],
  ["directory", (d) => d, /regular|unreadable/],
];
for (const [name, mk, re, opts] of bad) {
  test(`fail closed: ${name}`, { skip: process.platform === "win32" && /^wrong (mode|uid)$/.test(name) && "no POSIX mode/owner on Windows" }, () => {
    const r = read(mk(tmp()), opts);
    assert.equal(r.profile, "strict");
    assert.match(r.reason, re);
  });
}

test("fail closed: FIFO does not hang", (t) => {
  const d = tmp();
  const f = join(d, "config.json");
  try { execFileSync("mkfifo", [f]); } catch { t.skip("mkfifo unavailable"); return; }
  const r = read(f);
  assert.equal(r.profile, "strict");
});

test("durations and release class are data", () => {
  assert.deepEqual(LIMITS.work, { defaultMs: 4 * H, maxMs: 24 * H });
  assert.deepEqual(PROFILES, ["strict", "work"]);
  assert.ok(RELEASE_CLASS.some((c) => c.id === "npm-publish"));
  assert.ok(Object.isFrozen(RELEASE_CLASS));
});

function run(dir, o = {}) {
  const errs = [];
  const out = [];
  const stdout = o.stdout ?? { write: (s) => out.push(s) };
  return setProfile({
    dir, now: NOW, env: {}, stdout, err: (m) => errs.push(m),
    ...o,
  }).then((code) => ({ code, errs, out: out.join("") }));
}

test("CLI: setProfile work sets default expiry and 0600 without confirmation typing", async () => {
  const d = tmp();
  const r = await run(d, { profile: "work" });
  assert.equal(r.code, 0);
  const c = JSON.parse(readFileSync(join(d, "config.json"), "utf8"));
  assert.equal(c.profile, "work");
  assert.equal(Date.parse(c.expires_at) - NOW, 4 * H);
  if (process.platform !== "win32") assert.equal(statSync(join(d, "config.json")).mode & 0o777, 0o600);
  assert.equal(readProfile({ file: join(d, "config.json"), now: NOW, uid }).profile, "work");
});

test("CLI: setProfile strict sets null expiry without prompt", async () => {
  const d = tmp();
  const r = await run(d, { profile: "strict" });
  assert.equal(r.code, 0);
  const c = JSON.parse(readFileSync(join(d, "config.json"), "utf8"));
  assert.equal(c.profile, "strict");
  assert.equal(c.expires_at, null);
});

test("CLI: max durations enforced", async () => {
  const d = tmp();
  assert.equal((await run(d, { profile: "off" })).code, 2); // off is removed
  assert.equal((await run(d, { profile: "work", forArg: "25h" })).code, 1);
  assert.equal((await run(d, { profile: "work", forArg: "bogus" })).code, 2);
});

test("CLI: global grants management (setGrant and revokeGrant)", () => {
  const d = tmp();
  const errs = [];
  const out = [];
  const code = setGrant({ dir: d, scopes: "merge,publish", duration: "2h", now: NOW, out: (s) => out.push(s), err: (m) => errs.push(m) });
  assert.equal(code, 0);
  const p = readProfile({ file: join(d, "config.json"), now: NOW, uid });
  assert.equal(p.grants.length, 2);
  assert.ok(p.grants.some((g) => g.scope === "merge"));
  assert.ok(p.grants.some((g) => g.scope === "publish"));

  // Revoke merge
  revokeGrant({ dir: d, scope: "merge", now: NOW, out: (s) => out.push(s), err: (m) => errs.push(m) });
  const p2 = readProfile({ file: join(d, "config.json"), now: NOW, uid });
  assert.equal(p2.grants.length, 1);
  assert.equal(p2.grants[0].scope, "publish");
});

test("CLI: status shows profile and active global grants", () => {
  const d = tmp();
  setGrant({ dir: d, scopes: "merge", duration: "2h", now: NOW, out: () => {} });
  const lines = [];
  assert.equal(status({ dir: d, now: NOW, out: (l) => lines.push(l) }), 0);
  assert.match(lines[0], /strict/);
  assert.ok(lines.some((l) => l.includes("grant merge")));
});

test("gateDir honours AOS_GATE_DIR only in sandbox or with test flag", () => {
  assert.equal(gateDir({ AOS_GATE_DIR: "/x", AOS_TEST_SANDBOX: "container" }), "/x");
  assert.equal(gateDir({ AOS_GATE_DIR: "/x" }, true), "/x");
  assert.match(gateDir({ AOS_GATE_DIR: "/x" }), /\.aos[\\/]gate$/);
});

test("Touch ID path is a stub", () => {
  assert.throws(() => touchId(), /WP-9/);
});

test("child process: agent-run aos-gate cannot widen; status and strict still work", () => {
  const d = tmp();
  const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "aos-gate.mjs");
  const env = { PATH: process.env.PATH, HOME: d, AOS_TEST_SANDBOX: "container", AOS_GATE_DIR: d };
  for (const args of [["profile", "work", "--for", "2h"], ["work"], ["grant", "publish", "1h"]]) {
    const p = spawnSync(process.execPath, [bin, ...args], { env, input: "", encoding: "utf8" });
    assert.equal(p.status, 1, args.join(" "));
    assert.match(p.stderr, /terminal/);
    assert.equal(existsSync(join(d, "config.json")), false);
  }
  const h = spawnSync(process.execPath, [bin, "grant", "publish"], { env: { ...env, CLAUDECODE: "1" }, input: "", encoding: "utf8" });
  assert.equal(h.status, 1);
  const s = spawnSync(process.execPath, [bin, "status"], { env, encoding: "utf8" });
  assert.equal(s.status, 0);
  assert.match(s.stdout, /profile: strict/);
});

test("widenRefusal: terminal, harness env and typed word are all required", async () => {
  const tty = { isTTY: true, write() {} };
  const ok = (extra = {}) => widenRefusal({ env: {}, stdin: tty, stdout: tty, what: "x", ask: async () => "wrong", ...extra });
  assert.match(await ok(), /confirmation/);
  assert.match(await ok({ stdin: { isTTY: false } }), /terminal/);
  assert.match(await ok({ env: { OPENCODE: "1" } }), /harness/);
  let word = "";
  const out = { isTTY: true, write: (s) => { word = /confirm: (\S+)/.exec(s)?.[1] ?? word; } };
  assert.equal(await widenRefusal({ env: {}, stdin: tty, stdout: out, what: "x", ask: async () => word }), null);
});

test("setGrant: unknown scope and over-24h duration are refused, nothing written", () => {
  const d = tmp();
  const errs = [];
  assert.equal(setGrant({ dir: d, scopes: "root", duration: "1h", now: NOW, out() {}, err: (m) => errs.push(m) }), 2);
  assert.equal(setGrant({ dir: d, scopes: "publish", duration: "25h", now: NOW, out() {}, err: (m) => errs.push(m) }), 1);
  assert.equal(existsSync(join(d, "config.json")), false);
});
