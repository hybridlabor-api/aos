import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const tmp = mkdtempSync(join(tmpdir(), "a2a-client-"));
process.env.AOS_SESSIONS_DIR = join(tmp, "sessions");
process.env.AOS_A2A_INBOX = join(tmp, "inbox");

const profile = (roleKey = "research") => ({
  orchestrator: { harness: "claude", model: "opus" },
  roles: {
    [roleKey]: { harness: "claude", model: "flash", write: false, mode: "spawn" },
  },
  default: { harness: "claude", model: "opus", write: true, mode: "live" },
});

const sidecar = await import("../lib/a2a-sidecar.mjs");
const client = await import("../lib/a2a-client.mjs");

test("send({to}) against echo sidecar completes with matching artifact", async () => {
  const s = await sidecar.startSidecar({ name: "c1", harness: "claude", profile: profile() });
  try {
    const res = await client.send({ to: "c1", text: "hello a2a" });
    assert.equal(res.state, "TASK_STATE_COMPLETED");
    assert.ok(res.artifacts.some((a) => a.text.includes("hello a2a")), JSON.stringify(res));
  } finally { s.stop(); }
});

test("send({role}) resolves via card skill id", async () => {
  const s = await sidecar.startSidecar({ name: "c2", harness: "claude", profile: profile("echo") });
  try {
    const res = await client.send({ role: "echo", text: "via role" });
    assert.equal(res.state, "TASK_STATE_COMPLETED");
    assert.ok(res.artifacts.some((a) => a.text.includes("via role")));
  } finally { s.stop(); }
});

test("depth limit rejects via AOS_DELEGATE_DEPTH and MCSC_DEPTH alone", async () => {
  const s = await sidecar.startSidecar({ name: "c3", harness: "claude", profile: profile() });
  try {
    process.env.AOS_DELEGATE_DEPTH = "1";
    await assert.rejects(client.send({ to: "c3", text: "x" }), /A2A depth limit reached/);
    delete process.env.AOS_DELEGATE_DEPTH;
    process.env.MCSC_DEPTH = "1";
    await assert.rejects(client.send({ to: "c3", text: "x" }), /A2A depth limit reached/);
    delete process.env.MCSC_DEPTH;
  } finally { s.stop(); }
});

test("send to unknown name errors quickly", async () => {
  await assert.rejects(client.send({ to: "nope", text: "x" }), /no live registry entry/);
});

test("reply() writes 0600 file and rejects > 8 KiB", () => {
  const out = client.reply({ name: "agent1", taskId: "t1", text: "the answer" });
  const mode = statSync(out.path).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.throws(() => client.reply({ name: "agent1", taskId: "t2", text: "x".repeat(9000) }), /8 KiB/);
});

// Lazy-import trick: register() (node:module) installs a resolve hook (--import'ed by the child via
// NODE_OPTIONS) that throws for "@a2a-js/sdk" specifiers. list/card/--help must still exit 0 because
// they never import the SDK; send must fail with "A2A SDK missing".
test("lazy SDK import: node bin/aos-a2a.mjs help/list work with SDK unresolvable", async () => {
  const hooks = join(tmp, "sdk-block-hooks.mjs");
  writeFileSync(hooks, `export async function resolve(specifier, context, next) {
  if (specifier === "@a2a-js/sdk" || specifier.startsWith("@a2a-js/sdk/")) throw new Error("blocked: mock unresolvable SDK");
  return next(specifier, context);
}\n`);
  const register = join(tmp, "sdk-block-register.mjs");
  writeFileSync(register, `import { register } from "node:module";\nregister(${JSON.stringify("file://" + hooks)});\n`);
  const env = { ...process.env, NODE_OPTIONS: `--import ${register}` };
  const bin = new URL("../bin/aos-a2a.mjs", import.meta.url).pathname;

  const help = await run(process.execPath, [bin, "--help"], env);
  assert.equal(help.code, 0, help.stderr);
  const list = await run(process.execPath, [bin, "list", "--json"], env);
  assert.equal(list.code, 0, list.stderr);
  const send = await run(process.execPath, [bin, "send", "--to", "x", "hi"], env);
  assert.notEqual(send.code, 0);
  assert.match(send.stderr, /A2A SDK missing/);
});

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env });
    let stdout = ""; let stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
