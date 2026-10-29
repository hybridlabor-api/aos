<div align="center">

![AOS — BDB Agent OS](assets/header-v5.png)

**Language / Sprache / Idioma**: **English** · [Deutsch](README.de.md) · [Português](README.pt.md)

# AOS² — 5.4.2 “Ouroboros”

[![NPM Version](https://img.shields.io/npm/v/@hybridlabor-api/aos.svg)](https://www.npmjs.com/package/@hybridlabor-api/aos)
[![NPM Downloads](https://img.shields.io/npm/dw/@hybridlabor-api/aos.svg)](https://www.npmjs.com/package/@hybridlabor-api/aos)
[![GitHub stars](https://img.shields.io/github/stars/hybridlabor-api/aos?style=flat&color=gold)](https://github.com/hybridlabor-api/aos/stargazers)
[![last commit](https://img.shields.io/github/last-commit/hybridlabor-api/aos.svg)](https://github.com/hybridlabor-api/aos/commits/main)
[![CI](https://github.com/hybridlabor-api/aos/actions/workflows/ci.yml/badge.svg)](https://github.com/hybridlabor-api/aos/actions)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)
[![skills](https://img.shields.io/badge/skills-262%20shipped-brightgreen.svg)](#skills)
[![MCPs](https://img.shields.io/badge/local%20MCPs-21-brightgreen.svg)](#mcp-servers)
[![harnesses](https://img.shields.io/badge/harnesses-9%20supported-blueviolet.svg)](#supported-harnesses)
[![SkillSpector](https://github.com/hybridlabor-api/aos/actions/workflows/skillspector.yml/badge.svg)](https://github.com/hybridlabor-api/aos/actions/workflows/skillspector.yml)
[![skills.sh](https://img.shields.io/badge/skills.sh-listed-black.svg)](https://skills.sh/hybridlabor-api/aos)

[![agents](https://img.shields.io/badge/subagents-46-orange.svg)](#the-subagents-46)
[![commands](https://img.shields.io/badge/commands-15-blue.svg)](#browse-everything)
[![playbooks](https://img.shields.io/badge/playbooks-36-informational.svg)](#playbooks)
[![A2A](https://img.shields.io/badge/A2A-Claude%20%C2%B7%20OpenCode%20%C2%B7%20agy%20%C2%B7%20Codex-0b7285.svg)](#a2a-sessions-that-talk-to-each-other)
[![MCP gateway](https://img.shields.io/badge/MCP%20gateway-default-teal.svg)](#mcp-gateway-and-one-mcp-per-app)
[![go-gate](https://img.shields.io/badge/go--gate-hook--enforced-red.svg)](#the-go-gate)

<p align="center">
  <b>The operating system for AI agent harnesses.</b><br/>
  One install: the same skills in nine harnesses. Subagents and the hook-enforced GO gate on Claude Code, Antigravity, Codex and OpenCode.
</p>

<p align="center">
  Built for <b>event and media technicians</b>, <b>designers</b> and <b>managers</b>, for <b>builders of custom installations</b> (show control, 3D, PCB and enclosure), and just as much for <b>everyday coding</b> of apps, tools and plugins. The skill library and the MCP servers cover both worlds.
</p>

AOS installs a curated skill library, a subagent roster, gate hooks and a runnable multi-agent build pipeline into every coding-agent harness on your machine.

```bash
npx -y @hybridlabor-api/aos@latest
```

<p align="center">
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-D97757?logo=anthropic&logoColor=white">
  <img alt="Antigravity" src="https://img.shields.io/badge/Google%20Antigravity-4285F4?logo=google&logoColor=white">
  <img alt="Codex CLI" src="https://img.shields.io/badge/Codex%20CLI-412991?logo=openai&logoColor=white">
  <img alt="OpenCode" src="https://img.shields.io/badge/OpenCode-111827">
  <img alt="Cursor" src="https://img.shields.io/badge/Cursor-000000?logo=cursor&logoColor=white">
  <img alt="Windsurf" src="https://img.shields.io/badge/Windsurf-0B100F">
  <img alt="Roo Code / Cline" src="https://img.shields.io/badge/Roo%20Code%20%2F%20Cline-5B21B6">
  <img alt="Aider" src="https://img.shields.io/badge/Aider-14B814">
  <img alt="AOS CLI" src="https://img.shields.io/badge/AOS%20CLI-pi--based-0d1117">
</p>

<sub>Recommended: the full installer above. Alternatively, use the skills CLI:</sub>

<table>
<tr>
<td width="100%" valign="top" align="left"><b>Install skills only</b><br/><br/><code>npx skills add hybridlabor-api/aos</code><br/><br/><sub>Gate hooks and MCP servers require the full installer. Plugin marketplace route is in progress; see <a href="#plugins-and-marketplace">Plugins and marketplace</a>.</sub></td>
</tr>
</table>

<sub>Skills use the open <a href="https://agentskills.io">Agent Skills</a> format (<code>SKILL.md</code>). AOS installs them for <b>Claude Code, Google Antigravity, Codex CLI, OpenCode, Cursor, Windsurf, Roo Code / Cline, Aider and the AOS CLI</b>, so all of them behave the same way.</sub>

<p align="center">
  <img src="docs/assets/readme/architecture-hero.svg" alt="How AOS fits together: nine harnesses feed one kernel of 262 skills, 46 subagents, gate hooks and 21 MCP servers, which drives three pipelines, session-to-session messaging and local tools, with the GO gate in front of every release command" width="100%">
</p>

</div>

---

## What AOS² means

AOS gives every coding agent one harness: rules, skills, guardrails, subagents and memory. AOS² adds a second loop. The harness learns from its own failures and proposes its own fixes.

The name refers to the Ouroboros, a snake that bites its own tail. The loop never ends. It renews itself.

The loop has six steps:

1. **Work.** An agent runs a task. Something fails or runs slowly.
2. **Capture.** AOS records the failure and removes secrets.
3. **Propose.** A strong model writes a fix in a separate copy.
4. **Probe.** A fixed test set checks the fix three times. The fix must improve the target and break nothing else.
5. **Gate.** The go-gate blocks every release command until you type GO.
6. **You merge.** You read the pull request and merge it. AOS never merges a change to itself without you.

**Today** only step 2 and the kill switch exist: `aos-evolve capture`, `status`, `enable` and `disable`. Steps 3 to 6 are the target; no command proposes, probes or merges a fix yet. Evolve stays off until a person runs `aos-evolve enable`. Kill switch: `aos-evolve disable` or `AOS_EVOLVE=off`.

## The five layers

AOS writes five layers into each harness it finds. The layers work the same way in every harness that supports them.

| Layer | What it holds | Examples |
|---|---|---|
| 1. Rules and memory | Instructions the agent reads at start | `AGENTS.md`, rules files, memB decisions |
| 2. Skills | One type of task each. Only the short description stays in context until the task matches. | `/fabric`, `godmode-*` |
| 3. Hooks and guardrails | Checks that run on each tool call and can block it | go-gate, Conventional Commits check |
| 4. Subagents and delegation | Workers with their own context. They return only the result. | `architect`, `reviewer`, `aos-acp` |
| 5. Plugins and distribution | Packages the four layers above for each harness | npm installer, plugin manifests |

AOS knows 15 harness config targets (nine harnesses in the table below). It is optimised for four: Claude Code, Codex, Antigravity and OpenCode. Claude is not required. Other harnesses receive rules and MCP entries. See [Supported harnesses](#supported-harnesses).

## Why AOS

| | Harness default | With AOS |
|---|---|---|
| **Skills** | Each harness has its own skill folder and its own copies. | <!-- count:skills -->262<!-- /count --> skills in eight categories, written as `<name>/SKILL.md` into every harness you have. One source tree. |
| **Subagents** | Agent files written by hand, per harness, in that harness's format. | <!-- count:agents -->46<!-- /count --> subagents compiled into each harness's native agent format (Claude Code, Antigravity, Codex, OpenCode only; others use rules in AGENTS.md). |
| **Release safety** | A rule in a prompt that the agent is asked to respect. | A `PreToolUse` hook (Claude Code, Antigravity, Codex, OpenCode) or rules in AGENTS.md (others) that blocks `git push`, `npm publish`, `npm version` and recursive `rm` until your own message is the literal word **GO**. |
| **Multi-agent builds** | Agents that call agents, with the routing inside their prompts. | A dispatcher graph: nodes never invoke each other, state is durable, a repair loop has a no-progress guard, escalation goes to you. |
| **Plans** | Scroll back through the chat to find what was agreed. | Plan Canvas: annotate the plan in a browser, then approve it before any agent builds. |
| **Visibility** | Read logs in several terminals. | agenttrail live map per repo, and a fleet band in Claude Code with gate mode, token-weather and who waits for your GO. |
| **Sessions** | Each session is alone in its terminal. | A2A between live Claude Code, OpenCode, agy and Codex sessions on localhost. An inbound message is never a GO. |
| **Beyond code** | Coding assistants know code. | 19 media-eventtech skills and MCP servers for grandMA3, Resolume, TouchDesigner, Unreal, DaVinci, After Effects, Blender and Rhino; `godmode-hardware-pcb` for KiCad and OpenSCAD; playbooks for offers, invoices, crew call sheets and event trackers. |

## What you get

<table>
<tr>
<td width="33%" valign="top">🎯 <b>Skills</b><br/>262 shipped skills in eight categories, discoverable by every harness as <code>&lt;name&gt;/SKILL.md</code>.<br/>→ <a href="#skills-at-a-glance">Skills at a glance</a></td>
<td width="33%" valign="top">👥 <b>Subagents</b><br/>46 subagents: Architect, TechLead, Reviewer, Godmodes and specialist reviewers.<br/>→ <a href="#the-dispatcher-graph">The dispatcher graph</a></td>
<td width="33%" valign="top">🔌 <b>MCP servers</b><br/>21 servers for creative software, OS control, memory and cross-harness delegation.<br/>→ <a href="#mcp-servers">MCP servers</a></td>
</tr>
<tr>
<td width="33%" valign="top">🚀 <b>Pipelines & GO gate</b><br/><code>/fabric</code>, <code>/fabric-graph</code>, <code>/fabric-multigraph</code>, and hook-enforced release gate.<br/>→ <a href="#the-pipelines">The pipelines</a></td>
<td width="33%" valign="top">💬 <b>Sessions that talk</b><br/>A2A between Claude Code, OpenCode, agy and Codex sessions on localhost.<br/>→ <a href="#a2a-sessions-that-talk-to-each-other">A2A</a></td>
<td width="33%" valign="top">🛠️ <b>Tools</b><br/>Plan Canvas, agenttrail, archify, AOS Store, AOS Hub, aos sessions, fleet band, aos doctor.<br/>→ <a href="#skills-at-a-glance">Tools</a></td>
</tr>
</table>

<table>
<tr>
<td width="20%" valign="top"><b>Event & media tech</b><br/>• Live show control: grandMA3, Resolume, TouchDesigner<br/>• Media production: Unreal, DaVinci, After Effects</td>
<td width="20%" valign="top"><b>Design</b><br/>• UI/UX design system and brand discovery<br/>• Landing pages, app redesigns, Plan Canvas</td>
<td width="20%" valign="top"><b>Management</b><br/>• Offers, invoices, budget tracking<br/>• Crew sheets, event planning, meeting actions</td>
<td width="20%" valign="top"><b>Custom builds</b><br/>• PCB design and OpenSCAD enclosures<br/>• 3D assets, Rhino, Blender modeling</td>
<td width="20%" valign="top"><b>General dev</b><br/>• Backend, frontend, testing, and shipping<br/>• 46 subagents, three pipelines, library skills</td>
</tr>
</table>

See [Playbooks](#playbooks) for guided workflows across these domains.

---

## Quick start

| I want to... | Run |
|---|---|
| Install for every harness I have | `npx -y @hybridlabor-api/aos@latest` |
| Install with low context overhead | `npx -y @hybridlabor-api/aos@latest --profile=minimal` |
| Refresh only the gates and hooks | `npx -y @hybridlabor-api/aos@latest --hooks-only` |
| See what would change first | `npx -y @hybridlabor-api/aos@latest --dry-run` |
| Check a broken setup | `aos doctor` |
| Open the local control page (services, catalog, store, plans, router) | `aos hub` |
| Browse and add skills and agents | `aos store ui` |
| Add the code knowledge graph | `npx -y @hybridlabor-api/aos@latest -y --modules=codebase-memory` |
| Plan a feature, then build it | `/plan`, then `/fabric-graph` |

---

## Daily commands

| When | Command | Why |
|---|---|---|
| Start of day | `aos doctor` | Checks the install, hooks, gateway and memory before you work. |
| New idea or task | `ask-tim` → `/bdbrainstorm` → `/fabric` | ask-tim picks the route. bdbrainstorm plans and grills the idea. fabric builds it. |
| Missing know-how | `find-skill`, or `aos store search <topic>` | find-skill searches the library and reads only the best match. The store installs one skill instead of loading all of them. |
| Full job | `/playbooks` | Runs a known job in fixed steps, with GO points. |
| Context is full | `/clear-context save` → `/clear` → `/clear-context` | Keeps the work and loses only the chat. |
| Before a risky step | `gogate status` (typed in the chat) or `aos-gogate status` | Shows the gate mode and your active grants. |
| End of day | `/playbooks` → `pb-ship` | Triages issues, reviews open PRs and merges after your GO. |
| New version | `aos update` | Updates the installed AOS. On a terminal it asks once how to handle updates: notify, auto or off. |

**Why the clear cycle.** A long chat fills the context window. The agent then works slower and forgets details. `/clear` empties the window, but it also removes everything that exists only in the chat. So `save` first writes a handoff file and stores the decisions in memB. After `/clear`, `/clear-context` reads the handoff, asks deja what the last session did, checks git again and waits for you.

## See it in action

<p align="center">
<img src="docs/assets/readme/agenttrail-live.gif" alt="agenttrail live plan map of a running multi-agent build" width="100%"><br/>
<sub><b>agenttrail.</b> The live map of a multi-agent build while it runs. <a href="docs/assets/readme/agenttrail-live.mp4">▶ Full-quality video</a></sub>
</p>

<table>
<tr>
<td width="50%" valign="top" align="center">
<img src="docs/assets/readme/plan-canvas.png" alt="Plan Canvas with an annotation on a plan element" width="100%"><br/>
<sub><b>Plan Canvas.</b> Annotate the plan in the browser, then approve it before any agent builds.</sub>
</td>
<td width="50%" valign="top" align="center">
<img src="docs/assets/readme/ao-pipeline.png" alt="AO workspace: the AOS Pipeline monitor with plan, gate, build, review and ship stages and the role-to-model routing" width="100%"><br/>
<sub><b>AO workspace.</b> The pipeline monitor, plan to ship, with role and model routing per node.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top" align="center">
<img src="docs/assets/readme/aos-store.png" alt="AOS Store web UI: skills, agents and playbooks by scope, category and source" width="100%"><br/>
<sub><b>AOS Store.</b> Skills, agents and playbooks on 127.0.0.1:4322.</sub>
</td>
<td width="50%" valign="top" align="center">
<img src="docs/assets/readme/codenotch-usage.png" alt="Codenotch: agents running and busy per harness, AOS and AO versions" width="100%"><br/>
<sub><b>Codenotch.</b> Agents running and busy per harness.</sub>
</td>
</tr>
</table>

<p align="center">
<img src="docs/assets/readme/fleet-band.png" alt="Fleet band in Claude Code showing gate mode, context use and sessions with their GO counts" width="100%"><br/>
<sub><b>Fleet band.</b> In Claude Code: gate mode, token-weather, and the sessions that wait for your GO.</sub>
</p>

<p align="center">
<img src="docs/assets/readme/aos-installer.gif" alt="AOS installer: boot animation, pre-flight telemetry and the setup menu" width="100%"><br/>
<sub><b>Installer.</b> <code>npx -y @hybridlabor-api/aos@latest</code>: boot, pre-flight telemetry, then the setup menu. <a href="docs/assets/readme/aos-installer.mp4">▶ Full-quality video</a></sub>
</p>

---

## Skills at a glance

- [**`/fabric`**](skills/basic/fabric/SKILL.md) - master entry: picks the fitting fabric mode for the task and says why in one line
- [**`/fabric-graph`**](skills/basic/fabric-graph/SKILL.md) - dispatcher graph with durable `state.json`, Reviewer repair loop, quality gate and escalation
  - The dispatcher invokes the subagents [`architect`](agents/architect.md), [`techlead`](agents/techlead.md), [`godmode-ui-ux`](agents/godmode-ui-ux.md), [`godmode-engineering`](agents/godmode-engineering.md), [`godmode-media-eventtech`](agents/godmode-media-eventtech.md), [`reviewer`](agents/reviewer.md) and [`godmode-shipping`](agents/godmode-shipping.md); they never call each other
- [**`/fabric-multigraph`**](skills/basic/fabric-multigraph/SKILL.md) - throwaway 2-4 node fan-out for any project, nothing persistent left behind
- [**`/fabric-teamwork`**](skills/basic/fabric-teamwork/SKILL.md) - prompt crafting and delegation to a team; `/fabric-swarm` runs many similar workers on one shared pool; `/fabric-loop` repeats a cycle until an exit check is green
- [**`/plan`**](commands/plan.md) - draft, render in a browser canvas, annotate, await approval, then hand off
  - [**`plan-canvas`**](skills/global_config/plan-canvas/SKILL.md) - local canvas where you annotate elements, chat and approve or request changes
  - [**`plan-arbiter`**](skills/global_config/plan-arbiter/SKILL.md) - compare competing plans from several agents and produce one recommended plan
- [**`/bdbrainstorm`**](skills/bdbrainstorm/SKILL.md) - multi-agent brainstorm that ends in a hand-off to `/fabric-graph`
  - [**`/grill-me`**](skills/global_config/grill-me/SKILL.md) - relentless interview to sharpen a plan or design
  - [**`bdbmediastorm`**](skills/basic/bdbmediastorm/SKILL.md) - brainstorming for live event tech, show control and real-time media
- [**`/playbooks`**](commands/playbooks.md) - list every `pb-*` playbook with duration, difficulty and requirements, and start one
  - [`pb-bug-fix`](skills/playbooks/pb-bug-fix/SKILL.md) - GitHub issue to tested fix and PR; push and PR only after GO
  - [`pb-ship`](skills/playbooks/pb-ship/SKILL.md) - triage, review and gate the day's PRs; merge only after GO
  - [`pb-release-aos`](skills/playbooks/pb-release-aos/SKILL.md) - release AOS to npm through the release-please PR
  - [`pb-show-build`](skills/playbooks/pb-show-build/SKILL.md) - build a show across grandMA3, Resolume and TouchDesigner, offline first
  - [`pb-offer`](skills/playbooks/pb-offer/SKILL.md) - draft a client offer priced from your price list; send only after GO
- [**`factory-collect`**](skills/global_config/factory-collect/SKILL.md) - Factory: collect and triage feedback, telemetry, errors and issue reports
  - [`factory-lookback`](skills/global_config/factory-lookback/SKILL.md) - audit recurring problems across sources for systemic fixes
  - [`factory-review-prs`](skills/global_config/factory-review-prs/SKILL.md) - review a configured PR queue; approve and merge stay with you
  - [`factory-human-digest`](skills/global_config/factory-human-digest/SKILL.md) - read-only digest of what still needs a human decision
- [**`gogate`**](skills/global_config/gogate/SKILL.md) - show or explain the go-gate mode (hard, soft, off) and the time-limited grants; CLI: `aos-gogate`
- [**`aos-a2a`**](skills/global_config/aos-a2a/SKILL.md) - list, send to and reply to live harness peers over A2A on localhost
  - [`master-session`](skills/basic/master-session/SKILL.md) - supervise several sessions: roster, status requests, GO board; workers can be spawned through `aos-acp`
  - [`mcsc`](skills/global_config/mcsc/SKILL.md) - delegate a task to another installed CLI harness (agy, OpenCode, Codex)
- [**`agenttrail`**](skills/global_config/agenttrail/SKILL.md) - live browser map of a multi-agent build; CLI: `aos-trail`
- [**`aos-store`**](skills/global_config/aos-store/SKILL.md) - browse, preview and install skills and agents from a local web UI (`aos store`)
- [**`memb-skill`**](skills/global_config/memb-skill/SKILL.md) - local-first long-term memory engine (memB)
  - [`memb-ingest`](skills/memb-ingest/SKILL.md) - ingest project files and conversation logs into memB
- [**`openwiki-skill`**](skills/global_config/openwiki-skill/SKILL.md) - initialize, update and visualize codebase wikis with OpenWiki
- [**`synapse-integration-skill`**](skills/synapse-integration-skill/SKILL.md) - BDB Synapse 3D codebase visualizer integration
- [**`/doctor`**](commands/doctor.md) - check the machine and the current project, print suggested `permissions.allow` entries, write no settings
- [**`aos-setup`**](skills/global_config/aos-setup/SKILL.md) - bring a machine to a complete, verified AOS installation
  - [`aos-project-init`](skills/global_config/aos-project-init/SKILL.md) - set up a project folder: slug, wiki, memory, Synapse map, `AGENTS.md`
- **Godmodes** - domain rulebooks
  - [`godmode-engineering`](skills/basic/godmode-engineering/SKILL.md) - strict DDD, TypeScript strictness, Clean Architecture, 5-step debugging triage
  - [`godmode-ui-ux`](skills/basic/godmode-ui-ux/SKILL.md) - brand discovery, Anti-Slop rules, DTCG design tokens, fluid motion
  - [`godmode-eventtech`](skills/basic/godmode-eventtech/SKILL.md) - show-control execution for grandMA3, Resolume, Unreal, Rhino, Vectorworks and Adobe MCP
  - [`godmode-hardware-pcb`](skills/basic/godmode-hardware-pcb/SKILL.md) - schematics, PCB layout, KiCad and OpenSCAD enclosures with DFM/DRC/ERC sign-off
  - [`godmode-shipping`](skills/basic/godmode-shipping/SKILL.md) - final gatekeeper: pre-launch checks, feature-flag rollouts, rollback planning
- **Vendored helpers** from [BuilderIO/skills](https://github.com/BuilderIO/skills)
  - [`read-the-damn-docs`](skills/global_config/read-the-damn-docs/SKILL.md) - forces a docs pass before coding third-party APIs from memory
  - [`stay-within-limits`](skills/global_config/stay-within-limits/SKILL.md) - respect 5-hour and weekly usage limits in long or parallel runs
  - [`quick-recap`](skills/global_config/quick-recap/SKILL.md) - end each response with a red/yellow/green status line

Full catalogs (every skill, subagent, playbook and MCP server) are in the collapsible lists under What's included.

---

## What's new in 5.4 “Ouroboros”

| Area | What changed |
|---|---|
| **Self-improvement** | The AOS² loop (see “What AOS² means” above). Capture, status, enable and disable only. Evolve stays off until enabled. |
| **Skill store** | A few router skills find the rest in the store. The session installs only what the task needs. See [Skill store](#skill-store). |
| **MCP gateway** | Creator and show-control servers sit behind one entry with lazy loading. See [Creator and event tools](#creator-and-event-tools-behind-the-gateway). |
| **go-gate** | Modes `hard`, `soft`, `off`, time-limited grants and `GO #<pr>`. See [Modes, grants and GO](#modes-grants-and-go). |
| **Coordination** | Five patterns, each mapped to an AOS mode. See [Five ways to coordinate](#five-ways-to-coordinate). |
| **Since 5.4.0** | `fabric-swarm` and `fabric-loop`. One hook process per Claude event instead of one per hook. Factory runs with the go-gate off and only hard blocks left; `aos-factory --unattended` runs it in a container. The `aos-fabric` CLI (`start`, `next`, `report`, `status`, `cancel`, `drive`) runs a fabric pipeline in any harness. `aos-gateway status` names the root cause of a server that never connected. The hub has a Router tab. `aos update` asks the update mode once. `aos-uninstall` lists everything it keeps. |

## What's new in v5

v5 changes how AOS gets onto a machine and how its parts talk to each other.

| Area | What changed |
|---|---|
| **Installer** | Rebuilt flow: Kernel, Harnesses, Packages, Optional, Verify. Profiles `minimal`, `standard`, `full`; `--no-hooks`, `--hooks-only`, `--without=<ids>`; repair and uninstall from the manifest; one version check at the start with Update as the default. See [Install](#install) and [docs/install-options.md](docs/install-options.md). |
| **MCP gateway** | `aos-gateway`: one local endpoint (1mcp behind a token-checking forwarder) in front of an allow list of shipped servers, `aos-gateway adopt` for your own stdio servers, and **one MCP per app** (Blender, Resolume, After Effects). Installed with the default profile; opt out with `aos-gateway direct`, `--without=gateway` or `--profile=minimal`. [docs/mcp-gateway.md](docs/mcp-gateway.md). |
| **A2A** | Live Claude Code, OpenCode, agy and Codex sessions message each other with `aos-a2a`. An inbound message is never a GO. Any MCP-capable harness can join through the `aos-a2a` MCP server. [docs/a2a.md](docs/a2a.md). |
| **Native agents** | Subagents are compiled into the formats and paths each harness really reads, including OpenCode and agy. No model is pinned unless you set one: [docs/agent-models.md](docs/agent-models.md). |
| **Fleet mod** | A band in Claude Code: gate mode, token-weather (context percent as a weather word plus a sparkline), and which sessions work or wait for you with their GO counts. `aos-gogate` shows gate state read-only. |
| **AOS Hub** | One local page for everything AOS runs on demand, on `127.0.0.1:7900`: Services, Catalog, Store, Plans and Router. `aos hub`, `aos services`, `aos restart`. It replaces the old Launchpad (page and login item); `aos-dashboard` is now a thin alias. [docs/hub.md](docs/hub.md). |
| **agenttrail** | One live map per repo, started automatically, with a link in your session. A v2 control room is **in progress**. |
| **Plan Canvas** | Plans open in a local canvas; annotations are dispatched back to the agent. |
| **go-gate** | Read, test and build commands with no write or network effect pass without a GO; deny logs mask credentials; hooks in four harnesses; a machine-wide gate profile (`strict`, `work`, `off`) narrows or widens it. |
| **Playbooks and Factory** | 37 `pb-*` playbooks, the nine `factory-*` skills and `plan-arbiter`. |
| **Orchestrator chain** | master session, project orchestrator, package orchestrator, mapped to real mechanisms. |

**In progress, not claimed as shipped.** agenttrail v2 control room, A2A intercom and a2abook, A2A `spawn` mode, `skill-create` and `instinct-*`.

---

## The dispatcher graph

The graph is harness-neutral and runs on Claude Code's Dynamic Workflows, Antigravity's parallel execution, and any compatible agent harness.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart TB
    subgraph SG[" "]
    direction TB
    U(["User"])
    A["<b>Architect</b><br/>System Plan"]
    T["<b>TechLead</b><br/>Capability Map"]
    UX["<b>UI_UX</b><br/>Frontend"]
    EN["<b>Engineering</b><br/>Backend"]
    ME["<b>Media_EventTech</b><br/>Creative"]
    R["<b>Reviewer</b><br/>QA"]
    S["<b>Shipping</b><br/>Gate"]

    U --> A --> T
    T --> UX & EN & ME
    UX & EN & ME --> R
    R --> S

    T -.->|reject| A
    R -.->|findings| UX
    S -.->|gate fail| EN
    R -.->|escalate| U
    end

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef human fill:#F7F4EC,stroke:#5B6168,color:#15171A
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    style SG fill:#F7F4EC,stroke:#B9B5AA,color:#15171A

    class A,T plan
    class UX,EN,ME build
    class R,S gate
    class U human
```

<p align="center"><sub><b>Dispatcher graph.</b> Architect and TechLead plan, three build nodes work in parallel, Reviewer and Shipping gate the result, and dashed edges route rejections and escalations.</sub></p>

---

## Install

**Requirements.** Node.js >= 20. macOS, Linux and Windows (PowerShell).

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
| Reconfigure System | Change targets, tier, profile or options |
| Uninstall AOS | Removes what the installer placed; your data stays |

### Profiles and options

| Flag | Effect |
|---|---|
| `--profile=standard` (default) | Skills, agents, rules, all hooks, MCPs, OpenWiki, fleet. Token Saver is off by default (use `--profile=full` to include it); for CLI output compression install [rtk](https://github.com/rtk-ai/rtk) yourself, AOS does not install it. |
| `--profile=minimal` | Skills, agents and harness rules only. No context-injection hooks, OpenWiki, Token Saver, Codenotch, optional modules, gateway or fleet. The low-context choice. |
| `--profile=full` | `standard` plus every optional module (same as `--modules=all` with `-y`). |
| `--no-hooks` | Skips only the context-injection hooks (`memb-inject`, `rules-inject`, `trail-relay`, `trail-autostart`). |
| `--hooks-only` | Installs or refreshes hooks and their settings entries, then exits. With `--no-hooks` it refreshes the gates only. |
| `--without=id,id` | Excludes packages by registry id (`memb, synapse, openwiki, remote, ao, creator, hardware, rustauri, styleseed, installer, deja, token-saver, codenotch, gateway, hub, fleet, sessions, alert`) or the bundle `memory` (memB, deja and OpenWiki: [unified memory](docs/unified-memory.md)). Saved, so updates and repair skip them. |
| `--modules=id,id` | Includes only the named optional modules on an otherwise non-interactive run (for example `--modules=creator` or `--modules=codebase-memory`); `all` takes every module. Also settable through `AOS_MODULES`. |
| `AOS_DISABLED_MCPS=a,b` | Keeps those shipped MCP server names out of the harness configs the installer writes. |
| `--dry-run` | Prints what would change and writes nothing. |

**The gate and safety hooks are always installed.** No profile or flag removes `go-gate`, `go-token`, `go-grant`, `graph-gate`, `conventional-commits` or `env-file-protection`. The OpenCode plugin is not affected by `--no-hooks` or `minimal`. Profile choices are saved in `~/.aos/v5-settings.json`. Full reference: [docs/install-options.md](docs/install-options.md).

### Non-interactive

```bash
npx -y @hybridlabor-api/aos@latest -y --platforms=2          # Claude only, all defaults
npx -y @hybridlabor-api/aos@latest -y --platforms=1,5 --mcps=none
npx -y @hybridlabor-api/aos@latest -y --modules=codebase-memory,styleseed
npx -y @hybridlabor-api/aos@latest --dry-run                 # print what would change
```

`--platforms=` values: `0` universal (all detected), `1` Antigravity, `2` Claude Desktop / Claude Code, `3` Cursor, `5` Codex CLI, `6` Windsurf, `7` Roo Code / Cline, `8` Aider, `10` AOS CLI. `4` (custom paths) needs the interactive menu. `--mcps=<name,name>|all|none` picks the MCP subset. `--verbose` and `--no-intro` do what they say.

### Local project harness

Instead of installing into `$HOME`, drop only the dispatcher contract (`.agents/`, the gate hooks, the agent definitions, the `/fabric-graph` workflow, the OpenCode plugin) into one repository:

```bash
cd your-project && npx -y @hybridlabor-api/aos@latest --project-harness -y
```

---

## Supported harnesses

AOS knows 15 harness config targets (`lib/harnesses.json`). The table below groups them into nine harnesses, plus the Codenotch app. It is optimised for four: Claude Code, Codex, Antigravity and OpenCode. The other targets get rules and MCP entries. Claude is not required: each harness works on its own with the same skills. Pick a harness below to see what the installer writes there.

**What gets written.** The installer writes the following for each target. Paths are the defaults; the installer only writes to harnesses it actually detects.

| Harness | Skills | Subagents | Hooks | Plugin / rules |
|---|---|---|---|---|
| Claude Code / Claude Desktop | `~/.claude/skills` | `~/.claude/agents` | `~/.claude/hooks` + `settings.json` (GO gate, graph gate, env-file protection, Conventional Commits, memB inject, trail relay, A2A inbox) | `.claude-plugin/` manifest ships in the repo (see Contributing); fleet mod registered in `settings.json` |
| Google Antigravity | `~/.gemini/config/skills` | `~/.gemini/config/agents/<name>/agent.md` | `~/.gemini/config/hooks.json` and `~/.gemini/antigravity-cli/hooks.json` | root `plugin.json` / `plugins/bdb-aos/plugin.json`, commands `/bdb-aos:<cmd>`, see [docs/codex-agy-setup.md](docs/codex-agy-setup.md) |
| Codex CLI | `~/.agents/skills` (Codex reads this root and `~/.codex/skills`; AOS writes only the first, so skills are not listed twice) | `~/.codex/agents` | `~/.codex/hooks` + `config.toml` | `.codex-plugin/` + `.agents/plugins/marketplace.json`, commands `$bdb-aos:<cmd>`, see [docs/codex-agy-setup.md](docs/codex-agy-setup.md) |
| OpenCode | `~/.config/opencode/skills` | `~/.config/opencode/agents` | via plugin | `bdb-aos.js` plugin + `/fabric-graph` command, registered in `opencode.jsonc`; keeps a `/fabric-graph` run moving on `session.idle`; generated `/bdb-aos-<cmd>` commands; opt-in extras, see [docs/opencode-setup.md](docs/opencode-setup.md) |
| Cursor | `~/.cursor/skills` | none | none | `.cursor/rules` (project) |
| Windsurf | `~/.windsurf/bdb-skills` | none | none | `mcp.json` |
| Roo Code / Cline | `~/.roo/skills` | none | none | `.roomodes` (project) |
| Aider | `~/.aider/bdb-skills` | none | none | none |
| AOS CLI (`pi`) | reads `~/.agents/skills` | `~/.agents/AGENTS.md` as system prompt | none | no MCP; separate install, Node >= 22.19, see [packages/aos-cli](packages/aos-cli/README.md) |
| BDB AO Codenotch (macOS app, Windows installer) | macOS `/Applications` or `~/Applications`; Windows per-user NSIS install (`/S`, no admin) | none | none | installed by default on macOS and Windows (never Linux); opt out with `--no-codenotch` or `AOS_CODENOTCH=0`; failures only warn; DMG from the public releases repo created by Tim, SHA-256 verified, ad-hoc signed with quarantine removed, see [docs/codenotch.md](docs/codenotch.md) |

Every install also writes the universal copy to `~/.agents/skills`, which is what the AOS CLI and the `skills` CLI read.

**OpenCode agents.** The four godmode personas (`godmode-ui-ux`, `godmode-engineering`, `godmode-media-eventtech`, `godmode-shipping`) are compiled with `mode: all`, so they show up in the OpenCode agent picker and can drive a whole session, not only a subagent call. Two thin session-level roles are written next to them as `mode: primary` agents that load the matching skill: `master-session` (roster, status requests, GO board) and `project-orchestrator` (parallel agents across repositories through the AO daemon). Every other agent is compiled as `mode: subagent`.

### Capability tiers

The harnesses do not get the same safety layer. The tier says what is actually wired, not what a harness could do in theory; per-row evidence is in [docs/harness-capabilities.md](docs/harness-capabilities.md).

| Tier | Harnesses | What you get |
|---|---|---|
| 1 Full | Claude Code | GO gate as an enforced hook, typed grants and modes (`gogate grant ...`), Fleet panel, A2A inbox drained into the next prompt, all context hooks, MCP gateway entries |
| 2 Gate and grants | OpenCode | GO gate through the plugin, grants capped at 2 h and no `off` mode, A2A injected as a prompt, MCP gateway entries; no panel |
| 3 Gate hook only | Codex CLI, Antigravity (agy) | A `PreToolUse` gate hook is installed; grants and modes are not wired (only a literal human `GO` counts); Codex needs a one-time `/hooks` trust, and whether the hook fires under `codex exec`, `aos-acp` or `agy --print` is **unverified**; A2A inbound by `codex queue` (Codex) or pull-only (agy) |
| 4 Skills, rules, MCP | Cursor, Windsurf, Roo Code / Cline, Aider | Skills and project rules (Cursor `.mdc`, Roo modes); MCP entries for Cursor; **no hook**, so the Destructive Actions text in `AGENTS.md` is the only safety layer |
| Not supported | Zed, Kimi | No installer target |

Where a tier has no hook, nothing mechanical stops a guarded command: use a Tier 1 or 2 harness for anything that can push, publish or delete.

<details>
<summary><b>Capability map per harness (4)</b></summary>

**Delegation, A2A and gate hooks.** Rows state what the code in this repo does. Source: [docs/harness-capabilities.md](docs/harness-capabilities.md).

| Capability | Claude Code | OpenCode | Codex | agy |
|---|---|---|---|---|
| Delegation out (`aos-acp`) | yes | yes | yes | via shell commands (no ACP client of its own) |
| A2A inbound | UserPromptSubmit drain + Stop nudge | plugin inject as synthetic prompt | `codex queue` / `codex exec resume` | pull only, inbox MCP `a2a_inbox_pull`; a running interactive session cannot be pushed into |
| A2A reply | `aos-a2a reply` via pre-approved Bash rules | reply file written by the plugin | answer to the queued or resumed prompt | `a2a_reply` tool, or `aos-a2a reply` |
| A2A sidecar mode | `--mode live` | `--mode live` | `--mode live` | `--mode live` |
| GO gate hook | yes | yes (plugin, shared hooks) | yes (a hook is installed; firing under `codex exec`, `aos-acp` and `agy --print` is unverified) | gate-only hooks (`PreToolUse`, `PreInvocation`, `Stop`) |
| Never-GO on A2A inbound | yes | yes | yes | yes |

</details>

---

## The pipelines

The contract lives in [`.agents/graph.md`](.agents/graph.md), the node roster in [`.agents/nodes.json`](.agents/nodes.json), the executable dispatcher in [`.claude/workflows/fabric-dispatch.mjs`](.claude/workflows/fabric-dispatch.mjs).

**One rule: nodes never invoke each other.** A dispatcher reads `production_artifacts/state.json` after each node returns and decides what runs next. There is no hand-off chain and no agent telling another agent to go. This design ensures context fidelity, single-place auditability of routing logic, and portability across harnesses.

Each node reads the plan and its own prior state, executes its work, writes its artifact and state fragments, and returns. The dispatcher merges per-node state fragments (`state.d/<node>.json`), evaluates edge predicates, and routes to the next node, or escalates to the user if a no-progress guard triggers (same blocking finding on the second repair cycle) or the iteration ceiling is reached.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph SG[" "]
    direction LR
    U(["User"]) --> A("Architect") --> T("TechLead")
    T --> UX("Godmode_UI_UX") & EN("Godmode_Engineering") & ME("Godmode_Media")
    UX & EN & ME --> R("Reviewer") --> S("Shipping")
    T -.->|reject| A
    R -.->|findings| UX
    R -.->|needs_human| U
    end

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef human fill:#F7F4EC,stroke:#5B6168,color:#15171A
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    style SG fill:#F7F4EC,stroke:#B9B5AA,color:#15171A

    class A,T plan
    class UX,EN,ME build
    class R,S gate
    class U human
```

<p align="center"><sub><b>Node roster.</b> The seven nodes of the graph and the edges that send work back: reject, findings and needs_human.</sub></p>

| Command | Machinery | Use when |
|---|---|---|
| `/fabric` | Master entry. Reads the task, picks one of the modes below and says which and why in one line. | Whenever you are unsure which mode fits. |
| `/fabric-graph` | The full graph: durable `state.json`, Reviewer repair loop, automated quality gate, human escalation. Flags: `--skill=<name>`, `--profile=<name>`, `--workstreams`. | Feature work where correctness matters more than speed and you want an audit trail. |
| `/fabric-multigraph` | Throwaway 2-4 node fan-out. Nothing persistent. Model-tiered per role; uses Antigravity, OpenCode or Codex if installed, Claude Code subagents otherwise. | A one-off "spawn a few workers" in any project. |
| `/fabric-teamwork` | 9-step prompt crafting and delegation to a team. | A vague brief that needs sharpening before a team gets it. |
| `/fabric-swarm` | N similar workers take items from one shared pool (`production_artifacts/swarm.json`). | Many near-identical items, one worker each. |
| `/fabric-loop` | Repeat a graph run until an exit check is green, bounded by round limits. | Repeat until a condition holds. |

### The modes side by side

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart TB
    subgraph L["/fabric-graph (linear run)"]
        direction LR
        L1("Architect") --> L2("TechLead") --> L3("parallel build") --> L4("Reviewer")
        L1 -. "production_artifacts/*.md" .-> L4
    end
    subgraph G["/fabric-graph (durable)"]
        direction LR
        D{{"Dispatcher<br/>state.json"}}
        D --> N1("node") --> D
        D --> N2("node") --> D
        D --> Q("quality gate")
        D -. "no progress / ceiling" .-> H(["Human"])
    end
    subgraph F["/fabric-multigraph (throwaway)"]
        direction LR
        F0("main session") --> W1("worker") & W2("worker") --> F3("review pass")
    end
    L ~~~ G ~~~ F

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef human fill:#F7F4EC,stroke:#5B6168,color:#15171A
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    class L1,L2,F0 plan
    class L3,N1,N2,W1,W2 build
    class L4,Q,F3,D gate
    class H human
    style L fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    style G fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    style F fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

<p align="center"><sub><b>Three modes.</b> The linear run, the durable dispatcher graph and the throwaway fan-out, side by side.</sub></p>

**What keeps the full graph honest.**

| Mechanism | What it prevents |
|---|---|
| Reviewer isolation | The Reviewer reads artifacts and the plan's contract, never the build node's reasoning or its claim that it is done. |
| No-progress guard | A repair cycle that reports the same blocking finding ID as the previous one escalates to a human instead of burning iterations. |
| Per-node state fragments | Parallel build nodes write `state.d/<node>.json`; the dispatcher merges. No lost-update race on one file. |
| Iteration ceiling | `max_iterations` (default 3) stops the loop unconditionally. |
| In-loop human edge | Any node can set `needs_human: true` and stop the run. |

### Orchestrator chain

**Mapping.** `master session -> project orchestrator -> package orchestrator` is a convention. This is how each hop maps to mechanisms that exist ([docs/orchestrator-chain.md](docs/orchestrator-chain.md), skill `orchestrator-chain`):

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart TD
    subgraph SG[" "]
    direction TB
    H(["Human"]) -->|"GO &lt;session&gt;"| M("Master session<br/>skill master-session<br/>roster, status, GO board")
    M --> P("Project orchestrator<br/>ao-orchestrator or a pipeline dispatcher")
    P --> K1("Package orchestrator<br/>aos-acp worker")
    P --> K2("Package orchestrator<br/>aos-a2a peer")
    P --> K3("Package orchestrator<br/>pipeline build node")
    K1 -.->|"never inherits GO"| M
    K2 -.->|"A2A message is never a GO"| M
    end

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef human fill:#F7F4EC,stroke:#5B6168,color:#15171A
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    style SG fill:#F7F4EC,stroke:#B9B5AA,color:#15171A

    class H human
    class M gate
    class P plan
    class K1,K2,K3 build
```

<p align="center"><sub><b>Orchestrator chain.</b> Each hop from the human down to a package orchestrator, with dashed edges showing that a GO is never inherited upward.</sub></p>

**Depth.** A2A rejects a send when the caller's depth is at or above `AOS_A2A_MAX_DEPTH` (default 1) and `mcsc` is one level deep. Workers delete nothing; cleanup is the dispatcher's job after your GO.

---

## Five ways to coordinate

Each pattern maps to an AOS mode. Agents never call each other. A dispatcher, the main session or a script, decides each next step.

| Pattern | AOS mode | Fits | Cost |
|---|---|---|---|
| **Sequential** | `/fabric-graph` | A known order of steps. Durable `state.json` and a repair loop. | Waiting. Each step runs after the last. |
| **Concurrent** | `/fabric-multigraph` | Independent slices, 2-4 workers. Nothing persistent. | Peak load and merge work. |
| **Group chat** | `/fabric-teamwork`, `/bdbrainstorm` | A vague goal that needs debate before a build. | A long thread and more turns. |
| **Handoff** | `/clear-context`, `aos-acp` | The context or the limit is reached, or another model is stronger for the task. | Lost detail, or a wrong route. |
| **Planning manager** | master session (`master-session`, `pb-master`) | Steps are unknown up front. One session supervises several others. | Planning calls and stalls. |

**Headless runs.** `aos-fabric start --goal <text>` creates a run; `aos-fabric drive --run <id>` loops next, execute, report until the run is done, escalated or `ready_to_ship`. The executor is `--executor aos-acp|ao|auto` (default `aos-acp`). `ao` is optional: it runs each step with `ao spawn --workdir <step dir>` and falls back to `aos-acp` when AO is absent or does not list `--workdir`; `auto` uses AO only when it is clearly up. AOS works without AO. See [docs/fabric.md](docs/fabric.md).

## Modes, grants and GO

The go-gate asks for a literal GO by default. Three settings change that. Type each one as a full message.

**Modes:** `gogate hard`, `gogate soft`, `gogate off`, `gogate status`.

- **hard:** a literal GO for every guarded command. It also cancels your grants.
- **soft** (default): like hard, but your active grants also allow commands.
- **off:** the gate only logs. This session only, max 24 hours. Hard blocks (deleting the home directory, changing the gate config) stay.

**Grants:** `gogate grant <scope[,scope]> <15m | 2h | 1d | session>`, for example `gogate grant merge,push-feature 2h`.

- **push-feature:** push to a named, non-protected branch.
- **push-main:** all other pushes, force pushes and deletes.
- **merge:** `gh pr merge`.
- **publish:** npm publish, npm version, releases and tags.
- **destructive:** reset --hard, clean -f, rm -r, branch -D, worktree remove.
- **github-write:** PR and issue comments, edits and `gh api` writes.
- **container-test** and **workspace:** narrower scopes for sandbox test runs and workspace paths.

A grant lasts at most 24 hours. Only you can type a grant. An agent, a peer or a file cannot.

**GO:** type `GO` as the full message. `GO #117` (also `GO PR 117`) covers only `gh pr` merge, edit, close, review and comment on the named PRs.

- A GO is never passed to a worker.
- After a hard block the agent stops and reports. It does not rephrase the command or try another route.

The gate profiles below are a separate, machine-wide setting.

## The GO gate

Reaching `ready_to_ship` is not shipping. [`.claude/hooks/go-gate.mjs`](.claude/hooks/go-gate.mjs) is a `PreToolUse` hook that blocks `git push`, `npm publish`, `npm version` and recursive `rm` unless your immediately preceding message is the literal word **GO**. It is a hook, not a rule an agent is asked to respect: it fires before any permission-mode check and cannot be argued around. The installer wires the same gate into Antigravity, Codex and OpenCode; on harnesses without hook support the rule in [AGENTS.md](AGENTS.md) applies and the agent is the enforcement. A subagent never inherits its orchestrator's GO, and a failed release command needs a fresh one.

**What v5 adds.**

- **Read-only work stays fast.** Read, test and build commands with no write or network effect pass without a GO, also after peer messages.
- **An A2A message is never a GO.** Every injected message carries that line.
- **Modes and grants.** Gate mode (`hard`, `soft`, `off`) and time-limited grants are shown by `aos-gogate status` and the `gogate` skill. `aos-gogate` is read-only and never records a grant.
- **Deny logs mask credentials** (bearer tokens, flags, URLs with credentials).
- **Limit.** The hook sees tool calls the harness routes through it. A worker started with permissions bypassed asks for nothing, so the in-harness hook stays the main layer.

### Gate profiles

A machine-wide, human-set profile widens or narrows what the gate asks for. `.claude/hooks/go-gate.mjs` reads it through `.claude/hooks/gate-profile.mjs`, so every harness that uses the shared go-gate (Claude Code, OpenCode, Codex, agy) honours it.

| Profile | Needs you | Default / maximum |
|---|---|---|
| `strict` | everything guarded (default) | never expires |
| `work` | the release class only | 4 h / 24 h |
| `off` | hard blocks only | 1 h / 2 h |

```bash
aos-gate status                       # profile, time left, last change
aos-gate profile work --for 24h       # needs a real TTY; refused inside a harness session
aos-gate profile strict               # no confirmation needed
```

- **Release class** (still needs a GO under `work`): push to the default branch, `main`/`master` or `release/*`, `npm publish`, `npm version`, `npm dist-tag add/rm`, `gh pr merge`, `gh release create`, recursive delete, bulk move out of home and delete outside the own worktree.
- **Hard blocks stay in every profile**: writes to the gate store or its config, delete paths built from HOME, `~` or environment variables, recursive delete outside the own worktree, edits to the gate hooks and the settings that register them.
- **Fail closed**: a missing, unreadable, symlinked, oversized, wrongly owned or wrong-mode (not 0600) config, a corrupt or expired file, or a `work`/`off` profile without expiry all read as `strict`. Config: `~/.aos/gate/config.json`.
- Loosening requires typing back a random word on the TTY.
- Accepted residual: code running as your own user can write the profile file directly. See [docs/gate-residuals.md](docs/gate-residuals.md).

---

## Playbooks

A playbook is a skill with `kind: playbook` that turns a recurring job into a guided run with a fixed contract. The 37 `pb-*` playbooks ship with the skills; list and start them with `/playbooks` (it runs `list-playbooks.mjs` and prints name, time, difficulty and requirements for each). There is no per-playbook command: you name the playbook.

**What a playbook declares.** Its frontmatter names trigger phrases, `inputs`, `requires` (skills, subagents, MCP servers, store items), `go_points`, `outputs`, a `verify` check, `difficulty` and `est_time`. The body is a numbered step list. Each step names the skill or agent it uses, its input, the artifact it writes and the check that says it is done.

**How a run works.**

- **One session by default.** The main session walks the steps and calls the required skills. Every step appends one line to a run log (`production_artifacts/pb-<name>-<date>.md`, never committed).
- **Subagents where it matters.** Steps marked `(agent)` run a subagent: `reviewer` in `pb-bug-fix`, `pb-ship` and `pb-release-aos`; `architect`, `techlead` and `reviewer` in `pb-harness-work`, `pb-idea-to-launch` and `pb-redesign-app`; `security-reviewer` and `silent-failure-hunter` in `pb-security-sweep`; `opensource-forker` and `opensource-sanitizer` in `pb-open-source`. On a harness without subagents the main session reads the agent file and runs the same contract inline. `pb-master` goes one step further and runs a control session over several Claude Code, Codex or OpenCode sessions.
- **GO points are part of the contract.** A `[GO]` step stops with `WAITING FOR GO: <step>` until you type **GO**; one GO covers one step, once. The go-gate hook is only the backstop. A failed check stops the run and is written into the log; nothing is retried silently.
- **One command, not one per playbook.** There is a single `playbooks` command that lists them; after that you name the playbook. How to reach it differs per harness:

| Harness | Type this |
|---|---|
| Claude Code | `/bdb-aos:playbooks`, then name one; or say what you want ("master session" starts `pb-master`) |
| Codex | `$bdb-aos:playbooks`; mentioning a playbook by name in words also works through `~/.agents/skills` (direct `$pb-<name>` use is unverified) |
| OpenCode | `/bdb-aos-playbooks`, or ask in words; playbooks that need an app server (media, show) stop with "Missing MCP" by design |
| Antigravity (agy) | `/bdb-aos:playbooks` (command namespacing on a live agy is unverified, see [docs/agy-coverage.md](docs/agy-coverage.md)) |
| Cursor, Windsurf, Roo Code / Cline, Aider | skills folder only, no command: ask for the playbook by name |

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph SG[" "]
    direction LR
    I[("Issue")] --> C1("Root cause<br/>+ test")
    C1 --> C2("Fix")
    C2 --> R("Review")
    R -.->|findings| C2
    R --> C3("PR")
    C3 --> G{{"GO"}}
    G -->|yes| C4("Push")
    end

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    style SG fill:#F7F4EC,stroke:#B9B5AA,color:#15171A

    class I store
    class C1,C3 plan
    class C2,C4 build
    class R,G gate
```

<p align="center"><sub><b>pb-bug-fix.</b> The issue is the contract, the test comes before the fix, the Reviewer sees only the diff and the issue, and the push waits for your GO.</sub></p>

<details>
<summary><b>Playbooks by domain (36)</b></summary>

| Playbook | Purpose | Subagents | Time · level |
|---|---|---|---|
| **Build and code** | | | |
| `pb-bug-fix` | Turn a GitHub issue into a tested fix on a branch with an open PR. | reviewer | 30-90 min · intermediate |
| `pb-project-new` | Start a new private GitHub project the AOS way. | — | 20-40 min · intermediate |
| `pb-idea-to-launch` | Turn an idea into a deployed prototype. | architect, techlead, reviewer | 2-6 h · advanced |
| `pb-harness-work` | Change the agent harness itself (hooks, gates, memory, permissions, plugins) the safe way. | architect, techlead, reviewer | 1-3 h · advanced |
| `pb-security-sweep` | Security sweep over one repo: secrets, dependencies, diff, one ranked findings report. | security-reviewer, silent-failure-hunter | 1-2 h · advanced |
| `pb-open-source` | Prepare a project for open sourcing: sanitized fork, sanitizer verdict, README and LICENSE, new private repo. | opensource-forker, opensource-sanitizer | 1-3 h · advanced |
| `pb-tauri-e2e` | Multi-phase E2E, live-app, and binary security audit for Tauri v2 desktop apps. | reviewer, silent-failure-hunter, security-reviewer | 15-45 min · advanced |
| `pb-worktrees-land` | Clean up git worktrees across your repos; removes only merged ones. | — | 10-30 min · intermediate |
| **Release, CI and operations** | | | |
| `pb-ship` | Ship the day's work in one repo: triage, review every open PR, merge. | reviewer | 20-60 min · intermediate |
| `pb-release-aos` | Release a new AOS version to npm through the release-please PR, merged only after GO. | reviewer | 30-60 min · advanced |
| `pb-ci-fix` | Fix red CI or set up GitHub Actions end to end; push only after GO. | — | 15-45 min · intermediate |
| `pb-aos-e2e` | AOS release E2E check in a clean sandbox from the packed tarball: install, doctor, gate hooks, gate round trip, hub, uninstall. | reviewer | 20-60 min · advanced |
| `pb-deploy-saas` | Deploy a SaaS app to the BDB fleet: preflight, guardrail plan, green CI, deploy after GO, health check. | — | 30-90 min · advanced |
| `pb-health-weekly` | Weekly health report over the BDB repos: version drift and CI status. | — | 15-30 min · intermediate |
| **Design and web** | | | |
| `pb-landing-page` | Build and launch a landing page: confirmed copy, brand tokens, UI and SEO review, deploy after GO. | — | 1-3 h · intermediate |
| `pb-redesign-app` | Overhaul one app's UI against an audit. | architect, techlead, reviewer | 2-4 h · advanced |
| `pb-docs-site` | Publish a project's docs as a static HTML manual on GitHub Pages. | — | 30-90 min · intermediate |
| `pb-newsletter` | Turn a recap or changelog range into a newsletter draft where every claim cites a source line. | — | 20-40 min · intermediate |
| **Media and event tech** | | | |
| `pb-show-build` | Build a show across lights (grandMA3), media (Resolume) and visuals (TouchDesigner) from one cue list, offline first. | — | 2-6 h · advanced |
| `pb-crew-call-sheet` | Build a crew call sheet and a load-in / load-out plan for one show day; send to the crew only after GO. | — | 10-20 min · beginner |
| `pb-event-tracker` | One spreadsheet for an event: guests, vendors, timeline, budget, with vendor messages drafted. | — | 20-40 min · intermediate |
| `pb-clip-from-moodboard` | Turn a look brief and reference images into a finished social clip. | — | 1-3 h · advanced |
| `pb-image-to-3d` | Turn one reference image into a cleaned, scaled 3D asset. | — | 30-90 min · advanced |
| `pb-launch-video` | Turn a live app or landing page into a short launch video. | — | 30-90 min · intermediate |
| `pb-social-pack` | Turn a release recap into a social pack where every claim traces to a facts file. | — | 30-60 min · intermediate |
| `pb-content-studio` | Idea to published-ready content: brief, script, render through the Creator Extension content-studio skill, then a social pack. | — | 45-120 min · intermediate |
| **Hardware** | | | |
| `pb-pcb-to-case` | From a KiCad board to a parametric OpenSCAD enclosure that fits it. | — | 1-3 h · advanced |
| **Management and office** | | | |
| `pb-offer` | Draft a client offer with line items priced only from your price list; send only after GO. | — | 10-20 min · beginner |
| `pb-invoice-check` | Check invoices and receipts line by line against your offers. Nothing is paid or sent. | — | 10-20 min · beginner |
| `pb-inbox-zero` | Sort an email backlog into reply, delegate, archive and ignore, and draft the replies. | — | 10-20 min · beginner |
| `pb-meeting-actions` | Turn a meeting transcript into notes, decisions and owners; send the follow-up only after GO. | — | 10-20 min · beginner |
| `pb-handover` | Write a handover note for a colleague from the state of a project folder. | — | 10-20 min · beginner |
| `pb-week-plan` | Turn scattered to-do lists and notes into one prioritised plan for the week. | — | 10-20 min · beginner |
| `pb-focus-chunks` | Split one big task into chunks of at most 25 minutes, each with a done-check. | — | 5-10 min · beginner |
| `pb-todo` | Turn one sentence into a task line in the right to-do list. | — | 2-5 min · beginner |
| **Machine and sessions** | | | |
| `pb-machine-setup` | Bring a new machine to a verified AOS installation. | — | 30-60 min · intermediate |
| `pb-master` | One control session over several Claude Code, Codex or OpenCode sessions: roster, status board, GO board. | — | 15 min setup, then session-long · advanced |

</details>

---

## Factory

**What it is.** Nine experimental skills adapted from [BuilderIO/skills](https://github.com/BuilderIO/skills) that turn feedback, telemetry, errors, issues and pull requests into a repeatable review loop: `factory` (the schedule and policy that hosts the others), `factory-collect`, `factory-lookback`, `factory-review-prs`, `factory-human-digest`, plus the delivery-side `factory-ship`, `factory-babysit-pr`, `factory-watchdog` and `factory-recover`. `plan-arbiter` ships alongside them for comparing competing plans. Factory runs are meant to run with the go-gate off; external writes then follow the action policies in `.agent-factory/config.yaml` instead of a literal GO.

**The review loop.**

| Skill | Reads | Writes | External writes |
| --- | --- | --- | --- |
| `factory-collect` | the sources in `workflows.collect.sources` | triage report, draft replies, proposed close wording; optional local fix | Policy-gated: reply, close, push, merge, publish |
| `factory-lookback` | configured sources over a bounded period, prior fixes | pattern report; optional local systemic fix | Policy-gated: reply, close, publish, merge |
| `factory-review-prs` | PRs matching the configured filters | per-PR findings, draft comments, approval and merge readiness | Policy-gated: reply, approve, merge |
| `factory-human-digest` | configured repositories and sources (default last 7 days) | decision queue, nothing else | Read-only |

### How to run

- **Invoke by name.** Ask the agent to run the skill, for example `factory-collect`; each `SKILL.md` carries a "Use when" trigger. Start by hand and read the report before enabling anything scheduled.
- **Configure.** `.agent-factory/config.yaml`, read by all of them. Keys named in the skills: `workflows.collect.sources`, `workflows.collect.implement`, `workflows.lookback`, `workflows.lookback.implement`, `workflows.human-digest`, and an optional `skill_prompts.<skill-name>` per skill. If the file is missing the skill stops and asks; it never creates it.
- **Gate and policies.** Before a run, you type `gogate off` as a plain message in the session that runs the factory (an agent never types it). With the gate off, each external write follows its action policy (`never`, `manual`, `criteria`, `after-fix`, `after-merge`): `never` always blocks, `manual` still stops and asks you. Hard blocks always stay: deleting the home directory or a top-level folder of it, and changes to the gate config. With the gate on, every external write waits for your literal GO. Releases (`npm publish`, `npm version`) default to `manual`.
- **Build runs.** When a module has to build a change, the build is an `aos-fabric` run (`aos-fabric start --goal-file …`, then `aos-fabric drive --run <id>`). `drive` ends at `ready_to_ship` or when a human is needed; it never pushes. The plan verdict is a human step; in a run nobody watches, `AOS_PLAN_APPROVAL=auto` skips it and prints a warning.
- **Unattended.** `node bin/aos-factory.mjs --unattended [--image <image>] [--env NAME]... -- <command>` runs the command in a Docker or Podman container on a fresh clone of the current branch. The clone has no remotes, and the host gate is not changed.

Vendored from [BuilderIO/skills](https://github.com/BuilderIO/skills) (MIT) with AOS safety changes, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); upstream docs: https://github.com/BuilderIO/skills/blob/main/docs/factory/README.md.

Details: [docs/factory.md](docs/factory.md).

---

## A2A: sessions that talk to each other

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/a2a-logo-white.svg"><img src="docs/assets/readme/a2a-logo-black.svg" alt="A2A protocol logo" height="40"></picture><br/>
  <img alt="aos-a2a: sidecar per session plus harness plugins and hooks" src="https://img.shields.io/badge/aos--a2a-sidecar%20%2B%20harness%20plugins-0b7285"> <img alt="A2A protocol, @a2a-js/sdk" src="https://img.shields.io/badge/protocol-A2A%20(%40a2a--js%2Fsdk)-333333">
</p>

Live Claude Code, OpenCode, agy and Codex sessions exchange messages on localhost. Each live session runs a small sidecar bound to `127.0.0.1` on a random port with a per-session bearer token and registers in a local registry. There is no central service.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A", "textColor": "#15171A", "actorBkg": "#E6F4EA", "actorBorder": "#1A7F3C", "actorTextColor": "#15171A", "actorLineColor": "#6e7681", "signalColor": "#6e7681", "signalTextColor": "#6e7681", "noteBkgColor": "#F7F4EC", "noteBorderColor": "#B9B5AA", "noteTextColor": "#15171A", "lineColor": "#6e7681", "sequenceNumberColor": "#15171A", "labelBoxBkgColor": "#F7F4EC", "labelBoxBorderColor": "#B9B5AA", "labelTextColor": "#15171A", "loopTextColor": "#15171A"}}}%%
sequenceDiagram
    participant C as Claude Code session
    participant R as local registry
    participant O as OpenCode session
    C->>R: aos-a2a list
    R-->>C: live peers (name, harness, url)
    C->>O: aos-a2a send --to opencode-1 "review this diff"
    Note over O: plugin injects it<br/>as a prompt,<br/>marked "never a GO"
    O-->>C: aos-a2a reply taskId "answer"
    Note over C: Codex: queue or resume<br/>agy: pull via inbox MCP
```

<p align="center"><sub><b>A2A message flow.</b> A Claude Code session lists live peers in the local registry, sends a message to an OpenCode session and gets the reply back.</sub></p>

```bash
aos-a2a list                              # live peers
aos-a2a send --to <name> "<text>"         # message a session
aos-a2a reply <taskId> "<answer>"         # answer an incoming message
aos-a2a watch <name> [--once]             # follow a peer read-only
```

Inbound per harness: Claude Code drains the inbox in a hook, OpenCode gets a plugin injection, Codex gets `codex queue` or `codex exec resume`, agy pulls through an inbox MCP (a running interactive agy session cannot be pushed into). For other channels use `mcsc` (one-shot task) or `aos-acp` (worker that may need a GO): [docs/delegation-routing.md](docs/delegation-routing.md). Details: [docs/a2a.md](docs/a2a.md). **In progress:** intercom and a2abook on top of A2A.

**For any MCP-capable harness.** `bin/aos-a2a-mcp.mjs` is one stdio server that puts send and pull in the same place, so agy, Cursor and anything else that speaks MCP can join without a harness plugin. Tools: `a2a_list`, `a2a_send`, `a2a_status`, `a2a_card`, `a2a_inbox_pull`, `a2a_reply`. Three rules make it safe to expose to a model:

- **It requires `AOS_A2A_NAME`.** Send, reply and pull fail with `AOS_A2A_NAME is not set` instead of inventing an identity. `a2a_reply` has no name argument at all, so a model cannot write another session's reply.
- **Text is data.** Arguments are validated locally to 8 KiB before any network call, the MCP exposes no GO, approval or token argument, and peer text is always wrapped with the never-GO line. `bin/a2a-inbox-mcp.mjs` stays the separate pull-only inbox MCP already registered for agy.
- **No secrets in output.** Peer bearer tokens never appear in any tool result; they are read from the registry's separate token file over loopback.

---

## Tools

<p align="center"><img src="docs/assets/readme/tools-landscape.svg" alt="The AOS tool landscape: universal harness on top, below it the AO workspace, agenttrail, A2A, the MCP gateway, memB, design and godmode skills, Creator Extension with Synapse, and Codenotch" width="100%"><br/><sub><b>Tool landscape.</b> The universal harness on top, with the AOS tools and optional modules below it.</sub></p>

<details>
<summary><b>Original v3.4.0 overview sketch</b></summary>

<p align="center"><img src="assets/bdb_v3_4_0_core_tools_overview_sketch.jpg" alt="BDB system components overview from v3.4.0" width="100%"><br/><sub><b>v3.4.0 overview.</b> Conceptual sketch from v3.4.0; components have grown since, and the table below is current.</sub></p>

</details>

| Tool | Command | What it does |
|---|---|---|
| Plan Canvas | `aos-plan-canvas open <file>` (skill `plan-canvas`) | Opens a plan or HTML artifact in a local browser canvas where you annotate elements, chat, and approve or request changes. Plans from the pipelines open here by default. |
| agenttrail | `aos-trail` (skill `agenttrail`, port 5330) | Live board of a multi-agent build: which component, which agent or harness, what is done, what is stuck. Fed by the trail-relay hooks, `mcsc` and `aos-acp`. |
| archify | `aos-archify` (skill `archify`) | Validated architecture, sequence, data-flow and state diagrams as standalone HTML with SVG export; accepts Mermaid. |
| AOS Store | `aos store list \| search <q> \| install <name> [--project]`, `aos store ui` (also `aos-store`, slash command `/aos-store`) | Browse and install AOS Core, ECC and Scenario (scenario-labs/skills, MIT) skills and agents; required skills are installed together and every file is SHA-256 verified. Both UIs lay the items out as a card grid (installed vs missing, name, category, tier) instead of a table: the standalone web UI on `http://127.0.0.1:4322` and the Store tab of the AOS Hub, where a slide-over previews the exact target paths and installs or rolls back only after you type the name. `list` and `search` read a pinned offline index: 287 ECC skills (library 174, bdb-core 46, engineering-method 38, design-ui-ux 19, media-eventtech 10), 53 ECC subagents and 13 Scenario skills (third-party, MIT, [scenario-labs/skills](https://github.com/scenario-labs/skills)). Items the installer already places are excluded from the list. |
| AOS Hub | `aos hub [--port 7900] [--tab id] [--no-open]`, `aos hub status [--json]`, `aos hub stop`, slash command `/hub` | The one local page for everything AOS runs on demand, on `127.0.0.1:7900`, with five tabs: **Services** (status, start/stop/restart, log tails), **Catalog** (every skill, agent, command and MCP with what is installed where), **Store** (the card grid), **Plans** (plan-kit sessions linked to their agenttrail map) and **Router** (which agent takes which role). Loopback only, per-process token in `~/.aos/hub/hub.json` (0600), typed confirm on anything destructive. It replaces the old Launchpad HTTP server; `aos-dashboard` is now a thin alias that starts the hub. A fresh install registers it as a login service (launchd, systemd user unit or Task Scheduler); `--without=hub` skips that. |
| Dashboard | `aos-dashboard [--port 7900] [--no-open]` | Thin alias for the AOS Hub on the same port. Superseded by `aos hub`. |
| Sessions | `aos-sessions [--json]`, Claude Code mod `bdb-aos-sessions` (`/aos-sessions`) | Read-only overview of every live session across harnesses plus the ACP workers, in four groups: NEEDS YOU, WORKING, IDLE, ACP WORKERS. Feeds the fleet band and the hub Plans tab. The installer enables the mod when Claude Code is found. |
| Doctor | `aos doctor [--json] [--net]` (also `aos-doctor`) | Verifies dependencies, skill placement per harness, daemons, hooks, modules and the MCP gateway; prints one row per check with a passed/total count (the total depends on the installed modules and harnesses); exits 1 when a critical check fails. `--resources` shows a process census. The first thing to run when anything misbehaves. |
| Workers | `aos-acp <claude\|codex\|opencode\|agy> --name <worker> [--sandbox coop\|wsl2]` | Start a worker whose guarded commands need a GO token for its name. `--sandbox` wraps the launch in an optional per-run sandbox (off by default): `coop` on macOS/Linux, `wsl2` on Windows. |
| Fleet band | Claude Code mod `plugins/bdb-aos-fleet` | Two-line band: gate mode (click it for the gate pane), token-weather, sessions that work or wait with GO counts, and the active projects. Needs Claude Code >= 2.1.287; enabled by the installer, opt out with `AOS_NO_FLEET=1` or `--without=fleet`. |
| Alert bar | Claude Code mod `plugins/bdb-aos-alert` (`/aos-alert test`, `/aos-alert off`) | A red blinking bar around the prompt when a go-gate block, permission request or question stops the session. Like the sessions mod it is read-only and grants no GO. Enabled by the installer like the fleet and sessions mods (`--without=alert` to skip). |
| GO helper | `aos-gogate status [--session <id>] \| preset <name> \| presets` | Read-only gate status and preset texts. Never records a grant. |
| Gate profile | `aos-gate status \| profile <strict\|work\|off> [--for <duration>]` | Read or change the machine-wide gate profile; changing one needs a real TTY and is refused inside a harness session. |
| A2A | `aos-a2a list \| send \| reply \| status \| cancel` | Messages between live harness sessions. |
| MCP gateway | `aos-gateway status \| enable \| direct \| adopt` | One local endpoint for shared MCP servers. Installed by a fresh install with the default profile; `direct` turns it back off. |
| Config | `aos-config show \| propose \| set <key> <value>` | Machine-level `~/.agents/aos-config.json`: workspace root, domains, user id. |
| mcsc | MCP tools `delegate_agy`, `delegate_opencode`, `delegate_codex`, `delegate_smart` (skill `mcsc`) | Delegates a task to another installed CLI harness and streams its tool calls to agenttrail. Preferred over shelling out to the CLI. |

### AOS Hub and the sandbox

**Hub tabs.** Services, Catalog, Store, Plans and Router. The Catalog tab is strictly read-only: it reads `skills/`, `agents/`, `commands/`, `mcp_config.json`, `mcp_picks.json` and the gateway allow list, and cross-checks the command list against `plugin.json`. No request value ever reaches the filesystem and nothing is written. The same CLI works without a browser: `aos services status [--json]`, `aos services start <id>`, `aos services stop <id> --confirm <id>`, `aos restart <id> --confirm <id>`. Details: [docs/hub.md](docs/hub.md).

**Worker sandbox.** `aos-acp --sandbox <provider>` wraps one worker launch, and only that launch. It is off by default and the provider is checked before anything starts:

| Provider | Where | How it wraps |
|---|---|---|
| `coop` | macOS and Linux | Needs the `coop` binary on `PATH` **and** `AOS_SANDBOX_COOP_CMD`, a template containing `{cmd}` as its own token (for example `coop <subcommand> {cwd} -- {cmd}`), because the pinned coop v0.8.0 README documents no run-a-command form. `{cwd}` is replaced with the worker directory. |
| `wsl2` | Windows | `wsl.exe --cd <path> --exec <cmd...>`, so the prompt is not re-split by a shell. Drive paths are translated to `/mnt/<drive>/...`; UNC and `\\?\` paths are refused rather than mistranslated. Unverified on a real Windows machine. |

An unknown provider, or one unavailable on this platform, fails with the reason and nothing is launched. `--sandbox` does not narrow paths itself: with `--allow-default=scoped` the path narrowing is agy's sandbox and the aos-go-gate hook, not this flag.

### Fleet band and token-weather

**Token-weather.** The fleet mod turns the context percent of a session into a weather word with advice and a sparkline: for example `ok` at low use, `compact soon` around 80 percent, `compact or start a new session` above 90. The same band lists your Claude sessions, which work, which wait for you, and how many GO requests each has pending. Source: `plugins/bdb-aos-fleet`.

---

## Skill store

The session starts with a small set of skills. Router skills know the rest. A router (`find-skill`, `ask-tim`) searches the store, which holds 300 store skills and 53 store subagents across the AOS, ECC and Scenario sources. This is the store count; the kernel ships 262 skills and 46 subagents. The session installs only what the task needs, then uses it at once.

- `aos store search <query>` (every word must match name, description or category)
- `aos store install <name> [--project]`
- `aos store install --pack <name>`; `aos store packs` lists the packs.
- `aos store rollback <name>` restores the previous copy.
- `/fabric … --skill=<name>` makes one skill required. If it is missing, the run shows the install command.

Each installed skill adds its description to every session. Fewer skills mean a smaller context and better skill choice.

## Creator and event tools behind the gateway

Creator tools (Blender, DaVinci Resolve, After Effects, Unreal) and show-control tools (grandMA3, Resolume, TouchDesigner) run behind the MCP gateway.

- A fresh install with the default profile installs the gateway and points every harness at it.
- Run `aos-gateway status` first. It exits 1 when the gateway is down, and for a server that never connected it prints the root-cause line from the upstream log. Fix that cause, then `aos-gateway restart`. Run `aos-gateway enable` only when the harness configs do not point at the gateway.
- `aos-gateway add <server>` adds one server. `aos-gateway inspect <server>` shows its tools.
- `aos-gateway run <server>/<tool> --args '{…}'` calls one tool.
- `aos-gateway adopt` moves your own local MCP servers behind the gateway. `aos-gateway direct` puts them back.
- Lazy loading is on. The agent sees three tools: `tool_list`, `tool_schema` and `tool_invoke`. It loads a schema only when it needs the tool.
- `aos context worker` removes the media servers for code workers (`aos context full|orchestrator|worker|small`).

A light desk or a media server is live equipment. The live-media-operator agent asks before each show-critical action. memB and deja stay direct in every harness.

## MCP servers

[`mcp_config.json`](mcp_config.json) defines <!-- count:mcps -->21<!-- /count --> local stdio servers, built or warmed by the installer from `mcps/`. They reach your harnesses in one of two ways:

- **Direct.** Each server is written into every harness's MCP configuration, so every harness sees the same tool set. This is what you get with `--without=gateway`, `--profile=minimal` or after `aos-gateway direct`.
- **Through the MCP gateway (the default).** Every harness gets one `aos` entry pointing at `127.0.0.1:7790`; behind it, [1mcp](https://github.com/1mcp-app/agent) runs the servers on the gateway allow list once for all harnesses. `aos-gateway adopt` moves your own local servers behind it too, and `aos-gateway direct` switches back. deja, memB, mcsc and the OS-control servers always stay direct.

**One residual worth knowing.** The gateway entry carries its local token inline as an `X-AOS-Token` header in each harness config: the secret launcher (`bin/aos-mcp-env.mjs`) covers stdio servers, and a streamable-HTTP entry needs the header itself. The token stops browsers, not other local processes.

The column "Routing" says which path a server takes when the gateway is on; "Reaches the app via" says how it talks to its application. API keys and tokens live in `~/.aos/secrets.env` (mode 0600), never inline in a harness config: [docs/mcp-secrets.md](docs/mcp-secrets.md).

| Server | App | Reaches the app via | Routing | Skill |
|---|---|---|---|---|
| **3D / CAD** | | | | |
| `bdb_blender_mcp` | Blender | socket integration; the official Blender MCP is picked instead when Blender >= 5.1 is found | gateway (official pick: direct) | `bdb-blender-mcp` |
| `bdb_rhino_mcp` | Rhino 3D, Grasshopper | McNeel Yak router, needs Rhino on the host | direct | `bdb-rhino-mcp` |
| `bdb_rhino_mcp_fallback` | Rhino 3D | GOLEM 3D (105 tools) | direct | `bdb-rhino-mcp` |
| `bdb_unreal_mcp` | Unreal Engine 5 | Web Remote Control API, port 30010 | gateway | `bdb-unreal-mcp` |
| **Video / post** | | | | |
| `bdb_davinci_mcp` | DaVinci Resolve | Resolve scripting API (162 tools) | gateway | `bdb-davinci-mcp` |
| `bdb_after_effects_mcp` | After Effects | pinned `@kumoproductions/mcp-aftereffects`, Node >= 24; legacy server only with `AOS_AE_MCP=legacy` | gateway | `bdb-after-effects-mcp` |
| `bdb_after_effects_mcp_fallback` | After Effects | Go server, ExtendScript | direct | `bdb-after-effects-mcp` |
| `adobe_uxp_mcp` | Photoshop, Illustrator, Premiere Pro, After Effects | UXP WebSocket bridge | gateway | `bdb-adobe-suite-mcp` |
| **Show control / live** | | | | |
| `bdb_grandma3_mcp` | grandMA3 | typed `ma3_*` tools, OSC/UDP port 8000 | gateway | `bdb-grandma3-mcp` |
| `bdb_resolume_mcp` | Resolume Arena | REST API, port 8080; the official Arena server is picked when its binary is found | gateway (official pick: direct) | `bdb-resolume-mcp` |
| `bdb_td_minddesigner` | TouchDesigner | MindDesigner bridge, port 9980 | direct | `bdb-touchdesigner-mcp` |
| `bdb_td_backup` | TouchDesigner | stdio bridge, fallback | direct | `bdb-touchdesigner-mcp` |
| **Design / browser** | | | | |
| `open_design_mcp` | Open Design | local daemon on 127.0.0.1:3000 | gateway | — |
| `chrome-devtools` | Chrome | Puppeteer | direct | — |
| **OS control** | | | | |
| `zavora_computer_use` | macOS, Linux desktop | `npx -y @zavora-ai/computer-use-mcp@7.4.0`, native Rust module bundled in the npm package | direct | `bdb-computer-use-mcp` |
| `bdb_windows_computer_use` | Windows desktop | Win32, COM, UIAutomation, local Tesseract OCR | direct | `bdb-computer-use-mcp` |
| **Memory / infra** | | | | |
| `memb_mcp` | memB | local SQLite + ONNX, WebUI on port 8088 | direct | `memb-skill`, `bdb-memb-mcp` |
| `deja` | agent transcripts | local index, secrets redacted | direct | `deja-memory` |
| `mcsc` | other harnesses | spawns agy, OpenCode or Codex and streams to agenttrail | direct | `mcsc` |
| `github` | GitHub | `@modelcontextprotocol/server-github` | gateway | `github` |
| `bdb_remoteos_mcp` | RemoteOS | multi-cloud gateway with 4-eyes approval | direct | — |

**Routing.** The allow list in `lib/gateway/config.js` decides: the nine servers marked `gateway` are shared through the one `aos` entry once you enable it; everything else stays direct in every harness.

### MCP gateway and one MCP per app

**One MCP per app.** For Blender, Resolume and After Effects the installer keeps a single candidate (`mcp_picks.json`): Blender official when Blender >= 5.1 is found, Resolume official when the Arena binary is found, the bundled server otherwise. The After Effects server is a pinned `npx` package and needs Node >= 24 (the legacy server only with `AOS_AE_MCP=legacy`).

**Gateway (the default profile).** `aos-gateway` runs a token-checking forwarder on `127.0.0.1:7790` in front of `@1mcp/agent` and shares an allow list of shipped servers behind one `aos` entry per harness. `aos-gateway adopt` moves your own local stdio servers behind it (skipping remote entries and entries with inline secrets). `aos-gateway direct` reverses everything. The token stops browsers, not other local processes. `deja`, `memb_mcp` and `mcsc` stay direct. Opt out with `--without=gateway` or `--profile=minimal`.

**Skipped shapes.** The gateway only writes into a harness whose config shape it has verified. Claude Desktop, Cline, Aider, VS Code, Windsurf, the Cursor app-support copy and a second agy candidate are reported as `skipped: shape unverified` and are never modified, because no vendor documentation for their remote-entry shape is recorded. The verified rows are Claude Code, Cursor (`~/.cursor/mcp.json`), Roo Code, OpenCode, Codex (`config.toml`) and Antigravity.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph D["Direct (gateway off)"]
        direction LR
        H1("Claude") --> S1[("github")] & S2[("blender")] & S3[("resolume")]
        H2("OpenCode") --> S1 & S2 & S3
        H3("Codex") --> S1 & S2 & S3
        H4("agy") --> S1 & S2 & S3
    end
    subgraph G["Gateway (default)"]
        direction LR
        G1("Claude") & G2("OpenCode") & G3("Codex") & G4("agy") --> F("aos entry<br/>127.0.0.1:7790<br/>token check")
        F --> M("1mcp agent<br/>127.0.0.1:7791") --> U1[("github")] & U2[("blender")] & U3[("resolume")]
        G1 -.->|"stays direct"| X[("memb_mcp, deja, mcsc")]
    end
    D ~~~ G

    classDef plan fill:#E6F4EA,stroke:#1A7F3C,color:#15171A
    classDef build fill:#FFFFFF,stroke:#15171A,color:#15171A
    classDef gate fill:#1A7F3C,stroke:#1A7F3C,color:#FFFFFF
    classDef human fill:#F7F4EC,stroke:#5B6168,color:#15171A
    classDef store fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    linkStyle default stroke:#6e7681,stroke-width:2px

    class H1,H2,H3,H4,G1,G2,G3,G4 plan
    class S1,S2,S3,U1,U2,U3,X store
    class F,M gate
    style D fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
    style G fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

<p align="center"><sub><b>Direct and gateway routing.</b> With the gateway on (the default) every harness shares one aos entry in front of the 1mcp agent; with it off each harness talks to each server directly.</sub></p>

**Reference.** [docs/mcp-gateway.md](docs/mcp-gateway.md).

---

## Plugins and marketplace

**Plugin manifest.** `.claude-plugin/plugin.json` + `marketplace.json` (generated by `npm run plugin:build`). AOS ships plugin manifests for Claude Code (`.claude-plugin/`), Codex (`.codex-plugin/`) and Antigravity (`plugin.json`); OpenCode has no marketplace concept and loads a local plugin instead. Sources: [docs/marketplaces.md](docs/marketplaces.md).

| Harness | Install | Update |
|---|---|---|
| Claude Code | `claude plugin marketplace add hybridlabor-api/aos` · `claude plugin install bdb-aos@bdb-marketplace` | `claude plugin marketplace update bdb-marketplace` · `claude plugin update bdb-aos@bdb-marketplace` |
| Codex CLI | `codex plugin marketplace add hybridlabor-api/aos` · `codex plugin add bdb-aos@bdb-aos` | `codex plugin marketplace upgrade bdb-aos` · `codex plugin add bdb-aos@bdb-aos` |
| Antigravity (agy) | `agy plugin install <local plugin dir>` — the npm installer runs this for you | re-run the npm installer |
| OpenCode | local plugin `.opencode/plugins/bdb-aos.js`, copied by the installer; no marketplace | overwrite the plugin file |

The Claude marketplace `bdb-marketplace` offers four plugins: `bdb-aos` (skills and subagents), `bdb-aos-fleet`, `bdb-aos-sessions` and `bdb-aos-alert`. When Claude Code is found, the installer offers the three mods (`-y` enables them) and registers them in `~/.claude/settings.json` itself; `--without=fleet,sessions,alert` or `--profile=minimal` skips them, and Uninstall removes them. The npm installer still performs each harness's plugin registration best-effort; the CLI commands above are the manual equivalents. The marketplace route carries skills and subagents only — the npm installer is the recommended route because it also sets up gate hooks and MCP servers.

**Skills discovery.** Every harness finds skills in its native directory (`~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, `~/.roo/skills`, etc.). To browse and install additional skills after install:

```bash
npx skills add hybridlabor-api/aos
```

This discovers all <!-- count:skills -->262<!-- /count --> shipped skills and installs them into the universal `~/.agents/skills` directory (used by all harnesses and the AOS CLI).

---

## AOS CLI

A lightweight CLI harness built on [pi](https://github.com/earendil-works/pi), a coding agent that runs in the terminal. AOS CLI reads `~/.agents/skills` (written by the installer) and `~/.agents/AGENTS.md` (the dispatcher graph as system instructions), runs no MCP servers of its own, and needs **Node >= 22.19** (pi's floor, higher than the main AOS installer).

```bash
aos-cli "what is the fastest way to fix this bug"
aos-cli --continue                    # resume the previous session
```

The CLI launcher (`packages/aos-cli/bin/aos-cli.mjs`) ships with an AOS-themed dark mode (`aos.json`), the ten core skills from `core-skills.json` (ask-tim, aos-setup, systematic-debugging, archify, etc.), and two in-session read-only commands (`/aos` shows the install menu; `/aos-status` runs the health check).

Install it through the AOS installer with the AOS CLI target: `npx -y @hybridlabor-api/aos@latest -y --platforms=10`. The package is private and is not published on npm, so `npm i -g @hybridlabor-api/aos-cli` does not work.

---

## Memory and knowledge

Three memories, three jobs: **memB** keeps decisions, **deja** keeps what was done, and **OpenWiki** explains the code.

Installed as optional modules by the installer; `aos doctor` verifies them and the AOS Hub Services tab shows them.

- **memB** (`@hybridlabor-api/memb`): local, offline vector memory with an MCP server (`add_memory`, `search_memory`, `list_memories`, `delete_memory`), a WebUI on port 8088, and an ambient hook that injects relevant memories into Claude Code sessions. Skills: `memb-skill`, `memb-ingest`, `bdb-memb-mcp`.
- **deja** (`@vshulcz/deja-vu`, installed with memB): indexes your agent transcripts locally with secrets redacted; `deja fix` on an error, `deja wip` when resuming, `deja search` for past sessions. Skill: `deja-memory`.
- **OpenWiki** (`openwiki` CLI): generates and refreshes a grounded wiki of a codebase, with a visualizer on port 4321 and a background daemon. Skill: `openwiki-skill`; this repo's own wiki is under [`.openwiki/`](.openwiki/quickstart.md).
- **Synapse** (`@hybridlabor-api/bdb-synapse`): renders a repository as a 3D code city and replays agent sessions through it. Skill: `synapse-integration-skill`.

`aos-setup` brings a machine to a verified state for all four; `aos-project-init` binds one project to them (slug, wiki, memory, `AGENTS.md`).

---

## What's included

### The subagents (46)

**Roster.** <!-- count:agents -->46<!-- /count --> agents are compiled into the native agent format of Claude Code, Antigravity, Codex and OpenCode; Cursor, Windsurf, Roo and Aider get none and use the rules in `AGENTS.md` instead. Sources are in [`agents/`](agents/). AOS pins no model: agents inherit the session model unless `.aos/pipeline.json` overrides a role per harness ([docs/agent-models.md](docs/agent-models.md)).

| Group | Agents |
|---|---|
| Pipeline nodes (7) | `architect`, `techlead`, `godmode-ui-ux`, `godmode-engineering`, `godmode-media-eventtech`, `reviewer`, `godmode-shipping` |
| Review and safety (7) | `security-reviewer`, `silent-failure-hunter`, `database-reviewer`, `reviewer-1`, `reviewer-2`, `devils-advocate`, `advisor` |
| Language reviewers (8) | `typescript-reviewer`, `python-reviewer`, `go-reviewer`, `rust-reviewer`, `java-reviewer`, `kotlin-reviewer`, `cpp-reviewer`, `csharp-reviewer` — read-only, compiled with edit and bash denied |
| Build helpers (3) | `go-build-resolver`, `opensource-forker`, `opensource-sanitizer` |
| Domain assistants (5) | `spec-prd-creator`, `pcb-design-assistant`, `event-manager-assistant`, `live-media-operator`, `video-motion-assistant` |

**What the seven pipeline nodes do.** Architect turns the goal into a system plan after reading the existing architecture. TechLead turns the plan into a capability map (module boundaries, dependency direction, build order) before any build node starts, and rejects back to Architect if it does not hold. `godmode-ui-ux` leads the frontend, `godmode-engineering` the backend, `godmode-media-eventtech` the creative and show-control work. Reviewer is an adversarial correctness review of build-node output against the plan's contract; Shipping runs the mechanical gate (lint, typecheck, tests, a11y, seo) and enforces the GO gate. The auxiliary 22 are not nodes of the graph. Subagents never inherit a GO and never invoke each other.

### Skills by category

**Categories.** <!-- count:skills -->262<!-- /count --> shipped skills, discoverable by every harness (the full generated catalog is in the next section). Eight categories, enforced by `npm run validate`:

- **bdb-core**: Core AOS infrastructure, pipelines, tools, and utilities: `fabric`, `fabric-graph`, `fabric-multigraph`, `fabric-teamwork`, `fabric-swarm`, `fabric-loop`, `agenttrail`, `plan-canvas`, `aos-a2a`, `aos-gateway`, `aos-store`, `master-session`, `codebase-memory`, and more.
- **design-ui-ux**: Frontend, UI design, accessibility, tokens, motion, anti-slop: `senior-frontend`, `ui-ux-pro-max`, `tailwind-patterns`, `shadcn`, `wcag-audit-patterns`, and more.
- **engineering-method**: Architecture, testing, debugging, CI/CD, code quality: `software-architecture`, `test-driven-development`, `systematic-debugging`, `ci-pipeline`, `github-actions-generator`, `docker-expert`, `makefile-pro`, and more.
- **library**: Language and framework specifics: TypeScript, Node.js, Python, React, Postgres, Prisma, Next.js, Drizzle ORM, Go, Rust, Tauri, and more.
- **media-eventtech**: 3D, video, show control, spatial design: `godmode-eventtech`, `threejs-skills`, the creative-software MCP skills, and more.
- **engineering-hardware**: PCB and electrical design: `godmode-hardware-pcb`.
- **saas-ops**: Running a SaaS end to end: `golive`, `pb-deploy-saas`, `pb-health-weekly`.
- **business-ops**: The commercial office side: `pb-offer`, `pb-invoice-check`.

### Browse everything

**Generated catalog.** Built from the repo files (frontmatter of every `SKILL.md`, `agents/`, `commands/`). Open a section to see names and one-line descriptions.

<!-- BEGIN GENERATED CATALOG: regenerate from the repo, do not hand-edit -->

<details>
<summary><b>Harnesses (9)</b></summary>

| Harness | Skills | Subagents | Hooks and gates | MCP | Extras |
|---|:---:|:---:|:---:|:---:|---|
| Claude Code / Desktop | yes | yes | yes (GO gate, graph gate, env-file protection, Conventional Commits, memB inject, trail relay, A2A inbox) | yes | slash commands, fleet band, plugin manifest |
| Google Antigravity (agy) | yes | yes | gate-only hooks | yes | `/bdb-aos:<cmd>` commands, inbox MCP for A2A |
| Codex CLI | yes | yes | GO gate, graph gate | yes | `$bdb-aos:<cmd>` commands, A2A queue/resume |
| OpenCode | yes | yes | via `bdb-aos.js` plugin | yes | `/bdb-aos-<cmd>` commands, A2A inject |
| Cursor | yes | no | no | yes | `.cursor/rules` |
| Windsurf | yes | no | no | yes | `mcp.json` |
| Roo Code / Cline | yes | no | no | yes | `.roomodes` |
| Aider | yes | no | no | no | none |
| AOS CLI (pi) | yes | system prompt | no | no | 10 core skills, dark theme |

</details>

<details>
<summary><b>Tools and CLIs (15)</b></summary>

| Command | What it does |
|---|---|
| `aos` | Installer menu: update, doctor, reconfigure, uninstall. |
| `aos doctor` | Verify dependencies, skill placement, daemons, hooks, modules, gateway. |
| `aos store` | Browse and install skills and agents (CLI and web UI on port 4322). |
| `aos-plan-canvas` | Open plans and HTML artifacts in the annotation canvas (port 4519). |
| `aos-trail` | agenttrail live map (port 5330). |
| `aos-archify` | Architecture and sequence diagrams as standalone HTML. |
| `aos-hub` | The AOS Hub on port 7900: Services, Catalog, Store, Plans, Router. `aos-dashboard` is a thin alias. |
| `aos-services` (via `aos services`) | Status, start, stop and restart for every local service. |
| `aos-a2a` | List, send to and reply to live harness peers. |
| `aos-acp` | Start workers whose guarded commands need a GO token; `--sandbox coop\|wsl2` wraps one launch. |
| `aos-gateway` | Local MCP gateway: serve, enable, direct, adopt, status. |
| `aos-gogate` | Read-only gate status and presets. |
| `aos-gate` | Read or change the machine-wide gate profile. |
| `aos-sessions` | Read-only overview of every live session and ACP worker. |
| `aos-config` | Machine-level AOS configuration. |

</details>

<details>
<summary><b>MCP servers (21)</b></summary>

| Server | Domain |
|---|---|
| `github`, `chrome-devtools` | Issues, PRs, workflows; browser automation and debugging |
| `bdb_unreal_mcp` | Unreal Engine (Web Remote Control, port 30010) |
| `bdb_rhino_mcp`, `bdb_rhino_mcp_fallback` | Rhino 3D and Grasshopper |
| `bdb_davinci_mcp` | DaVinci Resolve |
| `bdb_grandma3_mcp` | grandMA3 (typed `ma3_*` tools) |
| `bdb_resolume_mcp` | Resolume Arena (REST, port 8080) |
| `adobe_uxp_mcp` | Adobe UXP bridge |
| `bdb_blender_mcp` | Blender |
| `bdb_after_effects_mcp`, `bdb_after_effects_mcp_fallback` | After Effects |
| `bdb_td_minddesigner`, `bdb_td_backup` | TouchDesigner (port 9980) |
| `zavora_computer_use`, `bdb_windows_computer_use` | Desktop control on macOS and Linux, and on Windows |
| `memb_mcp`, `deja` | Local memory and transcript search |
| `mcsc` | Delegation to other harnesses |
| `open_design_mcp` | Open Design |
| `bdb_remoteos_mcp` | RemoteOS multi-cloud gateway with 4-eyes approval |

</details>

<details>
<summary><b>Skills (226)</b></summary>

<details>
<summary><b>library (85)</b></summary>

| Skill | What it does |
|---|---|
| `ai-agent-development` | AI agent development workflow for building autonomous agents, multi-agent systems, and agent orchestration with CrewAI, LangGraph, and custom agents. |
| `ai-product` | Every product will be AI-powered. |
| `api-design-principles` | Master REST and GraphQL API design principles to build intuitive, scalable, and maintainable APIs that delight developers and stand the test of time. |
| `api-patterns` | API design principles and decision-making. |
| `apify-lead-generation` | Scrape leads from multiple platforms using Apify Actors. |
| `apify-ultimate-scraper` | AI-driven data extraction from 55+ Actors across all major platforms. |
| `bash-linux` | Bash/Linux terminal patterns. |
| `brainstorming` | Use before creative or constructive work (features, architecture, behavior). |
| `browser-automation` | Browser automation powers web testing, scraping, and AI agent interactions. |
| `cloudflare-workers-expert` | Expert in Cloudflare Workers and the Edge Computing ecosystem. |
| `copywriting` | Write rigorous, conversion-focused marketing copy for landing pages and emails. |
| `crewai` | Expert in CrewAI, the leading role-based multi-agent framework. |
| `database-design` | Database design principles and decision-making. |
| `debugger` | Debugging specialist for errors, test failures, and unexpected behavior. |
| `deep-research` | Run autonomous research tasks that plan, search, read, and synthesize information into comprehensive reports. |
| `docker-expert` | Advanced Docker containerization: optimization, security hardening, multi-stage builds, orchestration. |
| `documentation` | Documentation generation workflow covering API docs, architecture docs, README files, code comments, and technical writing. |
| `drizzle-orm-expert` | Expert in Drizzle ORM for TypeScript: schema design, relational queries, migrations, and serverless database integration. |
| `firecrawl` | Search, scrape, and interact with the web via the Firecrawl CLI. |
| `firecrawl-sdk` | Integrate Firecrawl into product code: SDK setup and FIRECRAWL_API_KEY onboarding, /scrape, /search and /interact endpoints. |
| `gemini-api-dev` | The Gemini API provides access to Google's most advanced AI models. |
| `gemini-api-integration` | Use when integrating Google Gemini API into projects. |
| `geo-fundamentals` | Generative Engine Optimization for AI search engines (ChatGPT, Claude, Perplexity). |
| `git-advanced-workflows` | Master advanced Git techniques to maintain clean history, collaborate effectively, and recover from any situation. |
| `git-pr-review` | Generate a concise and structured PR description from commit history with minimal token usage. |
| `github` | Use the `gh` CLI for issues, pull requests, Actions runs, and GitHub API queries. |
| `github-actions-templates` | Production-ready GitHub Actions workflow patterns for testing, building, and deploying applications. |
| `github-workflow-automation` | Patterns for automating GitHub workflows with AI assistance. |
| `go-concurrency-patterns` | Master Go concurrency with goroutines, channels, sync primitives, and context. |
| `go-playwright` | Robust browser automation using Playwright Go. |
| `golang-pro` | Master Go 1.21+ with modern patterns, advanced concurrency, performance optimization, and production-ready microservices. |
| `landing-page-generator` | Generates high-converting Next.js/React landing pages with Tailwind CSS. |
| `linear-claude-skill` | Manage Linear issues, projects, and teams. |
| `llm-app-patterns` | Production-ready patterns for building LLM applications. |
| `llm-application-dev-ai-assistant` | Creating intelligent conversational interfaces, chatbots, and AI-powered applications. |
| `llm-prompt-optimizer` | Use when improving prompts for any LLM. |
| `llm-structured-output` | Get reliable JSON, enums, and typed objects from LLMs using response_format, tool_use, and schema-constrained decoding. |
| `local-llm-expert` | Master local LLM inference, model selection, VRAM optimization, and local deployment using Ollama, llama.cpp, vLLM, and LM Studio. |
| `microservices-patterns` | Microservices architecture patterns: service boundaries, inter-service communication, data management, resilience. |
| `modern-javascript-patterns` | Modern JavaScript (ES6+) features, functional programming patterns, and best practices. |
| `monorepo-management` | Build efficient, scalable monorepos that enable code sharing, consistent tooling, and atomic changes. |
| `n8n-code-javascript` | Write JavaScript code in n8n Code nodes. |
| `n8n-code-python` | Write Python code in n8n Code nodes. |
| `n8n-expression-syntax` | Validate n8n expression syntax and fix common errors. |
| `n8n-mcp-tools-expert` | Expert guide for using n8n-mcp MCP tools effectively. |
| `n8n-workflow-patterns` | Proven architectural patterns for building n8n workflows. |
| `neon-postgres` | Expert patterns for Neon serverless Postgres, branching, connection pooling, and Prisma/Drizzle integration. |
| `nextjs-app-router-patterns` | Next.js 14+ App Router architecture, Server Components, and modern full-stack React development. |
| `nextjs-best-practices` | Next.js App Router principles. |
| `obsidian-markdown` | Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, and properties. |
| `openapi-spec-generation` | Generate and maintain OpenAPI 3.1 specifications from code, design-first specs, and validation patterns. |
| `os-scripting` | Operating system and shell scripting troubleshooting workflow for Linux, macOS, and Windows. |
| `playwright-skill` | General-purpose browser automation skill. |
| `posix-shell-pro` | Expert in strict POSIX sh scripting for maximum portability across Unix-like systems. |
| `postgres-best-practices` | Postgres performance optimization and best practices from Supabase. |
| `postgresql` | Design a PostgreSQL-specific schema. |
| `prisma-expert` | Prisma ORM: schema design, migrations, query optimization, relations modeling, and database operations. |
| `product-manager-toolkit` | Essential tools and frameworks for modern product management, from discovery to delivery. |
| `programmatic-seo` | Design and evaluate programmatic SEO strategies for creating SEO-driven pages at scale. |
| `python-patterns` | Python development principles and decision-making. |
| `python-performance-optimization` | Profile and optimize Python code using cProfile, memory profilers, and performance best practices. |
| `python-pro` | Master Python 3.12+ with modern features, async programming, performance optimization, and production-ready practices. |
| `rag-engineer` | Expert in building Retrieval-Augmented Generation systems. |
| `rag-implementation` | RAG implementation workflow: embedding selection, vector database setup, chunking strategies, retrieval optimization. |
| `react-best-practices` | Performance optimization guide for React and Next.js applications, maintained by Vercel. |
| `react-component-performance` | Diagnose slow React components and suggest targeted performance fixes. |
| `react-patterns` | Modern React patterns and principles. |
| `readme` | Technical writer for comprehensive project documentation. |
| `remotion` | Generate walkthrough videos from Stitch projects using Remotion with transitions, zooming, and text overlays. |
| `schema-markup` | Design, validate, and optimize schema.org structured data for eligibility, correctness, and measurable SEO impact. |
| `seo` | Run a broad SEO audit across technical SEO, on-page SEO, schema, sitemaps, content quality, AI search readiness, and GEO. |
| `seo-audit` | Diagnose and audit SEO issues affecting crawlability, indexation, rankings, and organic performance. |
| `seo-technical` | Audit technical SEO across crawlability, indexability, security, URLs, mobile, Core Web Vitals, and structured data. |
| `tanstack-query-expert` | Expert in TanStack Query (React Query), asynchronous state management. |
| `tmux` | Expert tmux session, window, and pane management for terminal multiplexing and persistent remote workflows. |
| `turborepo-caching` | Configure Turborepo for efficient monorepo builds with local and remote caching. |
| `typescript-pro` | Master TypeScript with advanced types, generics, and strict type safety. |
| `using-neon` | Neon serverless Postgres: autoscaling, branching, instant restore, scale-to-zero. |
| `vector-database-engineer` | Expert in vector databases, embedding strategies, and semantic search implementation. |
| `vercel-ai-sdk-expert` | Expert in the Vercel AI SDK. |
| `vercel-deployment` | Expert knowledge for deploying to Vercel with Next.js. |
| `web-artifacts-builder` | Build powerful frontend claude.ai artifacts. |
| `web-performance-optimization` | Optimize loading speed, Core Web Vitals, bundle size, caching strategies, and runtime performance. |
| `web-scraper` | Multi-strategy intelligent web scraping. |
| `zustand-store-ts` | Create Zustand stores following established patterns with proper TypeScript types and middleware. |

</details>

<details>
<summary><b>engineering-method (55)</b></summary>

| Skill | What it does |
|---|---|
| `agent-tool-builder` | Tools are how AI agents interact with the world: schema to error handling. |
| `agentic-harness-patterns` | Harness patterns for coding agents: memory, permissions, context engineering, delegation, skills, hooks, bootstrap. |
| `archify` | Validated architecture, workflow, sequence, data-flow, and state diagrams as explorable standalone HTML with inline SVG. |
| `architect-review` | Master software architect specializing in modern architecture. |
| `bdb-computer-use-mcp` | Native Rust/Node and Python computer-use servers to control macOS, Windows, and Linux desktops. |
| `bdb-security-audit` | Security auditing, diff analysis, defensive checklists, and vulnerability testing. |
| `bdb-shipping-skill` | Problem-framing pre-flight, one-way/two-way door classification, ADR-lite decision logging, post-ship outcome loop. |
| `ci-pipeline` | Set up a complete CI/CD pipeline for a project. |
| `clean-code` | The principles of "Clean Code". |
| `concise-planning` | Generate a clear, actionable, atomic checklist for a coding task. |
| `diagnosing-bugs` | Diagnosis loop for hard bugs and performance regressions. |
| `dispatching-parallel-agents` | Use when facing 2+ independent tasks that can be worked on without shared state. |
| `domain-modeling` | Build and sharpen a project's domain model. |
| `executing-plans` | Execute a written implementation plan in a separate session with review checkpoints. |
| `factory` | Configure an autonomous software delivery factory. |
| `factory-babysit-pr` | Monitor one explicitly authorized pull request. |
| `factory-collect` | Experimental workflow for collecting and triaging product feedback, telemetry, runtime errors, and issue reports. |
| `factory-lookback` | Experimental workflow for auditing recurring feedback, telemetry, and errors to find systemic fixes. |
| `factory-recover` | Find interrupted coding runs and report resume candidates. |
| `factory-review-prs` | Experimental workflow for reviewing configured repositories' pull requests. |
| `factory-ship` | Experimental workflow for publishing and completing configured software delivery work. |
| `factory-watchdog` | Monitor explicitly authorized delivery tasks and report stalled work. |
| `finishing-a-development-branch` | Decide how to integrate finished work once implementation is complete and tests pass. |
| `github-actions-generator` | Create, generate, or scaffold GitHub Actions workflows and CI/CD pipelines. |
| `github-actions-validator` | Validate, lint, audit, fix GitHub Actions workflows. |
| `github-repo` | Standards and workflows for writing, sanitizing, and publishing high-quality GitHub repositories. |
| `godmode-engineering` | Senior Fullstack and Backend Engineer. |
| `godmode-shipping` | Release Gatekeeper, QA and Verification Auditor. |
| `grill-me` | A relentless interview to sharpen a plan or design. |
| `grill-with-docs` | Like grill-me, and builds the project's domain model (glossary and ADRs) as it goes. |
| `grilling` | Grill the user relentlessly about a plan, decision, or idea. |
| `makefile-pro` | Generate, scaffold, validate and lint Makefiles and .mk files: .PHONY targets, build automation, common mistakes. |
| `planning-with-files` | Use persistent markdown files as working memory on disk. |
| `pr-recap` | Visual recap page for a PR or git range: changed-files tree, per-file notes, Verified vs Not verified table, risks. |
| `prompt-engineer` | Transforms prompts into optimized prompts using frameworks (RTF, RISEN, Chain of Thought, and more). |
| `prompt-engineering-patterns` | Advanced prompt engineering techniques to maximize LLM performance, reliability, and controllability. |
| `prototype` | Build a throwaway prototype to answer a design question. |
| `read-the-damn-docs` | Read the docs before implementing, integrating, upgrading, or debugging anything third-party. |
| `requesting-code-review` | Verify work meets requirements after completing tasks or before merging. |
| `reverse-engineer-anything` | Reverse engineer native, managed, Electron/JS, packaged, firmware, and browser targets with REA. |
| `simplify-code` | Review a diff for clarity and safe simplifications, then optionally apply low-risk fixes. |
| `software-architecture` | Guide for quality-focused software architecture. |
| `subagent-driven-development` | Execute implementation plans with independent tasks in the current session. |
| `systematic-debugging` | Use on any bug, test failure, or unexpected behavior, before proposing fixes. |
| `tdd` | Test-driven development. |
| `test-driven-development` | Use when implementing any feature or bugfix, before writing implementation code. |
| `to-spec` | Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed. |
| `triage` | Move issues and external PRs through a state machine of triage roles and write agent-ready briefs. |
| `two-axis-code-review` | Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding sta... |
| `using-git-worktrees` | Ensure an isolated workspace for feature work and plan execution. |
| `verification-before-completion` | Run verification commands and confirm output before claiming work is complete or passing. |
| `wayfinder` | Plan a huge chunk of work (more than one agent session can hold) as a shared map of decision tickets on your issue tracker, and resolve them one at a time un... |
| `wcag-audit-patterns` | Audit web content against WCAG 2.2 with actionable remediation strategies. |
| `webapp-testing` | Test local web applications with native Python Playwright scripts. |
| `writing-plans` | Write a plan for a multi-step task from a spec, before touching code. |

</details>

<details>
<summary><b>bdb-core (51)</b></summary>

| Skill | What it does |
|---|---|
| `advisor` | Read-only second opinion at the three advisor call points: verdict and at most 10 findings, never writes. |
| `agent-manager-skill` | Manage multiple local CLI agents via tmux sessions with cron-friendly scheduling. |
| `agent-memory-mcp` | Hybrid memory system: persistent, searchable knowledge management for AI agents. |
| `agent-pipeline` | Reference for the seven-node dispatcher graph that /fabric-graph runs. |
| `agenttrail` | Live map of a multi-agent build in the browser: which plan component, which agent or harness, what is done, what is stuck. |
| `ao-orchestrator` | Multi-project orchestrator across repositories using the Agent Orchestrator (AO) daemon. |
| `aos-a2a` | List, send to and reply to live harness peers (Claude Code, OpenCode, Codex, agy) over A2A on localhost. |
| `aos-gateway` | Use the local MCP gateway and the per-app MCP picks. |
| `aos-project-init` | Interview a project folder into AOS: slug and domain, OpenWiki, memB, Synapse map, AGENTS.md. |
| `aos-setup` | Bring a machine to a complete, verified AOS installation. |
| `aos-store` | Browse, preview, and install AOS Core, ECC and Scenario skills and agents from a local web UI. |
| `aos-update` | Update the installed AOS: check for a new version, preview, run the update and verify. |
| `ask-tim` | Ask which skill or flow fits your situation. |
| `bdb-aos` | Entry point for the BDB Agent OS suite installed as a Claude Code plugin. |
| `bdb-deploy` | Build and deploy a project to a real server via rsync over SSH. |
| `bdb-memb-mcp` | Model Context Protocol interface to the memB persistent agent memory layer. |
| `bdb-updater` | Alias of `aos-update`. |
| `bdbhtmlmanueldocs` | Design system, standalone HTML template and GitHub Pages hosting workflow for neutral developer documentation. |
| `bdbrainstorm` | Multi-agent brainstorming, /grill-me and the Core Godmodes, ending in a hand-off to /fabric-graph. |
| `bdbresilience` | CI/CD error recovery, file-based locking, diagnostic triage, and two-phase GO gate resilience for multi-agent pipelines. |
| `clear-context` | Survive a /clear or context limit: save a verified handoff, then restore state, verify and continue. |
| `codebase-memory` | Code research over an indexed codebase with minimal context: graph queries, call chains, architecture overview, dead code. |
| `deja-memory` | Use `deja fix` on an error, `deja wip` when resuming, `deja search` for past sessions. |
| `design-control-loop` | Interview the user to design an agentic control loop tailored to their codebase, then build it. |
| `fabric` | Master entry for the fabric family: picks the fitting mode for the task and says why. |
| `fabric-graph` | The autonomous multi-agent build pipeline with durable state, repair loop and escalation. |
| `fabric-loop` | Repeat-until-done mode with an exit check and round limits. |
| `fabric-multigraph` | A small, throwaway multi-agent fan-out in any project. |
| `fabric-swarm` | N similar workers take items from one shared pool (`swarm.json`). |
| `fabric-teamwork` | Interactive 9-step prompt crafting and delegation protocol for autonomous multi-agent teams. |
| `factory-human-digest` | Experimental workflow for summarizing work that still needs human judgment. |
| `find-skill` | Find which AOS skill in the library fits a task, by searching it. |
| `gogate` | Show or explain the AOS go-gate mode (hard, soft, off) and the time-limited grants of this session. |
| `instinct-export` | Use when the user wants to share or back up learned instincts — validates the local instincts file, allowlists the six known fields, strips secrets and home-... |
| `instinct-import` | Use when the user brings an exported instincts JSON to merge into the local store — treats trigger and action as inert data, validates every entry against th... |
| `instinct-status` | Use when the user wants to see what learned instincts exist, their confidence scores and how current they are — reads the local instincts file under ~/.aos/i... |
| `loop-templates` | Repeat a task on a schedule or until a condition holds (CI until green, follow a PR to merge). |
| `master-session` | One Claude Code session supervises several others: roster, status requests, GO board, idle notices, GO-token protocol. |
| `mcsc` | Delegate a task to another installed CLI harness (agy, OpenCode, Codex) from inside an AOS repo. |
| `memb-ingest` | Deep scan and ingest project files and past conversation logs into the local memB vector memory engine. |
| `memb-skill` | BDB local-first long-term memory engine (memB). |
| `openwiki-skill` | Initialize, update, and visualize codebase or personal knowledge wikis using OpenWiki. |
| `orchestrator-chain` | Hand work down the chain master session, project orchestrator, package orchestrator. |
| `plan-arbiter` | Compare, cross-review, merge, or arbitrate competing plans from multiple agents. |
| `plan-canvas` | Open plans and HTML artifacts in a local browser canvas where the human annotates, chats, and approves. |
| `quick-recap` | End each agent response with a red/yellow/green status line. |
| `skill-create` | Use when the user wants to capture a real repo's working patterns as a reusable skill — analyzes the local git log and diffs the agent runs itself and drafts... |
| `stay-within-limits` | Respect 5-hour and weekly usage limits by checking usage between waves and pausing near the cap. |
| `subagent-setup` | Configure and synchronize multi-harness subagents with optional per-harness model overrides. |
| `synapse-integration-skill` | BDB Synapse (3D Codebase Visualizer) integration. |
| `token-saver-config` | Context window output compression engine for CLI commands. |

</details>

<details>
<summary><b>media-eventtech (19)</b></summary>

| Skill | What it does |
|---|---|
| `bdb-adobe-suite-mcp` | Automate Photoshop, Illustrator, Premiere Pro, and After Effects via ExtendScript and UXP bridges. |
| `bdb-after-effects-mcp` | Compositions, layers, masks, keyframe animations, and ExtendScript in After Effects. |
| `bdb-blender-mcp` | Build 3D assets, apply materials, inspect scenes, and script bpy in Blender. |
| `bdb-davinci-mcp` | DaVinci Resolve timeline editing, media analysis, color grading, Fusion and Fairlight scripting. |
| `bdb-eventagency-skill` | Event agency operations: client intake, scoping, vendors, crew, production planning, pre-show logistics, wrap. |
| `bdb-grandma3-mcp` | Patch fixtures, execute console commands, and trigger macros on grandMA3. |
| `bdb-resolume-mcp` | Trigger clips, clear layers, adjust speeds, and query composition status in Resolume Arena. |
| `bdb-rhino-mcp` | Create and manipulate 3D models and run Grasshopper graphs in Rhino. |
| `bdb-touchdesigner-mcp` | TOP/CHOP chains, operator scripting, parameter inspection, and node-network debugging in TouchDesigner. |
| `bdb-unreal-mcp` | Control UE5 through a native C++ Automation Bridge plugin. |
| `bdb-vectorworks-mcp` | Search and retrieve Vectorworks Python and VectorScript API documentation. |
| `bdbmediastorm` | Brainstorm live event technology, show control, and real-time media systems. |
| `brag` | Turn the current project website into a short, shareable launch video. |
| `godmode-3d-creation` | 3D meshes, text-to-CAD, and scene reconstruction via TRELLIS, TripoSR, or Text-to-CAD engines. |
| `godmode-eventtech` | Real-time performance and multimedia operator work: signal flows, OSC/DMX, MCP orchestration, hardware limits. |
| `godmode-media-creation` | Assemble video timelines, sync beats, and create media via OpenMontage, Palmier Pro, or TouchDesigner. |
| `mcp-manage` | Check capabilities and guide use of specialized MCP servers like Unreal, Rhino, DaVinci, or TouchDesigner. |
| `spline-3d-integration` | Interactive 3D scenes from Spline.design in web projects. |
| `threejs-skills` | Create 3D scenes, interactive experiences, and visual effects using Three.js. |

</details>

<details>
<summary><b>design-ui-ux (14)</b></summary>

| Skill | What it does |
|---|---|
| `bdb-ui-library` | Component and motion-icon lookup for UI work. |
| `bdb-visual-edit` | Edit source from an element the human points at in a running local dev app. |
| `bdbdesignpro` | Animation engine choice, motion tokens, scroll effects, micro-interactions, motion accessibility. |
| `creative-direction` | Use before UI/UX, motion, visual identity or campaign work to find the insight and the idea, then hand one brief to godmode-ui-ux, prototype or bdbdesignpro. |
| `design-spells` | Curated micro-interactions, delightful animations, and subtle design details. |
| `editable-design` | Fixed-canvas editable visual designs: posters, marketing graphics, covers, menus, banners, social cards. |
| `frontend-dev-guidelines` | Senior frontend engineering under strict architectural and performance standards. |
| `godmode-ui-ux` | Lead Frontend Designer and UI Engineer. |
| `live-preview-canvas` | Local HTML mock with a built-in feedback layer for visual comments. |
| `senior-frontend` | React components, Next.js performance, accessibility, frontend code quality. |
| `shadcn` | Add, customize, and troubleshoot shadcn/ui components. |
| `tailwind-patterns` | Tailwind CSS v4, CSS-first configuration, container queries, design token architecture. |
| `ui-ux-pro-max` | Comprehensive design guide for web and mobile applications. |
| `ux-persuasion-engineer` | Behavioral UX: choice architecture, friction audits, commitment design, without coercion. |

</details>

<details>
<summary><b>engineering-hardware (1)</b></summary>

| Skill | What it does |
|---|---|
| `godmode-hardware-pcb` | Electrical schematics, PCB layouts, KiCad projects, OpenSCAD enclosures: DFM/DRC/ERC sign-off and co-design. |

</details>

<details>
<summary><b>saas-ops (1)</b></summary>

| Skill | What it does |
|---|---|
| `golive` | Take an agent-written app from repo to live production on the user's OWN accounts, with providers they choose (hosting, database, auth, payments, email, doma... |

</details>

</details>

<details>
<summary><b>Playbooks (38)</b></summary>

| Playbook | What it does |
|---|---|
| `pb-aos-e2e` | AOS release E2E check in a clean sandbox: tarball install, doctor, gate hooks, memB inject, hub, update, uninstall. |
| `pb-bug-fix` | Turn a GitHub issue into a tested fix on a branch with an open PR. |
| `pb-ci-fix` | Fix red CI or set up GitHub Actions end to end; push only after GO. |
| `pb-clip-from-moodboard` | Turn a look brief and reference images into a finished social clip. |
| `pb-code-video` | The main entry point for video creation: generates a video brief, creates a shot plan, routes to the right render engine (Remotion, Hyperframes, ffmpeg, laun... |
| `pb-content-studio` | Idea to published-ready content (30 s / 40 s video, text overlay, AI generated shots): brief, script and render via the Creator Extension content-studio skil... |
| `pb-crew-call-sheet` | Build a crew call sheet and a load-in / load-out plan for one show day. |
| `pb-deploy-saas` | Deploy a SaaS app to the BDB fleet: preflight, guardrail plan, green CI, deploy after GO, health check. |
| `pb-docs-site` | Publish a project's docs as a static HTML manual on GitHub Pages. |
| `pb-event-tracker` | One spreadsheet for an event: guests, vendors, timeline, budget. |
| `pb-focus-chunks` | Split one big task into chunks of at most 25 minutes, each with a done-check. |
| `pb-handover` | Write a handover note for a colleague from the state of a project folder. |
| `pb-harness-work` | Change the agent harness itself (hooks, gates, memory, permissions, plugins) the safe way. |
| `pb-health-weekly` | Weekly health report over the BDB repos: version drift and CI status. |
| `pb-idea-to-launch` | Turn an idea into a deployed prototype. |
| `pb-image-to-3d` | Turn one reference image into a cleaned, scaled 3D asset. |
| `pb-inbox-zero` | Sort an email backlog into reply, delegate, archive and ignore, and draft the replies. |
| `pb-invoice-check` | Check invoices and receipts line by line against your offers. |
| `pb-landing-page` | Build and launch a landing page: confirmed copy, brand tokens, UI and SEO review, deploy after GO. |
| `pb-launch-video` | Turn a live app or landing page into a short launch video. |
| `pb-machine-setup` | Bring a new machine to a verified AOS installation. |
| `pb-master` | One control session over several Claude Code, Codex or OpenCode sessions: roster, status board, GO board. |
| `pb-meeting-actions` | Turn a meeting transcript into notes, decisions and owners; send the follow-up only after GO. |
| `pb-newsletter` | Turn a recap or changelog range into a newsletter draft where every claim cites a source line. |
| `pb-offer` | Draft a client offer with line items priced only from your price list. |
| `pb-open-source` | Prepare a project for open sourcing: sanitized fork, sanitizer verdict, README and LICENSE, new private repo. |
| `pb-pcb-to-case` | From a KiCad board to a parametric enclosure that fits it. |
| `pb-project-new` | Start a new private GitHub project the AOS way. |
| `pb-redesign-app` | Overhaul one app's UI against an audit. |
| `pb-release-aos` | Release a new AOS version to npm through the release-please PR, merged only after GO. |
| `pb-security-sweep` | Security sweep over one repo: secrets, dependencies, diff, one ranked findings report. |
| `pb-ship` | Ship the day's work in one repo: triage, review every open PR, merge. |
| `pb-show-build` | Build a show across lights (grandMA3), media (Resolume) and visuals (TouchDesigner) from one cue list. |
| `pb-social-pack` | Turn a release recap into a social pack where every claim traces to a facts file. |
| `pb-tauri-e2e` | Multi-phase E2E, live-app, and binary security audit for Tauri v2 desktop apps. |
| `pb-todo` | Turn one sentence into a task line in the right to-do list. |
| `pb-week-plan` | Turn scattered to-do lists and notes into one prioritised plan for the week. |
| `pb-worktrees-land` | Clean up git worktrees across your repos; removes only merged ones. |

</details>

<details>
<summary><b>Subagents (46)</b></summary>

| Agent | What it does |
|---|---|
| `advisor` | Read-only second opinion at the three advisor call points: verdict and at most 10 findings, never writes. |
| `architect` | Turns the user's goal into a system plan. |
| `code-reviewer` | Independent read-only general code reviewer: code health, architecture boundaries, edge cases, error handling, and maintainability. |
| `comment-analyzer` | Independent read-only code comment analyzer: documentation drift, comment accuracy, security disclosures, and comment hygiene. |
| `cpp-reviewer` | Independent read-only C++ code reviewer: memory safety, modern C++ idioms, concurrency, and performance for `.cpp`/`.hpp`/`.cc`/`.h` changes. |
| `csharp-reviewer` | Independent read-only C#/.NET code reviewer: .NET conventions, async patterns, security, nullable reference types, EF Core. |
| `database-reviewer` | PostgreSQL specialist for query optimization, schema design, security, and performance. |
| `devils-advocate` | Argues against the plan or diff under review: hunts unstated assumptions, missing failure modes, and the case where the proposed approach is the wrong one. |
| `django-reviewer` | Independent read-only Django code reviewer: ORM query efficiency, security, transactions, view architecture, and migrations. |
| `event-manager-assistant` | Event production planning assistant: run of show, technical riders, crew plans, schedules and budgets, load-in planning, and vendor lists. |
| `fastapi-reviewer` | Independent read-only FastAPI code reviewer: async route correctness, Pydantic schemas, dependency injection, and API design. |
| `flutter-reviewer` | Independent read-only Flutter/Dart code reviewer: widget lifecycle, state management, rebuild performance, and platform patterns. |
| `fsharp-reviewer` | Independent read-only F# code reviewer: functional purity, algebraic data types, async workflows, and .NET interop. |
| `go-build-resolver` | Resolves Go build, vet, and compilation errors with minimal changes. |
| `go-reviewer` | Independent read-only Go code reviewer: idiomatic Go, concurrency, error handling, and performance for `.go` changes. |
| `godmode-engineering` | Senior Fullstack and Backend Engineer. |
| `godmode-media-eventtech` | Creative-Tech and Show-Control Specialist. |
| `godmode-shipping` | Release Gatekeeper, QA and Verification Auditor. |
| `godmode-ui-ux` | Lead Frontend Designer and UI Engineer. |
| `healthcare-reviewer` | Independent read-only healthcare application reviewer: HIPAA compliance, PHI protection, medical data schemas, and audit logging. |
| `java-reviewer` | Independent read-only Java code reviewer for Spring Boot and Quarkus projects: layered architecture, JPA/Panache, security, concurrency, testing. |
| `kotlin-reviewer` | Independent read-only Kotlin/Android/KMP code reviewer: idiomatic Kotlin, coroutine and Flow safety, Compose recomposition traps, clean architecture, Android... |
| `live-media-operator` | Live show operator for grandMA3, media servers such as Resolume, and TouchDesigner networks. |
| `mle-reviewer` | Independent read-only machine learning engineering reviewer: training pipelines, data leakage, inference latency, drift, and numerical stability. |
| `network-config-reviewer` | Independent read-only network configuration reviewer: routing protocols, ACLs, VLANs, firewall policies, and device security. |
| `opensource-forker` | Forks a project for open-sourcing: strips secrets and internal references. |
| `opensource-sanitizer` | Verifies an open-source fork is fully sanitized before release. |
| `pcb-design-assistant` | PCB design assistant for KiCad-centered hardware work: schematic and layout review, DRC/ERC clearance, stackup and impedance constraints, BOM checks, and man... |
| `php-reviewer` | Independent read-only PHP code reviewer: modern PHP 8.x idioms, Laravel/Symfony frameworks, OWASP security, and type safety. |
| `pr-test-analyzer` | Independent read-only pull request test coverage analyzer: assertion strength, mocking integrity, edge cases, and test flakiness. |
| `python-reviewer` | Independent read-only Python code reviewer: Pythonic idioms, PEP 8, type hints, security, and concurrency for `.py` changes. |
| `rag-pipeline-reviewer` | Independent read-only RAG pipeline reviewer: chunking strategy, embeddings, vector indexing, retrieval quality, and prompt injection defense. |
| `react-reviewer` | Independent read-only React code reviewer: hooks correctness, component lifecycle, Next.js architecture, render performance, and accessibility. |
| `reviewer` | Adversarial review of build-node output against the plan's contract. |
| `reviewer-1` | Independent adversarial reviewer, correctness focus: logic errors, broken edge cases, mismatches between the plan's stated contract and the implementation, a... |
| `reviewer-2` | Independent adversarial reviewer, security and operability focus: injection, leaked secrets, auth gaps, silent failures, and rollback/deployment hazards. |
| `rust-reviewer` | Independent read-only Rust code reviewer: ownership, lifetimes, unsafe usage, error handling, and idiomatic patterns for `.rs` changes. |
| `security-reviewer` | Security vulnerability detection and remediation. |
| `silent-failure-hunter` | Reviews code for silent failures, swallowed errors, bad fallbacks. |
| `spec-prd-creator` | Turns a raw idea into a spec/PRD: goals, non-goals, user stories, acceptance criteria, and open questions. |
| `swift-reviewer` | Independent read-only Swift code reviewer: Swift Concurrency, memory safety (ARC), SwiftUI/UIKit architecture, and Apple platform patterns. |
| `techlead` | Reviews the plan for a capability map before any build node starts. |
| `type-design-analyzer` | Independent read-only type design analyzer: encapsulation, domain modeling precision, algebraic data types, and type-system safety. |
| `typescript-reviewer` | Independent read-only TypeScript/JavaScript code reviewer: type safety, async correctness, Node/web security, and idiomatic patterns for `.ts`/`.tsx`/`.js`/`... |
| `video-motion-assistant` | Code-driven video and motion specialist, carved out of godmode-media-eventtech: programmatic video generation and editing, After Effects and Premiere automat... |
| `vue-reviewer` | Independent read-only Vue.js code reviewer: Vue 3 Composition API, reactivity rules, Pinia state, Nuxt architecture, and component performance. |

</details>

<details>
<summary><b>Slash commands (15)</b></summary>

| Command | What it does |
|---|---|
| `/brainstorm` | Brainstorm a topic with the matching skill: bdbrainstorm, bdbmediastorm, grill-me. |
| `/doctor` | Check the machine and project, and print suggested permissions.allow entries without writing settings. |
| `/graph` | Run the fabric-graph pipeline. |
| `/hub` | Open the AOS Hub on 127.0.0.1:7900 (services, plan kits, store) or stop/status it. |
| `/init` | Set up the current project folder for AOS. |
| `/loop` | Run a prompt repeatedly on an interval. |
| `/mastersession` | Supervise other Claude Code sessions: roster, status, GO board, idle notices. |
| `/memb` | Query or store long-term memory with memB. |
| `/orchestrator` | Coordinate parallel coding agents across repositories through the AO daemon. |
| `/plan` | Plan end to end: draft, render in plan-canvas, annotate, await approval, hand off. |
| `/playbooks` | List all pb-* playbooks and start one. |
| `/setup` | Bring this machine to a complete, verified AOS installation. |
| `/shipping` | Pre-ship framing and the technical release gate, with approvals under the go-gate rules. |
| `/startproject` | Start a new composition: project init, brainstorm, then pick a fabric mode. |
| `/store` | Browse and preview AOS skills, agents and playbooks in the local store UI. |

</details>


<!-- END GENERATED CATALOG -->

---

## Skills

<!-- count:skills -->262<!-- /count --> skills, curated from open-source and proprietary collections, covering the full software development and creative pipeline. Every skill is a directory with a `SKILL.md` frontmatter declaring `name`, `description`, and one `category`: `bdb-core`, `design-ui-ux`, `engineering-method`, `engineering-hardware`, `media-eventtech`, `library`, `saas-ops`, `business-ops`.

**Persona layer.** The **Godmode** skills are specialized personas that directly map to the build and ship nodes of the dispatcher graph.

All UI/UX work — the `godmode-ui-ux` persona and the design skills it routes through, such as `bdbdesignpro` — draws components first from the pinned BDB component and motion-icon library (`@bdb` shadcn registry backed by npm `@hybridlabor-api/ui-motion-library`), before falling back to third-party registries or building from scratch.

| Godmode | Owns | Maps to |
|---|---|---|
| `godmode-engineering` | Domain-Driven Design, Clean Architecture, strict TypeScript/Python, systematic debugging, database best practices. | **Engineering** node |
| `godmode-ui-ux` | Anti-slop frontend principles, DTCG design tokens, motion dynamics, accessibility (WCAG), high-agency taste. | **UI_UX** node |
| `godmode-shipping` | Pre-launch checks, automated quality gates, safe rollback procedures, Go-gate enforcement. | **Shipping** node |
| `godmode-eventtech` | Show control, signal flow, DMX lighting, TouchDesigner networks, Resolume media servers, live-event hardware. | **Media_EventTech** node |
| `godmode-3d-creation` | MCP-first 3D generation, mesh reconstruction, parametric CAD, spatial modeling. | Optional specialist |
| `godmode-media-creation` | Video production, timeline assembly, motion design pipelines, OpenMontage, Remotion. | Optional specialist |
| `godmode-hardware-pcb` | Electrical schematics, PCB layout and routing, KiCad ERC/DRC/DFM gate, enclosure co-design, OpenSCAD. | Optional specialist |

**Entry points and navigation.**

- **`ask-tim`**: Skill recommendation by description
- **`bdbrainstorm`** and **`bdbmediastorm`**: Multi-agent ideation sessions ending in an executable plan
- **`fabric-teamwork`**: Prompt crafting, role delegation, collaboration setup
- **Grilling family**: `grill-me` (general audit), `grill-with-docs` (documentation-grounded), `triage` (prioritization)
- **CI/CD and generators**: `ci-pipeline`, `github-actions-generator`, `docker-expert`, `makefile-pro`
- **Code quality**: `bdb-security-audit`, `systematic-debugging`, `silent-failure-hunter`, `bdbresilience`
- **Framework specialists**: Full coverage of TypeScript, React, Next.js, Drizzle ORM, Prisma, Python, Go, and more

**Skills CLI.** The library is also readable by the `skills` CLI:

```bash
npx skills add hybridlabor-api/aos
```

### Playbooks

37 `pb-*` playbooks turn recurring jobs into guided runs with declared GO points. See [Playbooks](#playbooks) for how a run works and the full table by domain.

---

## Optional modules

**Optional by design.** The installer's module picker offers these and Quick Update keeps them current. AOS works standalone without any of them. Pick them non-interactively with `-y --modules=<id>,<id>` or `AOS_MODULES`; the ids are the names below plus `rustauri`, `styleseed` and `codebase-memory`. Anything vendored ships inside the kernel, so those install with no download.

### memB: local vector memory

`@hybridlabor-api/memb`: offline, local vector memory with an MCP server, WebUI on port 8088, and an ambient hook that injects relevant memories into Claude Code sessions. Skill: `memb-skill`, `memb-ingest`, `bdb-memb-mcp`.

memB is not an optional module any more: it is part of the default [unified memory](docs/unified-memory.md) (memB, deja and OpenWiki, plus Codebase Memory MCP when you code), installed with the standard profile and with `-y`. Opt out with `--without=memory` or `--profile=minimal`; without it, no harness gets `memb_mcp`, `deja` or the `memb-inject` hook.

### deja: transcript indexing

`@vshulcz/deja-vu`: indexes your agent transcripts locally (secrets redacted), with `deja fix` on an error, `deja wip` to resume, `deja search` for past sessions. Installed with memB. Skill: `deja-memory`.

### OpenWiki: living documentation

`openwiki` CLI: generates and refreshes a grounded wiki of a codebase, with a visualizer on port 4321 and a background daemon. Skill: `openwiki-skill`. This repo's wiki: [.openwiki/](.openwiki/quickstart.md).

**Synapse:** `@hybridlabor-api/bdb-synapse` renders a repository as a 3D code city and replays agent sessions as light trails. Skill: `synapse-integration-skill`.

**AO (Agent Orchestrator):** `@hybridlabor-api/bdb-agent-orchestrator` orchestrates parallel agents in Git worktrees with live terminal control and CI/CD feedback. Skill: `ao-orchestrator`.

**Creator Extension:** `@hybridlabor-api/bdb-dev-creator-extension` provides ComfyUI MCP (FLUX, SDXL), image-to-3D (TripoSR, TRELLIS), and automated video production (OpenMontage, Remotion). Skill: `bdb-dev-creator-extension`.

**Hardware and PCB:** `@hybridlabor-api/bdb-hardware-pcb` drives KiCad and OpenSCAD design with ERC/DRC gate and parametric enclosure design. Skills: `godmode-hardware-pcb`, `bdb-hardware-pcb`.

### Rust + Tauri (`rustauri`)

Ships inside the kernel under `vendor/rustauri`, nothing to download. Two skills: `tauri-pilot`, which drives and tests a running Tauri v2 app through the CLI or MCP (MIT, adapted from [mpiton/tauri-pilot](https://github.com/mpiton/tauri-pilot)), and `rust-pro`, written for this repo. Enable with `-y --modules=rustauri` or `aos package install rustauri`.

The `tauri-pilot` MCP entry is registered in every harness even when the `tauri-pilot` CLI could not be installed (no cargo, or the build failed). The MCP server then fails at launch until the CLI is present; the install warning names the failed step.

### StyleSeed (`styleseed`)

Ships inside the kernel under `vendor/styleseed`, nothing to download. Eight UI/UX skills in the StyleSeed Toss design language (MIT, from [bitjaru/styleseed](https://github.com/bitjaru/styleseed)): `ui-component`, `ui-page`, `ui-pattern`, `ui-review`, `ui-tokens`, `ux-audit`, `ux-feedback`, `ux-flow`. It is opt-in because the skills assume that design system; the agent personas, playbooks and docs refer to them only as "if the StyleSeed package is installed". Copies from earlier installs are kept, not deleted. Enable with `-y --modules=styleseed`.

### Codebase Memory MCP (`codebase-memory`)

The optional code knowledge graph. A third-party self-contained stdio binary ([DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp), MIT) that indexes a repository into a local SQLite graph under `~/.cache/codebase-memory-mcp/` and answers structural questions ("who calls X", "what routes does service A expose") with far fewer tokens than reading files one by one. No cloud calls, no API keys.

AOS never downloads the binary. If you install it yourself (pinned to `0.11.0` when AOS installs it for you), the MCP entry is registered with the next harness MCP sync; `aos doctor` reports `app missing: codebase-memory-mcp` while it is missing. Asking for it is the "yes, I code here" answer: the installer asks *"Do you use AOS for coding?"* once, stores the answer as `codingMode` in `~/.aos/v5-settings.json`, and `--coding` / `--no-coding` set it without a prompt. Enable with `-y --modules=codebase-memory`; details and the measurement recipe in [docs/codebase-memory.md](docs/codebase-memory.md). Skill: `codebase-memory`.

<details>
<summary><b>How the modules work (diagrams)</b></summary>

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph S["Synapse"]
    direction LR
    A[("Logs")] -->|parse| B("Adapters")
    B --> C("Events")
    C & D[("Repo")] --> E("Go server")
    E --> F("WebGL")
    end
    style S fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph A["AO"]
    direction LR
    H(["IDE"]) --> O("Orchestrator")
    O --> S1("Build") & S2("Refactor")
    S1 & S2 --> C("Monitor")
    C --> F("Feedback")
    end
    style A fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph C["Creator"]
    direction LR
    A("Agent") -->|MCP| R("Router")
    R --> D("3D") & V("Video")
    D --> T["TRELLIS"]
    V --> O["OpenMontage"]
    end
    style C fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

```mermaid
%%{init: {"theme": "base", "themeVariables": {"lineColor": "#6e7681", "edgeLabelBackground": "#f6f1e8", "textColor": "#15171A", "clusterBkg": "#F7F4EC", "clusterBorder": "#B9B5AA", "titleColor": "#15171A", "primaryColor": "#FFFFFF", "primaryBorderColor": "#15171A", "primaryTextColor": "#15171A"}}}%%
flowchart LR
    subgraph P["Hardware/PCB"]
    direction LR
    A("Agent") -->|MCP| K("KiCad") & O("OpenSCAD")
    K --> E("ERC") & L("Layout")
    O --> EN("Enclosure")
    E & L & EN --> F[("Output")]
    end
    style P fill:#F7F4EC,stroke:#B9B5AA,color:#15171A
```

</details>

### Heimdall Token Saver: CLI output compression

`@hybridlabor-api/heimdall-token-saver`: compresses repeated CLI output via ambient hooks on every harness. Reduces token overhead on large projects. Skill: `token-saver-config`.

### Token optimization at a glance

| Lever | How |
|---|---|
| Minimal profile | `--profile=minimal` skips context-injection hooks and optional modules. |
| No context hooks | `--no-hooks` keeps the gates and drops memB, rules and trail injection. |
| Heimdall Token Saver | Compresses repeated CLI output via hooks. |
| No pinned model | Agents inherit the session model; per-role overrides live in `~/.aos/pipeline.json` ([docs/agent-models.md](docs/agent-models.md)). |
| Token-weather | The fleet band shows how full the context is and when to compact. |

---

## Updating

**Update.** Run the same command again. The installer sees the installed version, offers **Quick Update**, and refreshes skills, hooks, templates and modules:

```bash
npx -y @hybridlabor-api/aos@latest
```

**`aos update`.** The installer puts an `aos` launcher in `~/.local/bin` that runs `npx -y @hybridlabor-api/aos@<channel>` (`latest`, or `beta` when you installed a beta), so `aos update`, `aos status` and `aos repair` always run the newest release of your channel. If you once ran `npm i -g @hybridlabor-api/aos`, whichever `aos` comes first on your PATH wins: a global npm copy stays frozen at its version, so update it (`npm i -g @hybridlabor-api/aos@latest`) or remove it. The installer prints the update command itself whenever a newer version exists; the `aos-update` skill (alias `bdb-updater`) wraps the same check for use from inside a session. On a terminal, `aos update` asks once how to handle updates (notify, auto or off) and remembers the answer; it never asks unattended. An older package than the install changes nothing unless you pass `--force`.

**Update notifications & opt-in auto-update.** AOS checks for newer releases during CLI operations and caches registry results for 24 h. Notifications appear in `aos status`, `aos doctor`, the Claude Code session start hint, and the AOS Hub status:
```bash
AOS 5.3.1 is available (you have 5.3.0). Update: npx -y @hybridlabor-api/aos@latest
```
Configure update behavior via `aos` → **Settings** → **Updates** (or the `updates` key in `~/.aos/v5-settings.json`):
- `notify` (default): Checks for updates and displays a notification at most once per 24 hours per surface.
- `auto`: Automatically updates AOS in the foreground when running `aos` or `aos status` if a newer stable release is found and no auto-update was attempted in the last 24 hours. Because updates refresh active hooks and release gate files, auto-update is strictly opt-in. Auto-update never runs inside background daemons or hooks, never runs in CI environments (`CI=1`), requires an interactive terminal (TTY on stdin and stdout), never updates to prereleases, and falls back to notification if an attempt fails.
- `off`: Disables update checks and notifications completely.

You can also set `AOS_NO_UPDATE_CHECK=1` in your environment to disable all update checks and notifications.

---

## Uninstall

```bash
aos-uninstall              # removes what AOS installed; memory, wikis and credentials stay
aos-uninstall --purge      # also removes memory, wikis, credentials and AOS state (asks you to type PURGE)
aos-uninstall --dry-run    # list everything, delete nothing
```

**What `--purge` adds.** `~/.MemBDB` (memB), `~/.openwiki`, `~/.synapse`, `~/.memb`, `~/.ao`, the deja index and privacy config, and AOS state: `~/.aos` hub, logs, status and hook-trust files, `~/.agents/gateway`, and `~/.aos/pipeline.json` only while it is still the shipped default. Antigravity hook and MCP files are removed only when every entry is AOS's own, and they are moved to `~/.aos/backups` first.

**How it works.** The uninstaller works from the install manifest: a file that still matches the hash AOS wrote is removed, a file you edited is backed up instead, a file AOS never wrote is not touched. The same action is in the installer menu. `aos-uninstall --restore-plugin-backup` restores the loose skill copies the installer removed when it registered the plugin; see [docs/plugin-migration.md](docs/plugin-migration.md). Uninstall also moves your saved install options to `~/.aos/v5-settings.json.removed-<timestamp>` instead of deleting them. It stops the background processes AOS started for this user (matched by command line, never by name alone), removes empty folders AOS created, and prints a **Kept** list with everything it leaves in place; backups (`~/.aos/backups`, `~/.agents/backups`, `*.bak`) always stay, even with `--purge`. The global npm package is not removed: run `npm uninstall -g @hybridlabor-api/aos` last.

---

## FAQ

**Do I need all nine harnesses?** No. The installer only writes to harnesses it detects.

**Will it overwrite my MCP config?** No. Existing entries are kept and AOS merges its own. `AOS_DISABLED_MCPS` keeps chosen servers out.

**Can I install with minimal context?** Yes: `--profile=minimal`, or `--no-hooks`. The gate and safety hooks stay either way.

**Does the GO gate work on every harness?** It is a real hook on Claude Code, Antigravity, Codex and the OpenCode plugin. On Cursor, Windsurf, Roo / Cline and Aider only the rule in `AGENTS.md` applies.

**Can an agent approve its own push?** Not through the gate: only your own typed GO counts, not an agent message, a subagent's relay or an A2A message.

**Does AOS work without AO, memB or OpenWiki?** Yes. All of them are optional modules.

**Something is broken.** Run `aos doctor`. It names what is missing and exits 1.

---

## Contributing

- [AGENTS.md](AGENTS.md) is the single source of rules for every harness: the skill contract, category routing, the release gate, Conventional Commits.
- A skill is a directory with `SKILL.md`; the frontmatter needs `name` (equal to the directory), `description` and `category`. `npm run validate` enforces the contract, as CI does on every push.
- `npm test` runs the validator self-test, the plugin-manifest check and the installer, store, doctor and cross-harness hook tests.
- `.claude-plugin/plugin.json` and `marketplace.json` are generated by `npm run plugin:build` and checked by `npm run plugin:check`. They exist today; the Claude Code marketplace install path is still being finalised, so the installer above remains the supported route.
- Releases are cut by release-please from Conventional Commits; do not bump `package.json` by hand. Every release is a patch (5.4.x), `feat:` included; minor or major only via a `Release-As:` footer.
- Skills derived from other projects record `source:` in the frontmatter and an entry in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Found a bug or want a skill added? [Open an issue](https://github.com/hybridlabor-api/aos/issues).

---

## Links

- Package: [npmjs.com/package/@hybridlabor-api/aos](https://www.npmjs.com/package/@hybridlabor-api/aos)
- Source and issues: [github.com/hybridlabor-api/aos](https://github.com/hybridlabor-api/aos) · [issues](https://github.com/hybridlabor-api/aos/issues)
- [CHANGELOG.md](CHANGELOG.md) · [docs/skills_table.md](docs/skills_table.md)
- Engineering notes: [docs/engineering/](docs/engineering/) — [update engine](docs/engineering/update-engine.md) · [Windows support](docs/engineering/windows-support.md) · [router](docs/engineering/router.md) · [release process](docs/engineering/release-process.md) · [v4.15→v5.3 history](docs/engineering/history-4.15-to-5.3.md)
- Sibling repos: [bdb-agent-orchestrator](https://github.com/hybridlabor-api/bdb-agent-orchestrator) · [bdb-synapse](https://github.com/hybridlabor-api/bdb-synapse) · [bdb-dev-creator-extension](https://github.com/hybridlabor-api/bdb-dev-creator-extension) · [bdb-hardware-pcb](https://github.com/hybridlabor-api/bdb-hardware-pcb) · [bdb-os-remote](https://github.com/hybridlabor-api/bdb-os-remote)

License: [Apache-2.0](LICENSE).
