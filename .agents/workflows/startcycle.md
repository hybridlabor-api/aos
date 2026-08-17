# Autonomous Development Cycle Workflow (/startcycle)

This workflow defines the zero-prompting, multi-agent execution pipeline triggered after a `/bdbrainstorm` or `/grill-me` session.

---

## Process Architecture

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

## 1. Task Decomposition & Planning
- **Agent**: `Planner_Orchestrator`
- **Action**: Parses the session output (markdown), breaks down requirements into discrete, atomic execution items across frontend, backend, and media streams.
- **Output**: Writes `production_artifacts/00_execution_plan.md`.

---

## 2. Parallel & Isolated Execution (State Hand-off)
The Harness spawns sub-agents in parallel/isolated contexts. Agents communicate exclusively via file hand-offs in `production_artifacts/`.

- **Frontend Stream**:
  - **Agent**: `Godmode_UI_UX`
  - **Action**: Reads `00_execution_plan.md`, designs responsive UI components using DTCG tokens and Anti-Slop guidelines.
  - **Output**: Writes `production_artifacts/01_frontend_spec.md` & code to `frontend/src/` or `app_build/src/components/`.

- **Backend & Database Stream**:
  - **Agent**: `Godmode_Engineering`
  - **Action**: Reads `00_execution_plan.md`, implements DDD models, type-safe ORM schemas, and REST/tRPC routes.
  - **Output**: Writes `production_artifacts/02_backend_schema.md` & code to `backend/src/` or `app_build/src/server/`.

- **Media & EventTech Stream (If Applicable)**:
  - **Agent**: `Godmode_Media_EventTech`
  - **Action**: Reads `00_execution_plan.md`, generates TouchDesigner TOX/GLSL scripts, Unreal blueprints, or DMX fixture mappings via MCPs.
  - **Output**: Writes `production_artifacts/03_media_pipeline.md`.

---

## 3. Verification & Quality Gate
- **Agent**: `Godmode_Shipping`
- **Action**:
  1. Runs typechecks and linters (`npm run lint` / `tsc --noEmit`).
  2. Runs Playwright webapp verification tests (`webapp-testing`).
  3. Audits accessibility (`wcag-audit-patterns`) and SEO signals (`seo-audit`).
- **Checkpoint**: Must achieve `Status: SUCCESS (100% Green)` before final release.
- **Output**: Writes `production_artifacts/04_release_report.md`.

---

## 4. Production Release & Knowledge Sync (`/ship`)
- **Action**:
  1. `openwiki-skill`: Scans git diff, updates `.openwiki/architecture.md`, `.openwiki/release_notes.md`, and updates `README.md`.
  2. `memb-ingest`: Ingests updated documentation and schema files into local memB vector memory.
  3. Git snapshot, commit, push to private repository.
