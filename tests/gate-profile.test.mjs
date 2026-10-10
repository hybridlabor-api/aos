import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readProfile, LIMITS, RELEASE_CLASS } from "../lib/gate-profile.mjs";
import { setProfile, status, gateDir, touchId } from "../bin/aos-gate.mjs";

const H = 3600000;
const NOW = Date.parse("2026-10-09T12:00:00Z");
const iso = (t) => new Date(t).toISOString();
const uid = process.getuid?.() ?? 0; // no uid on Windows; the POSIX mode/owner cases still need a win32 skip
const tmp = () => mkdtempSync(join(tmpdir(), "gate-profile-"));
const cfg = (o = {}) => ({ version: 1, profile: "work", set_at: iso(NOW - H), expires_at: iso(NOW + H), set_by: { uid, method: "typed" }, ...o });

function put(dir, content, mode = 0o600) {
  const f = join(dir, "config.json");
  writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content));
  chmodSync(f, mode);
  return f;
}
const read = (file, extra = {}) => readProfile({ file, now: NOW, uid, ...extra });

test("valid work and off configs are honoured", () => {
  const d = tmp();
  assert.equal(read(put(d, cfg())).profile, "work");
  assert.equal(read(put(d, cfg({ profile: "off", expires_at: iso(NOW + H) }))).profile, "off");
  assert.equal(read(put(d, cfg({ profile: "strict", expires_at: null }))).profile, "strict");
});

const bad = [
  ["wrong mode", (d) => put(d, cfg(), 0o644), /mode/],
  ["wrong uid", (d) => put(d, cfg()), /owner/, { uid: uid + 1 }],
  ["corrupt JSON", (d) => put(d, "{nope"), /corrupt/],
  ["future set_at", (d) => put(d, cfg({ set_at: iso(NOW + H) })), /future/],
  ["expired", (d) => put(d, cfg({ expires_at: iso(NOW - 1) })), /expired/],
  ["unknown profile", (d) => put(d, cfg({ profile: "root" })), /unknown/],
  ["missing", (d) => join(d, "config.json"), /no config/],
  ["work without expiry", (d) => put(d, cfg({ expires_at: null })), /expiry/],
  ["work beyond 24h", (d) => put(d, cfg({ set_at: iso(NOW - H), expires_at: iso(NOW - H + 25 * H) })), /maximum/],
  ["off beyond 2h", (d) => put(d, cfg({ profile: "off", set_at: iso(NOW - H), expires_at: iso(NOW - H + 3 * H) })), /maximum/],
  ["wrong version", (d) => put(d, cfg({ version: 2 })), /schema/],
  ["oversize", (d) => put(d, JSON.stringify(cfg()) + " ".repeat(5000)), /large/],
  ["symlink", (d) => { const t = put(d, cfg()); const l = join(d, "link.json"); symlinkSync(t, l); return l; }, /symlink/],
  ["directory", (d) => d, /regular|unreadable/],
];
for (const [name, mk, re, opts] of bad) {
  test(`fail closed: ${name}`, () => {
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
  assert.deepEqual(LIMITS.off, { defaultMs: 1 * H, maxMs: 2 * H });
  assert.ok(RELEASE_CLASS.some((c) => c.id === "npm-publish"));
  assert.ok(Object.isFrozen(RELEASE_CLASS));
});

const tty = { isTTY: true, write() {} };
const noTty = { isTTY: false, write() {} };
function run(dir, o = {}) {
  const errs = [];
  const out = [];
  const stdout = o.stdout ?? { isTTY: true, write: (s) => out.push(s) };
  return setProfile({
    dir, now: NOW, env: {}, stdin: tty, stdout, err: (m) => errs.push(m),
    ask: async () => { const w = /confirm: (\S+)/.exec(out.join(""))?.[1]; return o.typed ?? w; },
    ...o,
  }).then((code) => ({ code, errs }));
}
const written = (d) => existsSync(join(d, "config.json"));

test("CLI: no TTY refuses and writes nothing", async () => {
  const d = tmp();
  assert.equal((await run(d, { profile: "strict", stdin: noTty })).code, 1);
  assert.equal((await run(d, { profile: "strict", stdout: noTty })).code, 1);
  assert.equal(written(d), false);
});

test("CLI: harness env refuses", async () => {
  for (const k of ["CLAUDE_SESSION_ID", "CLAUDECODE", "OPENCODE", "CODEX_SANDBOX", "CODEX_SESSION_ID"]) {
    const d = tmp();
    const r = await run(d, { profile: "strict", env: { [k]: "1" } });
    assert.equal(r.code, 1);
    assert.match(r.errs[0], /harness/);
    assert.equal(written(d), false);
  }
});

test("CLI: strict needs no confirmation, writes 0600", async () => {
  const d = tmp();
  const r = await run(d, { profile: "strict", ask: async () => { throw new Error("asked"); } });
  assert.equal(r.code, 0);
  assert.equal(statSync(join(d, "config.json")).mode & 0o777, 0o600);
  assert.equal(readdirSync(d).length, 1);
});

test("CLI: right phrase loosens with default expiry, 0600", async () => {
  const d = tmp();
  assert.equal((await run(d, { profile: "work" })).code, 0);
  const c = JSON.parse(readFileSync(join(d, "config.json"), "utf8"));
  assert.equal(c.profile, "work");
  assert.equal(Date.parse(c.expires_at) - NOW, 4 * H);
  assert.equal(statSync(join(d, "config.json")).mode & 0o777, 0o600);
  assert.equal(readProfile({ file: join(d, "config.json"), now: NOW, uid }).profile, "work");
});

test("CLI: wrong phrase refuses", async () => {
  const d = tmp();
  const r = await run(d, { profile: "work", typed: "work" });
  assert.equal(r.code, 1);
  assert.equal(written(d), false);
});

test("CLI: max durations enforced", async () => {
  const d = tmp();
  assert.equal((await run(d, { profile: "off", forArg: "3h" })).code, 1);
  assert.equal((await run(d, { profile: "work", forArg: "25h" })).code, 1);
  assert.equal((await run(d, { profile: "work", forArg: "bogus" })).code, 2);
  assert.equal(written(d), false);
  assert.equal((await run(d, { profile: "off", forArg: "2h" })).code, 0);
});

test("CLI: status is read-only", () => {
  const d = tmp();
  const lines = [];
  assert.equal(status({ dir: d, now: NOW, out: (l) => lines.push(l) }), 0);
  assert.match(lines[0], /strict/);
  assert.equal(readdirSync(d).length, 0);
});

test("gateDir honours AOS_GATE_DIR only in sandbox or with test flag", () => {
  assert.equal(gateDir({ AOS_GATE_DIR: "/x", AOS_TEST_SANDBOX: "container" }), "/x");
  assert.equal(gateDir({ AOS_GATE_DIR: "/x" }, true), "/x");
  assert.match(gateDir({ AOS_GATE_DIR: "/x" }), /\.aos\/gate$/);
});

test("Touch ID path is a stub", () => {
  assert.throws(() => touchId(), /WP-9/);
});

test("child process: profile without TTY refuses, status writes nothing", () => {
  const d = tmp();
  const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "aos-gate.mjs");
  const env = { PATH: process.env.PATH, HOME: d, AOS_TEST_SANDBOX: "container", AOS_GATE_DIR: d };
  const p = spawnSync(process.execPath, [bin, "profile", "strict"], { env, input: "", encoding: "utf8" });
  assert.equal(p.status, 1);
  assert.match(p.stderr, /terminal/);
  const s = spawnSync(process.execPath, [bin, "status"], { env, encoding: "utf8" });
  assert.equal(s.status, 0);
  assert.match(s.stdout, /strict/);
  assert.equal(readdirSync(d).length, 0);
});
