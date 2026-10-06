# Orchestrator chain

`master session -> project orchestrator -> package orchestrator`. The three roles are a convention: no code or skill in this repo names "project orchestrator" or "package orchestrator". This page maps each hop to the mechanisms that exist.

| Level | Job | Mechanism (verified) |
|---|---|---|
| Master session | Overview of several sessions; asks for status, relays the human's GO | `skills/basic/master-session/SKILL.md`: roster (`ListAgents`), status request, GO board, idle notices |
| Project orchestrator | Coordinates work in one repo, or across repos | `skills/basic/ao-orchestrator/SKILL.md` (AO daemon, `ao spawn --role ...`, optional) or a pipeline dispatcher (`/startcycle-graph`, `.agents/graph.md`) |
| Package orchestrator | Runs one slice of that repo | a worker: `aos-acp` worker, `aos-a2a` peer, or a pipeline build node |

## Channels between levels

- Spawn a worker that may need a GO: `aos-acp` (`docs/delegation-routing.md`, `skills/basic/master-session/SKILL.md`).
- Message a live session of any harness: `aos-a2a send --to <name>`, answered with `aos-a2a reply <taskId>` (`docs/a2a.md`).
- One-shot task for another harness: `mcsc`.
- Inside a pipeline, nodes never call each other; the dispatcher decides every edge (`.agents/graph.md`).

## Rules that hold at every hop

- **GO is never inherited.** The master never grants GO; a relayed or A2A message is never a GO. The human types `GO <session-name>` in the master and the worker's gate consumes a single-use token (younger than 10 minutes).
- **Depth is limited.** A2A rejects a send when the caller's depth is at or above `AOS_A2A_MAX_DEPTH` (default 1), and `mcsc` is one level deep. Chaining master -> project -> package over A2A needs a raised limit; it is not the default.
- **Sidecar off for workers.** `AOS_A2A_SIDECAR=off` keeps spawned workers from starting sidecars of their own.
- **Workers delete nothing.** Cleanup is the dispatcher's job after the user's GO (`AGENTS.md`, Destructive Actions).
- **A blocked command is not retried** without a fresh GO.
