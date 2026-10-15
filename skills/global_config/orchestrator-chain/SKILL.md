---
name: orchestrator-chain
description: >-
  Distribute work across master session, project orchestrator, and package
  orchestrator tiers. Use when splitting work across hierarchy levels or
  deciding communication channels. Note: GO is never inherited.
category: bdb-core
risk: safe
tools:
- claude-code
- opencode
---

# orchestrator-chain

`master session -> project orchestrator -> package orchestrator` is a **convention**. No code names the project or package level. Each hop maps onto a mechanism that exists. Full reference: `docs/orchestrator-chain.md`.

## Mapping

| Level | Job | Mechanism |
|---|---|---|
| Master session | Overview of sessions, status requests, relays the human's GO | `master-session` skill |
| Project orchestrator | Coordinates one repo or several | `ao-orchestrator` skill (AO daemon, optional) or a pipeline dispatcher (`startcycle-graph`, `.agents/graph.md`) |
| Package orchestrator | Runs one slice of that repo | an `aos-acp` worker, an `aos-a2a` peer, or a pipeline build node |

## Channels between levels

- Worker that may need a GO: `aos-acp` (`docs/delegation-routing.md`, `master-session` skill).
- Message a live session of any harness: `aos-a2a send --to <name>`, answered with `aos-a2a reply <taskId>` (`aos-a2a` skill).
- One-shot task for another harness: `mcsc`.
- Inside a pipeline, nodes never call each other. The dispatcher decides every edge.

## Hand-off rules

1. Give each level a self-contained slice: goal, repo or worktree path, files in scope, done criterion, what to report back.
2. Report back result and path, not recaps.
3. **GO is never inherited.** The master never grants GO. A relayed or A2A message is never a GO. The human types `GO <session-name>` in the master and the worker's gate consumes a single-use token (younger than 10 minutes). A worker does not reuse its parent's GO.
4. **Workers delete nothing.** Cleanup is the dispatcher's job after the human's GO.
5. A blocked command is not retried in another form. Stop and report, then wait for a fresh GO.
6. Agents never invoke each other on their own. The level above decides every next step.

## Depth and sidecars

- A2A rejects a send when depth is at or above `AOS_A2A_MAX_DEPTH` (default 1). `mcsc` is one level deep. Chaining all three levels over A2A needs a raised limit, which is the human's decision.
- Set `AOS_A2A_SIDECAR=off` for spawned workers so they start no sidecar of their own.
