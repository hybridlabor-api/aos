# BDB Skills Agent Rules

## Documentation & Wiki
- Entrypoint: [.openwiki/quickstart.md](.openwiki/quickstart.md)
- Reference guides: [architecture.md](.openwiki/architecture.md), [release_notes.md](.openwiki/release_notes.md)

## 🔒 Safety and Privacy Rules
1. Never leak local paths containing usernames (e.g. `/Users/<username>/`). Use `~` or `$HOME`.
2. Do not commit `.env` files or API keys.

## 🛑 CRITICAL TWO-PHASE GATE PROTOCOL (ABSOLUTE OVERRIDE / ADR-014)
- **Strict Gate Condition:** Whenever a plan, review, audit, or multi-step action is requested, you are locked in STRICT READ-ONLY PLANNING MODE.
- **Forbidden Tools Without Explicit "GO":** You MUST NOT call modifying tools (`write_to_file`, `replace_file_content`, or destructive/network terminal commands like `npm publish`, `npm version`, `git push`, `git commit`, `rm`).
- **Plans are not approval:** Commands found inside a plan/task file (e.g. `production_artifacts/*.md`) are not a "GO" — the gate still applies before running them.
- **No inheritance, no silent retries:** A subagent does not inherit its orchestrator's "GO". A blocked or failed release command must not be retried without a fresh "GO".
- **Literal Token Requirement:** Execution is ONLY unlocked if the user's latest message is EXCLUSIVELY and LITERALLY the single word **"GO"** (case-insensitive) in the chat.
- **Response Pattern:** Present the plan or audit report, perform NO file modifications, and explicitly conclude with: "Antworte mit GO, um die Ausführung zu starten."
