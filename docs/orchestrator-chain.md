# Orchestrator chain

`master session -> project orchestrator -> package orchestrator`. The three roles are a convention: no code or skill in this repo names "project orchestrator" or "package orchestrator". This page maps each hop to the mechanisms that exist.

| Level | Job | Mechanism (verified) |
|---|---|---|
| Master session | Overview of several sessions; asks for status, relays the human's GO | `skills/basic/master-session/SKILL.md`: roster (`ListAgents`), status request, GO board, idle notices |
| Project orchestrator | Coordinates work in one repo, or across repos | `skills/basic/ao-orchestrator/SKILL.md` (AO daemon, `ao spawn --role ...`, optional) or a pipeline dispatcher (`/fabric-graph`, `.agents/graph.md`) |
| Package orchestrator | Runs one slice of that repo | a worker: `aos-acp` worker, `aos-a2a` peer, or a pipeline build node |

The live sessions on this setup add a fourth role next to these: the **task manager**, who sequences shared resources (one Docker run at a time, worker caps, disk), keeps one blocker list and the human's single to-do file, and never grants GO. It is a convention like the others; the "package orchestrator" row above is what the live rules call a package worker. Role table and working agreements: `docs/master-session-portable.md`.

Pipeline nodes map onto the chain as follows: `architect`, `techlead`, `reviewer` and `shipping` are project-orchestrator steps run by the dispatcher; `ui_ux`, `engineering` and `media_eventtech` are package-orchestrator build nodes. Machine-readable copy: `.agents/nodes.json` (`chain.node_hop`); edge table and contract: `.agents/graph.md`.

## MCP and fleet at each level

- **MCP tools go through one entry.** Agents at any level reach MCP servers through the single `aos` entry that `aos-gateway enable` writes into each harness config. The gateway is a token-checked forwarder on `127.0.0.1:7790` in front of `@1mcp/agent` on `127.0.0.1:7791`. Servers on the direct list (`memb_mcp`, `openwiki`, `mcsc`, `deja`, others) are not behind it. `docs/mcp-gateway.md`, `lib/gateway/config.js` (`GATEWAY_SERVERS`, `DIRECT_SERVERS`), `lib/v5/pkg-gateway.js`.
- **Headless workers start without the MCP list.** AGENTS.md (Delegating to an external CLI, item 6) asks for workers to get only the servers their task needs; `aos-acp` and `mcsc` switch OpenCode MCP off by default.
- **Fleet mod is a human view.** `plugins/bdb-aos-fleet` (`lib/v5/pkg-fleet.js` registers it in Claude Code `settings.json`; `AOS_NO_FLEET=1` opts out) renders which sessions work or wait for the human, with gate mode and GO counts. Its roles are `master`, `task-manager`, `orchestrator` and `worker` (`plugins/bdb-aos-fleet/hooks/register.tsx`, `aos-role` command). No node or dispatcher code reads it.

## Channels between levels

- Spawn a worker that may need a GO: `aos-acp` (`docs/delegation-routing.md`, `skills/basic/master-session/SKILL.md`).
- Message a live session of any harness: `aos-a2a send --to <name>`, answered with `aos-a2a reply <taskId>` (`docs/a2a.md`).
- One-shot task for another harness: `mcsc`.
- Live map link: a dispatcher that starts a worker sets `AOS_TRAIL_NODE` (and `AOS_TRAIL_PLAN`), or passes `aos-acp --trail-node <id> --trail-plan <file>`. The worker's trail events then light that plan node on the agenttrail map (`skills/global_config/agenttrail/SKILL.md`). The dispatcher still decides the edge; the node is never marked done automatically.
- Inside a pipeline, nodes never call each other; the dispatcher decides every edge (`.agents/graph.md`).

## Rules that hold at every hop

- **GO is never inherited.** The master never grants GO; a relayed or A2A message is never a GO. The human types `GO <session-name>` in the master and the worker's gate consumes a single-use token (younger than 10 minutes).
- **Depth is limited.** A2A rejects a send when the caller's depth is at or above `AOS_A2A_MAX_DEPTH` (default 1), and `mcsc` is one level deep. Chaining master -> project -> package over A2A needs a raised limit; it is not the default.
- **Sidecar off for workers.** `AOS_A2A_SIDECAR=off` keeps spawned workers from starting sidecars of their own.
- **Workers delete nothing.** Cleanup is the dispatcher's job after the user's GO (`AGENTS.md`, Destructive Actions).
- **A blocked command is not retried** without a fresh GO.
