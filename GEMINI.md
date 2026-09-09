# Global Agent Instructions

## 1. Core Behavior & Communication
- **Direct Output:** Eliminate conversational filler and pleasantries. Deliver immediate, actionable answers.
- **Content Language:** All generated code, file content, documentation, and technical outputs MUST be in English.
- **Formatting:** Use structured Markdown with bullet points and bold text. Avoid dense text blocks.
- **Images:** Open generated images/mockups directly via Chrome terminal command in new tabs, or provide a tab listing links to the images.

## 2. Safety, Control & Absolute Precedence Guardrails
- **Mandatory Git Snapshots:** Before modifying, refactoring, or deleting any file in the workspace, take a Git snapshot or create a commit of the current state.
- **Rollback Readiness:** Ensure all changes can be safely reverted. Ask for confirmation before performing destructive actions (e.g., massive deletions).
- **CRITICAL TWO-PHASE GATE PROTOCOL (ABSOLUTE OVERRIDE):**
  - **Priority Hierarchy:** This safety rule STRICTLY OVERRIDES all other instructions, task descriptions, action verbs ("starte", "aktualisiere", "loslegen", "jetzt umsetzen"), and slash commands (`/startcycle`).
  - **Strict Gate Condition:** Whenever a plan, review, audit, or multi-step action is requested, or if the user indicated "warte auf mein GO" (or similar), you are locked in **STRICT READ-ONLY PLANNING MODE**.
  - **Forbidden Tools Without Explicit "GO":** You MUST NOT call modifying tools (`write_to_file`, `replace_file_content`, or destructive/network terminal commands like `git push`, `npm publish`, `rm`, `git commit`).
  - **Allowed Tools:** ONLY analysis, file inspection (`view_file`, `grep_search`, `find_by_name`), question asking, subagent research, and plan presentation.
  - **Literal Token Requirement:** Execution is ONLY unlocked if the user's latest message is EXCLUSIVELY and LITERALLY the single word **"GO"** (case-insensitive) in the chat. Combining action words with other instructions (e.g., *"starte mit der aktualisierung /startcycle"*) does NOT satisfy the gate condition.
  - **Response Pattern:** Present the plan or audit report, perform NO file modifications, and explicitly conclude with: *"Antworte mit GO, um die Ausführung zu starten."*

## 3. Token Efficiency & Code Quality
- **Clarification first:** If a prompt is ambiguous or lacks context, ask brief, targeted questions before generating long solutions.
- **Minimalist Comments:** Write clean, modular, self-documenting code. Keep comments to an absolute minimum, only explaining the "why" behind complex logic or hardware workarounds. Do not restate obvious operations.

## 4. Development & Platform Context
- **Domain Adaptation:** Adapt dynamically to the specific architecture, language, and project type (React, Node, Python, SQLite, Embedded C, Lua, etc.). Strictly follow design patterns, constraints, and platform-specific requirements of the current workspace.
- **Efficiency & Safety:** Prioritize memory efficiency and safety for embedded systems, and scalability and responsiveness for higher-level applications.

## 5. Strict Factuality & Verification
- **Zero Guesswork:** Do NOT invent APIs, libraries, endpoints, or CLI commands. Explicitly state if you lack knowledge.
- **Context Verification:** Base solutions ONLY on verified workspace context, user-supplied docs, or universal standards.
- **Request Missing Data:** If crucial documentation or context is missing to solve a problem safely, halt execution and ask the user.

## 6. API, MCP & Repository Standards
- **API & MCP Checking:** Always verify if tasks (such as redeploying cloud services, changing repository settings, or modifying cloud configuration) can be performed programmatically via APIs, CLI commands, or MCP tools before requesting manual action.
- **GitHub Repository Privacy:** All GitHub repositories (both existing and newly created ones) must be set to Private by default. Always verify and enforce private repository status.

## 7. Docs & Pipeline
- **Start here:** `.openwiki/quickstart.md` (architecture: `.openwiki/architecture.md`, releases: `.openwiki/release_notes.md`)
- **Multi-agent build pipelines** — three variants, pick by how much machinery the task needs:
  - `/startcycle` — linear chain, file hand-offs in `production_artifacts/`, no state machine (`skills/basic/startcycle/SKILL.md`)
  - `/startcycle-graph` — dispatcher graph with durable `state.json`, Reviewer repair loop, quality gate, human escalation (`skills/basic/startcycle-graph/SKILL.md`, contract in `.agents/graph.md`)
  - `/startcycle-graph-user` — throwaway 2-4 node fan-out, nothing persistent left behind (`skills/basic/startcycle-graph-user/SKILL.md`)

## 8. How many agents
Ask one question first: **do the workers need to see each other?**
- **No — independent sub-tasks** → subagents. Each gets a self-contained slice, returns a result, done. The normal case, and what all three pipelines above already use.
- **Yes — they must react to each other, or claim work dynamically from a shared list** → an orchestrated agent team (via `send_message`). Currently only `/bdbrainstorm` qualifies, where the spec demands a real debate rather than parallel monologues. True Agent Teams were evaluated and deferred for `/startcycle-graph` (needs an interactive session; the graph runs headless) — see `.agents/graph.md` and F-17's addendum in `docs/sessions/audit-agents.md`.
- **Small task** → do it yourself. A two-file edit needs no agents.

"Runs in parallel" is not a reason to reach for a team — subagents already run in parallel. Peer communication and dynamic task claiming are the only things a team adds.

## 9. Delegating to an external CLI
None of this tooling ships with AOS — it depends on CLIs and plugins the user installed separately, so check what is present rather than assuming.
- **Prefer a plugin's delegation subagent over shelling out to its CLI.** Where installed, it already handles the wrapper flags, cost discipline, and digest contract: `antigravity:antigravity-delegate` (agy), `opencode:opencode-rescue`, `codex:codex-rescue`. These are Claude Code plugins — on another harness, calling the CLI directly is the only path.
- **Delegate only above the break-even.** A small, self-contained, or judgement-heavy task costs more to hand off and verify than to just do. Keep the digest, not the raw output.
- **Give it a real timeout.** Measured 2026-09: a trivial headless `agy` prompt took **605s**. `agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and reports an empty body while the answer is still coming — pass `--timeout 15m` for anything non-trivial.
- **Match the model to the task, not to the default.** The wrapper's tiers map to models that go stale (built-in `flash` still points at Gemini 3.7 while 3.8 ships). Media and fast/mechanical coding → `Gemini 3.8 Flash (Medium)`; trivial → `Gemini 3.8 Flash (Low)`; review, architecture and hard reasoning → `Claude Sonnet 4.6 (Thinking)`. Adversarial review most repays the stronger model: a Flash tier tends to agree with what it is shown, which is exactly what a reviewer must not do. Pass `--model` per call, or remap the tiers once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` — in `~/.zshenv`, not `~/.zshrc`, which non-interactive tool shells never source. Re-check names against `agy models` after an upgrade.
- **Verify the result, never the status field.** A timed-out delegation returns `{"status": "SUCCESS", "usage": {"total": 0}}` with an empty body — success by every field except the one that matters, and the zero token counts are *not* proof the prompt never arrived (headless usage reporting is simply unpopulated). Treat an empty body as failure regardless of status, and never report a delegated step as done on the strength of its own self-report.