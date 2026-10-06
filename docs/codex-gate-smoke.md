# Codex hook smoke test (plan only, not run)

Question: does a `PreToolUse` hook fire (a) under `codex exec` and (b) under `aos-acp codex`? If it fires, `go-gate.mjs` is the inner gate for Codex like it is for agy and OpenCode. If it does not under ACP, `aos-acp` stays the only gate for Codex and keeps refusing guarded commands without a GO token.

**Status: nothing here has been run.** Codex calls a paid API, so the test needs a working login and your knowledge. Everything below that says UNVERIFIED stays that way until `scripts/codex-gate-smoke.mjs --run` was executed and the result is written in the table at the end.

## What is known (codex-cli 0.154.0, from the plan's section 9b)

- `codex features list` shows `hooks stable true`; events include PreToolUse, PermissionRequest, PostToolUse, SessionStart, UserPromptSubmit, Stop.
- Config: `[[hooks.PreToolUse]]` with `matcher` (regex on the tool name) and `[[hooks.PreToolUse.hooks]]` with `type = "command"`, `command`, `timeout` in `~/.codex/config.toml`.
- Deny: exit 2 with the reason on stderr, or JSON `decision: "block"` with a reason. `go-gate.mjs` already does this for Codex.
- Codex keeps a trust state per hook (`--dangerously-bypass-hook-trust` exists). New or changed hooks probably need your approval: **UNVERIFIED**.
- Hook input: `transcript_path`, `prompt`, `tool_input.command` confirmed; `session_id` and `tool_name` not confirmed.

## Installer

The default install already writes the go-gate `[[hooks.PreToolUse]]` stanza (matcher `^(Bash|run_command)$`) into the Codex `config.toml` block between `# AOS:HOOKS:START` and `# AOS:HOOKS:END`. `aos --codex-gate` prints exactly that stanza plus the trust note and exits without writing anything, so you can inspect or copy it. Codex asks you to trust new or changed hooks; approve the go-gate hook there or it stays inactive.

## Procedure

`node scripts/codex-gate-smoke.mjs` prints the plan and executes nothing. `AOS_CODEX_SMOKE=1 node scripts/codex-gate-smoke.mjs --run` runs it in a throwaway `CODEX_HOME` with a probe hook that appends each hook call to a marker file (and denies a command containing `SMOKE_DENY`). Log in inside that `CODEX_HOME` yourself; the script never reads `~/.codex`. `--bypass-trust` adds `--dangerously-bypass-hook-trust` to the Codex calls.

| Step | Command shape | Pass |
|---|---|---|
| exec-fires | `codex exec ... "Run the shell command: echo smoke-ok"` | marker has a line for that command |
| exec-denies | same with `echo SMOKE_DENY` | marker line exists and the command did not run |
| acp-fires | `aos-acp codex --name smoke --cwd <dir> --allow-default allow --prompt "Run the shell command: echo smoke-acp"` | marker has a line for that command |

The `CODEX_HOME` variable and the `-C` flag of `codex exec` are assumed from general knowledge of the CLI and are UNVERIFIED; adjust the plan if Codex rejects them.

## Decision after the run

- exec fires, ACP fires: wire go-gate as the inner gate for Codex under ACP; `aos-acp codex` can then default to `--no-consume` like claude and opencode (the hook consumes the token).
- exec fires, ACP does not: keep `aos-acp codex` as the gate (`consume` stays on); document that Codex workers are covered only by `aos-acp`.
- exec does not fire: check the trust state first; otherwise Codex has no inner gate at all.

## Results

## Delete hard block and block cooldown (same classifier everywhere)

- Deleting, moving away or `rsync --delete`-ing `/`, the home directory or a direct child of it is blocked unconditionally by `hardBlockReason` in `go-gate.mjs`; no GO, grant, mode or token lifts it. The Claude hook, the OpenCode plugin, `aos-acp` (Codex over ACP) and `go-check` all call it.
- After a block, a script file written later than the block needs a fresh GO for 10 minutes. The marker is `~/.aos/gate/<key>.block`. Keys: Claude hook = session id (else conversation id, transcript path or cwd, prefixed `x-`); OpenCode = the OpenCode session id; `aos-acp` and `go-check` = the worker name (`--name` / `--session`). A host that sends no stable key (a hook input without session id, transcript path and cwd) has no cooldown.
- Limits: an agent can backdate a script (`touch -t`), run a script written before the block, or remove the marker through a path built at run time (literal paths into `~/.aos/gate` are hard-blocked).

## Known limits of the gate

- The pattern gate is a tripwire, not a security boundary. It stops accidents and obvious routes, not an agent that is trying to get around it.
- Indirections are not covered: `eval`, `awk system()`, `source`, commands piped into a shell's stdin from a file, `npm run`, `make`, and code that builds a command at run time. Code that decodes or evals a built string is classified as unscoped (needs a GO), nothing more.
- A GO can be forged by an agent that writes its own transcript or the `~/.aos` token and grant files. The hook cannot tell a forged entry from a real one.
- Push scopes read the git config files directly (system, XDG, `~/.gitconfig` of the OS user, repo, `config.worktree`; no `include`). Tests point that lookup at a temp home with `AOS_GATE_TEST_REALHOME`, which the gate honours only when `AOS_TEST_SANDBOX` or `NODE_TEST_CONTEXT` is set; production always uses the OS user's home.
- Analysis runs under a 150 ms budget: past it a command is unscoped (guarded, GO needed). The hard-block pass has no budget and runs first.
- Real protection needs a separate OS user or a sandbox. Policy summary: recursive delete or move of home, `/` or a top-level directory of home is a hard block; one file directly in home and overwriting a dotfile there need a GO (not grantable); a command over 16 KB needs a GO.

| Step | Date | Codex version | Result |
|---|---|---|---|
| exec-fires | | | UNVERIFIED |
| exec-denies | | | UNVERIFIED |
| acp-fires | | | UNVERIFIED |
