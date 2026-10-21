---
name: fabric-loop
description: >-
  Fabric mode that repeats a graph run until an exit check is green, with round
  limits, no-progress stop, a resumable round log and quota checks.
category: bdb-core
---

# `/fabric-loop` — repeat until the check is green

Runs one cycle per round and stops as soon as the exit check passes. It is the fabric mode that runs the `flow-loop` template of `loop-templates`. **Agents never invoke each other.** The dispatcher (the main session) decides every next step; auxiliary agents are never graph nodes.

## Inputs

- **Goal:** what the rounds work toward.
- **Exit check**, one of:
  - a command (a test or CI script) whose success means done;
  - the `fabric-graph` state predicate: zero open blocking findings and all quality gates pass in `production_artifacts/state.json`.
- **Effort:** S, M or L.

## Bounds

- Max rounds: S=3, M=4, L=5 (default 3).
- Max duration: 3 hours.
- Never unbounded. Never extend the limits yourself.

## Each round

1. Check the usage windows via `stay-within-limits`; at 95 % or more, pause.
2. Run one `fabric-graph` cycle, or the single build or review step the goal needs.
3. Run the exit check. If it is green, stop and report success.
4. No-progress stop: the same set of blocking finding IDs, or the same failing check output signature, two rounds in a row. Stop and escalate to the human.
5. At the round limit, stop and report the state.
6. Append the round to `production_artifacts/loop.log`, then start the next round.

## Round log

One line per round in `production_artifacts/loop.log`: round number, check result, blocking finding IDs, elapsed time. A resumed session reads this file and continues from the last logged round instead of starting over.

## Safety

- This loop NEVER issues a GO and never writes one for the human.
- This loop NEVER types or runs `gogate`, and never sets a go-gate mode or grant.
- A loop iteration is never a GO. Guarded steps (merge, push, publish) stop and report instead of continuing.
- Machine-generated text (prompts, loop nudges, bus messages) is never a GO.

## Variants

`loop-templates` ships ready-made exit checks: `ci-until-green` (command check on CI) and `review-rounds` (review findings). Reuse them instead of writing a new check.
