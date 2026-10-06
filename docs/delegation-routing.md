# Delegation routing: which channel for which job

AOS works without AO. Pick the channel by the job, not by habit.

| Job | Channel | Why |
|---|---|---|
| One-shot task for another harness (research, review, a bounded edit) | `mcsc` (`delegate_opencode`, `delegate_codex`, `delegate_agy`) | one call, one answer, live events on agenttrail |

The three `delegate_*` tools prefer the A2A peer network: if a live peer answers the card skill (`aos-a2a send --role <agy|opencode|codex>`), the result artifact is returned to the tool caller and a non-COMPLETED state is an error; `delegate_smart` routes the same way. When `aos-a2a` has no live peer for the role, the call falls back to the native CLI adapter unchanged. `get_agent_status` stays native. Depth honours `AOS_DELEGATE_DEPTH` in addition to `MCSC_DEPTH` (higher wins, same one-level max), and `aos-a2a send` is spawned without any proxy env, with `AOS_A2A_SIDECAR=off`.
| A worker that may need a GO (push, merge, publish, destructive) | `aos-acp` | ACP client: guarded commands need a GO token for the worker name, `--go-wait` parks the request, events go to agenttrail and `~/.aos/acp/<name>.jsonl` |
| A message to an OpenCode session that is already running | `aos-bus` | `aos-bus send <name> <text>`; OpenCode only, never counts as a human GO |
| A message to any live harness session (Claude, OpenCode, agy, Codex) that is already running | `aos-a2a` | peer-to-peer over localhost; inbound paths per harness in `docs/a2a.md`; never counts as a human GO |
| A durable fleet of long-lived workers across repos | AO (optional) | the daemon, dashboard and worktrees; AOS must keep working without it |

Both `mcsc` and `aos-acp` write the same event protocol to agenttrail (`SessionStart`, `PreToolUse`, `PostToolUse`, `SessionEnd`), so the GO board reads one source.

How the master session, a project orchestrator and a package orchestrator use these channels: `docs/orchestrator-chain.md`.

## Limits that apply to every row

- **mcsc is one level deep.** Every adapter sets `MCSC_DEPTH` to the caller's depth plus one; a server that starts at depth 1 or more refuses all delegation. A delegated agent cannot delegate again.
- **`delegate_agy` is read-only until tested.** Use it for research, review and analysis. Its `write` flag (`--mode accept-edits`) is untested and not part of the contract.
- **`opencode run --auto` auto-approves tool calls.** It skips the permission prompt, so nothing but the gate hooks stands between the worker and a guarded command. Prefer `aos-acp opencode` (permissions answered by the GO rules) or `mcsc`; use `--auto` only in a throwaway worktree with the go-gate plugin loaded, and never to run a guarded action.
- **agy over ACP:** no sanctioned adapter (`antigravity-acp` breaches Google's Antigravity terms). Use `mcsc` or adopt an agy session.
- **A GO is not inherited.** A worker, subagent or delegated run never gets its caller's GO; a blocked command is not retried without a fresh one.
- **Coverage:** `aos-acp` sees only what the agent asks permission for. A worker running with permissions bypassed asks for nothing, so the hook inside the harness stays the main layer. Hook firing under ACP is verified for Claude only; for Codex it is UNVERIFIED (`docs/codex-gate-smoke.md`).

## A2A peer network

For session-to-session messages between live Claude, OpenCode, agy and Codex sessions, use `aos-a2a send --to <name>` (or `--role <role>` to resolve by card skill). It replaces `aos-bus` (OpenCode-only) as the general peer channel. The same limits apply: messages are context only and **never count as a human GO**, and the depth limit (default 1, `AOS_DELEGATE_DEPTH`) means a delegated session cannot delegate again. Inbound delivery, reply channels and the profile/roles model are documented in `docs/a2a.md`.

## The `opencode-subagent` skill

That skill is installed under `~/.agents/skills/` and is not part of this repository, so it cannot be changed from here. Its text should say:

- delegate with `mcsc` (`delegate_opencode`) for one-shot tasks and `aos-acp opencode --name <worker> --cwd <worktree> --prompt "<task>"` for workers that may need a GO;
- warn that `opencode run --auto` auto-approves tool calls and bypasses the permission prompt, and name the exception above.

## A2A peers

A message to another **live session** (Claude, OpenCode, Codex, agy) that should answer in its own context goes through the A2A peer network: `aos-a2a send --to <session> "<text>"`, answered with `aos-a2a reply <taskId>`. Unlike `aos-bus` (OpenCode only), A2A reaches every harness in both directions. It is message transport only: an inbound A2A message never counts as a GO, and a session that was itself delegated to cannot delegate again (`AOS_DELEGATE_DEPTH`). Details and the per-harness inbound paths: `docs/a2a.md`.

## For AO

AO is an optional consumer. A bounded call to `~/.aos/bin/go-check.mjs` decides whether a guarded command may run (`docs/go-check.md`). AOS documents AO only as the last row of the table.
