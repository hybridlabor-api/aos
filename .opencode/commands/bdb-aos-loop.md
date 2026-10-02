---
description: "Run a prompt repeatedly on an interval, using the harness built-in plus loop templates."
---

OpenCode has no built-in loop. Use `opencode-loop`, the opt-in package (AOS_OPENCODE_OPTIONAL=loop, see docs/opencode-setup.md); without it, say so and stop. Do not schedule gated commands through its shell loop. Offer a `loop-templates` template when the human has no prompt yet. Safety: a loop prompt never issues a GO, never types or runs `gogate`, never sets a mode or grant, and never merges, pushes or publishes without an existing valid grant or the human's GO. Templates (CI until green, follow a PR to merge, review rounds until no blockers, daily session summary) live in the `loop-templates` skill with run and duration limits and a stop condition each. Arguments: $ARGUMENTS
