---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
category: engineering-method
---

<!-- Source: mattpocock/skills skills/productivity/grilling — MIT, see THIRD_PARTY_NOTICES.md -->

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: multiple choice, with your recommended answer marked. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs>

  - **A.** <plain-language option>
  - **B.** <plain-language option>
  - **C.** <plain-language option>

➡️ Recommended: A — <one-line why>

---

❓ **Q2** - **<question title>**: <question body>

  - **A.** <plain-language option>
  - **B.** <plain-language option>

➡️ Recommended: B — <one-line why>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

## In AOS

This is the primitive. Two skills compose it, and neither duplicates it:

- **`grill-me`** — the interview alone. Use without a working directory, or when the output is a decision rather than a document.
- **`grill-with-docs`** — the interview plus `domain-modeling`, leaving a paper trail. Prefer it whenever there is a repo to leave one in.

Grilling produces a shared understanding, not a plan. Once the frontier is empty, hand off to whichever pipeline the work actually needs — `/fabric` for a straight run, `/fabric-graph` when the durable record and repair loop earn their overhead, `/fabric-multigraph` for a throwaway fan-out. `/bdbrainstorm` and `/bdbmediastorm` invoke this skill as their own interview step rather than restating it.

Ask every decision round as **multiple choice** with plain-language options and the recommendation marked — never as an open essay prompt. In Claude Code, ask the round through the `AskUserQuestion` tool: at most **4 questions per call**, each with 2–4 plain-language options and the recommended option first. Inside a plan builder plan, ask the same questions as a `<QuestionForm>` component. On harnesses without `AskUserQuestion`, ask the same numbered options in chat. The user may always answer in prose, pick several options at once, or correct the options — treat that as a normal answer and let it reshape the tree.

**When the grilling ends in a written plan,** open it in plan-canvas with the planning mode resolved by the rules in the `plan-canvas` skill ("Planning mode choice"): `bdb-plan-builder` whenever it is available (it is the default when detected), `standard` only as fallback when it is not. Do not ask which mode to use.
