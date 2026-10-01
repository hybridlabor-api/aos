# Context Engineering Pattern

## The Problem

Without deliberate management, context windows fill with redundant or stale data on every turn. Rebuilding expensive context on each invocation adds latency. Exposing the full capability catalog up front bloats every prompt. Delegated sub-agents pollute their parent's context with intermediate state. These are inherent to any agent that persists across turns and delegates to sub-agents.

## The Four-Axis Framework

Context engineering decomposes into four concerns:

1. **Select** -- decide what enters the context window, when, and at what granularity.
2. **Write** -- the agent does not just consume context; it writes back to persistent storage, creating the learning loop.
3. **Compress** -- long sessions exhaust the window; truncation, compaction, and snapshot labeling recover budget.
4. **Isolate** -- delegated work must not pollute or corrupt the parent's context or filesystem.

### A note on "Write"

The write axis is a cross-cutting principle rather than a standalone pattern. Every axis involves write-back: selections are cached and invalidated, compression produces summaries that are stored, isolation boundaries return results that the parent integrates. The write-back loop -- auto-memory, session extraction, persisted permissions, task state updates -- is what transforms a stateless tool-caller into a learning system. It is covered as a design principle in the main skill definition rather than a separate sub-file.

## Sub-File Index

### [Select: Context Selection and Progressive Disclosure](context-engineering/select-pattern.md)
Lazy loading, three-tier progressive disclosure, promise memoization for concurrency, manual cache invalidation, token budgeting for capability discovery, canonical-path deduplication, and path-conditional activation.

### [Compress: Context Compression and Snapshot Management](context-engineering/compress-pattern.md)
Truncation with recovery pointers, reactive compaction triggered by fill ratio, snapshot labeling with staleness warnings, character and token caps on variable-length blocks, and recovery-pointer preservation across compaction passes.

### [Isolate: Context Isolation for Delegated Work](context-engineering/isolate-pattern.md)
Zero-inheritance workers, full-inheritance forks with single-level boundaries, filesystem isolation via worktrees, path translation injection, blast radius as the primary design criterion, and immutable shared state across concurrent agents.
