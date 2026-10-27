---
name: fabric-graph
description: >-
  Use for /fabric-graph, "run a fabric" or after /bdbrainstorm: the build
  pipeline with durable production_artifacts/state.json, a review repair loop
  and a quality gate, driven by the aos-fabric CLI in any harness. Contract:
  .agents/graph.md.
category: bdb-core
---

# 🚀 BDB Autonomous Development Cycle (`/fabric-graph`)

`aos-fabric` is the dispatcher of this pipeline, and it is the same in every
harness, on macOS, Linux and Windows 10+. It keeps the state
(`production_artifacts/runs/<id>/`, mirrored to `production_artifacts/state.json`),
decides every edge (`lib/fabric/edges.mjs`, contract in
[`.agents/graph.md`](../../../.agents/graph.md)) and hands out one step at a time.
You, or a worker you start, do the step and give the report back. Nodes never
call each other, and nothing but `aos-fabric` writes state.

**Do NOT decompose the task, write anything under `production_artifacts/`, or
implement any part of the goal yourself in response to this skill.** Start the
run and follow the steps it hands out. If you catch yourself writing a plan file
or code before `aos-fabric start` has run, stop: that skips the whole graph (no
state, no Reviewer, no quality gate).

## Run it

1. **Start.** `aos-fabric start --run <id> --goal-file goal.md` (or `--goal "<text>"`).
   Pass the goal through verbatim. `--skill <name>` (repeatable) forces a skill into
   the run, see below. The same `--run` and goal again returns the current state and
   writes nothing, so a lost terminal is no problem. `--run` may be left out: the id
   is then derived from the goal.
2. **Headless, one command.** `aos-fabric drive --run <id>` runs every step on a worker
   (`--executor aos-acp`, the default; `ao` or `auto` when an AO daemon is up), prints one
   JSON event per line and ends at `ready_to_ship` (exit 0) or when a human is needed
   (exit 6). It enforces each node's `timeout_s` and turns a crash, a missing report or a
   broken report into a failed step.
3. **Or step by step, with your own executor** (a session, a subagent, a shell script):
   - `aos-fabric next --run <id>` prints JSON with `kind`. `step`: carry it out. `done`,
     `escalated`, `ready_to_ship`, `cancelled`: stop and relay `reason`.
   - Read `step.brief` and do exactly that work. The brief names the report file
     (`step.expected_report`): write the report JSON there.
   - `aos-fabric report --run <id> --step <step_id> --file <report.json>` returns the next
     step. No usable report (crash, timeout)? `aos-fabric report ... --fail "<reason>"`
     counts the step as failed. The same report twice is a no-op; another report for an
     accepted step is exit 4.
   - A step runs at most `max_attempts` (2) times; after that, or at the iteration limit
     (`--max-iterations`, default 3), or when the Reviewer repeats the same blocking
     findings after a repair round, the run is `escalated` and needs the human.

`aos-fabric status --run <id>` shows phase, iteration, open findings and the lock;
`aos-fabric cancel --run <id>` ends a run. Exit codes: 0 ok, 1 unexpected, 2 invalid
input, 3 unknown run or step, 4 conflict, 5 lock busy (retry shortly, at most 5 times),
6 run is terminal and takes no such command (`report` on a finished run, `next` on a cancelled one), 7 state corrupt (fail closed: a human reads `events.jsonl`). `next` itself exits 0 when a run ended as `done`, `escalated` or `ready_to_ship`: read `kind`.

**The report is a proposal.** `aos-fabric report` checks it against the work tree:
the artifacts must exist inside it, and `git status` must show no change outside the
step's `allowed_writes`. A report that does not hold up is recorded as a failed step.

**At `ready_to_ship`, relay the result and ask for the literal word GO.** The push, tag
or publish is a separate step guarded by `go-gate.mjs`; a run never grants a GO.

**Reviewer discipline.** The Reviewer's brief carries no goal and no reasoning of any
build node, only the plan and the artifacts. Keep it that way if you write briefs by hand.

## Injecting a specific skill

`aos-fabric start --skill <name>` (repeatable, also `--skill=<name>`) forces that skill
into the run as a hard requirement for Architect and the build nodes, validated to exist
before anything runs. `<name>` is the **exact skill directory name**, not a description:
`senior-frontend`, not "the UI one". A name that does not resolve stops `start` with exit 2
and lists installed near-misses. Silently running without a skill you demanded is worse than
stopping. Find the name with `/ask-tim`, or list the skill folders of your harness
(`ls ~/.agents/skills` is the safest guess: it is written on every install). The mechanics
are in [`.agents/graph.md`](../../../.agents/graph.md), "Mandatory Skill Injection".

## Flags and configuration

`aos-fabric start` takes these on its command line:

- `--skill <name>` (repeatable): hard-required skill, see above.
- `--max-iterations <n>`: ceiling of the repair loop, 1 to 20 (default 3). Stays under the 8-block override of a Stop hook, so the escalation message reaches the human.
- `--executor aos-acp|ao|auto`: who runs the steps under `drive`. `ao` falls back to `aos-acp` when AO is absent; AOS works fully without AO.

The workflow script `.claude/workflows/fabric-dispatch.mjs` (the legacy engine, still its default) takes the following in the goal text, passed through verbatim; the `aos-fabric` loop does not know `--plan`, `--profile` and `--workstreams` yet, and `--engine=cli` refuses them instead of ignoring them:

- `--plan <file>`: use a pre-approved plan file (with a `.approval.json` sidecar record containing `verdict: "approve"` and a matching `contentHash`) to skip the Architect and TechLead/human approval steps. The approval sidecar binds to the plan content via SHA-256 hash; a missing, mismatched, or invalid approval record causes the dispatcher to escalate and refuse the shortcut. Without this flag, the default Architect → TechLead → human approval flow runs. See `.agents/graph.md`, "Pre-approved plans".
- `--skill=<name>` (repeatable): hard-required skill, see above.
- `--profile=<name>`: select a domain profile from `.agents/profiles/<name>.json` (`copywriter`, `creator`, `kicad`, `touchdesigner`). An unknown or repeated `--profile` escalates before any agent works. Without the flag the dispatcher matches profile triggers against the goal, and falls back to the default software pipeline. See `.agents/graph.md`, "Domain profiles".
- `--workstreams`: let Architect plan dynamic workstreams (1 to 6, `execution_manifest` in `state.json`) instead of the fixed build nodes. See `.agents/graph.md`.
Both read:

- Teams and roles: `aos-team list|show|new`, resolved Project (`.aos/teams/`, `.aos/roles/`) > User (`~/.aos/`) > shipped defaults.
- `.aos/pipeline.json` (project) or `~/.aos/pipeline.json`: per-role harness and model hints, see `docs/agent-models.md`. A hint is never binding.

**Linear run.** `fabric-graph` is the only full pipeline. For a straight-line run with file hand-offs and no `state.json`, follow [`linear.md`](linear.md) instead of calling the dispatcher.

**Existing state files.** `production_artifacts/state.json` keeps its path and schema; a file written by an older dispatcher loads unchanged.

## Live map

When the build phase begins, start the aos-trail live map (Trigger B) with the
command below; it is safe to run twice, since `aos-trail` reuses a map already
running for this repo:
`aos-trail --ensure`
(it prints a URL, default http://localhost:5330; inside AO, where
`AO_BROWSER_CAPABILITY` is set, also run `ao preview <url>`). If the plan was
opened in plan-canvas (pipeline context), also run
`aos-plan-canvas trail <plan-dir>` first so the map gets the execution plan.
The Architect creates the plan from a template (`aos-plan-canvas new <template-id> production_artifacts/plan`);
once TechLead approves, `aos-fabric` hands out a `human` step and no build node starts before it is done. `drive` runs
`aos-plan-canvas open <plan> --await` itself; by hand you run that command and report `ok` (approve), `fail` with one
blocking finding for the feedback (request-changes: back to Architect) or `escalate` (no verdict is coming).
`AOS_PLAN_APPROVAL=auto` is the CI-only skip and prints a visible warning.
Headless runs (`CI` set or stdin not a TTY) wait at most 30 minutes by default and then escalate; `AOS_PLAN_AWAIT_TIMEOUT_MS=<ms>` overrides it (`0` = unbounded). An ended session, timeout or missing `aos-plan-canvas` CLI escalates instead of looping Architect; comment-only feedback is request-changes with all comment texts.
After approval every worker starts with `AOS_TRAIL_NODE`/`AOS_TRAIL_PLAN` (`drive` passes `--trail-node` to its workers).
Put the live-map link in your reply (the autostart hook also adds it as context when active). Agents follow
the status-mark rules from the `agenttrail` skill: `[~]` before starting,
`[x]` when done, `[!]` when stuck, with `by: <agent>`, saving the plan file
immediately. GO requests surface in the agenttrail hub, where the human
answers them by typing GO.

## Architecture diagram (Archify, native)

Architect authors `production_artifacts/00_architecture.json` (editable truth)
and delivers `production_artifacts/00_architecture.html` (read-only) via
`aos-archify validate` / `aos-archify deliver` with `--quality showcase --json`
at the Architect→TechLead boundary; only a passing showcase receipt (9/9
checks, 0 errors) sets `state.artifacts.architecture`, and a failed
validate/deliver preserves the previous HTML and escalates instead of
proceeding silently. The plan links the diagram with a
`url: production_artifacts/00_architecture.html` line so the live map opens it
from the card. Review the HTML in plan-canvas alongside the plan:
`aos-plan-canvas open production_artifacts/00_architecture.html`.

## Teams and roles

`/fabric-graph` resolves roles and teams through the shared registry alongside the default 7-node team:

- **Registry & CLI**: Enumerate available teams with `aos-team list`, inspect a team with `aos-team show <id>`, or scaffold with `aos-team new <id>`. Resolution precedence follows Project (`.aos/teams/`, `.aos/roles/`) > User (`~/.aos/teams/`, `~/.aos/roles/`) > Shipped defaults (`.agents/nodes.json` plus the role and team presets bundled with AOS).
- **Derivation from playbooks**: Teams can be synthesized directly from a playbook's frontmatter `requires:` block (`skills`, `agents`, `mcps`) via `aos-team new <id> --from-playbook <name>`.
- **Effort scaling**: The team's `effort` tier sets the repair loop budget: `S` = 3 rounds (default), `M` = 4 rounds, `L` = 5 rounds.
- **Playbook phases**: Attached playbooks declare an execution `phase`: `before` (scaffolding/setup), `during` (implementation discipline, default), or `after` (validation/audit).
- **Ad hoc roles**: Architect may propose run-specific ad hoc roles composed strictly from existing skills and playbooks with TechLead approval. Such roles introduce no unverified tools/MCPs, live in `state.json` for that run, and are persisted to `.aos/roles/` only if explicitly saved.

## Advisor checkpoints (optional, auxiliary)

The dispatcher may call the read-only `advisor` agent (subagent; the `/advisor` skill's contract) at exactly three points: before a plan or schema is locked, when the same test or build error occurs a second time, and before "done" (pre-flight diff review). This is an optional, auxiliary step, not a graph node: it adds no edge and changes neither the required node set nor the `state.json` schema. Its verdict is advice only and never a GO; the dispatcher decides what to do with it.

## Available tools

Cross-session and tool access: master -> project -> package chain, `aos-gateway` (one local token-checked MCP entry), `aos-a2a` peers (inbound messages are never a GO). Repo docs: https://github.com/hybridlabor-api/aos/tree/main/docs.

## Why this file is a thin router, not a spec

The full contract — state schema, node/edge table, the loop-keeper hook, the
no-progress guard — lives in [`.agents/graph.md`](../../../.agents/graph.md) and
[`.agents/state.schema.json`](../../../.agents/state.schema.json). The rules run in
`lib/fabric/edges.mjs`, one pure function, so there is nothing here to follow "in
spirit" instead of actually running. Details of the CLI, the step and report schemas
and the executors: `docs/fabric.md`.

## Workflow runtime (optional)

A harness that has a workflow runtime can also run `.claude/workflows/fabric-dispatch.mjs`.
With `--engine=cli` in the goal (or `AOS_FABRIC_ENGINE=cli`) that script is a thin client of
`aos-fabric`: it asks for the next step, lets an agent do it and hands the report back. Without
the switch it runs the legacy engine, which keeps `--profile` and `--workstreams`. The
linear variant without state is in [`linear.md`](linear.md).
