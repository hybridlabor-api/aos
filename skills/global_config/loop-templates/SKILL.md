---
name: loop-templates
description: Loop templates for repeating tasks. Schedule or condition-based. Duration limits, stop conditions, go-gate rules.
category: bdb-core
---

# Loop templates

Reference prompts for `/bdb-aos:loop`. Pick a template, fill the placeholders, hand it to the harness loop mechanism.

| Template | File | Max runs / duration |
|---|---|---|
| CI until green | `references/ci-until-green.md` | 10 / 2 h |
| Follow a PR to merge | `references/pr-to-merge.md` | 20 / 4 h |
| Review rounds until no blockers | `references/review-rounds.md` | 5 / 3 h |
| Flow loop (build/review) | `references/flow-loop.md` | 3-5 rounds (effort S/M/L) / 3 h |
| Daily session summary | `references/daily-summary.md` | 7 days |

## Flow loop (autonomous build/review)

The `flow loop` template (`references/flow-loop.md`) drives iterative build and review cycles for multi-agent workflows (run `/fabric-graph` in rounds via the harness loop mechanism):
- **Stop predicate**: halts on clean review (zero blocking findings and all quality gates pass).
- **Max rounds by effort**: capped at `max_iterations` derived from team effort (`S` = 3 rounds, `M` = 4 rounds, `L` = 5 rounds).
- **No-progress guard**: stops and escalates immediately if consecutive review rounds produce identical blocking finding IDs.
- **Stay-within-limits check**: inspects quota windows via `stay-within-limits` before each round; if usage >= 95%, halts in a persistent wait state.
- **Guarded commands**: never auto-run commands guarded by `go-gate` (e.g. `git push`, `npm publish`); requires explicit human `GO`.

## Per-harness invocation
- **Claude Code:** built-in `/loop <interval> <prompt>`; omit the interval to let the model self-pace.
- **OpenCode:** `opencode-loop`, an opt-in package (`AOS_OPENCODE_OPTIONAL=loop`, see `docs/opencode-setup.md`). Do not schedule gated commands through its shell loop.
- **Codex:** `/goal` with the filled template as the goal. Codex has no `/loop`. Codex /goal is unverified in AOS docs; confirm with `codex --help`.
- **agy:** unverified, no loop mechanism confirmed. Manual repeat: re-send the filled template yourself at each interval and stop at the limits.

## Rules for every loop
- A loop prompt never issues a GO, never types or runs `gogate`, never sets a mode or grant.
- Act on a guarded step (merge, push, publish) only if the human's immediately preceding message is a literal GO or a valid grant (scope and time fit) covers the action. A loop iteration never satisfies the first condition, so it must STOP and report instead of continuing a blocked guarded step.
- Every template carries explicit limits and a stop condition; never remove them.

## Plan review

When a loop produces a plan or updated artifact, open it in the Plan Canvas before acting on it:

1. Give the document's top-level heading a stable ID, e.g. `## Plan {#plan-id}`.
2. Run `aos-plan-canvas open <path-to-plan>.md`.
3. Run `aos-plan-canvas await <path-to-plan>.md` and wait for the human verdict.
4. Continue the loop only after an `approve` verdict.

*(If running in OpenCode, always print the Canvas URL in chat.)*
