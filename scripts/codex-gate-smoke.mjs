#!/usr/bin/env node
// Plan and runner for the Codex hook smoke test. Default: print the plan, run nothing.
// `--run` calls Codex, which calls a paid API, so it also needs AOS_CODEX_SMOKE=1 and a login
// inside the throwaway CODEX_HOME (printed in the plan). Everything about firing under ACP
// is UNVERIFIED until this has been run; see docs/codex-gate-smoke.md.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const PROBE = `import { appendFileSync, readFileSync } from "node:fs";
let input = {};
try { input = JSON.parse(readFileSync(0, "utf8")); } catch {}
const cmd = input?.tool_input?.command ?? "";
appendFileSync(process.env.AOS_SMOKE_MARKER, JSON.stringify({ at: new Date().toISOString(), keys: Object.keys(input), cmd }) + "\\n");
if (String(cmd).includes("SMOKE_DENY")) { process.stderr.write("smoke: denied by probe hook\\n"); process.exit(2); }
`;

export function buildConfig(probePath) {
  return [
    "[features]",
    "hooks = true",
    "",
    "[[hooks.PreToolUse]]",
    'matcher = "^(Bash|run_command)$"',
    "[[hooks.PreToolUse.hooks]]",
    'type = "command"',
    `command = ${JSON.stringify(`node "${probePath}"`)}`,
    "timeout = 10",
    "",
  ].join("\n");
}

export function steps({ dir = "<tmpdir>", bypassTrust = false } = {}) {
  const env = `CODEX_HOME=${dir}/codex-home AOS_SMOKE_MARKER=${dir}/marker.jsonl`;
  const trust = bypassTrust ? " --dangerously-bypass-hook-trust" : "";
  return [
    { id: "setup", text: `Throwaway CODEX_HOME ${dir}/codex-home with config.toml holding the [[hooks.PreToolUse]] stanza that runs ${dir}/probe-hook.mjs. Log in inside it (codex login, or OPENAI_API_KEY); never copy credentials from ~/.codex.` },
    { id: "exec-fires", cmd: `${env} codex exec${trust} --skip-git-repo-check -C ${dir} "Run the shell command: echo smoke-ok"`, expect: "marker.jsonl gains a line with cmd containing 'echo smoke-ok'. If not, hooks do not fire under codex exec (or the hook was not trusted)." },
    { id: "exec-denies", cmd: `${env} codex exec${trust} --skip-git-repo-check -C ${dir} "Run the shell command: echo SMOKE_DENY"`, expect: "marker line for SMOKE_DENY exists and the command did not run (the agent reports it was blocked)." },
    { id: "acp-fires", cmd: `${env} node ${join(root, "bin", "aos-acp.mjs")} codex --name smoke --cwd ${dir} --allow-default allow --timeout 180 --prompt "Run the shell command: echo smoke-acp"`, expect: "marker.jsonl gains a line with 'echo smoke-acp'. UNVERIFIED: if only the aos-acp permission request fires and the hook does not, aos-acp stays the only gate for Codex." },
    { id: "record", text: "Write the observed result of each step (and the Codex version) into docs/codex-gate-smoke.md, replacing UNVERIFIED with the date and the result. Hook input keys are in marker.jsonl ('keys')." },
  ];
}

const invokedAs = (() => { try { return realpathSync(process.argv[1] || ""); } catch { return ""; } })();
if (invokedAs === fileURLToPath(import.meta.url)) {
  const run = process.argv.includes("--run");
  const bypassTrust = process.argv.includes("--bypass-trust");
  if (!run) {
    console.log("Codex hook smoke plan (nothing is executed; add --run with AOS_CODEX_SMOKE=1 to run it)\n");
    for (const s of steps({ bypassTrust })) console.log(`[${s.id}] ${s.cmd ?? s.text}${s.expect ? `\n    expect: ${s.expect}` : ""}`);
    process.exit(0);
  }
  if (process.env.AOS_CODEX_SMOKE !== "1") { console.error("refusing to run: this calls a paid API. Set AOS_CODEX_SMOKE=1."); process.exit(2); }
  const dir = mkdtempSync(join(tmpdir(), "aos-codex-smoke-"));
  writeFileSync(join(dir, "probe-hook.mjs"), PROBE);
  const home = join(dir, "codex-home");
  mkdirSync(home);
  writeFileSync(join(home, "config.toml"), buildConfig(join(dir, "probe-hook.mjs")));
  const marker = join(dir, "marker.jsonl");
  for (const s of steps({ dir, bypassTrust }).filter((x) => x.cmd)) {
    const before = existsSync(marker) ? readFileSync(marker, "utf8").split("\n").length : 0;
    const r = spawnSync("sh", ["-c", s.cmd], { stdio: "inherit", timeout: 240000 });
    const after = existsSync(marker) ? readFileSync(marker, "utf8").split("\n").length : 0;
    console.log(`[${s.id}] exit ${r.status}; hook fired: ${after > before ? "YES" : "NO"}; expect: ${s.expect}`);
  }
  console.log(`marker and config kept in ${dir} (remove it yourself when done)`);
}
