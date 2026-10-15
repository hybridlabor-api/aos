# Teamwork Project Prompt — Draft

> Status: Step 9 — Approved & Delegated
> Goal: Introduce context profiles (`full`, `orchestrator`, `worker`, `small`) to reduce session token costs
> Requested team: self / autonomous execution

Introduce context profiles across AOS (gateway presets, profile state, doctor detection, skill budget, hook caps, and docs).

Working directory: /Users/timrennings/dev/bdb-dev/aos-wt-ctx
Integrity mode: development

## Requirements

### R1. Gateway Presets per Context Profile
Define/map gateway presets corresponding to context profiles (`full`, `orchestrator`, `worker`, `small`).
`worker` and `small` expose a core set; media/creative upstreams (davinci, unreal, blender, grandma3, touchdesigner, after effects, resolume, rhino, vectorworks) are opt-in. Document harness selection mechanism.

### R2. Context Profile State & CLI
Add `context` setting to AOS profile state (default `full`).
Add prompt/choice in `aos setup` and Settings entry.
Add `aos context` status command printing the current context profile and token estimate.

### R3. Skill Frontmatter Budget
Add validator check in `scripts/validate-skills.mjs` failing descriptions > 250 characters.
Shorten the worst offending skills in `skills/` under 250 chars while preserving trigger words.

### R4. SessionStart Hook Caps & Off-Switch
Cap `additionalContext` at 2000 chars in `aos-session-hint.mjs` and memB hook.
Add off switch via `AOS_SESSION_START_CONTEXT=off`.

### R5. Duplicate Agent Detection in `aos doctor`
Detect when `~/.claude/agents` mirrors plugin agents and report in `aos doctor` without deleting.

### R6. Documentation
Author `docs/context-profiles.md` detailing profile behaviors, measured vs estimated token counts, and what is not possible on Claude Code.

### R7. Verification & Tests
Write tests for R2, R3, R4 and verify clean execution with sandbox.

## Acceptance Criteria
- [ ] R1: Gateway presets defined for context profiles with media upstreams excluded from worker/small
- [ ] R2: `aos context` and profile setting tested and functional
- [ ] R3: `npm run validate` enforces <= 250 chars and passes on all skills
- [ ] R4: `AOS_SESSION_START_CONTEXT=off` and 2000 char cap implemented and tested
- [ ] R5: `aos doctor` reports duplicate agents cleanly
- [ ] R6: `docs/context-profiles.md` written with explicit "Not possible" section
- [ ] R7: Unit tests pass in temp HOME
