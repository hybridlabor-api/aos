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
`doubt-driven-development` discipline — see below). Node identity, model,
and skill allowlist now come from `.agents/nodes.json` (a declarative
registry the dispatcher loads at run start via a `load-registry` step) —
this table stays the routing summary; per-node config lives in the
registry, not here or in `.agents/agents.md`.

| Node | Reads | Writes | Never |
|---|---|---|---|
| **Architect** | `goal` | `artifacts.plan`, `phase: plan` | invokes TechLead itself |
| **TechLead** | `artifacts.plan` | `phase` (`build` or back to `plan`), capability-map approval | invokes Architect or the build nodes itself |
| **UI_UX** | `artifacts.plan`, own prior `findings` | own `state.d/ui_ux.json` fragment (never `state.json` directly — see Harness) | invokes Engineering/Media/Reviewer itself |
| **Engineering** | `artifacts.plan`, own prior `findings` | own `state.d/engineering.json` fragment (never `state.json` directly) | invokes UI_UX/Media/Reviewer itself |
| **Media_EventTech** | `artifacts.plan`, own prior `findings` | own `state.d/media_eventtech.json` fragment (only if the goal needs it; never `state.json` directly) | invokes the other build nodes itself |
| **Reviewer** | `artifacts.{frontend,backend,media}` **only** — never `goal`, never a build node's reasoning | `findings[]` | invokes a build node itself, or ever sees the original `goal`/CLAIM |
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
4. **No-progress guard, adapted from B3's "doubt theater" concept.** B3's
   original framing — escalate after 2 consecutive *clean* Reviewer cycles on
   the same artifact — doesn't have a reachable trigger once this contract
   became an actual runnable script (`.claude/workflows/startcycle-dispatch.mjs`): a
   clean result exits the build/review loop immediately, so Reviewer is never
   asked to re-confirm an already-clean artifact twice in a row. What the
   script implements instead, in the same spirit: if a repair round reports
   the **exact same blocking finding ID(s)** Reviewer already flagged before
   the build node was re-invoked to fix them, the dispatcher escalates
   immediately rather than burning the remaining iterations on a cycle that
   isn't making progress. Same intent (don't keep trusting a loop that isn't
   working), a form this control flow can actually reach.

## Edges

Evaluated by the dispatcher after every node returns, against `state.json` —
never inside a node's own prompt.

| After | Predicate | Dispatcher does |
|---|---|---|
| Architect | *(always)* | invoke TechLead |
| TechLead | plan rejected (capability map not approved) | `iteration++`, invoke Architect again |
| TechLead | plan approved | invoke UI_UX, Engineering, Media_EventTech (parallel — each is an independent dispatcher call, not one node fanning out to the others) |
| any build node | *(after all three return, or the ones the goal needs)* | invoke Reviewer |
| Reviewer | any `blocking` finding open, and it's a **new** finding ID | `iteration++`, invoke the owning build node (only that one, not all three) |
| Reviewer | the **same** `blocking` finding ID(s) as the previous cycle | set `needs_human: true`, `phase: escalated` — **stop** (no-progress guard, see above) |
| Reviewer | zero blocking findings | invoke Shipping |
| Shipping | any `gate.*` is `fail` | `iteration++`, invoke whichever build node(s) Shipping's own structured output names as owning the failing check(s) — the dispatcher does not guess a lint/test-to-node mapping itself |
| Shipping | all `gate.*` are `pass`/`skip` | `phase: ready_to_ship`, stop — surface "ready to ship, needs GO" to the user. The dispatcher does not itself check `approvals` for a prior GO here (see the Harness section's noted exception); the actual push/version/publish is a separate GO-gated step, enforced by `go-gate.mjs`, which does the GO check at the point it matters. |
| any | `iteration >= max_iterations` | **stop unconditionally**, `phase: escalated`, set `needs_human: true` — do not invoke anything further automatically |
| any | a node sets `needs_human: true` itself | stop, surface to the user (in-loop feedback edge, per B5's diagram — `/startcycle`'s original "zero-prompting" framing had removed this; it's restored here as an edge, not a constant interruption) |

## Harness (the loop-keeper)

Three layers now, matching §7's design rule — nothing normative lives only in
a Claude-only file:

- **Advisory** (every harness): this file, read by whatever plays the
  dispatcher role — the main Claude Code session, an Antigravity subagent
  loop, or an OpenCode primary agent. The edge table above is the contract
  regardless of which harness executes it.
- **Executable dispatcher (Claude Code only)**: `.claude/workflows/startcycle-dispatch.mjs`
  is the actual runnable implementation of this contract, using Claude
  Code's Dynamic Workflows runtime (a script holds the loop and branches;
  the seven agents are leaves it calls via `agent()`/`pipeline()`, never
  calling each other). The script's first action is a `load-registry` step
  that reads `.agents/nodes.json` for each node's `agentType`, `model`, and
  `skills` allowlist — if a required node id is missing from that file, the
  script escalates rather than falling back to a hardcoded list. It's a
  translation, not a re-derivation — every edge in the table above has a
  corresponding branch in that script, with two deliberate exceptions: the
  script stops at `phase: ready_to_ship` rather
  than checking `approvals` itself for a prior `GO` and proceeding to
  `phase: done` (the row above notes this explicitly). Re-running the whole
  plan→build→review loop just to check one flag would be wasteful; the
  actual push/version/publish is a separate GO-gated step, enforced by
  `go-gate.mjs`, which does the GO check at the point it matters. Verified by
  running the script's extracted logic against 9+ scripted scenarios before
  it was committed (happy path, TechLead rejection loop, Reviewer repair
  loop, the no-progress guard, gate-failure repair, missing goal), then by an
  adversarial review pass against this file and `state.schema.json` that
  found and fixed real gaps (an unpersisted iteration counter, `needs_human`
  never actually being written, and the Reviewer note that follows). The
  second exception: the three build nodes never write `state.json`
  directly. Because they run inside a `pipeline()` fan-out (genuinely
  parallel — each is an independent dispatcher call, not one node fanning
  out to the others per the table's own "Never" column), two of them
  writing the same file at once would race and silently drop an update.
  Each writes only its own `production_artifacts/state.d/<nodeId>.json`
  fragment instead; immediately after the `pipeline()` call returns (the
  barrier where every parallel node has finished), one dedicated `haiku`
  merge step folds every fragment into `state.json` before the run
  continues — never deferred, since `graph-gate.mjs` reads `state.json` at
  turn end. Sequential nodes (Architect, TechLead, Reviewer, Shipping) are
  never inside a `pipeline()` call, so they are not part of this race and
  keep writing `state.json` directly as the table above describes. Other
  harnesses without an equivalent "workflow" primitive fall back to this
  file as a manual dispatch guide followed turn-by-turn.
- **Deterministic safety net (Claude Code only, degrades to advisory
  elsewhere)**: `.claude/hooks/graph-gate.mjs`, a `Stop` hook that blocks
  turn-end while `state.json` shows a failing gate and
  `iteration < max_iterations` — see that file's own comments for the exact
  predicate. This exists independently of the workflow script above: it
  catches the case where someone continues a `/startcycle` run manually,
  turn by turn, outside the workflow runtime, and stops early despite a
  known-failing gate. It fails *open* (allows the stop) on a missing or
  malformed `state.json`, unlike `go-gate.mjs`'s fail-closed default — a
  stuck loop-keeper is a worse failure than one that occasionally lets a
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
