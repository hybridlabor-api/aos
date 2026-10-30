---
name: ask-tim
description: >-
  Route to the right AOS skill or flow for a task. Use when unsure where to start, to find a skill, or when choosing between overlapping skills.
category: bdb-core
---

<!-- The flow map below is derived from mattpocock/skills' ask-matt (MIT, see
     THIRD_PARTY_NOTICES.md). The route is AOS's own: most stations on
     upstream's main flow have no AOS equivalent, so copying it verbatim would
     have produced a router pointing at skills that do not exist. -->

# `ask-tim`: which way do I go?

You don't remember every skill, so ask. This does no work itself. To look up a skill by name or topic, use `find-skill` (`aos store search <words>`); come back here when several look alike.

Two layers, answering different questions. **The flow map** answers *"which way?"* — the route work travels from an idea to something shipped, and which branch to take at each fork. **The catalogue** below it answers *"which skill?"* — grouped by domain, with overlap guidance for the cases where several look alike. Start with the flow; drop to the catalogue when you already know roughly where you are.

---

## The main flow: idea → ship

The route most work travels.

**1. Sharpen the idea.** `/grill-with-docs` whenever you are in a working directory — the interview *plus* a paper trail, writing settled terminology into `CONTEXT.md` and ADRs as it goes. Without a repo to write to, `/grill-me`. Both run the same `grilling` primitive; the difference is only whether the understanding survives the session.

For a bigger or fuzzier idea, `/bdbrainstorm` runs the same interview inside a multi-agent debate (`/bdbmediastorm` for live show-control and event tech). Don't grill twice — those skills already do this step.

**2. Branch: how much machinery does the build need?** This is the fork that matters, and picking wrong is expensive in both directions.

- **`/fabric`** — the master: reads the task, picks one of the modes below and says why. The right start when you are unsure.
- **`/fabric-graph`** — when you need the durable `state.json`, a Reviewer repair loop with a no-progress guard, an automated quality gate, and escalation to a human. Mission-critical or multi-session work. Runs headless.
- **`/fabric-multigraph`** — a throwaway 2–4 node fan-out for one-off parallel work. Nothing persistent left behind.
- **`/fabric-teamwork`** — a vague brief that needs 9-step prompt crafting before delegation to a team.
- **`/fabric-swarm`** — N similar workers take items from one shared pool.
- **`/fabric-loop`** — repeats a graph run until an exit check is green, bounded by round limits.
- **Two-file edit?** No pipeline. Just do it.

**3. Review the plan before it is built.** At the Architect→TechLead gate, `aos-plan-canvas open production_artifacts/00_execution_plan.md` opens the plan in a browser where you point at what should change instead of retyping it. Mandatory at the end of `/bdbrainstorm` and `/bdbmediastorm`; optional in the linear run (`skills/basic/fabric-graph/linear.md`); deliberately not forced in `/fabric-graph`, which runs headless.

**4. Build, then review adversarially.** The pipelines invoke their own build and review nodes — you do not call these by hand. Reviewer's pass is a correctness check against the plan's contract; `godmode-shipping`'s gate is mechanical (lint, typecheck, tests). Two different checks, deliberately not merged.

Reach for `test-driven-development` on their own when you want one behaviour built test-first without a whole pipeline, and `git-pr-review` when reviewing a branch or PR against a fixed point.

**Forcing a specific skill into a run:** `--skill=<name>` on any fabric variant makes it a hard requirement — for a private skill of your own no node would otherwise reach for. Validated before the run starts; a name that does not resolve halts rather than proceeding without it.

## Outside the core: the ECC store

When no native AOS skill fits, search the markdown-only ECC store before starting a pipeline:

- `aos store search <words>` finds any skill by name, description or category (every word must match, any order), including all shipped AOS skills and the `pb-*` playbooks that the catalogue below does not name. Use it first when nothing below fits. Under a lean skill library most skills are not installed: when a skill you need is missing, run `aos store install <name>`, then read `~/.aos/library/skills/<name>/SKILL.md` right away so the current session can use it without a restart.
- `aos-store install <name> --net` installs a verified item after explicit user action.
- `aos-store list --type=skills` and `aos-store list --type=agents` show the catalogue.
- The core remains the trusted AOS skill set; the store is a fallback, not a reason to bypass the fabric validation.
- A missing `--skill` is reported by the dispatcher with the exact install command. It never downloads during a run.

---

## On-ramps

A starting situation that generates work, then merges onto the main flow.

- **Issues piling up** → `/triage`. For work you did *not* create: bug reports, incoming requests, anything raw. Tickets a pipeline already produced are agent-ready — **do not triage them**.
- **Something is broken** → `systematic-debugging` for a structured hunt, `debugger` for a plain error. Both refuse to theorise before there is a reproduction.
- **You need a runnable answer, not an argument** → `/prototype`. Throwaway code to settle a question that conversation cannot, then bring what you learned back to the idea thread.
- **Installing or updating AOS itself** → `aos-setup` brings a machine to a verified install; `aos-update` checks for and applies a new release (`bdb-updater` is its old name).
- **Deploying or shipping infrastructure** → `godmode-shipping` gates a release; `bdb-deploy`, `vercel-deployment` and `cloudflare-workers-expert` do the actual shipping.

---

## What this flow does not cover

Named so you don't go looking: AOS has no equivalent of a cross-session `handoff` file, and no `wayfinder`-style skill for charting a months-long effort as decision tickets. For work too large for one session, `/fabric-graph`'s durable `state.json` is the closest thing — it is resumable, but it does not chart the fog for you.

---

## 🧭 Intent Index (Table of Contents)

If the user's intent matches one of these, jump to the corresponding section:

* **"I need to choose a build pipeline (fabric vs fabric-graph)"** ➔ [Agent Orchestration & Pipelines](#agent-orchestration--pipelines)
* **"I need multi-agent brainstorming or ideation"** ➔ [Agent Orchestration & Pipelines](#agent-orchestration--pipelines)
* **"I want to build a new UI component or page"** ➔ [Frontend, UI & Motion](#frontend-ui--motion)
* **"I want Tailwind, shadcn, or design-system UI work"** ➔ [Frontend, UI & Motion](#frontend-ui--motion)
* **"I'm optimizing React or Next.js performance"** ➔ [Frontend, UI & Motion](#frontend-ui--motion)
* **"I'm designing an API (REST/GraphQL)"** ➔ [Backend, APIs & Databases](#backend-apis--databases)
* **"I need Prisma, Drizzle, or Postgres schema help"** ➔ [Backend, APIs & Databases](#backend-apis--databases)
* **"I'm working with n8n workflows"** ➔ [Backend, APIs & Databases](#backend-apis--databases)
* **"I want to deploy to Vercel, Cloudflare, or a VPS"** ➔ [DevOps, Git & Deployment](#devops-git--deployment)
* **"I'm managing GitHub PRs, issues, or monorepos"** ➔ [DevOps, Git & Deployment](#devops-git--deployment)
* **"I want to scrape or extract data from a website"** ➔ [Web Scraping & Browser Automation](#web-scraping--browser-automation)
* **"I need to run browser automation or web testing"** ➔ [Web Scraping & Browser Automation](#web-scraping--browser-automation)
* **"I'm building an AI agent, RAG pipeline, or working with LLMs"** ➔ [AI, LLMs & Agents](#ai-llms--agents)
* **"I need an SEO, GEO, or accessibility audit"** ➔ [Content, SEO & Docs](#content-seo--docs)
* **"I need to write a README or documentation"** ➔ [Content, SEO & Docs](#content-seo--docs)
* **"I need to debug a failing test or weird bug"** ➔ [Core Programming & Debugging](#core-programming--debugging)
* **"I want to ship a feature safely to production"** ➔ [Core Programming & Debugging](#core-programming--debugging)
* **"I'm managing the BDB SaaS multi-cloud fleet"** ➔ [BDB Ecosystem & SaaS Ops](#bdb-ecosystem--saas-ops)
* **"I need Three.js, 3D, or motion work"** ➔ [Media & EventTech](#media--eventtech)
* **"I need live event tech, TouchDesigner, or Resolume help"** ➔ [Media & EventTech](#media--eventtech)
* **"I need PCB layout, schematic capture, or electrical/hardware design"** ➔ [Electrical & Hardware Design](#electrical--hardware-design)

---

## 🏗️ Agent Orchestration & Pipelines

Use these skills to orchestrate complex multi-agent workflows.

* **Top Picks:** `fabric-graph`, `bdbrainstorm`

### Overlap: The fabric modes
Don't guess which pipeline to use. Follow these rules (source of truth: `CLAUDE.md` and `skills/basic/*/SKILL.md`):
* **`fabric`**: Use when unsure: it picks the fitting mode and says why.
* **`fabric-graph`**: Use when you need the full dispatcher graph: durable `state.json`, a Reviewer repair loop, a quality gate, and human escalation.
* **`fabric-multigraph`**: Use for a small throwaway fan-out (2-4 nodes) in any project without persistent artifacts.

### Overlap: Brainstorming
* **`bdbrainstorm`**: For multi-agent software engineering ideation, UI/UX design, and architecture planning. Handoffs to `/fabric-graph`.
* **`bdbmediastorm`**: For creative-tech, live event technology, and show-control systems (TouchDesigner, Resolume, grandMA3).
* **`brainstorming`**: Lighter-weight than `bdbrainstorm` — use before any creative or constructive work to turn a vague idea into a validated design through disciplined reasoning, without spinning up a multi-agent cycle.

### Overlap: Planning Before Code
* **`concise-planning`**: A coding task needs a plan. Produces a clear, atomic checklist.
* **`writing-plans`**: You already have a spec/requirements for a multi-step task — write the plan before touching code.
* **`executing-plans`**: You already have a written plan and need to execute it in a separate session with review checkpoints.
* **`planning-with-files`**: Work like Manus — persistent markdown files as working memory on disk, for long-running or resumable tasks.
* **`deep-research`**: The task is autonomous research (plan → search → read → synthesize into a report), not implementation.

### Overlap: Multi-Agent Session &amp; Tool Management
* **`agent-manager-skill`**: Managing multiple local CLI agents via tmux sessions (start/stop/monitor/assign) with cron-friendly scheduling.
* **`agent-tool-builder`**: You're building a *new* tool for an agent to use (not picking an existing skill) — schema design through error handling.
* **`agent-memory-mcp`**: A hybrid persistent/searchable memory system for agents (architecture, patterns, decisions) — distinct from `memb-skill`/`memb-ingest`, which are BDB's own memB engine specifically.
* **`triage`**: Moving issues/external PRs through a categorize → verify → brief state machine, not general planning.
* **`prototype`**: A throwaway prototype to sanity-check a state model or UI direction before committing to real work.

### Overlap: Cross-Session Coordination
* **`orchestrator-chain`**: Splitting work across levels (master session, project orchestrator, package orchestrator): which channel connects them and what each level may do. GO is never inherited.
* **`aos-a2a`**: Listing, messaging and replying to live harness peers (Claude Code, OpenCode, Codex, agy) over A2A on localhost. Inbound messages are context, never a GO.
* **`aos-gateway`**: The local MCP gateway and the per-app MCP picks: check, start, enable, disable, adopt other MCP servers behind it.

### Overlap: The Factory Family
`factory` configures an autonomous delivery factory (sources, schedules, action policies); it is report-only until you give a literal GO. It coordinates the module skills, which each do one job: `factory-collect` (collect and triage signals), `factory-lookback` (recurring patterns), `factory-human-digest` (what still needs a human), `factory-review-prs` (review a filtered PR queue), `factory-babysit-pr` (follow one authorized PR), `factory-ship` (publish and complete delivery), `factory-watchdog` (find stopped delivery work), `factory-recover` (resume interrupted runs). Guide: `docs/factory.md`.

*Also see:* `agent-pipeline`, `subagent-driven-development`.

---

## 🎨 Frontend, UI & Motion

Use these skills for UI development, component architecture, and design taste.

* **Top Picks:** `godmode-ui-ux`, `senior-frontend`, `shadcn`
* **Optional first step:** `creative-direction` before UI, motion or identity work on a new direction. It finds the insight and idea, then hands the brief to `godmode-ui-ux`, `prototype` or `bdbdesignpro`.

### Overlap: The UI Cluster vs Senior Frontend
* **`ui-component` / `ui-page` / `ui-pattern`** (only if the optional StyleSeed package is installed): Use these strictly when scaffolding new pieces in the **StyleSeed Toss** design system convention (enforcing tokens, spacing, and rhythm).
* **`ui-review` / `ui-tokens`** (only if the StyleSeed package is installed): Use for reviewing code against StyleSeed or syncing its design tokens.
* **`senior-frontend`**: Use for general React/Next.js/Tailwind development outside of strict StyleSeed scaffolding, or for reviewing general frontend code quality.
* **`shadcn`**: Use specifically when adding or customizing shadcn/ui components.
* **`tailwind-patterns`**: Use when managing CSS-first configurations, container queries, or Tailwind CSS v4 design token architectures.

### Overlap: React & Next.js Performance
* **`react-best-practices`**: The Vercel-maintained guide for broad performance optimization and App Router data fetching.
* **`react-patterns`**: Use for core hooks, composition, and TypeScript best practices.
* **`nextjs-app-router-patterns` / `nextjs-best-practices`**: Use specifically for Next.js App Router architecture and routing.
* **`react-component-performance`**: Use for targeted diagnosis of slow React components (e.g., render bottlenecks).
* **`tanstack-query-expert`**: Async state/data-fetching specifically — TanStack Query mutations, stale time, optimistic updates.
* **`zustand-store-ts`**: Client-side state stores with Zustand, typed and with middleware.
* **`web-performance-optimization`**: Broader than component-level — Core Web Vitals, bundle size, caching across the whole app.
* **`wcag-audit-patterns`**: Accessibility compliance auditing against WCAG 2.2, not general UX review.
* **`frontend-dev-guidelines`**: General-purpose frontend engineering standards when the task doesn't need a narrower skill above. For the backend half, `godmode-engineering` and `software-architecture`.
* **`landing-page-generator`**: Specifically a high-converting marketing landing page (PAS/AIDA/BAB copy frameworks), not a general app page.

### Overlap: The UX Cluster
* **`ux-flow`** (if the StyleSeed package is installed): Designing user flows, progressive disclosure, hub-and-spoke navigation (StyleSeed patterns).
* **`ux-audit`** (if the StyleSeed package is installed): Auditing existing screens against Nielsen's heuristics and mobile UX best practices.
* **`ux-feedback`** (if the StyleSeed package is installed): Adding loading/empty/error/success feedback states to components.
* **`ux-persuasion-engineer`**: Conversion/onboarding/checkout flows specifically — choice architecture, friction audits, commitment design.
* **`ui-ux-pro-max`**: Broader design guide (color, typography, general UI review) when the task doesn't fit one of the narrower UX skills above.

*Also see:* `bdbdesignpro`, `design-spells`.

---

## 🗄️ Backend, APIs & Databases

Use these for server-side architecture, APIs, workflows, and database schema design.

* **Top Picks:** `godmode-engineering`, `api-design-principles`, `drizzle-orm-expert`

### Overlap: Database & ORM Choices
* **`database-design`**: Use for overarching schema design, indexing strategy, and general database principles.
* **`postgres-best-practices`**: Use for raw performance optimization, queries, and Supabase-specific patterns.
* **`postgresql`**: Use for raw schema design, indexing, and Postgres constraints.
* **`using-neon` / `neon-postgres`**: Use specifically when working with Neon's serverless Postgres (branching, connection pooling).
* **`prisma-expert`**: Use for Prisma ORM schema design, migrations, and relational modeling.
* **`drizzle-orm-expert`**: Use for Drizzle ORM type-safe queries and serverless integrations.

### Overlap: The n8n Cluster
* **`n8n-workflow-patterns`**: Use for architectural patterns of whole workflows.
* **`n8n-code-javascript` / `n8n-code-python`**: Use when writing custom code inside n8n Code nodes (handles `$input`/`$json` nuances for JS/Python).
* **`n8n-expression-syntax`**: Use for debugging `{{}}` expressions.
* **`n8n-mcp-tools-expert`**: Use for integrating n8n-mcp tools effectively.

### Overlap: Architecture Level
* **`software-architecture`**: General quality-focused architecture guidance — the default when the task is "design/analyze architecture" without a more specific fit below.
* **`microservices-patterns`**: Specifically service boundaries, inter-service communication, and distributed-systems resilience.
* **`architect-review`**: Reviewing an existing architecture against modern practice, not designing a new one from scratch.

*Also see:* `api-patterns`, `openapi-spec-generation`, `golang-pro`, `python-pro`.

---

## 🕷️ Web Scraping & Browser Automation

Use these skills to extract data or control browsers.

* **Top Picks:** `apify-ultimate-scraper`, `playwright-skill`

### Overlap: Scraping and Extraction
* **`apify-ultimate-scraper`**: The top-level choice. Automatically selects from 55+ Apify Actors for the task.
* **`apify-lead-generation`**: Narrow use case: scraping leads from multiple platforms.
* **`web-scraper`**: Multi-strategy data extraction (tables, prices) with pagination and CSV/JSON export.
* **`browser-automation`**: General principles for selectors, waiting, and anti-detection.
* **`playwright-skill`**: Universal executor for custom Playwright code (e2e testing, interactive scraping).
* **`go-playwright`**: Use when writing browser automation in Go.
* **`webapp-testing`**: Use when writing native Python Playwright scripts for local testing.

---

## 🚀 DevOps, Git & Deployment

Use these to ship code, manage infrastructure, and handle source control.

* **Top Picks:** `godmode-shipping`, `github`, `vercel-deployment`

* **Godmode Shipping**: `godmode-shipping` is the ultimate pre-launch gatekeeper (lint, tests, rollbacks).
* **Deployments**: `vercel-deployment` (Next.js/React), `cloudflare-workers-expert` (Edge/KV/D1), `bdb-deploy` (rsync over SSH to VPS), `docker-expert` (Containers).
* **Git/GitHub**: `git-advanced-workflows`, `git-pr-review`, `github-workflow-automation`, `github-repo`, `github-actions-templates` (CI/CD workflow patterns specifically).
* **Monorepos**: `turborepo-caching`, `monorepo-management`.

---

## 🧠 AI, LLMs & Agents

Use these when building AI products or optimizing models.

* **Top Picks:** `prompt-engineer`, `llm-structured-output`, `rag-engineer`

* **Agent Dev**: `ai-agent-development`, `crewai`.
* **LLM Integration**: `gemini-api-integration`, `gemini-api-dev` (Gemini API model capabilities specifically), `local-llm-expert`, `llm-app-patterns`.
* **Conversational AI Products**: `llm-application-dev-ai-assistant` — building a chatbot/assistant product end-to-end, not just integrating one API.
* **Prompting**: `prompt-engineering-patterns`, `llm-prompt-optimizer`.
* **RAG**: `rag-implementation`, `rag-engineer` (broader — embedding models, vector DB selection), `vector-database-engineer` (specifically Pinecone/Weaviate/Qdrant/Milvus/pgvector selection and tuning).
* **Vercel AI SDK**: `vercel-ai-sdk-expert` — `generateText`/`streamText`, UI hooks, tool calling specifically on Vercel's SDK.

---

## 📝 Content, SEO & Documentation

Use these for docs, markdown, and search engine optimization.

* **Top Picks:** `readme`, `seo`, `documentation`

* **Docs**: `openwiki-skill`, `readme`, `copywriting`.
* **SEO**: `seo` (broad audit), `seo-technical` (crawlability, CWV), `seo-audit` (rankings), `geo-fundamentals` (AI search), `programmatic-seo`, `schema-markup`.

---

## 🔧 Core Programming & Debugging

Use these for raw problem solving and code hygiene.

* **Top Picks:** `systematic-debugging`, `clean-code`, `test-driven-development`

* **Debugging**: `debugger` (general errors), `systematic-debugging` (structured triage before fixing).
* **Hygiene**: `simplify-code` (diff review for clarity).
* **TDD**: `test-driven-development`.

### Overlap: Language Expertise
* **`typescript-pro`**: Advanced types, generics, strict type safety, enterprise patterns.
* **`modern-javascript-patterns`**: ES6+ features and functional patterns (no TypeScript-specific typing concerns).
* **`python-patterns`**: Framework selection, async patterns, project structure — decision-making, not a specific bug.
* **`python-performance-optimization`**: An existing Python app is slow — profiling and bottleneck fixes specifically.
* **`go-concurrency-patterns`**: Goroutines, channels, sync primitives, race-condition debugging.
* **`bash-linux`**: General Bash/Linux scripting patterns, macOS or Linux.
* **`posix-shell-pro`**: The script must run on any POSIX shell (dash/ash/sh), not just bash.
* **`tmux`**: Terminal multiplexing and persistent remote session management specifically.

---

## 🌀 BDB Ecosystem & SaaS Ops

Specific utilities for the BDB environment.

* **Top Pick:** `memb-skill`

*Also see:* `memb-ingest`, `synapse-integration-skill`.

---

## 🧊 Media & EventTech

Use these for 3D, motion, video and live show control.

* **Top Picks:** `godmode-media-creation` (video and montage), `godmode-eventtech` (live shows), `godmode-3d-creation` (meshes and scenes)

* **Godmodes**: Determine the overarching flow (3D, Media, EventTech).
* **Implementations**: `mcp-manage` drives the creative applications over MCP, `spline-3d-integration` (web 3D), `threejs-skills` (WebGL), `remotion` (React → MP4, deterministic frame counts).

* **Per-application MCP guides**: once `mcp-manage` has told you *which* server to use, these document the tool surface of one application each — `bdb-touchdesigner-mcp`, `bdb-resolume-mcp`, `bdb-grandma3-mcp`, `bdb-davinci-mcp`, `bdb-adobe-suite-mcp`, `bdb-after-effects-mcp`, `bdb-blender-mcp`, `bdb-unreal-mcp`, `bdb-rhino-mcp`, `bdb-vectorworks-mcp`. Reach for one only when you already know the application; `mcp-manage` is the way in.

### Which video route?

For video, motion, social posts or scripts, start with the Creator Extension `content-studio` skill (playbook `pb-content-studio`): its `route(brief)` picks Hyperframes or Remotion. The table below is for the cases it does not cover.

The choice is driven by where the pixels come from, not by the output format — all four end in a video file.

| Source material | Route |
|---|---|
| Code-generated motion graphics, text, brand animation | `remotion` — React components rendered to MP4, deterministic and exactly frame-accurate |
| Existing footage: cutting, colour, beat-sync | `godmode-media-creation` + `mcp-manage` → **DaVinci Resolve** (`davinci-resolve-mcp`) or **Adobe Premiere** (`adobe_uxp_mcp`) |
| Compositing, motion design over footage | `mcp-manage` → **After Effects** (`ae-mcp`, `after-effects-mcp`), or **Photoshop** for stills (`adobe_uxp_mcp`) |
| Generative visuals: audio-reactive, shaders, real-time | `godmode-eventtech` → TouchDesigner MCP, then `record_movie` |
| Generative *assets*: text→3D, image→3D, AI video | The **Creator Extension** engines — TRELLIS and TripoSR (3D), Text-to-CAD, OpenMontage (multimodal montage), Video-Shotcraft (shot direction), Palmier-Pro (timeline and grading). The 3D engines run as local CLI scripts (see `godmode-3d-creation`); `comfyui-mcp` is only the fallback for TRELLIS without CUDA. Installed as a separate power-up module, not a skill in this catalogue. |
| Concept not settled yet | `bdbmediastorm` first — it runs the grilling interview for show-control and media work |

Resolve and Premiere are interchangeable at this level: pick whichever is actually installed. Both have a working MCP under `mcps/`.

---

## 🔩 Electrical & Hardware Design

Use these for schematic capture, PCB layout, and physical hardware design (KiCad, OpenSCAD).

* **Top Picks:** `godmode-hardware-pcb`, `code-first-hardware-design`, `pcb-constraint-definition`

* **Architectural authority**: `godmode-hardware-pcb` — enforces IPC-standard trace/impedance/stackup math and the headless ERC/DRC/DFM sign-off gate across the skills below; load it before starting schematic or layout work.
* **Circuit synthesis & enclosures**: `code-first-hardware-design` — programmatic schematic capture (SKiDL, netlists, S-expressions) and parametric 3D CAD enclosure co-design (OpenSCAD/BOSL2).
* **Constraints & stackup**: `pcb-constraint-definition` — translates hardware requirements into layer stackup, netclasses, impedance matching, and custom DRC rules before layout starts.
* **Layout & routing**: `pcb-layout-routing-automation` — floorplanning, component placement, high-speed differential pair routing, thermal via arrays, and keepout enforcement.
* **Validation & sign-off**: `pcb-validation-dfm-signoff` — automated DRC/ERC, SI/PI screening, fab house DFM/DFA compliance, and production release sign-off (Gerbers/BOM/CPL).
* **Schematic & datasheet auditing**: `schematic-datasheet-analysis` — electrical rule auditing, datasheet grounding, pinout validation, and power tree tracing.

These ship in the separate `@hybridlabor-api/bdb-hardware-pcb` power-up module (KiCad + OpenSCAD MCP servers), not in this base skills package — install it as an optional AOS module when hardware work comes up.

---

## 🛡️ Overlap: The Supreme Godmodes

When do you use a `godmode-*` skill versus a narrower skill?
* **`godmode-ui-ux`, `godmode-engineering`, `godmode-shipping`, `godmode-3d-creation`, `godmode-media-creation`, `godmode-eventtech`** are orchestrator/enforcer skills. They hold the "supreme rulebook" for a domain. Use them when starting a major feature or defining the overarching architecture of a task.
* Use narrower skills (e.g., `shadcn`, `drizzle-orm-expert`, `threejs-skills`) for the tactical implementation inside those domains.

---

## 🛑 Fallback Note

If none of the intents above match your task, look for the closest general library skill in the catalog. 

**Remember:** This file helps discover skills, but **`CLAUDE.md`** is the canonical source of truth for the primary Skill Routing by Domain table and the exact rules for Agent Counts (subagents vs teams vs solo). Do not rely on `ask-tim` to dictate pipeline definitions—always defer to `CLAUDE.md`.


---

## Available Packs & Roles Catalogue

<!-- aos:pack-index:start -->
## Available Packs

### engineering

Backend, Architecture & Deployment: testing, debugging, CI/CD, security, shipping

**Install:** `aos store install --pack engineering`

### design-ui-ux

Design & Frontend: React, Next.js, TailwindCSS, UI components, accessibility

**Install:** `aos store install --pack design-ui-ux`

### media-eventtech

Event & Live Tech, Motion, Content, 3D & Video

**Install:** `aos store install --pack media-eventtech`

### ops

Agentur & Business: project management, research, automation, APIs, automation

**Install:** `aos store install --pack ops`

### docs

Harness Configuration & AOS Engineering: skills, memory, state, documentation

**Install:** `aos store install --pack docs`

### video

Video creation and rendering: routes, engines and handoffs

**Install:** `aos store install --pack video`

### hardware

Hardware & PCB: KiCad, schematics, layouts, DRC, manufacturing (external skills)

**Install:** `aos store install --pack hardware`

## Roles (Preset Pack Combinations)

- **Eventagentur / Veranstalter**: ops, media-eventtech
- **Event- und Live-Technik**: media-eventtech, hardware
- **Motion- und Content-Design**: media-eventtech, design-ui-ux
- **Web- und App-Entwicklung**: design-ui-ux, engineering
- **Agents und Automationen**: engineering
- **Harness-Engineering**: all packs
<!-- aos:pack-index:end -->

---

<!-- aos:skill-catalogue:start -->
## All shipped skills

Generated from the SKILL.md frontmatter of every shipped skill by the catalogue build step of this repository; do not edit by hand. Search it with `aos store search <words>`.

### bdb-core

- `advisor` - Read-only second opinion at three fixed points: before a plan or schema is locked, on t...
- `agent-manager-skill` - Use when manage multiple local CLI agents via tmux sessions (start/stop/monitor/assign)...
- `agent-memory-mcp` - Use when a hybrid memory system that provides persistent, searchable knowledge manageme...
- `agent-pipeline` - How AOS structures multi-agent build pipelines: the seven-node dispatcher graph /fabric...
- `agenttrail` - agenttrail: the live map of a multi-agent build
- `ao-orchestrator` - Multi-project orchestrator using AO daemon
- `aos-a2a` - Message live harness peers (Claude Code, OpenCode, Codex, agy) over A2A localhost
- `aos-gateway` - Local MCP gateway and per-app MCP picks
- `aos-project-init` - Interview a project folder into AOS: .aos/project.json, OpenWiki, memB memory, Synapse...
- `aos-setup` - Bring a machine to a verified AOS install: skills pack, MCP servers, gate hooks, memB,...
- `aos-store` - Browse, preview, and install AOS Core, ECC and Scenario skills and agents from a local...
- `aos-update` - Update the installed AOS: check for a new version, preview, run the update and verify
- `ask-tim` - Route to the right AOS skill or flow for a task
- `bdb-aos` - Entry point for AOS Agent OS suite
- `bdb-deploy` - Deploy a project to a real server via rsync over SSH
- `bdb-memb-mcp` - MCP interface to memB persistent memory
- `bdb-updater` - Alias of aos-update
- `bdbhtmlmanueldocs` - Enterprise-grade developer docs and user manuals
- `bdbrainstorm` - Multi-agent brainstorming with /grill-me and Godmodes incl
- `bdbresilience` - CI/CD error recovery, distributed file-based locking, diagnostic triage and GO-gate res...
- `clear-context` - Survive a /clear or context limit
- `codebase-memory` - Code research over an indexed codebase with minimal context: graph queries, call chains...
- `deja-memory` - On-demand local session memory (deja fix/wip/search)
- `design-control-loop` - Interview the user to design an agentic control loop (sensor, controller, actuator) tai...
- `fabric` - Master entry for the fabric family
- `fabric-graph` - Use for /fabric-graph, "run a fabric" or after /bdbrainstorm: the build pipeline with d...
- `fabric-loop` - Fabric mode that repeats a graph run until an exit check is green, with round limits, n...
- `fabric-multigraph` - Use when a task needs a small, throwaway multi-agent fan-out (a couple of parallel work...
- `fabric-swarm` - Fabric mode for N similar workers taking items from one shared pool
- `fabric-teamwork` - Multi-agent team prompt crafting and delegation
- `factory-human-digest` - Summarize work needing human judgment across PRs, issues, feedback and delivery signals
- `find-skill` - Find which skill in the AOS library fits a task, by searching it
- `gogate` - AOS go-gate status and modes
- `instinct-export` - Use when the user wants to share or back up learned instincts — validates the local ins...
- `instinct-import` - Use when the user brings an exported instincts JSON to merge into the local store — tre...
- `instinct-status` - Use when the user wants to see what learned instincts exist, their confidence scores an...
- `loop-templates` - Loop templates for repeating tasks
- `master-session` - Supervise multiple agent sessions on this machine
- `mcsc` - Delegate to other CLI harnesses (agy, OpenCode, Codex)
- `memb-ingest` - Use when deep scan and ingest project files (.md, .json, agent.md, .openwiki) and past...
- `memb-skill` - Local-first long-term memory (memB)
- `openwiki-skill` - OpenWiki: codebase and knowledge wikis
- `orchestrator-chain` - Hand work across orchestration levels
- `pb-focus-chunks` - Split one big task into at most 25-minute chunks, each with a done-check, and place the...
- `pb-handover` - Write a handover note for a colleague from a project folder's state: done, open, risky,...
- `pb-harness-work` - Change the agent harness itself (hooks, gates, memory, permissions, plugins) the safe w...
- `pb-inbox-zero` - Sort an email backlog into reply, delegate, archive and ignore, and draft the replies
- `pb-machine-setup` - Bring a new machine to an AOS install: doctor baseline, install after GO, MCP per harne...
- `pb-master` - Run one control session over several Claude Code, Codex or OpenCode sessions: roster, s...
- `pb-meeting-actions` - Turn a meeting transcript into clean notes, decisions and who does what by when, then d...
- `pb-project-new` - Start a new private GitHub project the AOS way: repo, AOS bootstrap, push after GO, ver...
- `pb-release-aos` - Release a new AOS version to npm via the release-please PR: check commits, review and g...
- `pb-todo` - Turn one sentence into a task line in the right to-do list, with project, priority and...
- `pb-week-plan` - Turn scattered to-dos and notes into one prioritised weekly plan, at most 3 must-do ite...
- `pb-worktrees-land` - Clean up git worktrees across your repos: list worktrees, classify merged, remote-only,...
- `plan-arbiter` - Compare, cross-review or judge competing agent plans and recommend one execution plan
- `plan-canvas` - Open a plan in a browser canvas to visualize the plan, annotate, approve
- `quick-recap` - Use when each agent response should end with a red/yellow/green status line showing whe...
- `skill-create` - Use when the user wants to capture a real repo's working patterns as a reusable skill —...
- `stay-within-limits` - Use when long-running or parallel agent work must respect 5-hour and weekly usage limit...
- `subagent-setup` - Configure multi-harness subagents (Claude Code, Antigravity, OpenCode, Codex) with per-...
- `synapse-integration-skill` - Use when global skill for AOS Synapse (3D Codebase Visualizer) integration
- `token-saver-config` - Use when context window output compression engine for CLI commands (60-99% token reduct...

### business-ops

- `pb-invoice-check` - Check invoices and receipts line by line against your offers and list what matches, dif...
- `pb-offer` - Draft a client offer with line items priced only from your price list, and send it only...

### design-ui-ux

- `bdb-ui-library` - Component and motion-icon lookup for UI work
- `bdb-visual-edit` - Edit the source of a locally running app after a visual-edit item from plan-canvas
- `bdbdesignpro` - Choose animation engines, define DTCG motion tokens, add scroll effects and audit motio...
- `creative-direction` - Use before UI/UX, motion, visual identity or campaign work to find the insight and the...
- `design-spells` - Use when adding curated micro-interactions, delightful animations, and subtle design de...
- `editable-design` - Fixed-canvas editable visual designs: posters, banners, covers with HTML/PNG output and...
- `frontend-dev-guidelines` - Senior frontend standards for architecture and performance
- `godmode-ui-ux` - Design lead for frontend: brand discovery, Anti-Slop, DTCG tokens, fluid motion, data-d...
- `live-preview-canvas` - A prototyping skill that generates a local HTML mock with a built-in feedback layer, al...
- `pb-docs-site` - Publish a project's docs as a static HTML manual on GitHub Pages: check Pages, update t...
- `pb-landing-page` - Build and launch a landing page: confirmed copy without invented claims, page in your b...
- `pb-newsletter` - Turn a pb-ship recap, changelog range or quick recap into a newsletter email draft wher...
- `pb-redesign-app` - Overhaul one app's UI from an audit: UX audit and UI review of the running app, token c...
- `senior-frontend` - Use when building React components, optimizing Next.js performance, implementing access...
- `shadcn` - Use when adding, customizing, or troubleshooting shadcn/ui components to build modern,...
- `tailwind-patterns` - Use when styling components with Tailwind CSS v4, managing CSS-first configurations, wr...
- `ui-ux-pro-max` - Design guide for web and mobile apps
- `ux-persuasion-engineer` - Behavioral UX choice architecture, friction audits and commitment design to guide users...

### engineering-hardware

- `godmode-hardware-pcb` - Electrical schematics, PCB layouts, KiCad, OpenSCAD
- `pb-pcb-to-case` - From a KiCad board to a parametric enclosure that fits it: ERC, DRC clean, dimensions e...

### engineering-method

- `agent-tool-builder` - Design tools for AI agents
- `agentic-harness-patterns` - Harness patterns for coding agents — memory, permissions, context engineering, delegati...
- `archify` - Build architecture, workflow, sequence, data-flow and state diagrams as explorable stan...
- `architect-review` - Master software architect specializing in modern architecture
- `bdb-computer-use-mcp` - Utilizes native Rust/Node and Python-based computer-use-mcp servers to control macOS, W...
- `bdb-security-audit` - Comprehensive security auditing, diff analysis, defensive checklists, and vulnerability...
- `bdb-shipping-skill` - Pre-flight shipping decisions: problem-framing, one/two-way door classification, ADR lo...
- `ci-pipeline` - Set up CI/CD: detect the stack, generate GitHub Actions workflows, Dockerfile and Makefile
- `clean-code` - This skill embodies the principles of \"Clean Code\" by Robert C
- `concise-planning` - Use when a user asks for a plan for a coding task, to generate a clear, actionable, and...
- `diagnosing-bugs` - Diagnosis loop for hard bugs and performance regressions
- `dispatching-parallel-agents` - Dispatch one subagent per independent task slice
- `domain-modeling` - Build and sharpen a project's domain model
- `executing-plans` - Use when you have a written implementation plan to execute in a separate session with r...
- `factory` - Configure an autonomous software delivery factory
- `factory-babysit-pr` - Monitor one explicitly authorized pull request
- `factory-collect` - Collect and triage product feedback, telemetry, runtime errors and issue reports
- `factory-lookback` - Audit recurring feedback, telemetry, errors and brittle delivery paths for systemic fixes
- `factory-recover` - Find interrupted coding runs and report resume candidates
- `factory-review-prs` - Experimental workflow for reviewing configured repositories' pull requests
- `factory-ship` - Experimental workflow for publishing and completing configured software delivery work
- `factory-watchdog` - Monitor explicitly authorized delivery tasks and report stalled work
- `finishing-a-development-branch` - Use when implementation is complete, all tests pass, and you need to decide how to inte...
- `github-actions-generator` - Create, generate, or scaffold GitHub Actions workflows, action.yml, or .github/workflow...
- `github-actions-validator` - Validate, lint, audit, fix GitHub Actions workflows (.github/workflows)
- `github-repo` - Standards and workflows for writing, formatting, sanitizing, and publishing high-qualit...
- `godmode-engineering` - Domain-Driven Design, strict TypeScript, Clean Architecture
- `godmode-shipping` - Final gatekeeper for production releases
- `grill-me` - A relentless interview to sharpen a plan or design before committing to an approach
- `grill-with-docs` - Interview to sharpen plan/design and build domain model
- `grilling` - Grill the user relentlessly about a plan, decision, or idea
- `makefile-pro` - Generate, scaffold, validate and lint Makefiles and .mk files: .PHONY targets, build au...
- `pb-aos-e2e` - AOS release E2E in a sandbox: install the packed tarball, verify doctor, gates, memB, h...
- `pb-bug-fix` - Turn a GitHub issue into a tested fix on a branch with an open PR: contract, root cause...
- `pb-ci-fix` - Fix red CI or set up GitHub Actions: read the failing run, find the root cause, patch a...
- `pb-idea-to-launch` - Turn an idea into a deployed prototype: spec from brainstorming, ComfyUI plan, fabric b...
- `pb-open-source` - Prepare a project for open sourcing: sanitized fork with secrets and internal refs stri...
- `pb-security-sweep` - Security sweep over one repo: secrets, deps and diff, security review, silent-failure h...
- `pb-ship` - Ship the day's work in one repo: triage issues, review every open PR, merge after GO, p...
- `pb-tauri-e2e` - Multi-phase E2E, live-app and binary security audit for Tauri v2 desktop apps with side...
- `planning-with-files` - Work like Manus: Use persistent markdown files as your \"working memory on disk.\"
- `pr-recap` - Visual recap page for a PR or git range: changed-files tree, per-file notes, verified t...
- `prompt-engineer` - Transforms user prompts into optimized prompts using frameworks (RTF, RISEN, Chain of T...
- `prompt-engineering-patterns` - Master advanced prompt engineering techniques to maximize LLM performance, reliability,...
- `prototype` - Build a throwaway prototype to answer a design question via UI variations or a state wa...
- `read-the-damn-docs` - Use when working with third-party APIs, libraries, CLIs or fast-moving product behavior
- `requesting-code-review` - Use when completing tasks, implementing major features, or before merging to verify wor...
- `reverse-engineer-anything` - Reverse engineer native, managed, Electron, packaged, firmware or browser targets with REA
- `simplify-code` - Review a diff for clarity and safe simplifications, then optionally apply low-risk fixes
- `software-architecture` - Quality-focused architecture guidance (Clean Architecture, DDD)
- `subagent-driven-development` - Dispatch a fresh subagent per task: implementation plans with independent tasks, two-st...
- `systematic-debugging` - Use when encountering any bug, test failure, or unexpected behavior, before proposing f...
- `tdd` - Test-driven development
- `test-driven-development` - Use when implementing any feature or bugfix, before writing implementation code
- `to-spec` - Turn the current conversation into a spec and publish it to the project issue tracker:...
- `triage` - Move issues and external PRs through a state machine of triage roles, categorise, verif...
- `two-axis-code-review` - Two-axis review since a fixed point: Standards (repo standards) and Spec (matches the i...
- `using-git-worktrees` - Use for feature work needing isolation or before executing a plan: ensure an isolated w...
- `verification-before-completion` - Use before claiming work is complete or fixed: run verification commands and confirm ou...
- `wayfinder` - Plan work too big for one agent session as a shared map of decision tickets on the issu...
- `wcag-audit-patterns` - Comprehensive guide to auditing web content against WCAG 2.2 guidelines with actionable...
- `webapp-testing` - To test local web applications, write native Python Playwright scripts
- `writing-plans` - Use when you have a spec or requirements for a multi-step task, before touching code

### library

- `ai-agent-development` - AI agent development workflow for building autonomous agents, multi-agent systems, and...
- `ai-product` - Every product will be AI-powered
- `api-design-principles` - Master REST and GraphQL API design principles to build intuitive, scalable, and maintai...
- `api-patterns` - API design principles and decision-making
- `apify-lead-generation` - Scrape leads from multiple platforms using Apify Actors
- `apify-ultimate-scraper` - AI-driven data extraction from 55+ Actors across all major platforms
- `bash-linux` - Bash/Linux terminal patterns
- `brainstorming` - Use before creative or constructive work (features, architecture, behavior)
- `browser-automation` - Browser automation for web testing, scraping and AI agent interactions
- `cloudflare-workers-expert` - Expert in Cloudflare Workers and the Edge Computing ecosystem
- `copywriting` - Write rigorous, conversion-focused marketing copy for landing pages and emails
- `crewai` - Expert in CrewAI - the leading role-based multi-agent framework used by 60% of Fortune...
- `database-design` - Database design principles and decision-making
- `debugger` - Debugging specialist for errors, test failures, and unexpected behavior
- `deep-research` - Run autonomous research tasks that plan, search, read, and synthesize information into...
- `docker-expert` - Docker containerization
- `documentation` - Documentation generation workflow covering API docs, architecture docs, README files, c...
- `drizzle-orm-expert` - Drizzle ORM for TypeScript
- `firecrawl` - Search, scrape, and interact with the web via the Firecrawl CLI
- `firecrawl-sdk` - Integrate Firecrawl into product code: SDK setup and FIRECRAWL_API_KEY onboarding, /scr...
- `gemini-api-dev` - The Gemini API provides access to Google's most advanced AI models
- `gemini-api-integration` - Use when integrating Google Gemini API into projects
- `geo-fundamentals` - Generative Engine Optimization for AI search engines (ChatGPT, Claude, Perplexity)
- `git-advanced-workflows` - Master advanced Git techniques to maintain clean history, collaborate effectively, and...
- `git-pr-review` - Generate a concise and structured PR description from commit history with minimal token...
- `github` - Use the `gh` CLI for issues, pull requests, Actions runs, and GitHub API queries
- `github-actions-templates` - Production-ready GitHub Actions workflow patterns for testing, building, and deploying...
- `github-workflow-automation` - Patterns for automating GitHub workflows with AI assistance, inspired by [Gemini CLI](h...
- `go-concurrency-patterns` - Go concurrency: goroutines, channels, sync primitives, context
- `go-playwright` - Expert capability for robust, stealthy, and efficient browser automation using Playwrig...
- `golang-pro` - Master Go 1.21+ with modern patterns, advanced concurrency, performance optimization, a...
- `landing-page-generator` - Next.js/React landing pages with Tailwind CSS
- `linear-claude-skill` - Manage Linear issues, projects, and teams
- `llm-app-patterns` - Production-ready patterns for building LLM applications, inspired by [Dify](https://git...
- `llm-application-dev-ai-assistant` - AI assistant development: chatbots, conversational interfaces, AI-powered applications
- `llm-prompt-optimizer` - Use when improving prompts for any LLM
- `llm-structured-output` - Get reliable JSON, enums, and typed objects from LLMs using response_format, tool_use,...
- `local-llm-expert` - Local LLM inference: model selection, VRAM optimization
- `microservices-patterns` - Microservices architecture: boundaries, communication, data management, resilience patt...
- `modern-javascript-patterns` - Modern JavaScript: ES6+, functional patterns, best practices
- `monorepo-management` - Build efficient, scalable monorepos that enable code sharing, consistent tooling, and a...
- `n8n-code-javascript` - JavaScript in n8n Code nodes
- `n8n-code-python` - Python in n8n Code nodes
- `n8n-expression-syntax` - n8n expression syntax validation
- `n8n-mcp-tools-expert` - n8n-mcp tools: nodes, configs, templates, workflows
- `n8n-workflow-patterns` - Proven architectural patterns for building n8n workflows
- `neon-postgres` - Expert patterns for Neon serverless Postgres, branching, connection pooling, and Prisma...
- `nextjs-app-router-patterns` - Comprehensive patterns for Next.js 14+ App Router architecture, Server Components, and...
- `nextjs-best-practices` - Next.js App Router principles
- `obsidian-markdown` - Flavored Markdown: wikilinks, embeds, callouts, properties
- `openapi-spec-generation` - OpenAPI 3.1 specs from code, design-first approach
- `os-scripting` - Shell scripting troubleshooting
- `playwright-skill` - Use when a task needs custom Playwright code: end-to-end testing, scraping a JS-rendere...
- `posix-shell-pro` - Strict POSIX sh scripting for maximum portability across Unix-like systems; scripts tha...
- `postgres-best-practices` - Supabase Postgres performance best practices
- `postgresql` - Design a PostgreSQL-specific schema
- `prisma-expert` - Prisma ORM expertise: schema design, migrations, query optimization, relations modeling...
- `product-manager-toolkit` - Essential tools and frameworks for modern product management, from discovery to delivery
- `programmatic-seo` - Design and evaluate programmatic SEO strategies for creating SEO-driven pages at scale...
- `python-patterns` - Python development principles and decision-making
- `python-performance-optimization` - Profile and optimize Python with cProfile, memory profilers and best practices
- `python-pro` - Modern Python 3.12+ expertise: async, performance, production practices and the latest...
- `rag-engineer` - Build Retrieval-Augmented Generation systems: embedding models, vector databases, chunk...
- `rag-implementation` - RAG implementation workflow: embedding selection, vector database setup, chunking strat...
- `react-best-practices` - Vercel's React performance guide
- `react-component-performance` - Diagnose slow React components and suggest targeted performance fixes
- `react-patterns` - Modern React patterns and principles
- `readme` - Write an absurdly thorough README.md as an expert technical writer
- `remotion` - Generate walkthrough videos from Stitch projects using Remotion with smooth transitions...
- `schema-markup` - Design, validate, and optimize schema.org structured data for eligibility, correctness,...
- `seo` - Broad SEO audit across technical SEO, on-page, schema, sitemaps, content quality, AI re...
- `seo-audit` - Diagnose and audit SEO issues affecting crawlability, indexation, rankings, and organic...
- `seo-technical` - Audit technical SEO: crawlability, indexability, URLs, mobile, Core Web Vitals, structu...
- `tanstack-query-expert` - TanStack Query (React Query) expertise: data fetching, stale time, mutations, optimisti...
- `tmux` - Expert tmux session, window, and pane management for terminal multiplexing, persistent...
- `turborepo-caching` - Configure Turborepo with local and remote caching
- `typescript-pro` - Master TypeScript with advanced types, generics, and strict type safety
- `using-neon` - Neon serverless Postgres: autoscaling, branching, instant restore, scale-to-zero, Postg...
- `vector-database-engineer` - Vector databases, embedding strategies and semantic search with Pinecone, Weaviate, Qdr...
- `vercel-ai-sdk-expert` - Vercel AI SDK expertise: Core API, UI hooks (useChat, useCompletion), tool calling and...
- `vercel-deployment` - Expert knowledge for deploying to Vercel with Next.js
- `web-artifacts-builder` - To build powerful frontend claude.ai artifacts, follow these steps:
- `web-performance-optimization` - Optimize website and web application performance including loading speed, Core Web Vita...
- `web-scraper` - Web scraping inteligente multi-estrategia
- `zustand-store-ts` - Create Zustand stores following established patterns with proper TypeScript types and m...

### media-eventtech

- `bdb-adobe-suite-mcp` - Automate Photoshop, Illustrator, Premiere Pro and After Effects via the Adobe Suite MCP...
- `bdb-after-effects-mcp` - Utilizes the After Effects MCP servers (after-effects-mcp and ae-mcp) to create composi...
- `bdb-blender-mcp` - Utilizes the Blender MCP server and addon to build 3D assets, apply materials, inspect...
- `bdb-davinci-mcp` - Utilizes the DaVinci Resolve MCP servers to control timeline editing, media analysis, c...
- `bdb-eventagency-skill` - Event agency operations: client intake, scoping, vendors, crew, production planning, lo...
- `bdb-grandma3-mcp` - Utilizes the grandMA3 MCP server to patch fixtures, execute console commands, and trigg...
- `bdb-resolume-mcp` - Utilizes the Resolume Arena MCP server to trigger clips, clear layers, adjust speeds, a...
- `bdb-rhino-mcp` - Utilizes the Rhino MCP servers (RhinoMCP and golem-rhino-mcp) to create and manipulate...
- `bdb-touchdesigner-mcp` - Utilizes the TouchDesigner MCP servers (tdmcp and touchdesigner-mcp) to create TOP/CHOP...
- `bdb-unreal-mcp` - Utilizes the Unreal Engine MCP server to control UE5 via a native C++ Automation Bridge...
- `bdb-vectorworks-mcp` - Utilizes the Vectorworks RAG + MCP server to search and retrieve Python and VectorScrip...
- `bdbmediastorm` - Use when brainstorming or planning live event technology, show control, and real-time m...
- `brag` - Turn the project website into a launch video with Hyperframes
- `godmode-3d-creation` - Use when generating 3D meshes, executing text-to-CAD, or reconstructing scenes via TREL...
- `godmode-eventtech` - Real-time show-control execution: signal flows, OSC/DMX, MCP orchestration
- `godmode-media-creation` - Video timelines, motion graphics, media creation, animation, exact timelines, local pro...
- `mcp-manage` - Use when checking capabilities or instructing the user on how to interact with speciali...
- `pb-clip-from-moodboard` - Turn a look brief and reference images into a social clip: concept, TouchDesigner look,...
- `pb-code-video` - The main entry point for video creation: generates a video brief, creates a shot plan,...
- `pb-content-studio` - Idea to published-ready content (30 s / 40 s video, text overlay, AI generated shots):...
- `pb-crew-call-sheet` - Build a crew call sheet and load-in / load-out plan for one show day from your event tr...
- `pb-event-tracker` - Build one spreadsheet for an event covering guests, vendors, timeline and budget, from...
- `pb-image-to-3d` - Turn one reference image into a cleaned, scaled 3D asset: image-to-3D ComfyUI workflow...
- `pb-launch-video` - Turn a live app, landing page, SaaS demo or product walkthrough into a short launch vid...
- `pb-show-build` - Build a show across grandMA3, Resolume and TouchDesigner from one cue list, offline fir...
- `pb-social-pack` - Release or ship recap into a social pack: posts per platform with claims traced to a fa...
- `spline-3d-integration` - Use when adding interactive 3D scenes from Spline.design to web projects, including Rea...
- `threejs-skills` - Create 3D scenes, interactive experiences and visual effects with Three.js

### saas-ops

- `golive` - Ship app from repo to production on user accounts
- `pb-deploy-saas` - Deploy a SaaS app to the AOS fleet: skill preflight, guardrail plan, green CI, deploy a...
- `pb-health-weekly` - Weekly health report over the AOS repos as an HTML report: git and npm version drift, C...
<!-- aos:skill-catalogue:end -->
