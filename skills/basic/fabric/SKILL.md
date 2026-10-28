---
name: fabric
description: >-
  Master entry for the fabric family. Use for /fabric or when you must pick a
  multi-agent mode: reads the task, picks one mode, says why in one line, then
  follows that skill.
category: bdb-core
---

# `/fabric` — pick the mode, then run it

`fabric` has no pipeline of its own. It reads the task, chooses one mode from the table, prints one line (`fabric: <mode> — <reason>`), and then follows that skill's contract. Ask the human only if two modes fit equally well.

| Mode | Pick it when | Skill |
|---|---|---|
| `fabric-graph` | An approved plan should be built and correctness beats speed: durable `production_artifacts/state.json`, Reviewer repair loop, automated quality gate, human escalation. | `fabric-graph` |
| `fabric-multigraph` | A small throwaway fan-out (2-4 nodes, nothing persistent) in any project. | `fabric-multigraph` |
| `fabric-teamwork` | The brief is still vague and needs 9-step prompt crafting before delegation to a team. | `fabric-teamwork` |
| `fabric-swarm` | Many similar workers taking items from one shared pool (`production_artifacts/swarm.json`, 4 workers, cap 6). | `fabric-swarm` |
| `fabric-loop` | A repeating cycle until an exit check is green (CI green, review rounds), bounded by round limits. | `fabric-loop` |

## Choosing

1. The task needs resumable state, a review loop or a quality gate before anything ships: `fabric-graph`.
2. The task splits into a few independent slices and nothing has to survive the session: `fabric-multigraph`.
3. The goal is unclear and a team will receive it: `fabric-teamwork` first, then one of the above.
4. Repeat-until-done with an exit check and round limits: `fabric-loop`. Many near-identical slices: `fabric-swarm`.
5. A small task needs no mode at all: do it yourself.

Pass the goal text through verbatim; flags are described below.

## Flags and building blocks

- `--skill=<name>`: handled by `fabric-graph` and `fabric-multigraph`. `fabric-swarm` and `fabric-loop` pass it through to each worker brief. `fabric-teamwork` does not support it.
- `--profile=<name>`: domain profile from `.agents/profiles/<name>.json`; handled by the workflow script of `fabric-graph`. An unknown profile escalates.
- `--workstreams`: workflow script of `fabric-graph` only; the Architect plans 1-6 dynamic workstreams (target 4, cap 6). Off by default.
- Teams: `aos-team list`, `aos-team show <id>`, `aos-team new <id> [--from-playbook <name>]`; add `--json` for machine output. Team JSON lives in `~/.aos/teams` or `.aos/teams` (project wins); shipped teams are in `lib/roles/teams`.
- Roles: a registry of role JSON files (types plan, approve, build, review, gate, specialist). Precedence: project `.aos/roles` over user `~/.aos/roles` over shipped. Role flags beyond the registry: unverified.

**One loop for every harness.** `fabric-graph` (and a `fabric-loop` round) runs on the `aos-fabric` CLI: `start`, then `next` and `report` by hand with your own executor, or `drive` for a headless run. It needs no workflow runtime and works without AO.

**Agents never invoke each other.** The dispatcher (the main session or the workflow script) decides every next step. Independent sub-tasks go to subagents; only work whose members must react to each other needs a team.

## Safety

`git push`, `npm publish` and `npm version` stay behind the go-gate. Choosing a mode never grants a GO.
