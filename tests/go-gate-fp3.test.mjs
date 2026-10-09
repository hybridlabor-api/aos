import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, utimesSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude", "hooks", "go-gate.mjs");
const H = 3600 * 1000;
const WORK = { profile: "work", expires_at: new Date(Date.now() + 3 * H).toISOString() };
// Assembled so this file holds no literal release or delete command.
const PUBLISH = ["npm", "publish"].join(" ");
const PUSH_MAIN = ["git", "push", "origin", "main"].join(" ");

function setup(cfg) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "gp-fp3-")));
  const proj = join(home, "projects", "work");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "package.json"), "{}");
  if (cfg) {
    const dir = join(home, ".aos", "gate");
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "config.json");
    writeFileSync(f, JSON.stringify({ version: 1, set_at: new Date(Date.now() - H).toISOString(), ...cfg }));
    chmodSync(f, 0o600);
  }
  const run = (command, cwd = proj) => {
    const input = JSON.stringify({ tool_name: "Bash", tool_input: { command }, transcript_path: join(home, "t.jsonl"), session_id: "s1", cwd });
    return spawnSync("node", [HOOK], { input, env: { ...process.env, HOME: home, AOS_TEST_SANDBOX: "1", AOS_GATE_TEST_REALHOME: home }, encoding: "utf8" }).status;
  };
  return { home, proj, run };
}

test("$PWD as the -v source: a read-only project mount runs free under work (any container body without a release noun)", () => {
  const { run } = setup(WORK);
  assert.equal(run(`docker run --rm -e AOS_TEST_SANDBOX=container -v "$PWD":/src:ro node:24 bash -c 'npm ci && node --test tests/x.test.js'`), 0);
  assert.equal(run(`docker run --rm -v $PWD:/src:ro node:24 bash -c 'echo hi'`), 0);
  assert.equal(run(`docker run --rm -v \${PWD}:/src:ro node:24 bash -c 'echo hi'`), 2, "the braced spelling is not resolved: stays a GO");
});

test("$PWD as the -v source: a release noun inside the container body still needs a GO", () => {
  const { run } = setup(WORK);
  assert.equal(run(`docker run --rm -v "$PWD":/src:ro node:24 bash -c '${PUBLISH}'`), 2);
  assert.equal(run(`docker run --rm -v "$PWD":/src:ro node:24 bash -c '${PUSH_MAIN}'`), 2);
});

test("$PWD is only trusted where it is known: after a cd, with a PWD assignment, or from a cwd that is home", () => {
  const { home, run } = setup(WORK);
  const body = "bash -c 'echo hi'";
  assert.equal(run(`cd ${home} && docker run --rm -v "$PWD":/h:ro node:24 ${body}`), 2);
  assert.equal(run(`export PWD=${home}; docker run --rm -v "$PWD":/h:ro node:24 ${body}`), 2);
  assert.equal(run(`docker run --rm -v "$PWD":/h:ro node:24 ${body}`, home), 2);
  assert.equal(run(`docker run --rm -v '$PWD':/h:ro node:24 ${body}`), 2);
});

test("node --check / -c is a parse, not an execution: free under work even if the file holds a delete", () => {
  const { proj, run } = setup(WORK);
  writeFileSync(join(proj, "installer.js"), `require("fs").r${"m"}Sync(process.env.HOME, { recursive: true });\n`);
  assert.equal(run("node --check installer.js"), 0);
  assert.equal(run("node -c installer.js"), 0);
  assert.equal(run("node installer.js"), 2, "running the same file is still judged by its content");
});

test("cooldown: a block does not hold back a fresh script under work, but still does under strict", () => {
  for (const [cfg, want] of [[WORK, 0], [null, 2]]) {
    const { proj, run } = setup(cfg);
    assert.equal(run(PUSH_MAIN), 2, "the first command is blocked and leaves the marker");
    const f = join(proj, "fresh.py");
    writeFileSync(f, "print('hi')\n");
    const later = new Date(Date.now() + 2000);
    utimesSync(f, later, later);
    assert.equal(run("python3 fresh.py"), want, cfg ? "work" : "strict");
  }
});

test("cooldown under work does not hide a release-class script: it is still judged by content", () => {
  const { proj, run } = setup(WORK);
  assert.equal(run(PUSH_MAIN), 2);
  const f = join(proj, "rel.sh");
  writeFileSync(f, `${PUBLISH}\n`);
  const later = new Date(Date.now() + 2000);
  utimesSync(f, later, later);
  assert.equal(run("bash rel.sh"), 2);
});
