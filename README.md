![AOS — BDB Agent OS](assets/header-v4.jpg)

🌐 **Language / Sprache / Idioma**: **English** | [ 🇩🇪 Deutsch ](README.de.md) | [ 🇵🇹 Português ](README.pt.md)

# AOS — BDB Agent OS

[![NPM Version](https://img.shields.io/npm/v/@hybridlabor-api/aos.svg)](https://www.npmjs.com/package/@hybridlabor-api/aos)
[![CI](https://github.com/hybridlabor-api/aos/actions/workflows/ci.yml/badge.svg)](https://github.com/hybridlabor-api/aos/actions)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)

AOS installs a curated skill library, a subagent roster, gate hooks and a runnable multi-agent build pipeline into every coding-agent harness on your machine.

```bash
npx -y @hybridlabor-api/aos@latest
```

Built for people who already run **Claude Code, Google Antigravity, Codex CLI, OpenCode, Cursor, Windsurf, Roo Code / Cline or Aider** and want all of them to behave the same way.

After install you have:

- **<!-- count:skills -->213<!-- /count --> skills** in six categories, discoverable by every harness as `<name>/SKILL.md`.
- **<!-- count:agents -->13<!-- /count --> subagents** (Architect, TechLead, Reviewer, the Godmodes, security and silent-failure reviewers) compiled into each harness's native agent format.
- **<!-- count:mcps -->21<!-- /count --> MCP servers** for creative software, OS control, memory and cross-harness delegation.
- **Three pipelines** — `/startcycle`, `/startcycle-graph`, `/startcycle-graph-user` — and a **GO gate** that mechanically blocks `git push`, `npm publish`, `npm version` and recursive `rm`.
- **Tools:** Plan Canvas, agenttrail, archify, the AOS Store, the Launchpad dashboard and `aos doctor`.

---

## Install

Requirements: Node.js >= 20. macOS, Linux and Windows (PowerShell).

```bash
npx -y @hybridlabor-api/aos@latest
```

**First run.** The installer detects which harnesses are present, asks which to target and which tier (Pro MEDIA or Basic), copies the skills into each harness's skill directory, compiles the subagents, wires the hooks, merges the MCP configuration into each harness's own config file (existing entries are kept), and offers the optional modules listed below.

**Every later run** opens a menu instead:

| Menu item | What it does |
|---|---|
| Quick Update | Refreshes skills, templates, hooks and installed modules to the version you just ran |
| Run System Checkup / Doctor | Runs `aos doctor`: dependencies, file placement, daemons, hooks |
| Drop Local Project Harness | Copies the dispatcher contract into the current directory (see below) |
| Reconfigure System | Change targets, tier or options |
| Uninstall AOS | Removes what the installer placed; your data stays |

### Non-interactive

```bash
npx -y @hybridlabor-api/aos@latest -y --platforms=2          # Claude only, all defaults
npx -y @hybridlabor-api/aos@latest -y --platforms=1,5 --mcps=none
npx -y @hybridlabor-api/aos@latest --dry-run                 # print what would change
```

`--platforms=` values: `0` universal (all detected), `1` Antigravity, `2` Claude Desktop / Claude Code, `3` Cursor, `5` Codex CLI, `6` Windsurf, `7` Roo Code / Cline, `8` Aider, `10` AOS CLI. `4` (custom paths) needs the interactive menu. `--mcps=<name,name>|all|none` picks the MCP subset. `--verbose` and `--no-intro` do what they say.

### Local project harness

Instead of installing into `$HOME`, drop only the dispatcher contract (`.agents/`, the gate hooks, the agent definitions, the `/startcycle-graph` workflow, the OpenCode plugin) into one repository:

```bash
cd your-project && npx -y @hybridlabor-api/aos@latest --project-harness -y
```

---

## Supported harnesses

What the installer writes for each target. Paths are the defaults; the installer only writes to harnesses it actually detects.

| Harness | Skills | Subagents | Hooks | Plugin / rules |
|---|---|---|---|---|
| Claude Code / Claude Desktop | `~/.claude/skills` | `~/.claude/agents` | `~/.claude/hooks` + `settings.json` (GO gate, graph gate, env-file protection, Conventional Commits, memB inject, trail relay) | `.claude-plugin/` manifest ships in the repo (see Contributing) |
| Google Antigravity | `~/.gemini/config/skills` | `~/.gemini/config/agents` | `~/.gemini/config/hooks.json` and `~/.gemini/antigravity-cli/hooks.json` | — |
| Codex CLI | `~/.codex/skills` | `~/.codex/agents` | `~/.codex/hooks` + `config.toml` | `.codex-plugin/` |
| OpenCode | `~/.config/opencode/skills` | `~/.opencode/agents` | via plugin | `bdb-aos.js` plugin + `/startcycle-graph` command, registered in `opencode.jsonc`; keeps a `/startcycle-graph` run moving on `session.idle` |
| Cursor | `~/.cursor/skills` | — | — | `.cursor/rules` (project) |
| Windsurf | `~/.windsurf/bdb-skills` | — | — | `mcp.json` |
| Roo Code / Cline | `~/.roo/skills` | — | — | `.roomodes` (project) |
| Aider | `~/.aider/bdb-skills` | — | — | — |
| AOS CLI (`pi`) | reads `~/.agents/skills` | `~/.agents/AGENTS.md` as system prompt | — | no MCP; separate install, Node >= 22.19 — see [packages/aos-cli](packages/aos-cli/README.md) |

Every install also writes the universal copy to `~/.agents/skills`, which is what the AOS CLI and the `skills` CLI read.

---

## The pipelines

The contract lives in [`.agents/graph.md`](.agents/graph.md), the node roster in [`.agents/nodes.json`](.agents/nodes.json), the executable dispatcher in [`.claude/workflows/startcycle-dispatch.mjs`](.claude/workflows/startcycle-dispatch.mjs).

**One rule: nodes never invoke each other.** A dispatcher reads `production_artifacts/state.json` after each node returns and decides what runs next. There is no hand-off chain and no agent telling another agent to go.

```mermaid
flowchart LR
    U(["User"]) --> A["Architect"] --> T["TechLead"]
    T --> UX["Godmode_UI_UX"] & EN["Godmode_Engineering"] & ME["Godmode_Media"]
    UX & EN & ME --> R["Reviewer"] --> S["Shipping"]
    T -.->|reject| A
    R -.->|findings| UX
    R -.->|needs_human| U
```

| Command | Machinery | Use when |
|---|---|---|
| `/startcycle` | Linear chain, file hand-offs in `production_artifacts/`. No state machine, no repair loop. `/startcycle --skill=<name> <goal>` forces a skill into every node. | A straightforward build with the agent roster but without the ceremony. |
| `/startcycle-graph` | The full graph: durable `state.json`, Reviewer repair loop, automated quality gate, human escalation. | Feature work where correctness matters more than speed and you want an audit trail. |
| `/startcycle-graph-user` | Throwaway 2–4 node fan-out. Nothing persistent. Model-tiered per role; uses Antigravity, OpenCode or Codex if installed, Claude Code subagents otherwise. | A one-off "spawn a few workers" in any project. |

What keeps the full graph honest:

| Mechanism | What it prevents |
|---|---|
| Reviewer isolation | The Reviewer reads artifacts and the plan's contract, never the build node's reasoning or its claim that it is done. |
| No-progress guard | A repair cycle that reports the same blocking finding ID as the previous one escalates to a human instead of burning iterations. |
| Per-node state fragments | Parallel build nodes write `state.d/<node>.json`; the dispatcher merges. No lost-update race on one file. |
| Iteration ceiling | `max_iterations` (default 3) stops the loop unconditionally. |
| In-loop human edge | Any node can set `needs_human: true` and stop the run. |

## The GO gate

Reaching `ready_to_ship` is not shipping. [`.claude/hooks/go-gate.mjs`](.claude/hooks/go-gate.mjs) is a `PreToolUse` hook that blocks `git push`, `npm publish`, `npm version` and recursive `rm` unless your immediately preceding message is the literal word **GO**. It is a hook, not a rule an agent is asked to respect: it fires before any permission-mode check and cannot be argued around. The installer wires the same gate into Antigravity, Codex and OpenCode; on harnesses without hook support the rule in [AGENTS.md](AGENTS.md) applies and the agent is the enforcement. A subagent never inherits its orchestrator's GO, and a failed release command needs a fresh one.

---

## Tools

| Tool | Command | What it does |
|---|---|---|
| Plan Canvas | `aos-plan-canvas open <file>` (skill `plan-canvas`) | Opens a plan or HTML artifact in a local browser canvas where you annotate elements, chat, and approve or request changes. Plans from the pipelines open here by default. |
| agenttrail | `aos-trail` (skill `agenttrail`, port 5330) | Live board of a multi-agent build: which component, which agent or harness, what is done, what is stuck. Fed by the trail-relay hooks and by `mcsc`. |
| archify | `aos-archify` (skill `archify`) | Validated architecture, sequence, data-flow and state diagrams as standalone HTML with SVG export; accepts Mermaid. |
| AOS Store | `aos store list \| search <q> \| install <name> [--project]`, `aos store ui` (also `aos-store`, slash command `/aos-store`) | Browse and install AOS Core and ECC skills and agents. The web UI on `http://127.0.0.1:4322` shows what is installed, previews the exact target paths, and installs only after you confirm. Multi-file skills are installed completely. `list` and `search` read a pinned offline index. |
| Launchpad | `aos-dashboard [--port 7900] [--no-open]` | One page with every local BDB service (memB, Synapse, OpenWiki, AO, Remote, AOS Store): status, start/stop, logs. Registered as an autostart entry. |
| Doctor | `aos doctor [--json] [--net]` (also `aos-doctor`) | Verifies dependencies, skill placement per harness, daemons, hooks and modules; exits 1 when something needs attention. The first thing to run when anything misbehaves. |
| Config | `aos-config show \| propose \| set <key> <value>` | Machine-level `~/.agents/aos-config.json`: workspace root, domains, user id. |
| mcsc | MCP tools `delegate_agy`, `delegate_opencode`, `delegate_codex`, `delegate_smart` (skill `mcsc`) | Delegates a task to another installed CLI harness and streams its tool calls to agenttrail. Preferred over shelling out to the CLI. |

---

## Memory and knowledge

Installed as optional modules by the installer; `aos doctor` verifies them and the Launchpad shows them.

- **memB** (`@hybridlabor-api/memb`) — local, offline vector memory with an MCP server (`add_memory`, `search_memory`, `list_memories`, `delete_memory`), a WebUI on port 8088, and an ambient hook that injects relevant memories into Claude Code sessions. Skills: `memb-skill`, `memb-ingest`, `bdb-memb-mcp`.
- **deja** (`@vshulcz/deja-vu`, installed with memB) — indexes your agent transcripts locally with secrets redacted; `deja fix` on an error, `deja wip` when resuming, `deja search` for past sessions. Skill: `deja-memory`.
- **OpenWiki** (`openwiki` CLI) — generates and refreshes a grounded wiki of a codebase, with a visualizer on port 4321 and a background daemon. Skill: `openwiki-skill`; this repo's own wiki is under [`.openwiki/`](.openwiki/quickstart.md).
- **Synapse** (`@hybridlabor-api/bdb-synapse`) — renders a repository as a 3D code city and replays agent sessions through it. Skill: `synapse-integration-skill`.

`aos-setup` brings a machine to a verified state for all four; `aos-project-init` binds one project to them (slug, wiki, memory, `AGENTS.md`).

---

## Skills

<!-- count:skills -->213<!-- /count --> skills, every one a directory with a `SKILL.md` whose frontmatter declares `name`, `description` and one `category`: `bdb-core`, `design-ui-ux`, `engineering-method`, `engineering-hardware`, `media-eventtech`, `library`. The full catalog is in [docs/skills_table.md](docs/skills_table.md).

The seven **Godmodes** under `skills/basic` are the persona layer; three of them are the build and ship nodes of the graph.

| Godmode | Owns |
|---|---|
| `godmode-engineering` | DDD, Clean Architecture, strict TypeScript, systematic debugging. The `Engineering` node. |
| `godmode-ui-ux` | Anti-slop frontend, DTCG tokens, motion, accessibility. The `UI_UX` node. |
| `godmode-shipping` | Pre-launch checks, quality gate, safe rollback. The `Shipping` node. |
| `godmode-eventtech` | Show control, signal flow, protocols, live-event hardware. |
| `godmode-3d-creation` | MCP-first 3D generation, mesh reconstruction, parametric CAD. |
| `godmode-media-creation` | Video, timeline assembly, motion design pipelines. |
| `godmode-hardware-pcb` | Schematics, PCB layout, KiCad ERC/DRC/DFM gate, enclosure co-design. |

Other entry points worth knowing: `ask-tim` (which skill fits), `bdbrainstorm` and `bdbmediastorm` (multi-agent ideation ending in a plan), `teamwork-preview` (prompt crafting and delegation), the `grilling` family (`grill-me`, `grill-with-docs`, `triage`), `ci-pipeline` and the `github-actions-*` / `dockerfile-*` / `makefile-*` generators and validators, `bdb-security-audit`, `bdbresilience`.

The library is also readable by the `skills` CLI:

```bash
npx skills add hybridlabor-api/aos
```

---

## MCP servers

[`mcp_config.json`](mcp_config.json) defines <!-- count:mcps -->21<!-- /count --> servers, built or warmed by the installer from `mcps/` and merged into each harness's MCP configuration:

- **Creative software:** Unreal Engine, Rhino / Grasshopper (primary + fallback), DaVinci Resolve, Blender, After Effects (primary + fallback), Adobe UXP bridge, TouchDesigner (MindDesigner `tdmcp` + backup), grandMA3, Resolume, Open Design.
- **OS control:** `zavora_computer_use` (macOS / Linux, native binary), `bdb_windows_computer_use`.
- **Memory and delegation:** `memb_mcp`, `deja`, `mcsc`.
- **Infrastructure:** `github`, `chrome-devtools`, `bdb_remoteos_mcp` (multi-cloud gateway with 4-eyes approvals).

Each creative server has a guide skill (`bdb-unreal-mcp`, `bdb-touchdesigner-mcp`, `bdb-davinci-mcp`, ...) that teaches the agent the tool signatures. Per-server ports, primary/fallback pairs and platform notes: [docs/mcp-servers.md](docs/mcp-servers.md).

---

## Optional modules

The installer's module picker offers, and Quick Update keeps current:

| Module | Package |
|---|---|
| memB | `@hybridlabor-api/memb` |
| Synapse | `@hybridlabor-api/bdb-synapse` |
| Heimdall Token Saver (CLI output compression hooks) | `@hybridlabor-api/heimdall-token-saver` |
| AO — Agent Orchestrator (parallel agents in Git worktrees) | `@hybridlabor-api/bdb-agent-orchestrator` |
| Creator Extension (ComfyUI, image-to-3D, video) | `@hybridlabor-api/bdb-dev-creator-extension` |
| Hardware & PCB (KiCad and OpenSCAD design module, driven by `godmode-hardware-pcb`) | `@hybridlabor-api/bdb-hardware-pcb` |
| OS Remote (remote execution gateway) | `@hybridlabor-api/bdb-os-remote` |

Details for each: [docs/ecosystem.md](docs/ecosystem.md).

---

## Updating

Run the same command again. The installer sees the installed version, offers **Quick Update**, and refreshes skills, hooks, templates and modules:

```bash
npx -y @hybridlabor-api/aos@latest
```

There is no `aos update` subcommand. If you once ran `npm i -g @hybridlabor-api/aos`, a plain `aos` on your PATH runs that frozen copy and its version, not the latest; either update it (`npm i -g @hybridlabor-api/aos@latest`) or remove it and stay with `npx`. The installer prints the update command itself whenever a newer version exists; the `bdb-updater` skill wraps the same check for use from inside a session.

## Uninstall

```bash
aos-uninstall              # removes what AOS installed; memory, wikis and credentials stay
aos-uninstall --purge      # also removes ~/.MemBDB, ~/.openwiki, ~/.synapse, ~/.memb
aos-uninstall --dry-run    # list everything, delete nothing
```

The uninstaller works from the install manifest: a file that still matches the hash AOS wrote is removed, a file you edited is backed up instead, a file AOS never wrote is not touched. The same action is in the installer menu.

---

## Contributing

- [AGENTS.md](AGENTS.md) is the single source of rules for every harness: the skill contract, category routing, the release gate, Conventional Commits.
- A skill is a directory with `SKILL.md`; the frontmatter needs `name` (equal to the directory), `description` and `category`. `npm run validate` enforces the contract, as CI does on every push.
- `npm test` runs the validator self-test, the plugin-manifest check and the installer, store, doctor and cross-harness hook tests.
- `.claude-plugin/plugin.json` and `marketplace.json` are generated by `npm run plugin:build` and checked by `npm run plugin:check`. They exist today; the Claude Code marketplace install path is still being finalised, so the installer above remains the supported route.
- Releases are cut by release-please from Conventional Commits; do not bump `package.json` by hand. `feat:` means a minor bump.
- Skills derived from other projects record `source:` in the frontmatter and an entry in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Links

- Package: [npmjs.com/package/@hybridlabor-api/aos](https://www.npmjs.com/package/@hybridlabor-api/aos)
- Source and issues: [github.com/hybridlabor-api/aos](https://github.com/hybridlabor-api/aos) · [issues](https://github.com/hybridlabor-api/aos/issues)
- [CHANGELOG.md](CHANGELOG.md) · [docs/skills_table.md](docs/skills_table.md) · [docs/cli.md](docs/cli.md) · [docs/mcp-servers.md](docs/mcp-servers.md) · [docs/ecosystem.md](docs/ecosystem.md)
- Sibling repos: [bdb-agent-orchestrator](https://github.com/hybridlabor-api/bdb-agent-orchestrator) · [bdb-synapse](https://github.com/hybridlabor-api/bdb-synapse) · [bdb-dev-creator-extension](https://github.com/hybridlabor-api/bdb-dev-creator-extension) · [bdb-hardware-pcb](https://github.com/hybridlabor-api/bdb-hardware-pcb) · [bdb-os-remote](https://github.com/hybridlabor-api/bdb-os-remote)

License: [Apache-2.0](LICENSE).
