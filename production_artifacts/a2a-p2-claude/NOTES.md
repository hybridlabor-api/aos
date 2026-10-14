# P2 Claude: wake an idle interactive session — notes

Branch `feat/51-p2` (base `feat/51-all`). Step 1 of the brief (plugin monitor) is built; the decisive live idle
test is still open and needs an interactive Claude session on the Mac.

## What was built

- `lib/a2a-monitor.mjs`: pid binding (`<sessionsDir>/claude-pids/<pid>.name`), name resolution
  (`AOS_A2A_NAME`, else nearest bound ancestor, re-read every tick), `drainOnce` (claim by rename to `.delivered`,
  one line per message), `runMonitor` (1 s poll, stdout = notifications only, exits when the parent is gone).
- `plugins/bdb-aos/monitors/monitors.json` (`when: "always"`) + `a2a-inbox-monitor.mjs` (thin wrapper; lib from the
  checkout `../../../lib` when the plugin is loaded in place, else `~/.agents/lib`, which the installer already fills
  with every `lib/a2a-*.mjs`).
- `.claude/hooks/a2a-session.mjs` (SessionStart) writes the binding after `ensureSidecar` returns a name.
- Backstop unchanged: `.claude/hooks/a2a-inbox.mjs drain` (UserPromptSubmit) and `stop`.
- Tests: `tests/a2a-monitor.test.mjs` (13 cases, in `npm test`).

## Design decisions

- **One line per message.** Claude turns each monitor output line into a notification; the multi-line injection is
  joined with ` ⏎ `. Safe because the quoted body escapes `<`, `>`, `[`, `]`, so the end marker and tags cannot be
  forged inside it (tested).
- **Reply command uses the real PATH, not `""`.** The brief says `replyCommand(taskId, undefined, "", session)`.
  With `pathEnv = ""` the command is always the absolute `node "<...>/bin/aos-a2a.mjs" reply ...` form, which is
  not covered by the pre-approved `Bash(aos-a2a reply:*)` rule, so an idle session would stop at a permission
  prompt and the sender would time out. The monitor inherits Claude's environment, so its PATH matches the Bash
  tool's; it renders the short form when `aos-a2a` is on PATH and falls back to the absolute form otherwise, exactly
  like the drain hook. `--name <session>` is always spelled out. Revert to `""` in `renderLine` if the dispatcher
  wants the literal brief.
- **Name via pid binding.** Monitors receive no `session_id` and no `CLAUDE_PLUGIN_*` env. The hook binds its chain
  from its parent up to the first `comm` containing `claude` (else the first non-shell, which covers the npm `node`
  install). Ceiling: Windows (no `ps`) needs `AOS_A2A_NAME`.

## Idle test (decisive, NOT yet run)

Prerequisite: the bdb-aos plugin must load the monitor — reinstall/refresh the plugin from this branch, or start
with `claude --plugin-dir <worktree>/plugins/bdb-aos`.

1. Terminal A: `AOS_A2A_LABEL=p2-idle claude` and leave it idle at the prompt (do not type).
2. Check the task panel lists the `a2a-inbox` monitor; check `~/.aos/sessions/claude-pids/` holds the binding.
3. Terminal B: `aos-a2a send --to p2-idle "ping: reply with pong" --timeout 60`.
4. Pass: Claude acts without input, runs the reply command, terminal B prints `TASK_STATE_COMPLETED` within 60 s.

Result: _pending_ (fill in: woke yes/no, latency, whether the notification text was shown in full).

## If the monitor does not wake an idle session

Next per brief: `asyncRewake: true` hook (exit 2 with the injection, re-armed from Stop), then the opt-in channel
server (`experimental['claude/channel']`). `drainOnce`/`renderLine` are reusable for both.
