---
name: bdb-aos
category: bdb-core
description: Entry point for BDB Agent OS suite. Routes 200+ skills, fabric subagents, pipeline workflows. Direct access when known.
---

# BDB Agent OS

The full AOS suite: 200+ skills, 46 subagents, and the fabric pipelines.

## Where things live

| Component | Location |
|---|---|
| Skills | `skills/<category>/<name>/SKILL.md` |
| Subagents | `agents/<name>.md` (mirrors `.claude/agents/`) |
| Pipeline contract | `.agents/graph.md`, node registry in `.agents/nodes.json` |
| State schema | `.agents/state.schema.json` |

## Pipelines

The fabric family. `fabric` picks the mode; the modes differ in how much machinery the task needs:

| Skill | Shape |
|---|---|
| `fabric` | Master: reads the task, picks one mode below, says which and why. |
| `fabric-graph` | Dispatcher graph: durable `state.json`, Reviewer repair loop, automated quality gate, human escalation. |
| `fabric-multigraph` | Throwaway 2–4 node fan-out, nothing persistent left behind. |
| `fabric-teamwork` | 9-step prompt crafting and delegation to a team. |
| `fabric-swarm` | N similar workers take items from one shared pool. |
| `fabric-loop` | Repeats a graph run until an exit check is green, bounded by round limits. |

**Agents never invoke each other.** A dispatcher — the main session or the
workflow script — decides every next step. Routing lives in the graph contract,
never inside an agent's prompt.

## CLIs

Generated from `lib/cli-specs` (`node scripts/build-cli-reference.mjs`); full reference in `docs/cli-reference.md`.

<!-- aos:cli-table:start -->
| CLI | Use it to | First command |
|---|---|---|
| `aos` | Install or update AOS, or reach any subcommand below. A bare `aos` starts the interactive installer. | `aos help --all --json` |
| `aos-plan-canvas` | You wrote a plan and need the human to review, annotate and approve it before building. | `aos-plan-canvas open plan.mdx --mode bdb-plan-builder --await` |
| `aos-trail` | Report agent progress to the live map (emit, tick), ask the human a question (ask), or start the map for a repo. | `aos-trail --ensure --json` |
| `aos-archify` | You need a diagram from a JSON description: render it, validate it, or check an output file. | `archify validate architecture arch.json --json` |
| `aos-dashboard` | A human wants the services overview in the browser. Agents should use `aos services status --json`. | `aos-dashboard --no-open` |
| `aos-hub` | Start, stop or inspect the hub. `status --json` is the agent-safe probe. | `aos-hub status --json` |
| `aos-config` | Read or set the workspace root, domains or memB user id during setup. | `aos-config propose` |
| `aos-store` | You need a skill or agent that is not installed, or want to list what the store offers. | `aos store search react` |
| `aos-doctor` | Something does not work, or before and after an update. `--json` for machine-readable results. | `aos doctor --json` |
| `aos-acp` | Delegate a bounded task to a worker in its own worktree. Guarded commands run only with a valid GO token. | `aos-acp opencode --name w1 --cwd ../wt --prompt-file task.md --allow-default scoped` |
| `aos-gateway` | Check or control the MCP gateway, add or remove a gateway server, or adopt MCP servers from harness configs. | `aos-gateway status --json` |
| `aos-gogate` | Ask the human to grant or change the gate: print the preset text for them to type. It never records anything. | `aos-gogate preset release` |
| `aos-go-ref` | Verify a GO reference a human forwarded over A2A before acting on it. It never issues or consumes anything. | `aos-go-ref verify --session w1 --ref 0123456789ab` |
| `aos-a2a` | Talk to another agent session on this machine: `list` to find peers, `send` a task, `reply` to an incoming one. | `aos-a2a list --json` |
| `aos-router` | See which worker target a role routes to, or set a role preference. | `aos-router show --json` |
| `aos-sessions` | See which sessions need input, are working or idle, and which ACP workers run. | `aos-sessions --json --section needs` |
| `aos-team` | List teams, show one team, or create a team definition from a playbook. | `aos team list --json` |
| `aos-bus` | Send text to a running OpenCode session, or list sessions that can receive it. | `aos-bus list` |
| `go-check` | A runner outside a harness (for example AO) must ask the GO gate before executing a command. | `node ~/.aos/bin/go-check.mjs --session w1 --command "git push"` |
| `mcsc` | Decide which worker CLI should take a task type, or run it there. | `mcsc route --task-type refactor --json` |
| `aos-mcp-env` | Wire an MCP server that needs API keys into a harness config without putting keys in the config. | `aos-mcp-env --vars GITHUB_PERSONAL_ACCESS_TOKEN -- npx -y @modelcontextprotocol/server-github@2025.4.8` |
| `aos-memb-ingest` | Normally never by hand. Use `aos memory` to configure paths and time. | `aos-memb-ingest --dry-run` |
| `aos-setup-doctor` | Used by the aos-setup skill before installing. For an installed system use `aos doctor`. | `node aos-doctor.mjs --json` |
| `aos-project-doctor` | After or before /aos-project-init, to see what is missing in a project. | `node aos-project-doctor.mjs . --json` |

Probe with `aos help --all --json`; `<cli> --help` never has side effects.
<!-- aos:cli-table:end -->

## Skill categories

`design-ui-ux`, `engineering-method`, `media-eventtech`, `bdb-core`, `library`,
`engineering-hardware`, `business-ops`. Pick the narrowest match; a `library` skill should never
be pulled for a task a domain skill already covers.

The harness contract for every skill — required frontmatter, attribution,
`source:` for derived work — is in `AGENTS.md` at the repo root.
