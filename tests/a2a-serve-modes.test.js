// tests for `aos-a2a serve --mode agy|codex`: a REAL `node bin/aos-a2a.mjs serve`
// sidecar per mode, with FAKE `agy` and `codex` executables put first on PATH.
// The real agy and codex binaries are never needed, looked up past the fakes,
// or run by this test.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";

// tmp env FIRST (before importing anything from the repo, whose modules read env)
const tmp = mkdtempSync(join(tmpdir(), "a2a-serve-modes-"));
process.env.AOS_SESSIONS_DIR = join(tmp, "sessions");
process.env.AOS_BUS_ROOT = join(tmp, "bus");
process.env.AOS_A2A_INBOX = join(tmp, "a2a-inbox");
process.env.AOS_A2A_BOOK = join(tmp, "a2abook.json");
process.env.AOS_A2A_MAX_DEPTH = "8";
mkdirSync(process.env.AOS_SESSIONS_DIR, { recursive: true });

const ROOT = join(import.meta.dirname, "..");
const A2A_BIN = join(ROOT, "bin", "aos-a2a.mjs");

const { send } = await import("../lib/a2a-client.mjs");
const { list } = await import("../lib/a2a-registry.mjs");

// ---- fake harness executables on PATH -----------------------------------------
// fake agy: prints a fixed answer on stdout (the agy resume reply IS its stdout).
const FAKE_AGY = "#!/usr/bin/env sh\nprintf 'FAKY-AGY-ANSWER\\n'\n";
// fake codex: extracts the taskId from the prompt's reply line (the sidecar
// passes the whole prompt as one argv entry; in queue mode it is $5) and writes
// the reply file via `node bin/aos-a2a.mjs reply` so the executor finds it.
const FAKE_CODEX = `#!/usr/bin/env sh
task_id=\$(printf '%s' "\$5" | sed -n 's/.* reply --name [^ ]* \\([0-9a-f-]*\\) .*/\\1/p')
AOS_A2A_NAME=serve-codex-ok node "${A2A_BIN}" reply "\$task_id" "FAKX-CODEX-ANSWER" >/dev/null
`;

const binDir = join(tmp, "fakebin");
mkdirSync(binDir, { recursive: true });
writeFileSync(join(binDir, "agy"), FAKE_AGY, { mode: 0o755 });
writeFileSync(join(binDir, "codex"), FAKE_CODEX, { mode: 0o755 });
chmodSync(join(binDir, "agy"), 0o755);
chmodSync(join(binDir, "codex"), 0o755);
process.env.PATH = `${binDir}${delimiter}${process.env.PATH}`;

// spawn("agy") / spawn("codex") without a shell cannot run the extensionless sh fakes (nor a .cmd) on Windows.
const SKIP_FAKES = process.platform === "win32" && "fake agy/codex are POSIX sh scripts; Windows spawn() cannot run them";

// A failed assert must never leave a sidecar behind: its piped stdio would keep this process alive until the watchdog.
const children = [];
after(() => {
  for (const c of children) {
    try { c.kill(); } catch { /* already gone */ }
    c.stdout?.destroy();
    c.stderr?.destroy();
    c.unref();
  }
});
const waitForRegistry = async (name, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (list().some((e) => e.name === name)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const startServe = async (args) => {
  const child = spawn(process.execPath, [A2A_BIN, "serve", ...args], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let err = "";
  child.stderr.on("data", (d) => { err += String(d); });
  return { child, stderr: () => err };
};

test("serve --mode agy resumes via the agy executor and completes with its stdout", { skip: SKIP_FAKES }, async () => {
  const name = "serve-agy-ok";
  const { child, stderr } = await startServe([
    "--name", name, "--harness", "agy", "--mode", "agy", "--parent-pid", String(process.pid),
  ]);
  try {
    assert.ok(await waitForRegistry(name), `sidecar did not register: ${stderr()}`);
    const res = await send({ to: name, from: "tester", text: "produce the word fakery", timeoutMs: 30000 });
    assert.equal(res.state, "TASK_STATE_COMPLETED", JSON.stringify(res));
    assert.match(res.artifacts?.[0]?.text ?? "", /FAKY-AGY-ANSWER/);
  } finally {
    child.kill();
  }
  await new Promise((r) => setTimeout(r, 200));
});

test("serve --mode codex (queue, default) completes via the file reply", { skip: SKIP_FAKES }, async () => {
  const name = "serve-codex-ok";
  const { child, stderr } = await startServe([
    "--name", name, "--harness", "codex", "--mode", "codex", "--thread", "thread-a",
    "--parent-pid", String(process.pid),
  ]);
  try {
    assert.ok(await waitForRegistry(name), `sidecar did not register: ${stderr()}`);
    const res = await send({ to: name, from: "tester", text: "produce the word fakery", timeoutMs: 30000 });
    assert.equal(res.state, "TASK_STATE_COMPLETED", JSON.stringify(res));
    assert.match(res.artifacts?.[0]?.text ?? "", /FAKX-CODEX-ANSWER/);
  } finally {
    child.kill();
  }
  await new Promise((r) => setTimeout(r, 200));
});

test("serve --mode codex without --thread exits non-zero", async () => {
  const out = await new Promise((resolve) => {
    const c = spawn(process.execPath, [A2A_BIN, "serve", "--name", "serve-codex-nothread", "--harness", "codex", "--mode", "codex"], {
      env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(c);
    let err = "";
    c.stderr.on("data", (d) => { err += String(d); });
    c.on("close", (code) => resolve({ code, err }));
  });
  assert.notEqual(out.code, 0);
  assert.match(out.err, /--thread/, "the error should mention --thread");
});

test("unknown --mode lists all four modes", async () => {
  const out = await new Promise((resolve) => {
    const c = spawn(process.execPath, [A2A_BIN, "serve", "--name", "serve-badmode", "--harness", "claude", "--mode", "turbo"], {
      env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(c);
    let err = "";
    c.stderr.on("data", (d) => { err += String(d); });
    c.on("close", (code) => resolve({ code, err }));
  });
  assert.notEqual(out.code, 0);
  for (const m of ["echo", "live", "agy", "codex"]) assert.ok(out.err.includes(m), `error text missing mode ${m}: ${out.err}`);
});
