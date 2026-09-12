# AOS — Claude Code

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to Claude Code.

## The release gate is a real hook here

`.claude/hooks/go-gate.mjs` (registered in `.claude/settings.json`) mechanically
blocks `git push`, `npm publish`, `npm version`, and recursive `rm` unless your
immediately preceding message is the literal word **GO**. On this harness the
gate is enforced, not merely honoured — you cannot argue around it, and it works
whether or not this file was loaded. See AGENTS.md for the policy layer and the
three clarifications that have caused real incidents.

## Delegation subagents available on this harness

These ship as Claude Code plugins and are the preferred path over shelling out
to the underlying CLI, because they already handle wrapper flags, cost
discipline, and the digest contract:

- `antigravity:antigravity-delegate` — agy / Gemini
- `opencode:opencode-rescue`
- `codex:codex-rescue`

On any other harness, calling the CLI directly is the only path. The break-even
rule and the "verify the result, never the status field" rule are in AGENTS.md
and apply identically.

## Pipeline entry points

- `/startcycle` — `skills/basic/startcycle/SKILL.md`
- `/startcycle-graph` — `skills/basic/startcycle-graph/SKILL.md`, contract in `.agents/graph.md`, registry in `.agents/nodes.json`, dispatcher at `.claude/workflows/startcycle-dispatch.mjs`
- `/startcycle-graph-user` — `skills/basic/startcycle-graph-user/SKILL.md`

Agent personas live in `.claude/agents/`. Agent Teams were evaluated and
deferred for `/startcycle-graph` — it runs headless and teams need an
interactive session. Read `.agents/graph.md` and F-17's addendum in
`docs/sessions/audit-agents.md` before reversing that.

## Validating a skill change

```bash
npm run validate          # the skill contract, as CI enforces it
npm test                  # selftest + validate
```
