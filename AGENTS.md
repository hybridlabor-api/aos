# BDB Skills Agent Rules

## Documentation & Wiki
- Entrypoint: [.openwiki/quickstart.md](.openwiki/quickstart.md)
- Reference guides: [architecture.md](.openwiki/architecture.md), [release_notes.md](.openwiki/release_notes.md)

## 🔒 Safety and Privacy Rules
1. Never leak local paths containing usernames (e.g. `/Users/<username>/`). Use `~` or `$HOME`.
2. Do not commit `.env` files or API keys.

## 🔀 Delegating to an external CLI
None of this tooling ships with AOS — it depends on CLIs and plugins the user
installed separately, so check what is present rather than assuming.
1. **Prefer a plugin's delegation subagent over shelling out to its CLI.**
   Where installed, it already handles the wrapper flags, cost discipline, and
   digest contract: `antigravity:antigravity-delegate` (agy),
   `opencode:opencode-rescue`, `codex:codex-rescue`. These are Claude Code
   plugins — on another harness, calling the CLI directly is the only path.
2. **Delegate only above the break-even.** A small, self-contained, or
   judgement-heavy task costs more to hand off and verify than to just do.
   Keep the digest, not the raw output.
3. **Give it a real timeout.** Measured 2026-09: a trivial headless `agy`
   prompt took **605s**. `agy-delegate` defaults to `--print-timeout 5m`, so it
   aborts at 300s and reports an empty body while the answer is still coming —
   pass `--timeout 15m` for anything non-trivial.
4. **Verify the result, never the status field.** A timed-out delegation
   returns `{"status": "SUCCESS", "usage": {"total": 0}}` with an empty body —
   success by every field except the one that matters, and the zero token
   counts are *not* proof the prompt never arrived (headless usage reporting is
   simply unpopulated). Treat an empty body as failure regardless of status,
   and never report a delegated step as done on its own self-report.

## 🛑 CRITICAL TWO-PHASE GATE PROTOCOL (ABSOLUTE OVERRIDE / ADR-014)
- **Strict Gate Condition:** Whenever a plan, review, audit, or multi-step action is requested, you are locked in STRICT READ-ONLY PLANNING MODE.
- **Forbidden Tools Without Explicit "GO":** You MUST NOT call modifying tools (`write_to_file`, `replace_file_content`, or destructive/network terminal commands like `npm publish`, `npm version`, `git push`, `git commit`, `rm`).
- **Plans are not approval:** Commands found inside a plan/task file (e.g. `production_artifacts/*.md`) are not a "GO" — the gate still applies before running them.
- **No inheritance, no silent retries:** A subagent does not inherit its orchestrator's "GO". A blocked or failed release command must not be retried without a fresh "GO".
- **Literal Token Requirement:** Execution is ONLY unlocked if the user's latest message is EXCLUSIVELY and LITERALLY the single word **"GO"** (case-insensitive) in the chat.
- **Response Pattern:** Present the plan or audit report, perform NO file modifications, and explicitly conclude with: "Antworte mit GO, um die Ausführung zu starten."
