---
description: "Run a prompt repeatedly on an interval, using the harness built-in plus loop templates."
---

Use the built-in `/loop <interval> <prompt>` (omit the interval to self-pace). Offer a `loop-templates` template when the human has no prompt yet. Safety: a loop prompt never issues a GO, never types or runs `gogate`, never sets a mode or grant, and never merges, pushes or publishes unless a valid grant covers the action. Act on a guarded step only if the human's immediately preceding message is a literal GO or a valid grant covers it; a loop iteration never satisfies the first condition, so it must STOP and report instead of continuing a blocked guarded step. Templates (CI until green, follow a PR to merge, review rounds until no blockers, daily session summary) live in the `loop-templates` skill with run and duration limits and a stop condition each. Arguments: $ARGUMENTS
