---
name: teamwork-preview
description: Interactive 9-step prompt crafting and delegation protocol for autonomous multi-agent teams. Enforces objective verification, integrity modes, and acceptance criteria across Antigravity, Claude Code, Cursor, OpenCode, Codex, and Roo Code.
---

# 🤝 Teamwork Preview — Multi-Agent Prompt Crafting & Delegation

A structured, harness-neutral workflow to turn high-level user ideas into robust, objectively verifiable multi-agent project specifications and delegate them cleanly to execution swarms.

Two-phase workflow:
1. **Interactive Prompt Crafting (Steps 1–9)**: Iteratively define project goals, eliminate ambiguity, select integrity modes, and enforce objective verification mechanisms.
2. **Delegation**: Hand off the validated specification to the target multi-agent team or execution harness.

---

## 🧭 Core Principles

| # | Principle | Rule |
|---|---|---|
| 1 | **Specify What, Not How** | Define requirements and acceptance criteria. Never prescribe implementation details (file structure, algorithms, libraries) unless the user explicitly mandates them. |
| 2 | **Objective Verification** | Every requirement needs an independent verification mechanism. Programmatic verification (tests, assertion scripts, CLI benchmarks) is preferred; explicit agent-as-judge rubrics are accepted when programmatic testing is impossible. |
| 3 | **Acceptance Criteria = Guardrails** | Acceptance criteria serve as the quality bar to prevent premature self-certification of incomplete or broken work. |
| 4 | **Minimal Requirements** | Only specify what the user explicitly cares about. Give the agent team maximal solution space. |

---

## 📋 Artifact-Based Workflow

Maintain a **prompt draft artifact** (`prompt_draft.md`) throughout the interaction. It provides real-time visibility to the user and tracks step progression.

```markdown
# Teamwork Project Prompt — Draft

> Status: Step 1 — Eliciting project idea
> Goal: Craft prompt → get user approval → delegate
> Requested team: [none — routes automatically from description]

[Project description — 1-2 sentences]

Working directory: [TBD]
Integrity mode: [development | demo | benchmark]

## Requirements

### R1. [TBD]

### R2. [TBD]

## Acceptance Criteria

### [Category]
- [ ] [Objective condition checkable without subjective bias]

---
*Next: when approved → delegate via execution protocol*
```

---

## 🔄 The 9-Step Interactive Workflow

### Step 1: Elicit the Idea
- Ask: What do you want to build? What is the purpose (production, demo, eval, prototype)? Who is the audience?
- Condense into a 1–2 sentence project description.
- Initialize `prompt_draft.md` and set status to Step 2.

### Step 2: Identify Ambiguity & Scale
- Probe points with multiple reasonable interpretations (data sources, third-party services, scope limits).
- Ask about effort and team scale:
  - **Single self-contained fix/feature**: Keep focused (one implementer + repeated adversarial review). Prefix prompt: *"This is a single self-contained fix; keep it small and focused."*
  - **Math, formal proofs, or massive search**: Offer standard pipeline vs. large-scale team. If large-scale selected, prefix prompt: *"Use a very large team of agents."*
  - **Standard multi-agent build**: Standard workflow routes from task description.

### Step 3: Determine Integrity Mode
Clarify operational boundaries:
- Can code be copied from existing open-source projects?
- Are pre-built external libraries permitted for core logic?
- Can test implementations be inspected before coding?
- **Mapping**:
  - Unrestricted / default → `integrity_mode: development`
  - Some shortcuts allowed (demo showcase) → `integrity_mode: demo`
  - Strict isolation / zero external leakage → `integrity_mode: benchmark`

### Step 4: Draft Requirements (R1, R2, ...)
- Write 2–5 concise requirement blocks.
- Focus strictly on **what** is required, not **how** to implement it.
- Apply litmus test: *"Would a senior engineer feel over-constrained by this requirement?"* If yes, prune.

### Step 5: Design Verification Mechanisms (Forcing Function)
> **Why this matters:** Verification is a forcing function. Its job is to create an objective test target that forces a genuine build → test → debug loop and prevents premature self-certification.

- Design programmatic tests where feasible (unit test suites, test runners, CLI assertion scripts).
- If programmatic tests are not feasible, draft an explicit agent-as-judge scoring rubric.
- Inquire whether the user has existing test suites, schemas, or reference implementations to include in a `## Verification Resources` section.

### Step 6: Set Acceptance Criteria
- Convert verification mechanisms into checkable markdown checkboxes (`- [ ]`).
- Calibrate strictly to the project purpose:
  - Demo: Achievable within rapid time budget.
  - Production: Full test coverage, strict error handling, production readiness.
  - Eval: Strict reproducible metrics over polish.

### Step 7: Infrastructure Constraints (If Applicable)
- Define sandboxing or controlled APIs for remote file operations, job launching, and external network calls.
- Skip if the project operates purely within local workspace files.

### Step 8: Choose Working Directory
- Confirm the target working directory (default: `~/teamwork_projects/{project_name}` or a relative path in the current repo).
- Record as `Working directory: <path>` at top of prompt draft.

### Step 9: Assemble, Validate & Seek Approval
Assemble the final structured prompt:

```markdown
[1-2 sentence project description]

Working directory: <path>
Integrity mode: [development | demo | benchmark]
[Optional: Team scaling directive]

## Requirements

### R1. [Primary Deliverable]
[What it does, not how to build it]

### R2. [Secondary Deliverable]
[What it does, not how to build it]

## Acceptance Criteria

### [Category]
- [ ] [Objective condition checkable without subjective bias]
```

**Pre-flight Checklist:**
- [ ] No unsolicited implementation hints (file structures, algorithms).
- [ ] Every acceptance criterion is objectively verifiable.
- [ ] Scope matches actual user needs.
- [ ] Team scale directive included if requested in Step 2.

Seek explicit approval from the user before triggering execution.

---

## 🚀 Delegation Protocol

Once approved by the user:

### 1. In Antigravity Harness
If running in Google Antigravity with native subagent support:
- Call `invoke_subagent`:
  - `TypeName`: `teamwork_preview`
  - `Role`: `Teamwork Coordinator`
  - `Prompt`: Full prompt content from `prompt_draft.md`
- Set artifact status to `Launched`.

### 2. In Other Agent Harnesses
- **Claude Code**: Feed the finalized prompt to dynamic workflows or dispatch via `/startcycle-graph` / subagents.
- **Cursor / Windsurf**: Inject the prompt into composer or project rules context.
- **OpenCode / Codex CLI**: Pass the prompt to `opencode run` or Codex runner.
