---
name: pb-idea-to-launch
description: >-
  Turn an idea into a deployed prototype: a spec from brainstorming, a visual
  plan of the ComfyUI workflow, a prototype built with startcycle, one hero
  image, green CI, then push and deploy after separate GOs. Use for "idea to
  launch", "from idea to a live prototype", "build and deploy this idea".
category: engineering-method
kind: playbook
trigger: ["idea to launch", "from idea to live prototype", "build and deploy this idea"]
inputs: [idea, repo_or_new_project, comfy_workflow, deploy_target]
requires:
  skills: [bdbrainstorm, grill-me, plan-canvas, prototype, startcycle, pb-ci-fix, bdb-deploy, github, "gh (external)"]
  agents: [architect, techlead, reviewer]
  mcps: [comfyui-mcp]
  store: []
go_points: ["git push", "deploy"]
outputs: ["production_artifacts/pb-idea-to-launch-<date>.md", "production_artifacts/pb-idea-to-launch-<date>/spec.md", "production_artifacts/pb-idea-to-launch-<date>/plan.md", "production_artifacts/pb-idea-to-launch-<date>/hero.png"]
verify: "gh run list --commit <sha> conclusion == success; curl -sI <url> returns 200"
difficulty: advanced
est_time: 2-6 h
---

# Idea to deployed prototype
What you get: an idea turned into a deployed prototype with green CI and one hero image, pushed and deployed only after your GO.

## Inputs
- idea — a short description, asked once
- repo_or_new_project — an existing checkout, or a name for a new project
- comfy_workflow — path to a ComfyUI API-format workflow JSON, required, never invented
- deploy_target — the host and path or the target the human names, asked once

## Steps
1. Preflight — one probe `check_comfyui_health` on `comfyui-mcp` (MCP tools may be deferred in the harness: try to load the tool once via the harness tool search before declaring it missing) → run log header — tool not loaded, call errors, or `status` is not `"online"` → log "Missing MCP: `comfyui-mcp` (`check_comfyui_health` unavailable). Start ComfyUI and check `mcpServers.comfyui-mcp` in your harness config." and mark step 5 to stop; steps 2 to 4 still run
2. bdbrainstorm or grill-me — idea → `production_artifacts/pb-idea-to-launch-<date>/spec.md` — spec written, open questions listed
3. plan-canvas (Plan Builder mode) — the workflow and the planned prototype screens → `plan.md` in the same folder — stops for approval
4. prototype, then startcycle (architect, techlead, reviewer) — spec and plan → prototype in the repo (a new project: a new local directory, no remote yet) — reviewer reports no open `blocking` finding
   - Commit: a new project gets `git init` first; the reviewed prototype files are staged by explicit path (never `git add -A`) and committed — SHA in the run log; the working tree has no uncommitted product files afterwards
5. ComfyUI — the workflow file's text (prompt filled in) as the JSON string for `queue_prompt` → `get_history <prompt_id>` status success → `get_output_media_info` path copied to `hero.png` in the run folder — one image; `local_path` is only set when `COMFYUI_DIR` is set, so if `local_path` is empty or `exists_locally` is false, stop with a clear message and copy nothing; preflight failed in step 1 → stop with the "Missing MCP" message and write nothing except the run log
6. pb-ci-fix (setup path) — run its steps up to and including the commit, but not its push step → workflow files committed, SHA in the run log — validator zero errors, commit hook passes; the push is covered by step 7, so pb-ci-fix's own push GO is skipped here
7. [GO] git push — SHA → remote branch (name the branch in the WAITING FOR GO line). A new project without a remote: `gh repo create <owner>/<name> --private --source . --remote origin` runs in the same GO, never public, never any other visibility; the line names owner and name. The run stops here until the human types GO. The hook guards `git push`; `gh repo create` is not hook-guarded, so this GO is its only guard.
8. github — SHA → `<id>` from `gh run list --commit <sha> --limit 1 --json databaseId` (wait until it exists), then `gh run watch <id> --exit-status` — `gh run list --commit <sha> --json conclusion -q '.[0].conclusion'` equals `success`; otherwise back to pb-ci-fix's debugging steps, at most 2 cycles, each push behind a fresh GO as in step 7, then stop and escalate
9. [GO] bdb-deploy — build from the committed tree only (a clean checkout of the pushed SHA, e.g. `git worktree add <scratch> <sha>`, removed with `git worktree remove <scratch>` (no `--force`) when the deploy ends or the run stops) and rsync to `deploy_target`, the target, the file list and the command shown in full. The run stops here until the human types GO. The rsync deploy is not hook-guarded, so this GO is its only guard.
10. Check — `curl -sI <url>` → status line in the run log — returns 200

Run log: `production_artifacts/pb-idea-to-launch-<date>.md` in the start directory, never committed

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries beyond what a step names.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
