# Delegation routing: which channel for which job

AOS works without AO. Pick the channel by the job, not by habit.

| Job | Channel | Why |
|---|---|---|
| One-shot task for another harness (research, review, a bounded edit) | `mcsc` (`delegate_opencode`, `delegate_codex`, `delegate_agy`) | one call, one answer, live events on agenttrail |
| A worker that may need a GO (push, merge, publish, destructive) | `aos-acp` | ACP client: guarded commands need a GO token for the worker name, `--go-wait` parks the request, events go to agenttrail and `~/.aos/acp/<name>.jsonl` |
| A message to an OpenCode session that is already running | `aos-bus` | `aos-bus send <name> <text>`; OpenCode only, never counts as a human GO |
| A durable fleet of long-lived workers across repos | AO (optional) | the daemon, dashboard and worktrees; AOS must keep working without it |

Both `mcsc` and `aos-acp` write the same event protocol to agenttrail (`SessionStart`, `PreToolUse`, `PostToolUse`, `SessionEnd`), so the GO board reads one source.

## Limits that apply to every row

- **mcsc is one level deep.** Every adapter sets `MCSC_DEPTH` to the caller's depth plus one; a server that starts at depth 1 or more refuses all delegation. A delegated agent cannot delegate again.
- **`delegate_agy` is read-only until tested.** Use it for research, review and analysis. Its `write` flag (`--mode accept-edits`) is untested and not part of the contract.
- **`opencode run --auto` auto-approves tool calls.** It skips the permission prompt, so nothing but the gate hooks stands between the worker and a guarded command. Prefer `aos-acp opencode` (permissions answered by the GO rules) or `mcsc`; use `--auto` only in a throwaway worktree with the go-gate plugin loaded, and never to run a guarded action.
- **agy over ACP:** no sanctioned adapter (`antigravity-acp` breaches Google's Antigravity terms). Use `mcsc` or adopt an agy session.
- **A GO is not inherited.** A worker, subagent or delegated run never gets its caller's GO; a blocked command is not retried without a fresh one.
- **Coverage:** `aos-acp` sees only what the agent asks permission for. A worker running with permissions bypassed asks for nothing, so the hook inside the harness stays the main layer. Hook firing under ACP is verified for Claude only; for Codex it is UNVERIFIED (`docs/codex-gate-smoke.md`).

## The `opencode-subagent` skill

That skill is installed under `~/.agents/skills/` and is not part of this repository, so it cannot be changed from here. Its text should say:

- delegate with `mcsc` (`delegate_opencode`) for one-shot tasks and `aos-acp opencode --name <worker> --cwd <worktree> --prompt "<task>"` for workers that may need a GO;
- warn that `opencode run --auto` auto-approves tool calls and bypasses the permission prompt, and name the exception above.

## For AO

AO is an optional consumer. A bounded call to `~/.aos/bin/go-check.mjs` decides whether a guarded command may run (`docs/go-check.md`). AOS documents AO only as the last row of the table.
