---
name: grill-with-docs
description: Interview to sharpen plan/design and build domain model. Glossary and ADRs while grilling.
category: engineering-method
---

<!-- Source: mattpocock/skills skills/engineering/grill-with-docs — MIT, see THIRD_PARTY_NOTICES.md -->

Invoke two skills and run them together: `grilling` and `domain-modeling`.

Neither is restated here. `grilling` supplies the interview — design tree, frontier rounds, multiple-choice questions with a recommended answer each (`AskUserQuestion` in Claude Code, numbered options in chat on harnesses without it). `domain-modeling` supplies the discipline that runs underneath it: challenging terms against the glossary, sharpening fuzzy language, stress-testing relationships with concrete scenarios, and writing what is settled into `CONTEXT.md` and `docs/adr/` **as it crystallises**, not batched at the end.

**Prefer this over `grill-me` whenever there is a repo to leave a trail in.** The interview is identical; the difference is whether the shared understanding survives the session. Use `grill-me` when there is no working directory, or when the outcome is a decision rather than a document.

## Handing off

Grilling produces a shared understanding, not an execution plan. When the frontier is empty, pick the pipeline the work actually needs:

- `/fabric` — picks the fitting mode for you; the usual choice
- `/fabric-graph` — when the durable `state.json`, the Reviewer repair loop and human escalation earn their overhead
- `/fabric-multigraph` — a throwaway 2–4 node fan-out, nothing persistent left behind

`/bdbrainstorm` and `/bdbmediastorm` run this interview as their own first step; do not run it twice.
