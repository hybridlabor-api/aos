---
description: "Run a prompt repeatedly on an interval, using the harness built-in plus loop templates."
---

Unverified, no loop mechanism confirmed for agy. Manual repeat: fill a `loop-templates` template, re-send it yourself at each interval, and stop at its limits or stop condition. Safety: a loop prompt never issues a GO, never types or runs `gogate`, never sets a mode or grant, and never merges, pushes or publishes without an existing valid grant or the human's GO. Templates (CI until green, follow a PR to merge, review rounds until no blockers, daily session summary) live in the `loop-templates` skill with run and duration limits and a stop condition each. Arguments: whatever the user wrote after the command name
