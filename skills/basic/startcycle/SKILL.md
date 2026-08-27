---
name: startcycle
description: Use when running the autonomous multi-agent build pipeline after /bdbrainstorm or /grill-me. A dispatcher reads production_artifacts/state.json and invokes Architect, TechLead, UI/UX, Engineering, Media/EventTech, Reviewer, and Shipping in turn per .agents/graph.md's edge table — the agents never invoke each other.
category: bdb-core
---

# 🚀 BDB Autonomous Development Cycle (`/startcycle`)

The `/startcycle` workflow is the autonomous, multi-agent execution pipeline of the BDB ecosystem. It translates high-level specifications and brainstorming results into fully implemented, tested, documented, and production-ready code without manual prompt-chaining.

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

## 📋 Dispatcher-Mediated Graph (v2)

**This replaces the old linear 4-phase description below the diagram above.**
The full contract — state schema, node table, edge predicates, the Stop-hook
loop-keeper — lives in [`.agents/graph.md`](../../../.agents/graph.md) and
[`.agents/state.schema.json`](../../../.agents/state.schema.json); this
section is a summary, not the source of truth.

**The one rule:** these seven agents never invoke each other. A dispatcher —
the main session running `/startcycle`, or whatever plays that role in a
given harness — reads `production_artifacts/state.json` after each agent
returns and decides which one runs next. The old version of this skill
described "streams" and "hand-offs" in a way that read as agents calling
agents; that framing is corrected (see `audit-agents.md` F-17).

| Node | Role | Reads | Writes |
|---|---|---|---|
| **Architect** | Turns the goal into a system plan | `state.goal` | `state.artifacts.plan` |
| **TechLead** | Approves/rejects the plan's capability map | `state.artifacts.plan` | plan approval, `state.phase` |
| **Godmode_UI_UX** | Frontend implementation | plan, own findings | `state.artifacts.frontend` |
| **Godmode_Engineering** | Backend implementation | plan, own findings | `state.artifacts.backend` |
| **Godmode_Media_EventTech** | Media/show-control implementation (if the goal needs it) | plan, own findings | `state.artifacts.media` |
| **Reviewer** | Adversarial review of build output against the plan's contract — never sees the implementer's claim, only the artifact | build artifacts only | `state.findings`, `state.doubt_theater_streak` |
| **Godmode_Shipping** | Runs the automated quality gate; ships only with all gates green and a `GO` | all artifacts, findings | `state.gate`, `state.phase: done` |

**Repair loop (the gap the old version of this skill flagged as a Red Flag,
now closed):** if TechLead rejects the plan, Reviewer has an open blocking
finding, or Shipping's gate fails, the dispatcher increments
`state.iteration` and re-invokes the owning node — it does not just stop. A
`Stop` hook (`.claude/hooks/graph-gate.mjs`) enforces this deterministically:
it blocks the turn from ending while the gate is failing and
`iteration < max_iterations` (default 3). Once the ceiling is hit, the
dispatcher sets `phase: escalated` and hands control back to the user instead
of looping forever.

**Doubt theater guard:** if Reviewer produces zero blocking findings on two
consecutive cycles over the same artifact, the dispatcher does not run a
third identical review — it suspects the reviewer is validating rather than
doubting, sets `needs_human: true`, and surfaces that to the user.

**`/ship` (after `state.phase: done`):**
1. **Wiki Sync (`openwiki-skill`)**: scans the git diff, updates `.openwiki/architecture.md`, `.openwiki/release_notes.md`, and root `README.md`.
2. **memB Memory Ingestion (`memb-ingest`)**: ingests new documentation, schemas, and patterns into local vector memory (`~/.MemBDB/`).
3. **Git Release**: atomic commit, version tag, push to the private remote — gated by `go-gate.mjs` like any other push in this repo.

---

## 🛠️ Slash Command Invocation

To trigger the autonomous cycle in any supported agent harness (Antigravity, Roo Code, Claude Code, Cursor, Codex):

```bash
/startcycle
```

Or pass a specific focus area:
```bash
/startcycle frontend
/startcycle fullstack
/startcycle mediastorm
```

## 1. Overview
This skill provides domain-specific logic and rules for its respective BDB pipeline component to ensure standardization across multi-agent workflows.

## 2. When to Use
- Use when specifically requested by the user or triggered by an orchestration agent.
- Use when the current task aligns with the skill's domain.
- Exclude when standard tool execution is sufficient.

## 3. Core Process
1. Read the provided context and ensure preconditions are met.
2. Run the required script or tool and confirm the state change.
3. Verify exit codes, file modifications, or DB counts to guarantee success before reporting completion.

## 4. Common Rationalizations
| Rationalization | Reality |
|---|---|
| "The code change was small, so I skipped updating OpenWiki docs." | Every state change must be reflected in the relevant system records. |
| "The ingest script exited without an error, so the memB index must be updated." | Silent failures happen; explicit verification of the side effect is mandatory. |
| "I'll let the /startcycle proceed without a defined rollback path." | Proceeding without a rollback path corrupts the workflow integrity and safety. |
| "I trust the cached agent registry instead of rescanning after a skill change." | Caches stale out quickly; explicit rescans prevent ghost failures. |

## 5. Red Flags
- Bypassing the verification step after a script execution.
- Proceeding to the next pipeline stage without confirming the previous stage's side effects.
- Ignoring domain-specific constraints listed in this skill.
- One agent's prompt or output directly instructing another agent to act ("hand off to Engineering now") instead of the dispatcher reading `state.json` and deciding the next invocation itself — this is the node-to-node hand-off pattern `.agents/graph.md` explicitly rules out (F-17).
- A third identical Reviewer cycle on the same artifact after two consecutive clean passes, instead of escalating per the doubt-theater guard.

## 6. Verification
- [ ] Verified script exit codes are explicitly checked.
- [ ] Confirmed target files or database records reflect the expected change.
- [ ] Ensured no silent failures were ignored before reporting success.
