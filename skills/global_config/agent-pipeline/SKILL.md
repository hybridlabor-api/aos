---
name: agent-pipeline
description: Use when defines the 6-stage BDB Software Engineering Pipeline (DEFINE, PLAN, BUILD, VERIFY, REVIEW, SHIP) with corresponding slash commands (/spec, /plan, /build, /test, /review, /ship) and autonomous orchestrator /startcycle.
category: bdb-core
---

# 🔄 BDB Software Engineering Pipeline

When orchestrating or executing software development, AI agents MUST follow the 6-stage lifecycle pipeline.

```
DEFINE          PLAN           BUILD          VERIFY         REVIEW          SHIP
 ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐
 │ Idea │ ───▶ │ Spec │ ───▶ │ Code │ ───▶ │ Test │ ───▶ │  QA  │ ───▶ │  Go  │
 │Refine│      │  PRD │      │ Impl │      │Debug │      │ Gate │      │ Live │
 └──────┘      └──────┘      └──────┘      └──────┘      └──────┘      └──────┘
  /spec          /plan          /build        /test         /review       /ship
 └─────────────────────────────────────────────────────────────────────────────┘
                        🚀 Master Macro: /startcycle
```

---

## ⚡ Autonomous Orchestration: `/startcycle`
To run the entire pipeline autonomously across a multi-agent team without manual step-by-step prompts, invoke:
```bash
/startcycle
```
`/startcycle` automatically assigns:
- **Stages 1 & 2 (DEFINE + PLAN):** `Planner_Orchestrator` ➔ `production_artifacts/00_execution_plan.md`
- **Stage 3 (BUILD):** `Godmode_UI_UX`, `Godmode_Engineering`, `Godmode_Media_EventTech`
- **Stages 4 & 5 (VERIFY + REVIEW):** `Godmode_Shipping` ➔ `production_artifacts/04_release_report.md`
- **Stage 6 (SHIP):** `openwiki-skill` (wiki sync) + `memb-ingest` (vector memory)

---

## 📌 Individual Pipeline Stages & Slash Commands

### 1. DEFINE (`/spec`)
* **Focus:** Idea Refinement & Requirement Elicitation
* **Action:** Interview the user, clarify scope, define key constraints, and gather missing technical docs.
* **Output:** User Stories, Scope Boundaries, and Spec RFCs.

### 2. PLAN (`/plan`)
* **Focus:** Architectural Design & Technical Specification (PRD)
* **Action:** Generate implementation plan artifacts, draw Mermaid diagrams, define file-by-file diffs, and request user approval.
* **Output:** Approved Implementation Plan Artifact (`<plan_name>.md`).

### 3. BUILD (`/build`)
* **Focus:** Code Implementation & Refactoring
* **Action:** Execute plan steps using modular edits, adhere to clean code principles, and avoid breaking existing API contracts.
* **Output:** Functional codebase modifications & newly created components.

### 4. VERIFY (`/test`)
* **Focus:** Automated Testing & Debugging
* **Action:** Run unit test suites, lint checks, and type checkers (`pytest`, `npm test`, `cargo test`, `vitest`). Inspect runtime logs upon failure.
* **Output:** Verified test run outputs (100% green build status).

### 5. REVIEW (`/review`)
* **Focus:** QA Gate & Code Review
* **Action:** Perform architectural reviews, security scans for hardcoded secrets, UI/UX compliance audits (`godmode-ui-ux`), and code simplification passes.
* **Output:** Code review summary & QA gate approval.

### 6. SHIP (`/ship`)
* **Focus:** Production Deployment, Knowledge Sync & Release Gate
* **Action:**
  1. **Pre-Push Sanitization (`github-repo`):** Audit for absolute local paths, usernames, and uncommitted secrets.
  2. **Codebase Wiki Sync (`openwiki-skill`):** Scan git diff, update `.openwiki/` (`architecture.md`, `release_notes.md`, `quickstart.md`), and refresh `README.md`.
  3. **Memory Engine Feeding (`memb-ingest`):** Feed updated docs and architecture into the local memB vector brain (`~/.MemBDB/`) via `memb-mcp` or `memb_ingest.py`.
  4. **Release Deployment:** Take git snapshot, commit structured changes, push to private remote repository, and trigger deployment/release tags.
* **Output:** Live deployment confirmation, synced `.openwiki/` release notes, and refreshed memB long-term memory.

## 1. Overview
This skill provides domain-specific logic and rules for its respective BDB pipeline component to ensure standardization across multi-agent workflows.

## 2. When to Use
- Use when specifically requested by the user or triggered by an orchestration agent.
- Use when the current task aligns with the skill's domain.
- Exclude when standard tool execution is sufficient.

## 3. Core Process
1. Read the provided context and ensure preconditions are met.
2. Run the required script or tool and confirm the state change.
3. Verify exit codes, file modifications, or DB counts to guarantee success before reporting completion.

## 4. Common Rationalizations
| Rationalization | Reality |
|---|---|
| "The code change was small, so I skipped updating OpenWiki docs." | Every state change must be reflected in the relevant system records. |
| "The ingest script exited without an error, so the memB index must be updated." | Silent failures happen; explicit verification of the side effect is mandatory. |
| "I'll let the /startcycle proceed without a defined rollback path." | Proceeding without a rollback path corrupts the workflow integrity and safety. |
| "I trust the cached agent registry instead of rescanning after a skill change." | Caches stale out quickly; explicit rescans prevent ghost failures. |

## 5. Red Flags
- Bypassing the verification step after a script execution.
- Proceeding to the next pipeline stage without confirming the previous stage's side effects.
- Ignoring domain-specific constraints listed in this skill.

## 6. Verification
- [ ] Verified script exit codes are explicitly checked.
- [ ] Confirmed target files or database records reflect the expected change.
- [ ] Ensured no silent failures were ignored before reporting success.
