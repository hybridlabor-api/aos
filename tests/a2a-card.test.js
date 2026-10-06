import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cardFromProfile, loadProfile, validateProfile } from "../lib/a2a-card.mjs";

const profile = () => ({
  orchestrator: { harness: "claude", model: "opus" },
  roles: {
    research: { harness: "agy", model: "flash", write: false, mode: "spawn" },
    build: { harness: "opencode", model: "sonnet", write: true, mode: "spawn" },
    review: { harness: "claude", model: "sonnet", write: false, mode: "live" },
    audit: { harness: "claude", model: "opus", write: true, mode: "spawn" },
  },
  default: { harness: "agy", model: "flash", write: false, mode: "spawn" },
});

test("skills equal the profile roles hosted by the harness", () => {
  const c = cardFromProfile(profile(), { name: "s1", harness: "claude", url: "http://127.0.0.1:9/a2a" });
  assert.deepEqual(c.skills.map((s) => s.id), ["review", "audit"]);
  assert.deepEqual(c.skills[0].tags, ["harness:claude", "model:sonnet", "write:false", "mode:live"]);
  assert.equal(c.supportedInterfaces[0].url, "http://127.0.0.1:9/a2a");
  assert.equal(c.capabilities.streaming, true);
  assert.equal(c.securitySchemes.bearer.scheme.value.scheme, "bearer");
});

test("extension carries session params", () => {
  const c = cardFromProfile(profile(), { name: "s1", harness: "claude", model: "opus", cwd: "/w" });
  const ext = c.capabilities.extensions.find((e) => e.uri === "urn:aos:a2a:session");
  assert.deepEqual(ext.params, { harness: "claude", model: "opus", write: true, modes: ["live", "spawn"], cwd: "/w" });
  assert.deepEqual(cardFromProfile(profile(), { name: "x", harness: "kimi" }).skills, []);
});

test("invalid profiles give clear errors", () => {
  const mut = (f) => { const p = profile(); f(p); return p; };
  assert.throws(() => validateProfile(null), /JSON object/);
  assert.throws(() => validateProfile(mut((p) => delete p.orchestrator)), /orchestrator\.harness/);
  assert.throws(() => validateProfile(mut((p) => { p.roles = {}; })), /roles/);
  assert.throws(() => validateProfile(mut((p) => { p.roles.build.write = "yes"; })), /roles\.build\.write/);
  assert.throws(() => validateProfile(mut((p) => { p.roles.build.mode = "fast"; })), /roles\.build\.mode/);
  assert.throws(() => validateProfile(mut((p) => delete p.default)), /default/);
  assert.throws(() => cardFromProfile(profile(), { name: "x" }), /name and harness/);
});

test("loadProfile: explicit path, project file, missing", () => {
  const dir = mkdtempSync("/private/tmp/claude-501/a2a-card-");
  const f = join(dir, "p.json");
  writeFileSync(f, JSON.stringify(profile()));
  assert.equal(loadProfile({ profile: f }).orchestrator.harness, "claude");
  writeFileSync(join(dir, "bad.json"), "{nope");
  assert.throws(() => loadProfile({ profile: join(dir, "bad.json") }), /bad\.json/);
  mkdirSync(join(dir, ".aos"));
  writeFileSync(join(dir, ".aos", "delegate.json"), JSON.stringify(profile()));
  assert.equal(loadProfile({ cwd: dir }).default.harness, "agy");
});

test("CLI: --help exits 0, card prints JSON", () => {
  const bin = new URL("../bin/aos-a2a.mjs", import.meta.url).pathname;
  assert.equal(spawnSync(process.execPath, [bin, "--help"]).status, 0);
  const dir = mkdtempSync("/private/tmp/claude-501/a2a-cli-");
  const f = join(dir, "p.json");
  writeFileSync(f, JSON.stringify(profile()));
  const r = spawnSync(process.execPath, [bin, "card", "--profile", f, "--name", "n", "--harness", "agy"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout).skills.map((s) => s.id), ["research"]);
  assert.equal(spawnSync(process.execPath, [bin, "card", "--name", "n"], { encoding: "utf8" }).status, 2);
});
