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
- **agy under `aos-acp`:** `aos-acp agy --name <n> --cwd <dir> --prompt-file <f> [--model gemini-3.8-flash-medium] [--print-timeout 900]` runs the vendor's own `agy --print` (same call as `mcsc` and `aos-a2a` spawn mode), not the third-party `antigravity-acp` shim. agy has no ACP server, so there are no per-tool permission requests for the GO rules to answer: `--allow-default deny` runs `--mode plan` (read-only), `scoped` runs `--mode accept-edits --sandbox` (aos does not narrow paths to the worktree; agy's sandbox and the `aos-go-gate` hook do), `allow` adds `--dangerously-skip-permissions`. `--print-timeout` is in seconds and goes to agy with an `s` suffix; agy reports status SUCCESS with an empty response when that timer fires, so an empty response counts as failure (exit 1). stdin is closed, because agy waits forever on an open pipe. Live check 2026-10-08 on the dev Mac: `agy -p "Reply with the single word OK" --model gemini-3.8-flash-medium --mode plan --print-timeout 60s --output-format json` with stdin closed (twice, once with stdin open) printed `[agy] print timeout after 1m0s with turn in progress` and JSON `{conversation_id, status: "SUCCESS", response: "", duration_seconds: 0, num_turns: 0, usage: {all 0}}`, so no answer was obtained and the cause is not determined (not stdin alone). A second call with `--project mcsc-delegate` and `--print-timeout 180s` returned the same empty shape after 3m0s. Two more single calls the same day, both with `--project mcsc-delegate --print-timeout 180s`, both timed out with the same empty shape and the stderr line about the print timeout: (a) plain `agy -p "..."` with stdin as inherited from the shell, (b) the same under a pseudo-terminal (`script -q /dev/null agy -p ...`). A non-TTY hang (antigravity-cli issue 318, from web research, not verified here) is therefore not what stops it on this Mac; `agy models` does answer, so the CLI starts and reaches the model catalog. The failure message names the likely causes (cold start, agy project, login state, model id) and does not claim more. The adapter treats exactly this shape as a failure. Whether the `aos-go-gate` hook fires under `agy --print` is UNVERIFIED (`docs/codex-agy-setup.md`); treat a write-mode agy worker like `opencode run --auto` and use a throwaway worktree.
- **Workers start without MCP servers unless the task needs them.** Every configured server's tool schemas load into the worker's context at start (the AOS gateway alone is well over 100); on GLM or Flash tiers that triggers autocompact thrash before the task begins. Claude Code: `--strict-mcp-config`. OpenCode: `OPENCODE_CONFIG_CONTENT='{"mcp":{"<name>":{"enabled":false}}}'` per connected server. `aos-acp` and `mcsc` set the OpenCode switch by default (opt-in: `aos-acp --with-mcp`, mcsc `mcp: true`). Codex: `codex exec -c mcp_servers.<name>.enabled=false` per configured server (names from `codex mcp list --json`, verified on codex-cli 0.162.1; `-c mcp_servers={}` merges and does not clear). `mcsc` sets it by default; `aos-acp` sets the same switch through `CODEX_CONFIG` for codex-acp, which takes no `-c` flags and is not yet verified live. Claude via `aos-acp` sends `mcpServers: []` in `session/new` (whether the adapter also skips the user's own servers is unverified). agy has no verified per-run switch, so its workers keep their MCP servers. Rule and examples: `AGENTS.md`, *Delegating to an external CLI*, item 6.
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
