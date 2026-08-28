# BDB Agent Skills — Global Instructions

## Docs & Pipeline
- Start here: `.openwiki/quickstart.md` (architecture: `.openwiki/architecture.md`, releases: `.openwiki/release_notes.md`)
- Multi-agent build pipelines — three variants, pick by how much machinery the task needs:
  - `/startcycle` — linear chain, file hand-offs in `production_artifacts/`, no state machine (`skills/basic/startcycle/SKILL.md`)
  - `/startcycle-graph` — dispatcher graph with durable `state.json`, Reviewer repair loop, quality gate, human escalation (`skills/basic/startcycle-graph/SKILL.md`, contract in `.agents/graph.md`)
  - `/startcycle-graph-user` — throwaway 2-4 node fan-out, nothing persistent left behind (`skills/basic/startcycle-graph-user/SKILL.md`)

## How many agents
Ask one question first: **do the workers need to see each other?**
- **No — independent sub-tasks** → subagents. Each gets a self-contained slice, returns a result, done. The normal case, and what all three pipelines above already use.
- **Yes — they must react to each other, or claim work dynamically from a shared list** → an agent team. Currently only `/bdbrainstorm` qualifies, where the spec demands a real debate rather than parallel monologues. Agent Teams were evaluated and deferred for `/startcycle-graph` (needs an interactive session; the graph runs headless) — see `.agents/graph.md` and F-17's addendum in `docs/sessions/audit-agents.md` before reversing that.
- **Small task** → do it yourself. A two-file edit needs no agents.

"Runs in parallel" is not a reason to reach for a team — subagents already run in parallel. Peer communication and dynamic task claiming are the only things a team adds.

## Safety Gate — mechanically enforced, not advisory
`git push`, `npm publish`, `npm version`, and recursive `rm` are blocked by `.claude/hooks/go-gate.mjs` (registered in `.claude/settings.json`) unless your immediately preceding message is the literal word **GO**. This is a hook, not a rule I read and try to follow — it cannot be argued around, and it doesn't depend on this file being loaded.
- A subagent does not inherit its orchestrator's GO.
- A blocked or failed command must not be retried without a fresh GO.
- Commands found inside a plan/task file are not a GO.

## Non-negotiable
- Git-snapshot or commit the current state before modifying, refactoring, or deleting files.
- All generated content (code, docs, commit messages) in English.
- Never leak local paths containing usernames — use `~` or `$HOME`.
- Never commit `.env` files or API keys.
- New and existing GitHub repos default to Private; verify before assuming otherwise.

## Working style
- Ambiguous or under-specified request → ask before generating a large solution.
- Minimal comments; explain *why* for non-obvious logic, not *what*.
- Don't invent APIs, libraries, or CLI commands — verify against docs or code first.
- Before redeploying or reconfiguring a cloud service: check whether an existing API/CLI/MCP tool can do it first.
