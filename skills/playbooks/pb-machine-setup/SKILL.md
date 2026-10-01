---
name: pb-machine-setup
description: >-
  Bring a new machine to a verified AOS installation: read-only doctor
  baseline, install after GO, MCP servers wired per harness with the configs
  backed up first, memB and OpenWiki checks, and a second doctor run for the
  delta. Use for "set up this machine", "onboard a new computer", "install AOS
  on this laptop".
category: bdb-core
kind: playbook
trigger: ["set up this machine", "onboard a new computer", "install AOS on this machine"]
inputs: [machine_role, harnesses]
requires:
  skills: [aos-setup, mcp-manage, memb-skill, openwiki-skill, "node (external)"]
  agents: []
  mcps: []
  store: []
go_points: [install]
outputs: ["production_artifacts/pb-machine-setup-<date>.md", "production_artifacts/pb-machine-setup-<date>/config-backup/"]
verify: "second doctor run shows zero failing rows, or each remaining one is logged with its fix hint"
difficulty: intermediate
est_time: 30-60 min
---

# New machine to a verified AOS install
What you get: a machine with AOS, MCP servers, hooks, memB and OpenWiki installed and checked by the doctor, with a before-and-after report and a backup of every harness config that was edited.

## Inputs
- machine_role — `dev`, `show` or `server`, asked if missing; a `server` skips the desktop-only rows (LaunchAgents, Synapse) and logs that choice
- harnesses — the harnesses to wire (Claude Code, Antigravity, Codex, OpenCode, Cursor, Roo), asked if missing; only these are touched

## Steps
1. aos-setup (Measure) — `command -v node` (Node 22 or newer, else stop with an install hint), then the doctor read-only, exactly as the aos-setup skill gives it: `node skills/global_config/aos-setup/scripts/aos-doctor.mjs` from the AOS repo, or `node ~/.claude/skills/aos-setup/scripts/aos-doctor.mjs` from an installed copy → baseline table (failing rows with their fix commands) in the run log — doctor ran, exit code and failing-row count logged; nothing was installed or edited. Then the backup: copy every harness config of the chosen harnesses (for example `~/.claude.json`, `~/.gemini/config/mcp_config.json`, `~/.codex/config.toml`, `opencode.jsonc`) into `production_artifacts/pb-machine-setup-<date>/config-backup/` and log the copied paths; a config that is missing is logged, not created — backup files exist before step 2, because the installer itself rewrites the harness configs
2. [GO] install — the install or update commands aos-setup section 3 gives for the harnesses chosen, for example `npx -y @hybridlabor-api/aos@latest` — the WAITING FOR GO line shows the exact command, the harness list and the backup path (and the installer's `--dry-run` output if aos-setup section 3 offers it). The run stops here until the human types GO. The hook does not guard npm installs, so this GO is the only guard; the installed `aos` binary is never run to inspect the version (it starts the full installer and rewrites harness configs).
3. mcp-manage — chosen harnesses → wire the MCP servers the machine_role needs per harness → server list per harness in the run log — this step never edits a config that step 1 has not backed up; a missing config is logged, not created blind
4. memb-skill and openwiki-skill — memB engine, MCP registration and ambient hook; OpenWiki CLI, `~/.openwiki/.env` credentials and refresh daemon → check results in the run log — each check passes or is logged with its fix hint from aos-setup; credentials are never written into the run log
5. aos-setup (Verify) — the doctor again, same command as step 1 → delta (fixed, still failing, new) in the run log — zero failing rows, or each remaining one logged with its fix hint and a note whether it is deliberate for this machine_role

Run log: `production_artifacts/pb-machine-setup-<date>.md` in the start directory, never committed; the config backups are never committed

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
