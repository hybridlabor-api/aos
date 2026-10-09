import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude", "hooks", "go-gate.mjs");
const H = 3600 * 1000;

function run(command, cfg) {
  const home = mkdtempSync(join(tmpdir(), "gp-hook-"));
  if (cfg) {
    const dir = join(home, ".aos", "gate");
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "config.json");
    writeFileSync(f, JSON.stringify({ version: 1, set_at: new Date(Date.now() - H).toISOString(), ...cfg }));
    chmodSync(f, 0o600);
  }
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command }, transcript_path: join(home, "none.jsonl"), cwd: home });
  return spawnSync("node", [HOOK], { input, env: { ...process.env, HOME: home }, encoding: "utf8" }).status;
}
const exp = (h) => new Date(Date.now() + h * H).toISOString();
const work = () => ({ profile: "work", expires_at: exp(3) });

test("no config = strict: a feature push is blocked", () => {
  assert.equal(run("git push origin HEAD:refs/heads/feat/x"), 2);
});
test("work: a feature push and a script run are free", () => {
  assert.equal(run("git push origin HEAD:refs/heads/feat/x", work()), 0);
  assert.equal(run("bash -c 'echo hi'", work()), 0);
});
test("work: the release class still needs a GO", () => {
  for (const c of ["npm publish", "npm version patch", "gh pr merge 5", "git push origin main"]) assert.equal(run(c, work()), 2, c);
});
test("work: hard blocks stay", () => {
  assert.equal(run("rm -rf ~/Desktop", work()), 2);
});
test("expired work falls back to strict", () => {
  assert.equal(run("git push origin HEAD:refs/heads/feat/x", { profile: "work", expires_at: exp(-1) }), 2);
});
test("off allows a release command, but not a hard block", () => {
  assert.equal(run("npm publish", { profile: "off", expires_at: exp(1) }), 0);
  assert.equal(run("rm -rf ~/Desktop", { profile: "off", expires_at: exp(1) }), 2);
});
