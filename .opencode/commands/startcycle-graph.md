---
description: Run the AOS multi-agent build graph (Architect, TechLead, build nodes, Reviewer, Shipping) with durable state in production_artifacts/state.json
agent: build
---

# AOS `/startcycle-graph`

Goal: $ARGUMENTS

## Step 0 — bootstrap the graph contract into this project

The agents dispatched below are told to read and write
`production_artifacts/state.json` "per `.agents/state.schema.json`". That path
resolves against the CURRENT PROJECT, not globally. In a project that has never
run the graph, those files are absent and every agent will freelance the state
shape instead of conforming to the schema.

```bash
mkdir -p .agents
[ -f .agents/graph.md ] || cp "$HOME/.agents/graph.md" .agents/graph.md
[ -f .agents/state.schema.json ] || cp "$HOME/.agents/state.schema.json" .agents/state.schema.json
[ -f .agents/nodes.json ] || cp "$HOME/.agents/nodes.json" .agents/nodes.json
```

`nodes.json` is not optional — it is the registry the run loads first, and a
missing or invalid one escalates before any agent runs. If any of the three is
also missing under `$HOME/.agents/`, stop and tell the user. Do not proceed.

## Step 1 — dispatch

Read `.agents/graph.md` for the node/edge table and `.agents/state.schema.json`
for the state shape, then drive the run:

**Architect** → plan (`production_artifacts/00_execution_plan.md`)

**TechLead** → approve the plan's capability map, or reject it back to Architect

**Build** (parallel) → `production_artifacts/01_frontend_spec.md`,
`02_backend_schema.md`, and `03_media_pipeline.md` where the goal needs it

**Reviewer** → adversarial review of the build artifacts against the plan's
contract, writing `state.findings[]`. It reads the artifacts, never the
implementer's claim that it is done.

**Shipping** → run the quality gate. Ships only with every gate green and a
`GO` in `state.approvals`.

**The one rule: these agents never invoke each other.** You are the dispatcher.
After each agent returns, read `production_artifacts/state.json` and decide which
one runs next. If TechLead rejects, Reviewer has an open `blocking` finding, or
Shipping's gate fails, increment `state.iteration` and re-invoke the owning
node. If a repair round reports the exact same blocking finding id Reviewer
already flagged, escalate instead of repeating the cycle. At
`state.iteration >= max_iterations`, set `phase: escalated` and hand control back
to the user.

Full contract: `skills/basic/startcycle-graph/SKILL.md`.
