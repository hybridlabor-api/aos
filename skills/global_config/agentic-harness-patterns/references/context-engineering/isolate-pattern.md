# Context Isolation for Delegated Work

## Problem

When an agent delegates work to sub-agents, every piece of shared state becomes a potential collision point. A sub-agent that inherits the parent's full context may act on stale assumptions; a sub-agent that shares the parent's working directory may overwrite files the parent is reading; a sub-agent that can recursively spawn its own children creates exponential context multiplication. Without explicit isolation boundaries, the blast radius of a single sub-agent mistake extends to the entire session.

These problems emerge in any agent runtime that supports delegation — coordinator patterns, fork patterns, or any form of parallel sub-agent work. They are inherent to multi-agent architectures, not specific to any single implementation.

## Golden Rules

### Zero-inheritance is the safest default

When delegating work to a sub-agent in a coordinator pattern, pass only the explicit prompt. The sub-agent receives no conversation history, no accumulated context, no session state. This is the narrowest possible boundary: the sub-agent can only act on what it was told, and nothing from the parent's session leaks accidentally. The cost is that the prompt must be self-sufficient — everything the sub-agent needs to do its job must be spelled out.

### Full-inheritance forks must be single-level

When a sub-agent needs the parent's full context (the fork pattern), copy the context but enforce a single-level boundary: the forked agent cannot itself fork. Without this constraint, recursive forking multiplies context cost exponentially — each level copies everything from the level above, and the total cost is O(2^n) in the depth of the fork tree. A single-level boundary keeps the cost linear.

### Filesystem isolation prevents path collisions

When a sub-agent modifies files, it needs its own working copy of the repository. Shared working directories create race conditions: the parent reads a file, the sub-agent modifies it, and the parent's next read returns unexpected content. Filesystem isolation (via worktrees, temp directories, or copy-on-write clones) gives each agent its own view. Path translations must be injected so the agent operates on its isolated copy, not the shared original.

### Choose the narrowest boundary that works

The isolation boundary determines the blast radius of a sub-agent's mistakes. A zero-inheritance worker can corrupt only its own output. A full-inheritance fork can produce results inconsistent with the parent's state. A shared-filesystem agent can corrupt the parent's working directory. Always start with the narrowest boundary and widen only when the sub-agent genuinely needs more context.

## When To Use

- Your agent delegates work to sub-agents or spawns concurrent workers.
- Sub-agents modify files in the same repository the parent is working in.
- Delegated sub-agents produce results that contradict the parent's state or each other.
- You need to prevent a sub-agent failure from corrupting the parent session.
- Parallel agents need to work on the same codebase without stepping on each other's changes.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Zero-inheritance delegation | Clean context boundaries, no accidental leakage | Sub-agent must be self-sufficient from its prompt alone |
| Full-inheritance fork (single-level) | Sub-agent has full context for complex tasks | Doubles context cost; must enforce no-recursive-fork rule |
| Filesystem isolation via worktrees | No file-level race conditions between agents | Worktree creation and teardown overhead; disk cost |
| Path translation injection | Agent operates on its own copy transparently | Translation logic must cover all file-operation tools |
| Immutable shared state | Safe concurrent reads across agents | State updates require new snapshots, not in-place mutation |
| Single-level fork boundary | Linear cost, not exponential | Forked agents that need further delegation must use coordinator pattern instead |

## Implementation Patterns

- For coordinator-pattern delegation, construct the sub-agent prompt as a self-contained document. Include all necessary context, constraints, and output format requirements in the prompt itself — do not rely on inherited session state.
- For fork-pattern delegation, copy the parent's context at fork time and enforce a single-level boundary. The forked agent should be unable to invoke the fork mechanism itself. If a forked agent needs further delegation, it must use the coordinator pattern (zero-inheritance) for its own sub-agents.
- When sub-agents modify files, create an isolated filesystem context (worktree, temp directory, or copy-on-write clone) before the agent starts. Inject path translations so every file-operation tool targets the isolated copy.
- On sub-agent completion, merge results back to the parent's working directory through a controlled integration point — not by letting the sub-agent write directly to the shared filesystem.
- Mark all state shared between parent and sub-agents as immutable. If a sub-agent needs to communicate state changes, it should return them as a result, not mutate shared objects in place.
- Register cleanup handlers that tear down isolated filesystems when the sub-agent completes or fails. Leaked worktrees or temp directories accumulate and waste disk.
- When multiple sub-agents work in parallel on the same codebase, assign non-overlapping file sets where possible. Filesystem isolation handles the general case, but non-overlapping assignments prevent merge conflicts at the integration point.

## Gotchas

**Recursive forks create exponential cost.** If a forked agent can itself fork, the context cost doubles at each level. Three levels of recursive forking mean eight copies of the original context. Enforce the single-level boundary at the delegation mechanism, not as a convention.

**Path translations must cover all file-operation tools.** If the isolation mechanism injects a worktree path but one file-operation tool bypasses the translation, that tool writes to the shared original directory. Every tool that touches the filesystem must go through the translation layer.

**Zero-inheritance prompts must be truly self-contained.** A common failure mode is constructing a sub-agent prompt that implicitly relies on context the parent has but the sub-agent does not. Review zero-inheritance prompts for hidden dependencies: file paths that assume a specific working directory, references to earlier conversation turns, or assumptions about available tools.

**Merging results from isolated agents can conflict.** When two parallel agents modify the same file in their respective worktrees, merging both back produces a conflict. Design task assignments to minimize overlap, and have a conflict resolution strategy for when overlap is unavoidable.

**Worktree cleanup must happen on all exit paths.** If cleanup only runs on successful completion, a failed or killed sub-agent leaks its worktree. Register cleanup on the process-level shutdown handler, not just in the success path.

**Immutable shared state does not mean no communication.** Sub-agents can still return results to the parent — the constraint is that they return values rather than mutating shared objects. The parent integrates returned results into its own state through a controlled update path.

## Claude Code Evidence

Claude Code's delegation system implements these isolation principles across multiple agent coordination patterns:

**Zero-inheritance as the default for coordinated work.** When the runtime dispatches a sub-agent in the coordinator pattern, the sub-agent receives only its explicit task prompt. No conversation history, no accumulated memory, no parent session state is inherited. This is a deliberate design choice: the sub-agent's blast radius is limited to its own output. The cost — that every sub-agent prompt must be fully self-contained — is accepted as worthwhile because it eliminates an entire class of state-leakage bugs.

**Single-level fork boundary.** The fork mechanism copies the parent's full conversation context to the forked agent but enforces that the forked agent cannot itself invoke the fork mechanism. If a forked agent needs to delegate further, it must use the coordinator pattern (zero-inheritance) for its own sub-tasks. This keeps the total context cost at 2x the parent's context, not 2^n. The design explicitly rejects recursive forking because the exponential cost makes it impractical for any real workload.

**Worktree-based filesystem isolation.** When a sub-agent needs to modify files, the runtime creates a git worktree that gives the agent its own working copy of the repository. Path translations are injected so that every file-operation tool targets the worktree, not the parent's working directory. This eliminates file-level race conditions between concurrent agents. Worktrees are cleaned up on all exit paths, including failure and kill, through process-level cleanup handlers.

**Immutable shared state across concurrent agents.** The application state shared between the parent and its sub-agents is wrapped in a deep-immutability type. Sub-agents cannot mutate this state in place. When a sub-agent produces results, they are returned as values and integrated by the parent through a controlled update path. This design prevents the most insidious class of concurrency bugs: silent in-place mutation of shared objects that causes different agents to see inconsistent state.

**Blast radius as the primary design criterion.** The isolation level for each delegation type was chosen by asking "what is the worst thing this sub-agent can break?" Zero-inheritance workers can only produce bad output. Full-inheritance forks can produce output inconsistent with the parent's context. Shared-filesystem agents can corrupt the parent's working directory. The runtime defaults to the narrowest boundary and only widens when the use case demands it.
