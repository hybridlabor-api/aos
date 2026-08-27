# BDB Agent Graph — `/startcycle` v2

Harness-neutral contract for the autonomous build pipeline. Replaces the linear
hand-off framing in `skills/basic/startcycle/SKILL.md` §"Deterministic 4-Phase
Pipeline" with a dispatcher-mediated graph. See `audit-agents.md` §6 and F-17
for the analysis behind this design; this file is the buildable spec.

**Read this before touching `/startcycle`'s control flow.** The single rule
that matters: **nodes never call each other.** A node reads `state.json`, does
its work, writes `state.json`, and returns. The dispatcher — the main session,
or a slash command acting on the user's behalf — is the only thing that
decides which edge fires next. This is not a Claude Code platform limit (it
permits nested subagent calls up to 3 levels); it's a deliberate choice for
context fidelity, single-place auditability of routing logic, and
cross-harness portability (§7 of the audit). If you find yourself writing
"and then this agent hands off to that agent," stop — that decision belongs
in this file's edge table and in the dispatcher, not inside an agent's prompt.

## State

The full schema is `.agents/state.schema.json`, persisted at
`production_artifacts/state.json`. Markdown artifacts
(`production_artifacts/{00_execution_plan,01_frontend_spec,...}.md`) stay the
human-readable payload; `state.json` is what the dispatcher's edges evaluate.
Every node reads `state.json` at the start of its turn and writes it back
before returning — this is what replaces "hand-off," and it's why a node
never needs another node's reasoning: `goal` and prior artifacts are always
read from the same typed record, not re-derived from a sibling's prose.

## Nodes

Seven, up from the original five — `Planner_Orchestrator` is split into
**Architect** (system plan) and **TechLead** (execution coordination,
capability-map approval) per the reference diagram (B5), and an explicit
**Reviewer** is added (B1's adversarial-review step, modeled on B3's
`doubt-driven-development` discipline — see below). Definitions live in
`.agents/agents.md`; this table is the routing summary only.

| Node | Reads | Writes | Never |
|---|---|---|---|
| **Architect** | `goal` | `artifacts.plan`, `phase: plan` | invokes TechLead itself |
| **TechLead** | `artifacts.plan` | `phase` (`build` or back to `plan`), capability-map approval | invokes Architect or the build nodes itself |
| **UI_UX** | `artifacts.plan`, own prior `findings` | `artifacts.frontend` | invokes Engineering/Media/Reviewer itself |
| **Engineering** | `artifacts.plan`, own prior `findings` | `artifacts.backend` | invokes UI_UX/Media/Reviewer itself |
| **Media_EventTech** | `artifacts.plan`, own prior `findings` | `artifacts.media` (only if the goal needs it) | invokes the other build nodes itself |
| **Reviewer** | `artifacts.{frontend,backend,media}` **only** — never `goal`, never a build node's reasoning | `findings[]`, `doubt_theater_streak` | invokes a build node itself, or ever sees the original `goal`/CLAIM |
| **Shipping** | `artifacts.*`, `findings` (all must be `fixed`/`wont_fix`) | `gate.*`, `artifacts.report`, `phase: ship\|done` | invokes anything, or ships with an open `blocking` finding |

### Reviewer discipline (from B3's `doubt-driven-development`, adopted verbatim)

The Reviewer is the one node most likely to be miswired into "just read what
the implementer said and check if it sounds right" — that is the failure mode
this discipline exists to prevent:

1. Pass the Reviewer **`artifacts.*` and the plan's stated contract only** —
   never the implementer's own claim that it's done, never their reasoning.
   Passing the claim biases toward agreement.
2. The dispatcher's invocation prompt to Reviewer must be adversarial:
   *"Find what is wrong with this artifact against its contract. Assume the
   author is overconfident. Do NOT validate. Do NOT summarize."*
3. Classify every finding against a fixed precedence, first match wins:
   contract misread → valid and actionable → valid trade-off (advisory, not
   blocking) → noise (discard).
4. **Doubt theater.** If `doubt_theater_streak` reaches 2 (two consecutive
   Reviewer cycles with zero `blocking` findings on the *same* artifact), the
   dispatcher does not run a third identical cycle — it sets
   `needs_human: true` and surfaces "the reviewer may be validating rather
   than doubting" to the user instead of looping again.

## Edges

Evaluated by the dispatcher after every node returns, against `state.json` —
never inside a node's own prompt.

| After | Predicate | Dispatcher does |
|---|---|---|
| Architect | *(always)* | invoke TechLead |
| TechLead | plan rejected (capability map not approved) | `iteration++`, invoke Architect again |
| TechLead | plan approved | invoke UI_UX, Engineering, Media_EventTech (parallel — each is an independent dispatcher call, not one node fanning out to the others) |
| any build node | *(after all three return, or the ones the goal needs)* | invoke Reviewer |
| Reviewer | any `blocking` finding open | `iteration++`, `doubt_theater_streak = 0`, invoke the owning build node (only that one, not all three) |
| Reviewer | zero blocking findings, `doubt_theater_streak < 2` | `doubt_theater_streak++`, invoke Shipping |
| Reviewer | zero blocking findings, `doubt_theater_streak >= 2` | set `needs_human: true`, `phase: escalated` — **stop, do not invoke Shipping automatically** |
| Shipping | any `gate.*` is `fail` | `iteration++`, invoke the build node the failing check maps to (lint/typecheck/tests → Engineering or UI_UX depending on where it failed; a11y/seo → UI_UX) |
| Shipping | all `gate.*` are `pass`/`skip`, no `approvals` entry with token `GO` yet | stop, surface "ready to ship, needs GO" to the user |
| Shipping | all `gate.*` pass, `approvals` has a `GO` | `phase: done` — proceed to `/ship` |
| any | `iteration >= max_iterations` | **stop unconditionally**, `phase: escalated`, set `needs_human: true` — do not invoke anything further automatically |
| any | a node sets `needs_human: true` itself | stop, surface to the user (in-loop feedback edge, per B5's diagram — `/startcycle`'s original "zero-prompting" framing had removed this; it's restored here as an edge, not a constant interruption) |

## Harness (the loop-keeper)

Two layers, matching §7's design rule — nothing normative lives only in a
Claude-only file:

- **Advisory** (every harness): this file, read by whatever plays the
  dispatcher role — the main Claude Code session, an Antigravity subagent
  loop, or an OpenCode primary agent. The edge table above is the contract
  regardless of which harness executes it.
- **Deterministic** (Claude Code only, degrades to advisory elsewhere):
  `.claude/hooks/graph-gate.mjs`, a `Stop` hook that blocks turn-end while
  `state.json` shows a failing gate and `iteration < max_iterations` — see
  that file's own comments for the exact predicate. This is what makes the
  repair loop actually unattended instead of depending on the model
  remembering to keep going. It fails *open* (allows the stop) on a missing
  or malformed `state.json`, unlike `go-gate.mjs`'s fail-closed default —
  a stuck loop-keeper is a worse failure than one that occasionally lets a
  turn end early; see the hook's own comments.

`max_iterations` defaults to 3 (see `.agents/state.schema.json`) — deliberately
under Claude Code's own 8-consecutive-Stop-hook-block override
(`code.claude.com/docs/en/best-practices`), so this graph's own escalation
message reaches the user before that platform ceiling would silently end the
turn without one.

## What this does not change

- The five build-and-ship agent *identities* (`Godmode_UI_UX`,
  `Godmode_Engineering`, `Godmode_Media_EventTech`, `Godmode_Shipping`, plus
  the split `Architect`/`TechLead`) keep their existing skills, MCP servers,
  and output artifacts as defined in `.agents/agents.md` — this file adds
  routing, not new responsibilities.
- `production_artifacts/*.md` stays the human-readable output. `state.json`
  is additive infrastructure, not a replacement for the markdown.
- Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) were evaluated and
  deferred for this graph specifically because spawning teammates requires an
  interactive session and `/startcycle` needs to run headless — see F-17's
  addendum in `audit-agents.md` for the full reasoning. Revisit if `/startcycle`
  ever becomes interactive-only by design.
