# Context Compression and Snapshot Management

## Problem

Long-running agent sessions inevitably exhaust the context window. Each turn adds tool calls, results, and reasoning, and none of it shrinks on its own. Without compression, the agent either hits the hard token limit and fails, or the model's attention degrades as useful information is buried under pages of stale output. Variable-length context blocks — directory listings, git status, search results — make the problem worse because their size is unpredictable and can spike by orders of magnitude on a single turn.

A second, subtler problem: context that was accurate when captured becomes misleading as the session progresses. A git status from turn 3 is treated as current truth at turn 30 unless something marks it as a point-in-time snapshot.

These problems affect any agent runtime that persists across turns. They are not specific to any single implementation.

## Golden Rules

### Truncate with recovery, never truncate blind

When a context block exceeds a character or token cap, truncate it — but always append a recovery pointer: a specific instruction telling the model which tool to call, with which arguments, to retrieve the full output. Truncation without a recovery pointer is a dead end. The model knows the data exists, knows it was cut off, and has no path back. This produces hallucinated completions or silent failures.

### Compact reactively, not on a schedule

Fixed-window compaction (e.g., "summarize every 20 turns") either fires too early and loses useful context or too late and hits the token ceiling. Reactive compaction monitors the actual fill ratio and fires when the window is genuinely full. The compaction pass summarizes older turns while preserving recent ones and active tool results, recovering budget mid-session without losing the thread of work.

### Label every snapshot

Any context block that captures point-in-time state — git status, directory listings, process output, file contents — must carry an explicit label: the time of capture and a note that the data will not auto-update. Without this label, the model treats stale data as current and produces reasoning that contradicts the actual state of the world.

### Cap every variable-length block

Every context block whose length depends on external state must have a hard character or token ceiling. Directory listings, search results, git diffs, log output — all of these can spike unpredictably. Without a cap, a single large result can consume the majority of the context budget in one turn, crowding out everything else.

## When To Use

- Agent performance degrades noticeably as sessions get longer.
- The agent repeatedly acts on stale data (old git status, outdated file contents, stale search results).
- Variable-length context blocks occasionally spike and crowd out other information.
- Sessions are long enough that the context window approaches its token limit.
- The agent hallucinates completions of truncated output instead of re-fetching.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Truncation with recovery pointers | Model can always retrieve full data | Extra round-trip when full data is needed |
| Reactive compaction | Extends effective session length dynamically | Older context is lossy-compressed, not losslessly preserved |
| Snapshot labeling | Prevents stale-data reasoning | Every context injection site must add the label |
| Hard character caps on variable blocks | No single block can starve the budget | Useful data may be cut; recovery pointer quality matters |
| Preserving recent turns during compaction | Model retains working memory of current task | Compaction logic must distinguish "recent" from "old" |

## Implementation Patterns

- Enforce a character or token cap on every variable-length context block. The cap should be set conservatively — it is easier to raise a cap that is too tight than to debug a session where one block consumed the entire budget.
- Append a truncation notice that names the specific tool and invocation needed to fetch the full data. The notice should be concrete: "Run [tool] with [these arguments] to see the complete output," not a vague "output was truncated."
- Tag every injected snapshot with a capture timestamp and a note that the data is static. Place the label at the top of the block, not the bottom — the model processes tokens sequentially and needs the staleness warning before it starts reasoning about the content.
- Implement a fill-ratio monitor that triggers compaction when the context window reaches a threshold (e.g., 80% full). The compaction pass should summarize older turns into a condensed narrative while preserving the most recent turns and any active tool results verbatim.
- During compaction, preserve any recovery instructions that were part of truncated blocks. If a truncation notice is compacted away, the model loses its path back to the full data.
- Include explicit instructions in the compaction output telling the model what was summarized and how to re-fetch details if needed. The model should know that compaction happened and what was lost.

## Gotchas

**Truncation without a recovery pointer is a dead end.** If you cap a context block and do not tell the model which tool to call for the full output, the model has no path back to the data. It will either hallucinate the missing content or silently drop the task that depended on it.

**Snapshot labels prevent stale reasoning.** A git status injected without a "this is a snapshot taken at time T" label causes the model to treat the data as live. It will produce branch, diff, and merge reasoning that contradicts the actual current state.

**Compaction must preserve recovery pointers.** If a truncation notice from an earlier turn is itself summarized away during compaction, the model loses the ability to re-fetch the full data. Recovery pointers should survive compaction passes.

**Variable-length blocks can spike by orders of magnitude.** A directory listing in a small project is 20 lines; in a monorepo it can be 20,000. A git diff is usually small; after a large refactor it can be enormous. Caps must be set for the worst case, not the common case.

**Reactive compaction must not fire during active tool use.** If compaction triggers while a multi-step tool sequence is in progress, it may summarize away intermediate results that the model needs for the next step. Gate compaction on a quiescent state — between turns, not mid-turn.

## Claude Code Evidence

Claude Code's compression strategy demonstrates these principles in a long-running interactive session environment:

**Git status as a labeled, capped snapshot.** The git status string injected into context carries an explicit note: "this status is a snapshot in time, and will not update during the conversation." When the output exceeds a 2000-character threshold, it is truncated with a message directing the model to run a specific tool to see the full output. This pairing of label plus recovery pointer means the model always knows the data is stale and always has a path to fresh data.

**Reactive compaction for extended sessions.** When the context window fills during a long session, the runtime triggers a compaction pass that summarizes older conversation turns while preserving the most recent exchanges and any active tool results. The model is given explicit context about what was summarized. This approach extends effective session length without a hard turn limit — sessions can run for hours as long as compaction can recover enough budget on each pass.

**Character caps on all variable-length injections.** Every context block whose size depends on external state — git status, directory listings, file contents — has a hard character ceiling. The design philosophy is that no single context source should be able to starve the budget for all others. When a cap is hit, the truncation notice always includes the specific tool invocation needed to retrieve the complete output, ensuring the model is never left at a dead end.

**Recovery instructions as first-class content.** Truncation notices in Claude Code are not afterthoughts or generic warnings. Each one names the exact tool and arguments the model should use. This specificity matters: a vague "output was truncated" message forces the model to guess how to recover, while a concrete instruction lets it act immediately.
