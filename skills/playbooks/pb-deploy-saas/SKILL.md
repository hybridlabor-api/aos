---
name: pb-deploy-saas
description: >-
  Deploy a SaaS app to the BDB fleet: preflight of the fleet skills and the
  RemoteOS MCP, a guardrail plan, green CI, the deploy after GO (Incus via
  Forgejo CI, or direct rsync), and a health URL check. Use for "deploy this to the
  fleet", "deploy the SaaS app", "ship to the Incus instance".
category: saas-ops
kind: playbook
trigger: ["deploy this to the fleet", "deploy the SaaS app", "deploy to the Incus instance"]
inputs: [repo, target_instance, path]
requires:
  skills: [bdb-deploy, pb-ci-fix, "bdbsaashost (external)", "deploy-incus (external)"]
  agents: []
  mcps: [bdb_remoteos_mcp]
  store: []
go_points: [deploy]
outputs: ["production_artifacts/pb-deploy-saas-<date>.md"]
verify: "curl -sI <health_url> returns 200 and the version marker matches the deployed commit SHA"
difficulty: advanced
est_time: 30-90 min
---

# Deploy a SaaS app to the fleet
What you get: the app deployed to the chosen fleet instance after your GO, with a health check logged.

## Inputs
- repo — the current directory, or the one the user names
- target_instance — the fleet instance to deploy to, asked if missing
- path — `incus-ci` (push to Forgejo, the runner deploys to Incus) or `direct` (rsync over SSH), asked if missing

## Steps
1. Preflight — `test -f ~/.claude/skills/bdbsaashost/SKILL.md`; `test -f ~/.claude/skills/deploy-incus/SKILL.md` (needed only for path = incus-ci); the RemoteOS MCP: load `remoteos_get_system_status` once via the harness tool search, then one call (it proves only that the MCP is loaded; it never contacts the gateway) → run log header — a skill absent → stop with "Missing skill: <name> (installed locally only, not shipped by AOS). Install it under `~/.claude/skills/` or run this playbook on the machine that has it."; tool not loaded or call errors → stop with "Missing MCP: bdb_remoteos_mcp (remoteos_get_system_status unavailable). Start the RemoteOS gateway and check `mcpServers.bdb_remoteos_mcp` in your harness config."; write nothing except the run log — all probes answered
2. bdbsaashost (external) — repo, target_instance → deploy plan with target, guardrails and the health URL in the run log — stops for approval (the human confirms target, path and health URL)
3. pb-ci-fix — only if `gh run list --branch <default branch> --limit 1 --json conclusion` for the repo is not `success` (a repo with no GitHub CI is logged and skipped) → one pb-ci-fix run, with its own GO for the push — latest run is green, else stop
4. [GO] deploy — path = incus-ci: deploy-incus pushes the repo to the Forgejo remote, the push command is hook-guarded; path = direct: bdb-deploy runs `rsync` over SSH to the target, which is not hook-guarded (the same goes for `incus` commands), so this GO is the only guard there — RemoteOS approval does not cover a Forgejo push or an rsync, only actions run through its own tools (for example container manage), which this step does not use. The WAITING FOR GO line names the path, target_instance, the exact command, and the commit SHA. The run stops here until the human types GO. One GO = one deploy.
5. Health check — `curl -sI <health_url>` → status line and version marker in the run log — status 200 on the deployed version; otherwise stop and report, no automatic rollback

Run log: `production_artifacts/pb-deploy-saas-<date>.md` in the start directory, never committed

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
