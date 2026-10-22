// `aos-gateway status` must end by draining the event loop (process.exitCode), never process.exit():
// on Windows a hard exit while an HTTP socket was still closing aborted with a libuv assertion (exit 127).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "aos-gateway.mjs");

test("the status branch sets process.exitCode and has no process.exit", () => {
  const src = readFileSync(BIN, "utf8");
  const start = src.indexOf("if (cmd === 'status') {");
  assert.ok(start > 0, "status branch not found");
  const end = src.indexOf("if (cmd === 'direct' || cmd === 'enable')", start);
  const block = src.slice(start, end);
  assert.doesNotMatch(block, /process\.exit\(/);
  assert.match(block, /process\.exitCode = s\.running \? 0 : 1;/);
});

test("aos-gateway status --json exits on its own with 0 or 1 and prints JSON", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-gw-status-"));
  try {
    const r = spawnSync(process.execPath, [BIN, "status", "--json"], {
      env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8", timeout: 30000, windowsHide: true,
    });
    assert.ok(r.status === 0 || r.status === 1, `exit ${r.status} ${r.signal || ""}: ${r.stderr}`);
    assert.equal(typeof JSON.parse(r.stdout).running, "boolean");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
