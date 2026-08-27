---
name: startcycle
description: Use when running the autonomous multi-agent build pipeline after /bdbrainstorm or /grill-me. Routes to the startcycle-dispatch Dynamic Workflow, which reads production_artifacts/state.json and invokes Architect, TechLead, UI/UX, Engineering, Media/EventTech, Reviewer, and Shipping in turn per .agents/graph.md's edge table — the agents never invoke each other.
category: bdb-core
disable-model-invocation: true
---

# 🚀 BDB Autonomous Development Cycle (`/startcycle`)

**Action — do this, and nothing else:** call the `Workflow` tool with
`name: "startcycle-dispatch"` and `args` set to the goal text that follows
`ARGUMENTS:` below this file's content. Pass it through verbatim. If there is
no `ARGUMENTS:` text, pass no `args` (or `args: undefined`) — the workflow
itself asks for a goal in that case rather than guessing one.

Then wait for the `Workflow` tool call to finish and report its result
(including `phase`, any `reason`, and — at `ready_to_ship` — the instruction
to reply `GO`) back to the user. Do not summarize or reinterpret it; relay it.

**Do NOT decompose the task, write anything under `production_artifacts/`, or
implement any part of the goal yourself in response to this skill.** This
file exists only to route the `/startcycle` slash command to the real
dispatcher — a Dynamic Workflow script
(`.claude/workflows/startcycle-dispatch.mjs`) that holds the actual
node/edge graph, spawns the seven agents, and drives the repair loop. If you
catch yourself about to write a plan file or code directly because of this
skill, stop — that means the `Workflow` tool call was skipped, which is
exactly the failure this file was rewritten to close (see
`SESSION-HANDOVER-v3.13.md` in the source repo for the incident: an earlier
version of this file embedded the full pipeline description in prose, and
the model followed it "in spirit" inline instead of invoking the script —
silently skipping the whole graph, with no `state.json`, no subagents, no
Reviewer, and no quality gate ever running).

## Why this file is a thin router, not a spec

The full contract — state schema, node/edge table, the Stop-hook
loop-keeper, the no-progress guard — lives in
[`.agents/graph.md`](../../../.agents/graph.md) and
[`.agents/state.schema.json`](../../../.agents/state.schema.json). Those are
read by the dispatcher script itself and by the agents it invokes, not
duplicated here — so there is nothing here to follow "in spirit" instead of
actually running.

## If the `Workflow` tool is unavailable

Some harnesses (or Claude Code with Dynamic Workflows toggled off in
`/config`) have no `Workflow` tool at all. Only in that case, fall back to
manually driving `.agents/graph.md`'s node/edge table yourself as the
dispatcher: read `production_artifacts/state.json`, decide the next node
per the edge predicates, invoke exactly that one agent, and repeat. Never
let one agent's output instruct another agent directly — that hand-off
pattern is the thing `.agents/graph.md` (F-17) rules out.
