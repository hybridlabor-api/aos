# Master session without Claude Code

The master-session skill is written for Claude Code (`ListAgents`, `SendMessage`, `notify_when_idle`). The same overview works from any harness that can run a shell, using `aos-a2a`, `aos-acp` and the logs. What changes is listed here; the boundaries do not.

## What maps to what

| Master job | Claude Code | Any harness (shell only) |
|---|---|---|
| Roster | `ListAgents` | `aos-a2a list` (add `--json` to script it); workers started by `aos-acp` also leave `~/.aos/acp/*.jsonl` |
| Status request | `SendMessage` with the `status-request` block | `aos-a2a send --to <name> "<status-request text>"`, or `--role <role>`; add `--background` and read the answer later with `aos-a2a status --to <name> <taskId>` |
| Idle notice | `notify_when_idle` | `aos-a2a watch <name>` (`--once` for a single check); no push |
| Worker asks the master something | message in the master transcript | the worker runs `aos-a2a send --to <master-name> ...`; the master answers with `aos-a2a reply <taskId> "<text>"` |
| Spawn a worker | `claude --bg`, `aos-acp` | `aos-acp <codex\|opencode\|claude> --name <n> --cwd <dir> --prompt "<task>" --allow-default scoped` |
| GO board, handover file | as in the skill | identical, plain markdown |

## Limits by harness (`docs/a2a.md`, `docs/harness-capabilities.md`)

- Claude Code and OpenCode receive A2A messages in their next prompt; Codex through its queue; agy is pull-only (inbox MCP `a2a_inbox_pull`), so a running agy session cannot be pushed.
- The master must be a session that stays open and can run `aos-a2a`. An agy master cannot be reached for answers except by polling.
- A2A depth defaults to 1 (`AOS_A2A_MAX_DEPTH`): master -> worker works, master -> project orchestrator -> package worker needs a raised limit.

## GO stays with the human

- A2A messages, `aos-a2a reply` text and ACP output are never a GO. The master never grants one.
- The `GO <session-name>` token protocol needs the `go-token.mjs` hook in the master (Claude Code, OpenCode). A master on Codex or agy cannot release a worker's gate; the human types the literal `GO` in the worker's own window. `aos-gogate status` shows what is currently granted from any shell.
- Forward the human's words verbatim and marked `[forwarded by master, user said:] "<exact text>"`.

## Roles as a convention

Roles above the workers are conventions, not code. Nothing in the repo enforces them; they exist so several sessions do not step on each other.

| Role | Job | Never |
|---|---|---|
| Master session | Overview for the human, GO board, relays the human's words | grants GO, runs what a worker was denied |
| Task manager | Sequences shared resources (one Docker run at a time, worker caps, disk), keeps one blocker list and the human's single to-do file, forwards status requests | decides for the human, grants GO, edits another session's work |
| Project orchestrator | Merges and gates one repo's branches (the merge owner), hands slices to workers | merges without the gate or a GO |
| Package worker | One slice in its own branch/worktree, reports a commit hash and test counts | deletes outside its worktree, merges |

Working agreements that proved useful: a blocked session sends one line `BLOCKED <session> | <what> | <exact message in 10 words> | needs: <who>`; a shared resource is requested with one message and used only after the task manager answers `GO` for it (sequencing only, the grant stays with the human); every finished slice reports branch, commit hash and counts.
