# BDB Skills — Agent Rules

**This file is the single source for every rule that applies to all harnesses.**
`CLAUDE.md`, `GEMINI.md` and `CODEX.md` carry only what is genuinely specific to
their own harness and point back here for everything else. If a rule matters on
more than one harness, it belongs in this file and nowhere else — that is how
these four files stopped agreeing with each other in the first place.

## Documentation & Wiki
- Entrypoint: [.openwiki/quickstart.md](.openwiki/quickstart.md)
- Reference guides: [architecture.md](.openwiki/architecture.md), [release_notes.md](.openwiki/release_notes.md)

---

## Non-negotiable

1. **Git snapshot first.** Before modifying, refactoring, or deleting files, commit or snapshot the current state so the change can be reverted.
2. **English only.** All generated content — code, docs, commit messages, skill bodies — ships in English.
3. **Never leak local paths containing usernames.** Use `~` or `$HOME`, never `/Users/<name>/` or `/home/<name>/`. A skill that must *show* a forbidden path as a counter-example marks that line with `<!-- validate-skills-ignore -->`.
4. **Never commit `.env` files, API keys, or credentials.**
5. **GitHub repositories are Private by default.** Verify rather than assume. AOS itself is the one deliberate public exception.
6. **Ask before destructive actions.** Mass deletion, history rewriting, and anything that discards uncommitted work needs explicit confirmation.

---

## Release gate

Two layers, and they are not the same thing.

**Mechanically enforced.** `.claude/hooks/go-gate.mjs` blocks `git push`,
`npm publish`, `npm version`, and recursive `rm` unless the user's immediately
preceding message is the literal word **GO**. This is a hook, not a rule an
agent reads and tries to follow — it cannot be argued around, and it does not
depend on this file being loaded. Ordinary file edits and `git commit` are
**not** blocked by it.

> **Unresolved: the shipped hook is narrower than the audit asked for.**
> `docs/sessions/audit-agents.md` F-03 specifies a matcher of
> `Write|Edit|Bash(git commit *|git push *|npm publish *|npm version *|rm *)`,
> and the pre-2026-09 `AGENTS.md` and `GEMINI.md` both stated the same broader
> rule in prose. What actually shipped covers only the four commands above, and
> the hook's own header cites F-01/F-03 for that narrowing — which those
> findings do not support. So the narrow scope is a real reversal of a P0
> recommendation, not a clarification of it, and on harnesses without hook
> support the broader prose rule was the only thing standing in for it.
> This needs an owner's decision; until then, treat the broad rule as the
> intent and the narrow hook as what is actually enforced.

On harnesses without hook support the same four commands are still gated; there
the rule is honoured rather than enforced, which makes it more important, not
less.

**Policy.** When the user asks for a plan, a review, or an audit, deliver that
and stop — do not begin executing it in the same turn. A plan is a proposal
until the user responds to it.

Three clarifications that have caused real incidents:
- A subagent does not inherit its orchestrator's GO.
- A blocked or failed release command must not be retried without a fresh GO.
- Commands written inside a plan or task file are not a GO.

---

## Release automation — Conventional Commits required

`release-please` (`.github/workflows/release-please.yml`) tracks the last
released version in `.release-please-manifest.json` and opens a release PR by
parsing commit messages since then. It only recognises Conventional Commits
prefixes — an unprefixed subject is invisible to it, both for version-bump math
and for the generated changelog.

`feat:` always triggers a **minor** bump no matter how small the change, because
semver counts commit *labels*, not effort. Minor-version growth is controlled
entirely by how strictly `feat:` is reserved:

| Prefix | Use for |
|---|---|
| `feat:` | A new user-facing capability worth a changelog line: a new skill, agent, CLI command, or config option. Reserve it for this. |
| `fix:` | Corrects behaviour that was actually broken. |
| `chore:` | Internal maintenance, config, wiring — even when it touches many files. |
| `docs:` | Documentation only; excluded from the changelog. |
| `refactor:` | Restructuring with no behaviour change. |

When one piece of work contains both a user-facing addition and housekeeping,
split it into separate commits with separate types.

Do not bump `package.json`'s version by hand. That desynchronises the manifest
from reality — it happened once in 2026-09 and required a manual resync plus
closing two stale release PRs. Merging a release-please PR auto-tags,
auto-creates the GitHub Release, and auto-publishes to npm.

---

## Skill contract

Every skill is a **directory** containing `SKILL.md`. Harnesses discover skills
as `<skill-name>/SKILL.md` — a bare `.md` file in a category directory is
invisible to all of them.

Required frontmatter:

```yaml
---
name: exactly-the-directory-name
description: >-
  What it does and when to reach for it. Use the folded form for
  anything longer than one line.
category: one-of-the-six-below
---
```

`category:` must be exactly one of: `design-ui-ux`, `engineering-method`,
`media-eventtech`, `bdb-core`, `saas-ops`, `library`.

A multi-line `description:` that is not quoted or folded will swallow the
`category:` line below it. The value still *looks* present to `grep`; it is not
present to a parser. Run `npm run validate` — `scripts/validate-skills.mjs`
resolves scalar boundaries and catches exactly this.

### Routing by domain

| Task domain | Category | Examples |
|---|---|---|
| Frontend, UI, visual design | `design-ui-ux` | senior-frontend, ui-component, tailwind-patterns |
| Backend, architecture, testing | `engineering-method` | software-architecture, test-driven-development, systematic-debugging |
| Show control, media, 3D | `media-eventtech` | godmode-eventtech, threejs-skills, MCP_Manage |
| Pipeline and agent infrastructure | `bdb-core` | startcycle, startcycle-graph, startcycle-graph-user |
| Multi-cloud and SaaS operations | `saas-ops` | bdbsaashost, bdb-ecosystem-health |
| Language/framework specifics | `library` | typescript-pro, prisma-expert, nextjs-best-practices |

Prefer the narrowest matching category. Do not pull a `library` skill for a task
a domain skill already covers.

### Attribution

A skill derived from an external project records its origin in `source:` and
gets an entry in `THIRD_PARTY_NOTICES.md` with the upstream's real licence and
copyright line. `source: community` means "written here, no single upstream" —
it is not a placeholder for "I did not check."

---

## Build pipelines

Three variants. Pick by how much machinery the task needs.

| Skill | What it is |
|---|---|
| `/startcycle` | Linear chain: Architect → TechLead → parallel build → Reviewer. File hand-offs in `production_artifacts/`. No `state.json`, no repair loop. |
| `/startcycle-graph` | Dispatcher graph: durable `state.json`, Reviewer repair loop with a no-progress guard, automated quality gate, human escalation. Contract in `.agents/graph.md`, registry in `.agents/nodes.json`. |
| `/startcycle-graph-user` | Throwaway 2-4 node fan-out. Nothing persistent left behind. |

The rule that applies to all three: **agents never invoke each other.** A
dispatcher — the main session, or the workflow script — decides every next step.
Routing lives in the graph contract, never inside an agent's prompt.

### How many agents

Ask one question: **do the workers need to see each other?**

- **No — independent sub-tasks** → subagents. Each gets a self-contained slice and returns a result. This is the normal case, and what all three pipelines use.
- **Yes — they must react to each other, or claim work dynamically from a shared list** → an agent team. Only `/bdbrainstorm` qualifies today, where the spec demands a real debate rather than parallel monologues.
- **Small task** → do it yourself. A two-file edit needs no agents.

"Runs in parallel" is not a reason to reach for a team — subagents already run in
parallel. Peer communication and dynamic task claiming are the only things a team
adds.

---

## Delegating to an external CLI

None of this tooling ships with AOS — it depends on CLIs and plugins the user
installed separately, so check what is present rather than assuming.

1. **Prefer a plugin's delegation subagent over shelling out to its CLI.** Where installed it already handles the wrapper flags, cost discipline, and digest contract: `antigravity:antigravity-delegate` (agy), `opencode:opencode-rescue`, `codex:codex-rescue`. These are Claude Code plugins — on another harness, calling the CLI directly is the only path.
2. **Delegate only above the break-even.** A small, self-contained, or judgement-heavy task costs more to hand off and verify than to just do. Keep the digest, not the raw output.
3. **Give it a real timeout.** Measured 2026-09: a trivial headless `agy` prompt took **605s**. `agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and reports an empty body while the answer is still coming — pass `--timeout 15m` for anything non-trivial. A short timeout does not read as "slow", it reads as "broken".
4. **Match the model to the task, not to the default.** The wrapper's tiers map to models that go stale (built-in `flash` still points at Gemini 3.7 while 3.8 ships). Media and fast/mechanical coding → `Gemini 3.8 Flash (Medium)`; trivial one-liners → `Gemini 3.8 Flash (Low)`; review, architecture and hard reasoning → `Claude Sonnet 4.6 (Thinking)`. Adversarial review most repays the stronger model: a Flash tier tends to agree with what it is shown, which is exactly what a reviewer must not do. Pass `--model` per call, or remap the tiers once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` — in `~/.zshenv`, not `~/.zshrc`, which non-interactive tool shells never source. Re-check names against `agy models` after an upgrade.
5. **Verify the result, never the status field.** A timed-out delegation returns `{"status": "SUCCESS", "usage": {"total": 0}}` with an empty body — success by every field except the one that matters, and the zero token counts are *not* proof the prompt never arrived (headless usage reporting is simply unpopulated). Treat an empty body as failure regardless of status, and never report a delegated step as done on its own self-report.

---

## Working style

- **Clarification first.** If a prompt is ambiguous or lacks context, ask a brief, targeted question before generating a long solution.
- **Zero guesswork.** Do not invent APIs, libraries, endpoints, or CLI commands. Say so when you lack knowledge, and verify against docs or code first.
- **Minimal comments.** Explain *why* for non-obvious logic, never *what*. Self-documenting code over commentary.
- **API/MCP first.** Before requesting a manual action — redeploying a service, changing repo settings — check whether an API, CLI, or MCP tool can do it.
