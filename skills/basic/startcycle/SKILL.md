---
name: startcycle
description: Autonomous multi-agent development cycle pipeline triggered after /bdbrainstorm or /grill-me. Orchestrates Planner, UI/UX, Engineering, Media/EventTech, and Shipping agents with deterministic production_artifacts hand-offs and automated openwiki + memB sync.
---

# 🚀 BDB Autonomous Development Cycle (`/startcycle`)

The `/startcycle` workflow is the autonomous, multi-agent execution pipeline of the BDB ecosystem. It translates high-level specifications and brainstorming results into fully implemented, tested, documented, and production-ready code without manual prompt-chaining.

```
                  ┌──────────────────────────────────────────────┐
                  │ 1. BRAINSTORM & SPECIFICATION                │
                  │    (/bdbrainstorm / /grill-me)               │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 2. AUTONOMOUS CYCLE (/startcycle)            │
                  │    • Task Decomposition & Architecture       │
                  │    • Parallel Frontend/Backend/Media Streams │
                  │    • Verification & Quality Gate             │
                  └──────────────────────┬───────────────────────┘
                                         │
                        ┌────────────────┴────────────────┐
                        ▼                                 ▼
         ┌───────────────────────────────┐ ┌──────────────────────────────┐
         │ 3a. OPENWIKI (.openwiki/)     │ │ 3b. MEMB VECTOR & VAULT       │
         │     • quickstart.md           │ │     • SQLite Vector Embeddings│
         │     • architecture.md         │ │     • AI-Vault: God_Mode.md   │
         │     • release_notes.md        │ │     • Triggered via ingest.py │
         └──────────────┬────────────────┘ └──────────────┬────────────────┘
                        │                                 │
                        └────────────────┬────────────────┘
                                         │
                                         ▼
                  ┌─────────────────────────────────────────────┐
                  │ 4. PERSISTENT AGENT MEMORY & RETRIEVAL       │
                  │    • agent.md / CLAUDE.md ──▶ .openwiki      │
                  │    • search_memory Tool ──▶ memB             │
                  └──────────────────────────────────────────────┘
```

---

## 📋 Deterministic 4-Phase Pipeline

### Phase 1: Task Decomposition & Planning
- **Agent Role**: `Planner_Orchestrator`
- **Model**: `Claude 3.5 Sonnet` / `Gemini 1.5 Pro` / `GPT-4o`
- **Action**:
  1. Ingests session output, RFC, or brainstorming summary.
  2. Breaks down requirements into atomic execution tasks across domain streams.
  3. Defines explicit dependency graphs and data contracts between streams.
- **Output Artifact**: `production_artifacts/00_execution_plan.md`

---

### Phase 2: Parallel Stream Execution (State Hand-Off)
Sub-agents are executed in isolated contexts. All inter-agent data exchange happens strictly via files in `production_artifacts/`.

#### 🎨 Frontend Stream
- **Agent Role**: `Godmode_UI_UX`
- **Primary Skills**: `godmode-ui-ux`, `landing-page-generator`, `shadcn`, `tailwind-patterns`, `react-best-practices`, `ui-component`
- **Action**: Reads `00_execution_plan.md`, implements responsive UI components, enforces Anti-Slop rules, DTCG design tokens, and fluid motion physics.
- **Output Artifacts**: `production_artifacts/01_frontend_spec.md` & code to `frontend/src/` or `app_build/src/components/`.

#### ⚙️ Backend & Architecture Stream
- **Agent Role**: `Godmode_Engineering`
- **Primary Skills**: `godmode-engineering`, `software-architecture`, `test-driven-development`, `api-design-principles`, `drizzle-orm-expert`, `postgres-best-practices`, `typescript-pro`, `python-pro`
- **Action**: Reads `00_execution_plan.md`, implements DDD models, type-safe database schemas, business logic, and API routes.
- **Output Artifacts**: `production_artifacts/02_backend_schema.md` & code to `backend/src/` or `app_build/src/server/`.

#### 🎬 Media & EventTech Stream (If Applicable)
- **Agent Role**: `Godmode_Media_EventTech`
- **Primary Skills**: `godmode-eventtech`, `godmode-media-creation`, `godmode-3d-creation`, `bdbmediastorm`, `threejs-skills`, `spline-3d-integration`
- **Action**: Reads `00_execution_plan.md`, generates TouchDesigner TOX/GLSL networks, Unreal Engine blueprints, DaVinci Resolve color grades, or DMX/grandMA3 lighting layouts via MCP tools.
- **Output Artifacts**: `production_artifacts/03_media_pipeline.md`.

---

### Phase 3: Verification & Quality Gate
- **Agent Role**: `Godmode_Shipping`
- **Primary Skills**: `godmode-shipping`, `webapp-testing`, `seo-audit`, `wcag-audit-patterns`, `clean-code`, `github-repo`
- **Action**:
  1. Runs typechecks, linters, and unit test suites (`npm test`, `pytest`, `tsc --noEmit`).
  2. Runs Playwright browser automation tests for critical user flows.
  3. Verifies WCAG 2.1 AA accessibility and SEO meta signals.
  4. Audits codebase for hardcoded secrets and absolute file paths.
- **Gate Checkpoint**: Must achieve `Status: PASSED (100% Green)` before progressing to release.
- **Output Artifact**: `production_artifacts/04_release_report.md`.

---

### Phase 4: Production Release & Memory Sync (`/ship`)
Once Phase 3 passes:
1. **Wiki Sync (`openwiki-skill`)**: Scans git diff, updates `.openwiki/architecture.md`, `.openwiki/release_notes.md`, and updates root `README.md`.
2. **memB Memory Ingestion (`memb-ingest`)**: Automatically ingests newly created documentation, schemas, and patterns into local SQLite vector memory (`~/.MemBDB/`).
3. **Git Release**: Creates atomic commit, tags version, and pushes to private remote repository.

---

## 🛠️ Slash Command Invocation

To trigger the autonomous cycle in any supported agent harness (Antigravity, Roo Code, Claude Code, Cursor, Codex):

```bash
/startcycle
```

Or pass a specific focus area:
```bash
/startcycle frontend
/startcycle fullstack
/startcycle mediastorm
```
