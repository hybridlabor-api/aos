---
name: pb-deploy-saas
description: >-
  Deploy a SaaS app to the BDB fleet with 4-eyes approval: preflight of the
  fleet skills and the RemoteOS gateway, a guardrail plan, green CI, the deploy
  after GO (Incus via Forgejo CI, or direct rsync), the second human's approval
  read from the queue, and a health URL check. Use for "deploy this to the
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
verify: "curl -sI <health_url> returns 200 on the deployed version; approval entry logged with the approver"
difficulty: advanced
est_time: 30-90 min
---

# Deploy a SaaS app to the fleet
What you get: the app deployed to the chosen fleet instance after your GO and a second human's approval, with the approver and a health check logged.

## Inputs
- repo — the current directory, or the one the user names
- target_instance — the fleet instance to deploy to, asked if missing
- path — `incus-ci` (push to Forgejo, the runner deploys to Incus) or `direct` (rsync over SSH), asked if missing

## Steps
1. Preflight — `test -f ~/.claude/skills/bdbsaashost/SKILL.md`; `test -f ~/.claude/skills/deploy-incus/SKILL.md` (needed only for path = incus-ci); the RemoteOS gateway: load `remoteos_get_system_status` once via the harness tool search, then one call → run log header — a skill absent → stop with "Missing skill: <name> (installed locally only, not shipped by AOS). Install it under `~/.claude/skills/` or run this playbook on the machine that has it."; tool not loaded, call errors, or the payload reports the gateway down → stop with "Missing MCP: bdb_remoteos_mcp (remoteos_get_system_status unavailable). Start the RemoteOS gateway and check `mcpServers.bdb_remoteos_mcp` in your harness config."; write nothing except the run log — all probes answered
2. bdbsaashost (external) — repo, target_instance → deploy plan with target, guardrails and the health URL in the run log — stops for approval (the human confirms target, path and health URL)
3. pb-ci-fix — only if `gh run list --limit 1 --json conclusion` for the repo is not `success` (a repo with no GitHub CI is logged and skipped) → one pb-ci-fix run, with its own GO for the push — latest run is green, else stop
4. [GO] deploy — path = incus-ci: deploy-incus pushes the repo to the Forgejo remote, the push command is hook-guarded; path = direct: bdb-deploy runs `rsync` over SSH to the target, which is not hook-guarded (the same goes for `incus` commands), so this GO is the only guard there — the WAITING FOR GO line names the path, target_instance, the exact command, and the commit SHA. The run stops here until the human types GO. One GO = one deploy.
5. remoteos approval queue — `remoteos_approval_queue_list` → the entry for this deploy with its status and approver in the run log — the entry is decided by a second human; the agent never calls `remoteos_approval_queue_decide`. Pending → log "WAITING FOR APPROVAL: <entry id>" and wait for the human to report the decision; rejected → stop, nothing is retried
6. Health check — `curl -sI <health_url>` → status line and version marker in the run log — status 200 on the deployed version; otherwise stop and report, no automatic rollback

Run log: `production_artifacts/pb-deploy-saas-<date>.md` in the start directory, never committed

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
