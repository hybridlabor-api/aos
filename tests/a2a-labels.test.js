import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tmp = mkdtempSync(join(tmpdir(), "a2a-labels-"));
process.env.AOS_SESSIONS_DIR = join(tmp, "sessions");

const reg = await import("../lib/a2a-registry.mjs");
const sess = await import("../lib/a2a-session.mjs");
const client = await import("../lib/a2a-client.mjs");

const binPath = fileURLToPath(new URL("../bin/aos-a2a.mjs", import.meta.url));

test("validLabel accepts valid string and rejects empty, whitespace, and >60 chars", () => {
  assert.equal(reg.validLabel("my-label"), "my-label");
  assert.equal(reg.validLabel("  trimmed  "), "trimmed");
  assert.equal(reg.validLabel("a".repeat(60)), "a".repeat(60));
  assert.throws(() => reg.validLabel(""), /invalid label/);
  assert.throws(() => reg.validLabel("   "), /invalid label/);
  assert.throws(() => reg.validLabel(null), /invalid label/);
  assert.throws(() => reg.validLabel(undefined), /invalid label/);
  assert.throws(() => reg.validLabel("a".repeat(61)), /invalid label/);
});

test("register({..., label}) stores label in session file", () => {
  reg.register({ name: "ses-label-1", harness: "claude", label: "Master Session" });
  const file = join(process.env.AOS_SESSIONS_DIR, "ses-label-1.json");
  assert.ok(existsSync(file));
  const data = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(data.label, "Master Session");
  assert.equal(data.name, "ses-label-1");
  assert.equal(data.harness, "claude");
});

test("register() defaults label from env AOS_A2A_LABEL when not passed", () => {
  const old = process.env.AOS_A2A_LABEL;
  try {
    process.env.AOS_A2A_LABEL = "Env Label";
    reg.register({ name: "ses-label-env", harness: "agy" });
    const file = join(process.env.AOS_SESSIONS_DIR, "ses-label-env.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(data.label, "Env Label");
  } finally {
    if (old === undefined) delete process.env.AOS_A2A_LABEL;
    else process.env.AOS_A2A_LABEL = old;
  }
});

test("sessionLabel in a2a-session reads and validates env AOS_A2A_LABEL", () => {
  assert.equal(sess.sessionLabel({ env: { AOS_A2A_LABEL: "Test Role" } }), "Test Role");
  assert.equal(sess.sessionLabel({ env: {} }), undefined);
  assert.throws(() => sess.sessionLabel({ env: { AOS_A2A_LABEL: "x".repeat(65) } }), /invalid label/);
});

test("ensureSidecar passes --label into args when label is present", () => {
  const calls = [];
  sess.ensureSidecar({
    harness: "claude",
    sessionId: "sid-1234",
    parentPid: 999,
    env: { AOS_A2A_LABEL: "Sidecar Role" },
    spawnImpl: (cmd, args, opts) => {
      calls.push({ cmd, args, opts, pid: 111, unref: () => {} });
      return calls[calls.length - 1];
    },
    binPath,
  });
  assert.equal(calls.length, 1);
  const args = calls[0].args;
  const labelIndex = args.indexOf("--label");
  assert.ok(labelIndex >= 0);
  assert.equal(args[labelIndex + 1], "Sidecar Role");
});

test("setLabel updates label in session file and rejects invalid label or missing session", () => {
  reg.register({ name: "ses-label-mod", harness: "opencode", label: "Initial" });
  const updated = reg.setLabel("ses-label-mod", "New Label");
  assert.equal(updated.label, "New Label");
  const data = JSON.parse(readFileSync(join(process.env.AOS_SESSIONS_DIR, "ses-label-mod.json"), "utf8"));
  assert.equal(data.label, "New Label");

  assert.throws(() => reg.setLabel("ses-label-mod", ""), /invalid label/);
  assert.throws(() => reg.setLabel("ses-label-mod", "x".repeat(61)), /invalid label/);
  assert.throws(() => reg.setLabel("nonexistent-ses", "Some Label"), /no session file/);
});

test("list() includes label in returned objects and book", () => {
  reg.register({ name: "ses-list-1", harness: "claude", label: "Worker 1" });
  reg.register({ name: "ses-list-2", harness: "agy" }); // no label -> null
  const sessions = reg.list();
  const s1 = sessions.find((s) => s.name === "ses-list-1");
  const s2 = sessions.find((s) => s.name === "ses-list-2");
  assert.ok(s1);
  assert.ok(s2);
  assert.equal(s1.label, "Worker 1");
  assert.equal(s2.label, null);

  const bookEntries = reg.book();
  const b1 = bookEntries.find((b) => b.name === "ses-list-1");
  const b2 = bookEntries.find((b) => b.name === "ses-list-2");
  assert.ok(b1);
  assert.ok(b2);
  assert.equal(b1.label, "Worker 1");
  assert.equal(b2.label, null);
});

test("resolveTarget matches session name first", async () => {
  reg.register({ name: "ses-target-name", harness: "claude", label: "other-label" });
  reg.register({ name: "other-name", harness: "agy", label: "ses-target-name" });

  // "to" matches ses-target-name by name first, even though another has that label
  const target = await client.resolveTarget({ to: "ses-target-name" });
  assert.equal(target.name, "ses-target-name");
  assert.equal(target.label, "other-label");
});

test("resolveTarget matches label case-insensitively and exact", async () => {
  reg.register({ name: "ses-target-lbl", harness: "claude", label: "Task Manager" });
  const t1 = await client.resolveTarget({ to: "Task Manager" });
  assert.equal(t1.name, "ses-target-lbl");

  const t2 = await client.resolveTarget({ to: "task manager" });
  assert.equal(t2.name, "ses-target-lbl");

  const t3 = await client.resolveTarget({ to: "TASK MANAGER" });
  assert.equal(t3.name, "ses-target-lbl");

  // Substring must NOT match
  await assert.rejects(
    () => client.resolveTarget({ to: "Task" }),
    /no live registry entry for "Task"/
  );
});

test("resolveTarget throws listing candidates when more than one session matches label", async () => {
  reg.register({ name: "peer-a", harness: "claude", label: "Shared Role" });
  reg.register({ name: "peer-b", harness: "agy", label: "shared role" });

  await assert.rejects(
    () => client.resolveTarget({ to: "SHARED ROLE" }),
    (err) => {
      assert.match(err.message, /multiple sessions match/);
      assert.match(err.message, /peer-a \(Shared Role\)/);
      assert.match(err.message, /peer-b \(shared role\)/);
      return true;
    }
  );
});

test("resolveTarget throws existing error when neither name nor label matches", async () => {
  await assert.rejects(
    () => client.resolveTarget({ to: "nonexistent-target" }),
    /no live registry entry for "nonexistent-target"/
  );
});

test("CLI aos-a2a label sets label with --name and with default AOS_A2A_NAME", () => {
  reg.register({ name: "cli-label-ses", harness: "claude" });

  const r1 = spawnSync(process.execPath, [binPath, "label", "--name", "cli-label-ses", "CLI Label 1"], {
    env: { ...process.env },
    encoding: "utf8",
  });
  assert.equal(r1.status, 0, r1.stderr);
  const out1 = JSON.parse(r1.stdout.trim());
  assert.equal(out1.name, "cli-label-ses");
  assert.equal(out1.label, "CLI Label 1");

  const r2 = spawnSync(process.execPath, [binPath, "label", "CLI Label 2"], {
    env: { ...process.env, AOS_A2A_NAME: "cli-label-ses" },
    encoding: "utf8",
  });
  assert.equal(r2.status, 0, r2.stderr);
  const out2 = JSON.parse(r2.stdout.trim());
  assert.equal(out2.name, "cli-label-ses");
  assert.equal(out2.label, "CLI Label 2");
});

test("CLI aos-a2a list prints label, harness, cwd, status, age and --json includes label", () => {
  reg.register({ name: "cli-list-ses", harness: "claude", label: "List Role" });

  const rText = spawnSync(process.execPath, [binPath, "list"], {
    env: { ...process.env },
    encoding: "utf8",
  });
  assert.equal(rText.status, 0, rText.stderr);
  const line = rText.stdout.split("\n").find((l) => l.includes("List Role"));
  assert.ok(line, `expected line with label in output: ${rText.stdout}`);
  const parts = line.split("\t");
  assert.equal(parts.length, 5);
  assert.equal(parts[0], "List Role");
  assert.equal(parts[1], "claude");
  assert.ok(parts[2].length >= 0); // cwd
  assert.equal(parts[3], "idle"); // status
  assert.match(parts[4], /^\d+[smh]$/); // age

  const rJson = spawnSync(process.execPath, [binPath, "list", "--json"], {
    env: { ...process.env },
    encoding: "utf8",
  });
  assert.equal(rJson.status, 0, rJson.stderr);
  const jsonArr = JSON.parse(rJson.stdout);
  const entry = jsonArr.find((e) => e.name === "cli-list-ses");
  assert.ok(entry);
  assert.equal(entry.label, "List Role");
});

test("CLI aos-a2a list prunes dead sidecars by default", () => {
  const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
  reg.register({ name: "dead-sidecar", harness: "agy", pid: deadPid });
  const file = join(process.env.AOS_SESSIONS_DIR, "dead-sidecar.json");
  assert.ok(existsSync(file));

  const r = spawnSync(process.execPath, [binPath, "list"], {
    env: { ...process.env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  // Dead sidecar was pruned on list
  assert.ok(!existsSync(file));
});
