// `codesign -v ~/.local/bin/ao` runs at most once per binary identity (mtime+size), and concurrent
// status requests share one in-flight check. The runner is injected: no real codesign, no real processes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync, statSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusService, resetAoSignCache } from "../lib/hub/services.mjs";

const home = mkdtempSync(join(tmpdir(), "hub-ao-codesign-"));
const bin = join(home, ".local", "bin", "ao");
mkdirSync(join(home, ".local", "bin"), { recursive: true });
writeFileSync(bin, "bin-v1");

const aoRow = (rows) => rows.find((r) => r.id === "ao");
const makeCtx = (run) => ({ root: home, home, cwd: home, platform: "darwin", uid: "501", run, now: () => Date.now(), log: () => {} });

test("codesign runs once for concurrent status requests and again only after the binary changes", async () => {
  resetAoSignCache();
  const seen = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const run = async (cmd, args) => {
    if (cmd === "codesign") { seen.push(args.join(" ")); await gate; return { ok: true, code: 0, stdout: "", stderr: "" }; }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };
  const ctx = makeCtx(run);
  // 12 overlapping status requests while the first codesign is still in flight
  const pending = Array.from({ length: 12 }, () => statusService(ctx));
  release();
  const results = await Promise.all(pending);
  assert.equal(seen.length, 1, `expected one codesign run, got ${seen.length}`);
  for (const rows of results) assert.equal(aoRow(rows).health, null, "signed binary reports no health problem");

  // same binary, later request: served from cache
  await statusService(ctx);
  assert.equal(seen.length, 1);

  // binary replaced (new size/mtime): checked again
  writeFileSync(bin, "bin-version-two-longer");
  utimesSync(bin, new Date(), new Date(Date.now() + 5000));
  await statusService(ctx);
  assert.equal(seen.length, 2);
});

test("a failing codesign check is reported, and cached as failing", async () => {
  resetAoSignCache();
  let calls = 0;
  const run = async (cmd) => {
    if (cmd === "codesign") { calls += 1; return { ok: false, code: 1, stdout: "", stderr: "invalid" }; }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };
  const ctx = makeCtx(run);
  const [a, b] = await Promise.all([statusService(ctx), statusService(ctx)]);
  assert.equal(calls, 1);
  assert.equal(aoRow(a).health.level, "error");
  assert.equal(aoRow(b).health.level, "error");
});

// B2: an indeterminate codesign run (spawn error, timeout, signal: no numeric exit code) is no verdict. It is not
// reported as "not signed" and not cached, so the next status request asks codesign again.
test("a codesign run without an exit code is not cached and not reported as unsigned", async () => {
  resetAoSignCache();
  let calls = 0;
  const run = async (cmd) => {
    if (cmd === "codesign") { calls += 1; return { ok: false, code: null, stdout: "", stderr: "spawn ETIMEDOUT" }; }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };
  const ctx = makeCtx(run);
  const first = await statusService(ctx);
  assert.equal(aoRow(first).health, null, "no verdict: no false not-signed error");
  await statusService(ctx);
  assert.equal(calls, 2, "indeterminate result must not be cached");
});

// B3: the cache key also covers inode and ctime: same size and mtime after a replacement or chmod re-checks.
test("a binary replaced with the same size and mtime is checked again (inode/ctime in the key)", async () => {
  resetAoSignCache();
  let calls = 0;
  const run = async (cmd) => {
    if (cmd === "codesign") { calls += 1; return { ok: true, code: 0, stdout: "", stderr: "" }; }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };
  const ctx = makeCtx(run);
  await statusService(ctx);
  const st = statSync(bin);
  const tmpBin = join(home, ".local", "bin", "ao.new");
  writeFileSync(tmpBin, "x".repeat(st.size));
  utimesSync(tmpBin, st.atime, st.mtime);
  renameSync(tmpBin, bin);
  await statusService(ctx);
  assert.equal(calls, 2, "a new inode with identical size and mtime is a new binary");
});
