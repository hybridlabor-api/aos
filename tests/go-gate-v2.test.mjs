import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude", "hooks", "go-gate.mjs");
const g = await import(HOOK);
const H = 3600 * 1000;

function run(command, cfg) {
  const home = mkdtempSync(join(tmpdir(), "gv2-hook-"));
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
const grant = (scope) => ({ profile: "strict", expires_at: null, grants: [{ scope, expires_at: new Date(Date.now() + H).toISOString() }] });

test("isGuardedCommand: unparseable commands (null scopes) stay guarded", () => {
  for (const c of ["opencode attach http://x", "claude --resume abc", "rm -rf $DIR", "curl http://x/session/a/message"]) {
    assert.equal(g.commandScopes(c), null, c);
    assert.ok(g.isGuardedCommand(c), c);
  }
  assert.equal(g.isGuardedCommand("git status"), false);
});

test("isHeadSubstitution: variable or substitution in the head or subcommand slot", () => {
  for (const c of ["$CMD push origin main", "git $p origin HEAD:main", "git $(echo push) origin main"]) assert.ok(g.isHeadSubstitution(c), c);
  for (const c of ["git status", "ls -la", "echo $HOME", ""]) assert.equal(g.isHeadSubstitution(c), false, c);
});

test("contentReleaseRisk: release-class nouns and head substitution", () => {
  for (const c of ["npm publish", "git push --force origin x", "git reset --hard", "gh pr merge 5", "git push origin main", "$X push"]) assert.ok(g.contentReleaseRisk(c), c);
  for (const c of ["ls -la", "git status", "node script.mjs"]) assert.equal(g.contentReleaseRisk(c), false, c);
  assert.equal(g.contentReleaseRisk(42), false);
});

test("inferredReleaseScopes: maps content to grant scopes", () => {
  assert.deepEqual(g.inferredReleaseScopes("npm publish"), ["publish"]);
  assert.deepEqual(g.inferredReleaseScopes("git push origin main"), ["push-main"]);
  assert.deepEqual(g.inferredReleaseScopes("gh pr merge 5"), ["merge"]);
  assert.deepEqual(g.inferredReleaseScopes("git reset --hard"), ["destructive"]);
  assert.equal(g.inferredReleaseScopes("ls"), null);
});

test("classifyLayer: A hard/store, B release or unreadable head, C the rest", () => {
  assert.equal(g.classifyLayer("echo x > ~/.aos/gate/config.json"), "A");
  assert.equal(g.classifyLayer("npm publish"), "B");
  assert.equal(g.classifyLayer("$CMD push origin main"), "B");
  assert.equal(g.classifyLayer("git status"), "C");
  assert.equal(g.classifyLayer(7), "B");
});

test("global grant: covers its scope only; strict otherwise; expired grant = blocked", () => {
  assert.equal(run("gh pr merge 5", grant("merge")), 0);
  assert.equal(run("npm publish", grant("merge")), 2);
  assert.equal(run("gh pr merge 5", { profile: "strict", expires_at: null }), 2);
  assert.equal(run("gh pr merge 5", { ...grant("merge"), grants: [{ scope: "merge", expires_at: new Date(Date.now() - H).toISOString() }] }), 2);
});

test("global grant never opens an unreadable command", () => {
  assert.equal(run("opencode attach http://x", grant("publish")), 2);
  assert.equal(run("rm -rf $DIR", grant("destructive")), 2);
});

test("agent-run aos-gate widening needs a GO (guarded, no scope)", () => {
  for (const c of ["aos-gate grant publish 2h", "node bin/aos-gate.mjs work", "npx aos-gate profile work"]) {
    assert.ok(g.isGuardedCommand(c), c);
    assert.equal(run(c), 2, c);
  }
  assert.equal(g.isGuardedCommand("aos-gate status"), false);
});
