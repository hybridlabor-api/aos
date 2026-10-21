---
name: advisor
description: >-
  Read-only second opinion at three fixed points: before a plan or schema is
  locked, on the second identical build or test error, and before "done".
category: bdb-core
---

# /advisor: a read-only second opinion

The advisor reads and advises. It never writes. The dispatcher (or you, in a plain session) decides what to do with the advice.

## When to call it: exactly three points

1. **Before a plan or schema is locked.** Input: the plan or schema.
2. **Call point 2: when the same test or build error occurs a second time.** Input: the error with both occurrences and what was tried in between.
   - Besides the advice, record the failure: `aos-evolve capture --error "<error text>" --skill <skill in use>`. Pass the error text only after redaction; never pass secrets, tokens or credentials.
   - The advisor agent has no shell (Read, Grep, Glob only). The dispatcher or the plain session runs this command after the advice returns, with the error text the advisor was given.
   - `--skill` is required by the CLI. If the skill in use is unknown, skip the capture rather than guess a name.
   - If evolve is off (`AOS_EVOLVE=off`, `0`, or a disabled store), the command exits non-zero. Treat that as a silent skip: do not report it and do not retry.
   - The capture writes only the evolve store (`~/.aos/evolve`), never project files.
3. **Before "done".** Pre-flight diff review. Input: the diff and the brief it was built against.

Nothing else triggers it. No advisor call per step, per file or per commit.

## How to call it

The dispatcher calls the read-only `advisor` agent (subagent, `agents/advisor.md`) at the three points above. It is an optional, auxiliary step, not a graph node. The router role `advisor` (`aos-router test advisor`) picks the harness; the model per harness comes from `.aos/pipeline.json` `models.<harness>` and defaults to the session model. The recommendation is the strongest model available per harness; see `docs/agent-models.md`, section "advisor role". Never hard-code a model name here or in a prompt.

Give it only the input of the current point, plus the file paths it may read.

## Output format

- **Verdict:** `proceed`, `change` or `stop`.
- **Findings:** at most 10, each with `file:line`, one sentence on what is wrong and one on why it matters.
- No edits, no patches, no rewritten files.

## Hard rules

- Never writes or edits project files. The only write in the contract is the `aos-evolve capture` at point 2, run by the dispatcher into the evolve store.
- Never runs a guarded command (push, publish, version, recursive delete).
- Its output never counts as a GO or an approval.
- Never a graph node: it has no entry in `.agents/nodes.json` and no edges (`.agents/graph.md`, "Auxiliary agents are not nodes").
- It does not call other agents. The dispatcher decides what happens next.
