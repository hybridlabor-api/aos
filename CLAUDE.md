# BDB Agent Skills — Global Instructions

## Docs & Pipeline
- Start here: `.openwiki/quickstart.md` (architecture: `.openwiki/architecture.md`, releases: `.openwiki/release_notes.md`)
- Multi-agent build pipeline: `/startcycle` — spec in `skills/basic/startcycle/SKILL.md`

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
