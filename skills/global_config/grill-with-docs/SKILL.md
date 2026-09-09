---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also builds the project's domain model — glossary and ADRs — as it goes. Use in a working directory whenever an idea needs sharpening.
category: engineering-method
disable-model-invocation: true
---

<!-- Source: mattpocock/skills skills/engineering/grill-with-docs — MIT, see THIRD_PARTY_NOTICES.md -->

Invoke two skills and run them together: `grilling` and `domain-modeling`.

Neither is restated here. `grilling` supplies the interview — design tree, frontier rounds, numbered questions with a recommended answer each. `domain-modeling` supplies the discipline that runs underneath it: challenging terms against the glossary, sharpening fuzzy language, stress-testing relationships with concrete scenarios, and writing what is settled into `CONTEXT.md` and `docs/adr/` **as it crystallises**, not batched at the end.

**Prefer this over `grill-me` whenever there is a repo to leave a trail in.** The interview is identical; the difference is whether the shared understanding survives the session. Use `grill-me` when there is no working directory, or when the outcome is a decision rather than a document.

## Handing off

Grilling produces a shared understanding, not an execution plan. When the frontier is empty, pick the pipeline the work actually needs:

- `/startcycle` — a straight run with file hand-offs; the usual choice
- `/startcycle-graph` — when the durable `state.json`, the Reviewer repair loop and human escalation earn their overhead
- `/startcycle-graph-user` — a throwaway 2–4 node fan-out, nothing persistent left behind

`/bdbrainstorm` and `/bdbmediastorm` run this interview as their own first step; do not run it twice.
