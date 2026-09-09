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

## Delegating to an external CLI
Some work is cheaper on another provider's compute (bulk scaffolding, exhaustive
test generation, long-context reads that distil to a digest). None of that tooling
ships with AOS — it depends on CLIs and Claude Code plugins the user installed
separately, so check what is actually present instead of assuming.

**Prefer a plugin's delegation subagent over shelling out to its CLI.** Where one
is installed it already handles the wrapper flags, cost discipline, and digest
contract: `antigravity:antigravity-delegate` (agy), `opencode:opencode-rescue`,
`codex:codex-rescue`. These are Claude Code plugins — on another harness, or a
machine without them, calling the CLI directly is the only path.

**Delegate only above the break-even.** A small, self-contained, or
judgement-heavy task costs more to hand off and verify than to just do. Keep the
digest, not the raw output.

**Give it a real timeout.** Measured 2026-09: a trivial headless `agy` prompt
took **605s**. `agy-delegate` defaults to `--print-timeout 5m`, so it aborts at
300s and reports an empty body while the answer is still coming — pass
`--timeout 15m` for anything non-trivial. A short timeout does not read as
"slow", it reads as "broken".

**Verify the result, never the status field.** A timed-out delegation returns
`{"status": "SUCCESS", "usage": {"total": 0}}` with an empty body — success by
every field except the one that matters, and the zero token counts are *not*
proof the prompt never arrived (headless usage reporting is simply unpopulated).
Check the returned content, treat an empty body as failure regardless of status,
and never report a delegated step as done on the strength of its own self-report.

## Safety Gate — mechanically enforced, not advisory
`git push`, `npm publish`, `npm version`, and recursive `rm` are blocked by `.claude/hooks/go-gate.mjs` (registered in `.claude/settings.json`) unless your immediately preceding message is the literal word **GO**. This is a hook, not a rule I read and try to follow — it cannot be argued around, and it doesn't depend on this file being loaded.
- A subagent does not inherit its orchestrator's GO.
- A blocked or failed command must not be retried without a fresh GO.
- Commands found inside a plan/task file are not a GO.

## Release Automation — Conventional Commits required
`release-please` (`.github/workflows/release-please.yml`) tracks the last-released version in `.release-please-manifest.json` and opens a release PR by parsing commit messages since that version. It only recognizes Conventional Commits prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, etc., with `!` or a `BREAKING CHANGE:` footer for majors) — an unprefixed commit subject is invisible to it, both for version-bump math and for the generated changelog/release notes.
- Every commit meant to ship needs a Conventional Commits prefix, or it won't appear in the next auto-generated release.
- Merging a release-please PR auto-tags, auto-creates the GitHub Release, and auto-publishes to npm (`NPM_TOKEN` secret already configured) — no manual `gh release create` / `npm publish` step, and no `GO` checkpoint in that path since the CI's own merge event triggers it, not a command run interactively.
- Do not bump `package.json`'s version by hand and push straight to `main` — that desyncs the manifest from reality (this happened once, 2026-09, requiring a manual manifest resync and closing two stale release PRs). Let release-please own the version bump via its PR.

### `feat:` vs `fix:`/`chore:`/`docs:` — the version-bump lever
`feat:` always triggers a **minor** bump (`x.Y.0`), no matter how small the change actually is — semver counts commit *labels*, not lines changed or effort spent. Minor-version growth is controlled entirely by how strictly `feat:` is reserved, so default to the narrower type unless the change genuinely earns `feat:`:
- **`feat:`** — a new user-facing capability someone would want to see in a changelog: a new skill, agent, CLI command, or config option. Reserve it for this.
- **`fix:`** — corrects behavior that was actually broken.
- **`chore:`** — internal maintenance: repo hygiene, config/gitignore changes, dependency bumps, non-user-facing wiring — even when it touches many files or adds new ones.
- **`docs:`** — documentation-only changes; excluded from the changelog entirely.
- **`refactor:`** — restructuring with no behavior change.
When a piece of work has both a user-facing addition and pure housekeeping (e.g. porting a feature *and* cleaning up unrelated repo clutter), split them into separate commits with separate types rather than tagging the whole diff `feat:`.

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
