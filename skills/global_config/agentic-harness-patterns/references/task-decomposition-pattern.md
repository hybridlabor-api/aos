# Long-running Work Management

## Problem

Without a structured work management layer, concurrent agent work collides in shared state: two sub-agents writing to the same in-memory buffer corrupt each other's output, there is no canonical signal for "this work is done and will not change," and the parent coordinator has no safe window to evict completed work from memory. Untyped work identifiers make it impossible to route kill signals or status queries to the right handler at scale.

These problems emerge in any agent runtime that supports concurrent or background work — they are not specific to a single implementation.

## Golden Rules

### Every work unit gets a typed identity

Assign each unit of async work a prefixed, typed ID at creation time. The type prefix encodes what kind of work it is (shell command, agent, remote worker, teammate, etc.), making log filtering, routing, and kill dispatch unambiguous without parsing additional fields. Use a collision-resistant random suffix — the ID space should be large enough that brute-force collisions are infeasible even across hostile environments.

### Strict state machine with permanent terminal states

Every work unit follows the same lifecycle: it starts (most register directly as "running," skipping any "pending" phase), it runs, and it ends in exactly one terminal state — completed, failed, or killed. Terminal states are permanent. Encode this invariant in a single canonical check function, and use that function everywhere instead of inlining status comparisons. If a new terminal state is ever added, inline copies will silently diverge.

### Output goes to disk; memory holds only an offset

Keeping full transcripts in memory for every concurrent sub-agent is unbounded. Instead, write output to a per-work-unit file on disk. The in-memory state only stores a read offset. On each poll cycle, read the delta since the last offset and advance atomically. This keeps the in-memory footprint constant regardless of how long a work unit runs.

### Eviction is two-phase, gated by notification

When work reaches a terminal state:

1. **Disk cleanup** happens eagerly — output files are removed at the terminal transition.
2. **Memory cleanup** happens lazily — the in-memory record is only removed after the parent has been notified of the result.

The notification gate is critical. Without it, the framework would delete the work record before the parent could read the result, creating a race between eviction and result retrieval.

## When To Use

- Your agent spawns concurrent sub-agents or background tasks.
- You need to track the lifecycle of work that outlives a single turn.
- You need to display task status in a UI or route kill signals to specific work units.
- Long-running agents produce output that would be too large to keep in memory.
- You need a clean GC strategy that doesn't race with result consumption.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Typed prefixed IDs | Unambiguous routing, easy log grep | One more field to generate and propagate |
| Skip "pending" in practice | Simpler, faster registration | UIs that assume "pending" as a required phase will break |
| Disk-backed output | Constant memory, survives interruption | I/O latency per poll, disk cleanup obligations |
| Two-phase eviction | No race between GC and result retrieval | More complex lifecycle — both phases must happen |
| Notification-gated GC | Parent always sees the result | Un-notified terminal tasks leak memory indefinitely |
| Retain flag for UI | Users can view completed work | Must be explicitly cleared or the task leaks |

## Implementation Patterns

- Mint a typed, prefixed ID before allocating any state. The ID is the work unit's identity for its entire lifecycle.
- Initialize shared base fields (status, output file path, read offset) via a factory function. The factory sets a safe default status; the concrete constructor overrides to "running" if the work starts immediately.
- Register work through a single entry point into shared state. Never write directly to the task store — the registration function is the chokepoint for validation and deduplication.
- For agent-type work, initialize the output file as a symlink to the agent's existing transcript. This avoids copying and lets the output file resolve immediately.
- Transition to "running" at or before registration. The "pending" state from the base factory is a safe default, not a required phase — most work starts immediately.
- Use a generic, type-parameterized update function for all mutations. Skip the state spread when the updater returns the same reference to prevent spurious re-renders.
- On every terminal transition: set the end timestamp, clean up the disk output, and set an eviction deadline (unless the work is being actively viewed).
- Enqueue a parent notification exactly once per terminal transition. Use a "notified" flag inside the update function to make the enqueue idempotent.
- Register a cleanup handler at process level that kills all running work on shutdown.
- Guard offset patches against stale state: after an async disk read, re-check the work unit's status before applying the new offset. The unit may have completed during the read.

## Gotchas

**Do not evict before the parent is notified.** The eviction function silently no-ops when the notification flag is false. If you call it early, the work unit stays in memory indefinitely and the parent never learns the result.

**Retained work units are never auto-evicted.** When a work unit is being actively viewed in a UI, its eviction deadline is set to infinity. The UI must explicitly clear the retain flag when the user navigates away — otherwise the terminal work unit leaks forever.

**Update functions must not mutate the existing state object.** Return a new object or the original reference. In-place mutations are invisible to the immutable-update pattern and will not propagate to subscribers.

**Do not hold a full state snapshot across an async boundary.** If you store the full work-unit state before an async disk read, a concurrent terminal transition during the read will be clobbered when you spread the stale snapshot back. Store only the fields you need (e.g., the new offset).

**Use the canonical terminal-status check, not inline comparisons.** If a new terminal status is ever added, inline `status === 'completed' || ...` copies will silently diverge from the authoritative check.

**Eviction is two-phase — skipping either phase leaks resources.** Skipping disk cleanup leaks files. Skipping memory cleanup leaks state-store entries. Both must happen for clean GC.

**Kill is a no-op on non-running work.** The kill guard only acts on "running" work units. Double-killing is safe, but you cannot kill a "pending" unit — wait for it to become "running" first.

## Claude Code Evidence

Claude Code's task system is a production implementation of these principles, managing seven distinct work types concurrently:

**Typed prefixed IDs.** Each task type has a single-character prefix (agent, bash, remote, teammate, workflow, monitor, dream). The remaining characters are drawn from a case-insensitive-safe alphabet (digits + lowercase), producing ~2.8 trillion combinations per prefix. The design comment notes this is intentionally large enough to resist brute-force symlink attacks on the output file paths.

**Practical skip of "pending."** The base factory initializes status as "pending," but in practice, agent tasks, remote tasks, and dream tasks all override to "running" at registration time. The "pending" state exists as a safe default for the type system, not as a phase that real tasks pass through.

**Disk-backed output with offset-based polling.** Agent task output is written to a per-task file on disk. For local agent tasks, the output file is initialized as a symlink to the agent's existing JSONL transcript — no data is copied. The framework polls this file during "running" state, reading only the delta since the last offset. The offset is advanced atomically after the async read, with an explicit comment about avoiding clobbering a status transition that may have occurred during the `await`.

**Two-phase eviction with notification gate.** Terminal tasks set an eviction deadline (30 seconds by default) to give the UI time to display the completion state. Tasks being actively viewed set a "retain" flag that blocks eviction entirely. The eviction function checks the "notified" flag and no-ops if the parent hasn't been signaled yet. Memory records are cleaned lazily on a separate sweep cycle.

**Session-level task IDs.** The core task ID prefix map has seven entries. A separate session-management task type generates its own prefix outside the core map, using the same underlying local-agent-task machinery but with a different identity namespace. This separation keeps the generic task system clean while allowing specialized reuse.
