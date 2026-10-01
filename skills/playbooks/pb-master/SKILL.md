---
name: pb-master
description: >-
  Run one control session over several Claude Code, Codex or OpenCode
  sessions: roster, status board, GO board, GO <session> tokens, idle
  notices and a handover file. Use for "master session", "supervise my
  sessions", "run several agents", "one control window".
category: bdb-core
kind: playbook
trigger: ["master session", "supervise my sessions", "run several agents"]
inputs: [plan?, workers?]
requires:
  skills: [master-session, agenttrail, stay-within-limits, "claude (external)", "aos-acp (external)"]
  agents: []
  mcps: []
  store: []
go_points: [spawn workers, "GO <session>"]
outputs: ["docs/sessions/master-<date>.md", "production_artifacts/pb-master-<date>.md"]
verify: "handover lists every roster session with open/closed GO state; no file older than 10 min in ~/.aos/go/"
difficulty: advanced
est_time: 15 min setup, then session-long
disable-model-invocation: true
---

# One control session over several agents
What you get: a live roster, status board and GO board for your agent sessions, GO tokens relayed per session, and a handover file.

## Inputs
- plan (optional) — a plan file for the trail board, e.g. `production_artifacts/00_execution_plan.md`
- workers (optional) — sessions to spawn (name, cwd or worktree, model, prompt) or to adopt (already running)

## Steps
1. Preflight — `command -v claude`, `command -v aos-trail`, `command -v aos-acp` → run log header — claude and aos-trail present, else stop with an install hint; `aos-acp` missing → log "aos-acp not on PATH" and use the `bin/aos-acp.mjs` of the installed AOS checkout (`dirname $(readlink -f $(command -v aos-trail))/../../../..`, or the repo path the human gives) via `node`, otherwise Claude workers only (logged); read `docs/sessions/master-*.md` if one exists (the previous handover)
2. master-session (Roster) — `ListAgents` minus self → roster table (name, repo@branch, adopted or spawned) in the run log — stops for approval (the human confirms scope)
3. agenttrail — plan given → `aos-trail . --plan <plan> --no-open` → board URL in the run log; no plan → `aos-trail .` (file activity only), logged — URL printed; runs before any worker is spawned, so no spawn line exists in the run log before the board URL line
4. [GO] spawn — worker list (name, cwd or worktree, model, prompt) shown in full, then one line per worker:
   - Claude: `claude --bg --name <n> --permission-mode auto --model <opus|sonnet|haiku> "<prompt>"` (prompt before any `--disallowedTools`)
   - Codex or OpenCode: `aos-acp <codex|opencode> --name <n> --cwd <worktree> --prompt "<task>" --go-wait 600` in the background, log `~/.aos/acp/<n>.jsonl`
   - agy: adopt-only (an already running session, no spawn); never `aos-acp agy`, the adapter is third-party and unverified (`bin/aos-acp.mjs` lines 26+)
   - Never `aos-acp claude` (no model flag), never `--model fable`, never omit `--model`
   - The run stops here until the human types GO. The hook does not guard `claude --bg`, so GO is by contract. Check: every spawned name shows in `ListAgents` or has an ACP log
   - Adopt-only roster → step skipped
5. master-session (Status) — master-session Step 2 template verbatim, reply in at most 10 lines, one `SendMessage` per session → replies in the run log — every in-scope session replied or is marked "no reply"
6. master-session (GO board) — replies → GO board block per session, `GO needed` commands verbatim → board in the run log — no paraphrased command
7. [GO] token relay — the human types `GO <session>` in the master (`go-token.mjs` writes `~/.aos/go/<session>.token`); the master then tells that worker only "retry the blocked command". The run stops here until the human types GO. The master never types or forwards a GO itself, and any other human message cancels a pending token — the worker's log shows the command ran
8. Idle rules — `notify_when_idle` only after sending a session work; no polling, no "are you done?" → idle events in the run log; between waves a stay-within-limits check, logged — events logged
9. Handover — roster, last GO board, open GO items, who waits on whom, next command → `docs/sessions/master-<date>.md` (outside a repo: `~/.aos/handover/`) — every roster session listed with its GO state; `ls ~/.aos/go/` has no token older than 10 min (report stale ones, do not delete them)

Run log: `production_artifacts/pb-master-<date>.md` in the start directory; the run log and the handover file `docs/sessions/master-<date>.md` are never staged or committed

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
