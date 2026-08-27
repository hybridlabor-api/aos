---
name: bdbrainstorm
description: Combines multi-agent brainstorming, the /grill-me slash command, and the 3 Core Godmodes (godmode-engineering, godmode-ui-ux, godmode-shipping) to force a comprehensive, multi-agent ideation and technical design workflow, ending in a hand-off to /startcycle.
category: bdb-core
---

# BDBrainstorm: The Ultimate Multi-Agent Design & Ideation Workflow

When this skill is invoked or requested, you MUST orchestrate a comprehensive ideation and development workflow using a combination of multi-agent brainstorming, interactive user grilling, and strict adherence to the 3 Core Godmodes (`godmode-engineering`, `godmode-ui-ux`, `godmode-shipping`).

## Core Requirements & Workflow

You are strictly required to enforce the following 6 pillars in your process:

### 1. Multi-Agent Brainstorming
- Instead of brainstorming alone, you MUST spawn specialized subagents (using `invoke_subagent`) to discuss ideas, architecture, and features.
- Assign clear, distinct roles to subagents (e.g., "UI/UX Visionary", "Technical Architect", "Devil's Advocate") and have them debate and refine the concept before any code is written.

### 2. The `/grill-me` Approach
- Actively challenge the user's initial ideas.
- Initiate a `/grill-me` style interactive interview to uncover blind spots, resolve design decisions, and align on a robust plan. Do not accept vague requirements. Ask deep, targeted questions.

### 3. Target Folder Selection & Project Scaffolding
- After the brainstorming and grilling phase produces a solid conceptual plan, you MUST explicitly ask the user: *"In which folder, workspace, or project directory should the output artifacts (e.g., plan, README.md, AGENTS.md) be stored?"*
- Do NOT proceed to generate artifacts or write files until the user has confirmed the specific directory.
- **Crucial:** Once the directory is confirmed, and BEFORE starting the development phase, you MUST utilize the `openwiki-skill` and `github-repo` skills to initialize the directory, set up `AGENTS.md`, and generate the foundational project files.

### 4. Engineering Godmode (Clean Architecture)
- Once the conceptual plan is solid, you must strictly enforce `godmode-engineering` principles.
- Delegate specific implementation tasks to independent subagents using Domain-Driven Design (DDD). You act as the Master Orchestrator, reviewing their work to ensure it passes the 5-step debugging triage.

### 5. UI/UX Godmode (Anti-Slop Standards)
- Every user interface decision, wireframe, or component generated during this process MUST adhere to the `godmode-ui-ux` guidelines.
- Enforce high-agency frontend interfaces, strict design taste, calibrated color palettes, and modern typography. Do not settle for "MVP" aesthetics.

### 6. Shipping Godmode & Pipeline Hand-off
- Before the brainstorm concludes, verify that the plan satisfies the `godmode-shipping` rules (Spec-Driven Development, feature flags, rollback strategies).
- Present the aligned plan and hand off to `/startcycle` for execution — write `state.goal` from this session's output and let `/startcycle`'s dispatcher take it from there (see `.agents/graph.md`). This skill does not invoke `/startcycle`'s agents itself; it produces the goal they read.

## Execution Rules
1. **Never skip the debate:** Ideas must be contested by subagents and the user before finalization.
2. **Never build alone:** Always use subagents for implementation.
3. **Never accept ugly UI:** Always apply `godmode-ui-ux` rules.
4. **Never skip architecture & shipping checks:** Always enforce `godmode-engineering` and `godmode-shipping` constraints.
5. **Never dump artifacts blindly:** Always ask the user for the target project directory before creating the plan, README, or `AGENTS.md` files.

To begin the BDBrainstorm process, start by invoking the "grill-me" interview style to question the user's premise, while simultaneously spinning up 2-3 subagents to analyze the initial request from different angles. Once aligned, ask the user for the target directory before writing the project artifacts and spawning development subagents.
