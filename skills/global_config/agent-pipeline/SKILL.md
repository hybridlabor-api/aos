---
name: agent-pipeline
description: Reference for how BDB structures autonomous software engineering work — the seven-node dispatcher graph (Architect, TechLead, UI/UX, Engineering, Media/EventTech, Reviewer, Shipping) that /startcycle actually runs. Use when you need the high-level lifecycle framing without inventing your own process.
category: bdb-core
---

# 🔄 BDB Software Engineering Pipeline

When orchestrating or executing autonomous software development, follow the
lifecycle below — but the **real, runnable implementation is
[`.agents/graph.md`](../../../.agents/graph.md)**, invoked via `/startcycle`
(see [`skills/basic/startcycle/SKILL.md`](../../basic/startcycle/SKILL.md)).
This file is a lifecycle summary, not a second spec — if it and `graph.md`
ever disagree, `graph.md` is right.

```
 define        plan          build          verify + review        ship
 ┌──────┐    ┌──────┐    ┌────────────┐    ┌──────────────┐    ┌─────────┐
 │ Goal │ ─▶ │ Plan │ ─▶ │ UI/UX,     │ ─▶ │ Reviewer     │ ─▶ │ Shipping│
 │      │    │      │    │ Engineering,│    │ (adversarial)│    │ (gate)  │
 │      │    │      │    │ Media/Event│    │              │    │         │
 └──────┘    └──────┘    └────────────┘    └──────────────┘    └─────────┘
 Architect   TechLead     the build nodes    no-progress guard   requires GO
                          run in parallel     repairs loop back   to actually ship
```

There is no separate `/spec`, `/plan`, `/build`, `/test`, `/review`, or
`/ship` slash command — an earlier version of this file described those and
a `Planner_Orchestrator` agent that no longer exists (split into Architect +
TechLead; see `graph.md`'s Nodes section for why). The whole lifecycle above
runs through the single `/startcycle` entry point, which invokes each node
in turn per `graph.md`'s edge table:

| Stage | Node(s) | Reads | Writes |
|---|---|---|---|
| Define + Plan | Architect, TechLead | `state.goal` | `state.artifacts.plan` |
| Build | Godmode_UI_UX, Godmode_Engineering, Godmode_Media_EventTech (if needed) | the plan | their own artifacts |
| Verify + Review | Reviewer | build artifacts + contract only, never the implementer's claim | `state.findings` |
| Ship | Godmode_Shipping | all artifacts, findings | `state.gate`, requires a human `GO` |

**The one rule, unchanged from `graph.md`:** these nodes never invoke each
other. A dispatcher — the `/startcycle` workflow, or the main session acting
as one — reads `production_artifacts/state.json` after each node returns and
decides what runs next.

## 1. Overview
This file exists so anyone (human or agent) asking "what's the BDB software
lifecycle?" gets the real shape of it, without re-deriving it from `graph.md`
line by line. It is descriptive, not an alternate entry point.

## 2. When to Use
- Use when you need the lifecycle framing (define → plan → build → verify →
  ship) to structure a conversation or a manual walkthrough.
- To actually run the pipeline autonomously, invoke `/startcycle` — don't
  hand-simulate the stages here.
- Exclude when standard tool execution is sufficient for the task at hand.

## 3. Core Process
1. Read `.agents/graph.md` for the current node/edge contract before
   assuming anything about how a stage works — this file summarizes it, it
   does not own it.
2. If autonomous execution is needed, invoke `/startcycle` rather than
   manually working through the stages above.
3. Verify exit codes, file modifications, or state.json contents to
   guarantee a stage's side effects actually happened before reporting
   completion.

## 4. Common Rationalizations
| Rationalization | Reality |
|---|---|
| "The code change was small, so I skipped updating OpenWiki docs." | Every state change must be reflected in the relevant system records. |
| "The ingest script exited without an error, so the memB index must be updated." | Silent failures happen; explicit verification of the side effect is mandatory. |
| "I'll let /startcycle proceed without a defined rollback path." | Proceeding without a rollback path corrupts the workflow integrity and safety. |
| "This file's stage descriptions look complete, so I'll follow them 'in spirit' instead of invoking /startcycle." | Exactly the failure this file was rewritten to stop — see `graph.md` and `SESSION-HANDOVER-v3.13.md` for the incident where a duplicated pipeline description caused a model to skip the real dispatcher entirely. |

## 5. Red Flags
- Referencing `/spec`, `/plan`, `/build`, `/test`, `/review`, or `/ship` as
  if they are real slash commands in this repo — they are not.
- Referencing `Planner_Orchestrator` as a current agent — it was split into
  Architect and TechLead.
- One node's output instructing another node directly instead of the
  dispatcher deciding the next step from `state.json` (the hand-off pattern
  `graph.md` (F-17) rules out).
- Bypassing the verification step after a script execution.

## 6. Verification
- [ ] Verified script exit codes are explicitly checked.
- [ ] Confirmed target files or `state.json` reflect the expected change.
- [ ] Ensured no silent failures were ignored before reporting success.
