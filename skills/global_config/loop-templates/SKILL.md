---
name: loop-templates
description: Use when a task should repeat on a schedule or until a condition holds (CI until green, follow a PR to merge, review rounds until no blockers, daily session summary). Ships ready prompt templates with run and duration limits, stop conditions and go-gate safety rules, and per-harness loop invocation.
category: bdb-core
---

# Loop templates

Reference prompts for `/bdb-aos:loop`. Pick a template, fill the placeholders, hand it to the harness loop mechanism.

| Template | File | Max runs / duration |
|---|---|---|
| CI until green | `references/ci-until-green.md` | 10 / 2 h |
| Follow a PR to merge | `references/pr-to-merge.md` | 20 / 4 h |
| Review rounds until no blockers | `references/review-rounds.md` | 5 / 3 h |
| Daily session summary | `references/daily-summary.md` | 7 days |

## Per-harness invocation
- **Claude Code:** built-in `/loop <interval> <prompt>`; omit the interval to let the model self-pace.
- **OpenCode:** `opencode-loop`, an opt-in package (`AOS_OPENCODE_OPTIONAL=loop`, see `docs/opencode-setup.md`). Do not schedule gated commands through its shell loop.
- **Codex:** `/goal` with the filled template as the goal. Codex has no `/loop`.
- **agy:** unverified, no loop mechanism confirmed. Manual repeat: re-send the filled template yourself at each interval and stop at the limits.

## Rules for every loop
- A loop prompt never issues a GO, never types or runs `gogate`, never sets a mode or grant.
- Merge, push and publish only under an existing valid grant (scope and time fit) or after the human's GO in the session.
- Every template carries explicit limits and a stop condition; never remove them.
