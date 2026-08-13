# Autonomous Development Cycle Workflow (/startcycle)

This workflow defines the zero-prompting, multi-agent execution pipeline triggered after a `/bdbrainstorm` or `/grill-me` session.

---

## Process Architecture

### 1. Task Decomposition & Planning
- **Agent**: `Planner_Orchestrator`
- **Action**: Parses the session output (markdown), breaks down requirements into discrete, atomic execution items.
- **Output**: Writes `production_artifacts/00_execution_plan.md`.

---

### 2. Parallel & Isolated Execution (State Hand-off)
The Harness spawns sub-agents in parallel/isolated contexts. Agents communicate exclusively via file hand-offs in `production_artifacts/`.

- **Frontend Stream**:
  - **Agent**: `Godmode_UI_UX`
  - **Action**: Reads `00_execution_plan.md`, designs responsive UI components using StyleSeed / anti-slop guidelines.
  - **Output**: Writes `production_artifacts/01_frontend_spec.md` & code to `app_build/src/components/`.

- **Backend & Database Stream**:
  - **Agent**: `Godmode_Engineering`
  - **Action**: Reads `00_execution_plan.md`, implements DDD models, type-safe ORM schemas, and REST/tRPC routes.
  - **Output**: Writes `production_artifacts/02_backend_schema.md` & code to `app_build/src/server/`.

- **Media & EventTech Stream (If Applicable)**:
  - **Agent**: `Godmode_Media_EventTech`
  - **Action**: Reads `00_execution_plan.md`, generates TouchDesigner TOX/GLSL scripts, Unreal blueprints, or DMX fixture mappings via MCPs.
  - **Output**: Writes `production_artifacts/03_media_pipeline.md`.

---

### 3. Verification & Quality Gate
- **Agent**: `Godmode_Shipping`
- **Action**:
  1. Runs typechecks and linters (`npm run lint` / `tsc --noEmit`).
  2. Runs Playwright webapp verification tests (`webapp-testing`).
  3. Audits accessibility (`wcag-audit-patterns`) and SEO signals (`seo-audit`).
- **Checkpoint**: Must achieve `Status: SUCCESS` before final release tag.
- **Output**: Writes `production_artifacts/04_release_report.md`.
