# Autonomous Development Cycle Workflow (/startcycle)

This workflow defines the zero-prompting, multi-agent execution pipeline triggered after a `/bdbrainstorm` or `/grill-me` session.

---

## Process Architecture

```
                  ┌──────────────────────────────────────────────┐
                  │ 1. BRAINSTORM & SPECIFICATION                │
                  │    (/bdbrainstorm / /grill-me)               │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 2. AUTONOMOUS CYCLE (/startcycle)            │
                  │    • Task Decomposition & Architecture       │
                  │    • Parallel Frontend/Backend/Media Streams │
                  │    • Verification & Quality Gate             │
                  └──────────────────────┬───────────────────────┘
                                         │
                        ┌────────────────┴────────────────┐
                        ▼                                 ▼
         ┌───────────────────────────────┐ ┌──────────────────────────────┐
         │ 3a. OPENWIKI (.openwiki/)     │ │ 3b. MEMB VECTOR & VAULT       │
         │     • quickstart.md           │ │     • SQLite Vector Embeddings│
         │     • architecture.md         │ │     • AI-Vault: God_Mode.md   │
         │     • release_notes.md        │ │     • Triggered via ingest.py │
         └──────────────┬────────────────┘ └──────────────┬────────────────┘
                        │                                 │
                        └────────────────┬────────────────┘
                                         │
                                         ▼
                  ┌─────────────────────────────────────────────┐
                  │ 4. PERSISTENT AGENT MEMORY & RETRIEVAL       │
                  │    • AGENTS.md / CLAUDE.md ──▶ .openwiki      │
                  │    • search_memory Tool ──▶ memB             │
                  └──────────────────────────────────────────────┘
```

---

## Dispatcher-Mediated Graph (v2)

**This replaces the old 4-step pipeline description below.** The full
contract — state schema, node table, edge predicates, the Stop-hook
loop-keeper — lives in [`.agents/graph.md`](../graph.md) and
[`.agents/state.schema.json`](../state.schema.json); this file is a summary,
kept in sync with `skills/basic/startcycle/SKILL.md`'s canonical version.

**The one rule:** these seven agents never invoke each other. A dispatcher —
the main session running `/startcycle`, or whatever plays that role in a
given harness — reads `production_artifacts/state.json` after each agent
returns and decides which one runs next. The version of this file below this
notice previously described "streams" and "hand-offs" in a way that read as
agents calling agents; see `audit-agents.md` F-17 for why that's corrected.

| Node | Role | Reads | Writes |
|---|---|---|---|
| **Architect** | Turns the goal into a system plan | `state.goal` | `state.artifacts.plan` |
| **TechLead** | Approves/rejects the plan's capability map | `state.artifacts.plan` | plan approval, `state.phase` |
| **Godmode_UI_UX** | Frontend implementation | plan, own findings | `state.artifacts.frontend` |
| **Godmode_Engineering** | Backend implementation | plan, own findings | `state.artifacts.backend` |
| **Godmode_Media_EventTech** | Media/show-control implementation (if the goal needs it) | plan, own findings | `state.artifacts.media` |
| **Reviewer** | Adversarial review of build output against the plan's contract — never sees the implementer's claim, only the artifact | build artifacts only | `state.findings` |
| **Godmode_Shipping** | Runs the automated quality gate; ships only with all gates green and a `GO` | all artifacts, findings | `state.gate`, `state.phase: done` |

**Repair loop:** if TechLead rejects the plan, Reviewer has an open blocking
finding, or Shipping's gate fails, the dispatcher increments
`state.iteration` and re-invokes the owning node instead of stopping. A
`Stop` hook (`.claude/hooks/graph-gate.mjs`) enforces this deterministically
while `iteration < max_iterations` (default 3). At the ceiling, the
dispatcher sets `phase: escalated` and hands control back to the user.

**No-progress guard:** if a repair round reports the exact same blocking
finding ID(s) Reviewer already flagged before the build node was re-invoked
to fix them, the dispatcher escalates immediately instead of repeating an
identical cycle (see `.agents/graph.md`'s Reviewer discipline).

**`/ship` (after `state.phase: done`):**
1. `openwiki-skill`: scans the git diff, updates `.openwiki/architecture.md`, `.openwiki/release_notes.md`, and `README.md`.
2. `memb-ingest`: ingests new documentation and schema files into local memB vector memory.
3. Git commit, version tag, push to the private remote — gated by `go-gate.mjs` like any other push in this repo.
