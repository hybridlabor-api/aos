import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, copyFileSync } from "node:fs";
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
  return spawnSync("node", [HOOK], { input, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8" }).status;
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
test("work: a wrapped or assembled release command (unreadable scope) needs a GO", () => {
  for (const c of ["bash -c 'git push origin main'", "p=push; git $p origin HEAD:main", "echo 'npm publish' | sh"]) assert.equal(run(c, work()), 2, c);
});
test("work: indirection that can carry a release command needs a GO", () => {
  for (const c of ["eval 'git push origin main'", "echo 'git push origin main' | sh", "npx semantic-release", "git $(echo push) origin HEAD:main"]) assert.equal(run(c, work()), 2, c);
});
test("work: an unscoped guarded command without indirection is free", () => {
  for (const c of ["gh pr view 5", "node script.mjs", "bash script.sh"]) assert.equal(run(c, work()), 0, c);
});
test("a go-gate copy without gate-profile.mjs still runs and keeps hard blocks and strict", () => {
  const dir = mkdtempSync(join(tmpdir(), "gp-nosib-"));
  copyFileSync(HOOK, join(dir, "go-gate.mjs"));
  const go = (command) => spawnSync("node", [join(dir, "go-gate.mjs")], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, transcript_path: join(dir, "none.jsonl") }), encoding: "utf8" }).status;
  assert.equal(go("rm -rf ~/Desktop"), 2);
  assert.equal(go("npm publish"), 2);
  assert.equal(go("ls"), 0);
});
test("off allows a release command, but not a hard block", () => {
  assert.equal(run("npm publish", { profile: "off", expires_at: exp(1) }), 0);
  assert.equal(run("rm -rf ~/Desktop", { profile: "off", expires_at: exp(1) }), 2);
});

const WIDEN = [
  "aos-gate profile off",
  "aos-gate work",
  "aos-gate grant merge",
  "node --no-warnings x/aos-gate.mjs grant publish 1h",
  'bash -c "aos-gate grant publish"',
  "env X=1 aos-gate profile off",
  "~/.local/bin/aos-gate profile work --for 2h",
];
test("work and off never free an aos-gate widening command", () => {
  for (const c of WIDEN) {
    assert.equal(run(c, work()), 2, `work: ${c}`);
    assert.equal(run(c, { profile: "off", expires_at: exp(1) }), 2, `off: ${c}`);
  }
});
test("a global grant never frees an aos-gate widening command", () => {
  const grants = ["merge", "publish", "destructive", "push-main"].map((scope) => ({ scope, expires_at: exp(1) }));
  for (const c of WIDEN) assert.equal(run(c, { profile: "strict", expires_at: null, grants }), 2, c);
});
test("aos-gate narrowing and status stay unguarded", async () => {
  const g = await import(HOOK);
  for (const c of ["aos-gate strict", "aos-gate profile strict", "node x/aos-gate.mjs revoke all", "aos-gate status"]) {
    assert.equal(g.neverGrantable(c), false, c);
    assert.equal(g.isGuardedCommand(c), false, c);
  }
  for (const c of WIDEN) assert.ok(g.neverGrantable(c) && g.isGuardedCommand(c), c);
});
