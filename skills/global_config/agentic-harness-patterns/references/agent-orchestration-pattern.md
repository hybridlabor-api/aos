# Agent Orchestration Pattern

## Problem

Without deliberate orchestration structure, multi-agent systems collapse into one of two failure modes: a single overloaded agent that serializes everything and runs out of context, or an uncontrolled fan-out where every sub-agent spawns more sub-agents, producing recursive depth that is impossible to track or cancel. A third failure is "lazy delegation" — passing raw research findings to implementation workers instead of synthesizing them into precise specifications, which degrades output quality proportionally to task complexity.

These problems emerge in any agent runtime that supports delegation to sub-agents — they are not specific to a single implementation.

## Golden Rules

### Synthesize, don't delegate understanding

The orchestrator's job is not to forward raw findings from one worker to the next. After a research phase completes, the orchestrator must read the results, extract the relevant facts, and compose a self-contained specification for the next worker. A worker prompt that says "based on your findings" delegates understanding to a process that has no findings — it started from a blank context. Every worker prompt must be interpretable by someone who has never seen the prior conversation.

### Choose delegation patterns deliberately; do not mix conflicting assumptions

The delegation patterns (coordinator, fork, swarm/peer) solve fundamentally different problems and make different assumptions about context sharing, depth, and lifecycle. Before mixing patterns in a single session, verify that their assumptions are compatible. Coordinator workers that start from blank context are incompatible with the context-sharing assumption of forking. Swarm peers that coordinate through shared state are incompatible with coordinator-style phased sequencing. If your runtime enforces mutual exclusion between modes, that is a valid simplification — it eliminates an entire class of ownership ambiguity at the cost of flexibility.

### Depth must be bounded by design

Recursive delegation is the single most dangerous failure mode in agent orchestration. Every pattern must enforce a hard depth limit: coordinator workers may spawn sub-workers but the overall tree must remain tractable; fork children cannot fork again; swarm peers cannot spawn other peers. These constraints exist because unbounded depth produces exponential fan-out that is impossible to monitor, cancel, or reason about.

### Workers get only the tools they need

Sub-agents that inherit the full tool set of the parent can take actions the orchestrator never intended — spawning their own background workers, modifying orchestration state, or accessing resources outside their task scope. Filter each worker's available tools down to what their specific task requires. Asynchronous workers need a more restricted set than synchronous ones, because they run without direct supervision.

## When To Use

- Your agent needs to split work across multiple concurrent sub-agents.
- A task has distinct phases that must sequence (research, then synthesis, then implementation, then verification).
- You need parallel execution of independent subtasks while maintaining a single coordination point.
- A parent agent has accumulated significant context and needs to share it with workers without re-deriving it.
- Long-running peer agents need to collaborate on shared state over many turns.
- You need independent verification of implementation quality by a worker that does not share the implementer's assumptions.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Three distinct patterns instead of one | Each pattern is simple and well-suited to its use case | Developers must choose correctly; wrong choice degrades performance |
| Coordinator starts workers from blank context | Clean separation of concerns; no stale assumptions leak through | Orchestrator must do real synthesis work to produce self-contained prompts |
| Fork inherits full parent context | Workers immediately have all relevant background; no re-research needed | Context size is doubled per child; parent changes after fork are invisible to children |
| Single-level fork constraint | Prevents exponential fan-out; keeps the process tree shallow and cancellable | Cannot decompose fork children's work further; parent must plan granularity up front |
| Flat swarm roster | Every peer is visible and addressable; no hidden sub-teams | Coordination complexity grows linearly with team size; no hierarchical delegation |
| Mutual exclusion between modes (if enforced) | No ambiguity about who owns orchestration | Cannot combine coordinator's phased workflow with fork's context sharing in one session |
| Worker tool filtering | Workers cannot take unintended actions outside their task scope | Filtering logic must be maintained as the tool set evolves |
| Continue-vs-spawn decision | Reusing a worker preserves loaded context; spawning fresh avoids assumption leakage | Continuing with stale context is worse than the cost of re-loading from scratch |

## Implementation Patterns

- Decide on the delegation pattern before dispatching work. If your runtime enforces mutual exclusion between modes, gate checks should reject conflicting activations explicitly rather than silently degrading.
- When using the coordinator pattern, structure work in explicit phases: research workers gather information, the coordinator synthesizes findings into specifications, implementation workers execute against those specifications, and verification workers independently confirm results.
- Write every worker prompt as a self-contained document. Include the specific file paths, exact changes required, and success criteria. Never reference "prior findings" or "the context above" — the worker has no prior context.
- After research workers report back, read their full results before dispatching implementation work. The synthesis step is where the orchestrator adds value — skipping it produces the "lazy delegation" failure.
- When forking, construct the child's initial messages so that the divergence point is as late as possible and the shared prefix is as long as possible. This maximizes cache hits across sibling workers. Only the per-child task directive should differ.
- Enforce the single-level fork constraint at invocation time, not at tool-definition time. Removing the delegation tool from a fork child's schema would change the tool set, breaking cache alignment with siblings. Instead, keep the tool present but reject the call with a clear error.
- For swarm peers, coordinate through a shared artifact (task list, file, or message bus) rather than through peer-to-peer spawning. The roster is defined at swarm creation and does not grow during execution.
- Filter each worker's tool set based on its role. Read-only research workers do not need write tools. Implementation workers do not need the ability to spawn their own background agents. Asynchronous workers get a more restrictive allow-list than synchronous ones.
- Decide whether to continue an existing worker or spawn a fresh one based on context relevance. If the worker's loaded context directly overlaps the next task, continue it. If the next task requires a different perspective (especially for verification), spawn fresh to avoid assumption leakage.
- For workers running in an isolated filesystem copy, inject a notice explaining that paths from the parent context refer to a different root. The worker must translate inherited paths to its own working directory.
- Include a purpose statement in every worker prompt so the worker can calibrate depth and scope. "This research will inform a PR description" produces different output than "this research will inform a security audit."

## Gotchas

**Do not skip the synthesis step.** The most common coordinator failure is passing a research worker's raw output directly to an implementation worker. The research worker optimized for breadth; the implementation worker needs precise, actionable specifications. The orchestrator must bridge that gap.

**Verification workers must start fresh.** Never continue a verification task from the implementation worker's context. The implementer's loaded context carries assumptions about correctness that will blind the verifier to the exact bugs it should catch.

**Fork children cannot fork.** Do not design prompts that instruct fork children to further decompose their work via forking. The recursive guard rejects the attempt at call time, wasting a turn. Plan the decomposition granularity at the parent level.

**Identical shared prefixes are load-bearing for cache efficiency.** When forking, the placeholder content in shared message slots must be byte-identical across all siblings. Customizing per-child content in the shared prefix region destroys the cache benefit that justifies forking over coordinator-style delegation.

**Swarm peers cannot spawn other peers.** The team roster is fixed at creation. Design coordination around shared state, not dynamic team expansion. If you need a new peer, the session orchestrator adds it — peers do not recruit.

**In-process peers have lifecycle constraints.** A peer agent running inside the leader's process cannot manage independent background work, because its lifecycle is tied to the leader's. If a peer needs autonomous long-running tasks, it must run in its own process (e.g., a separate terminal session).

**Tool filtering has layers.** Different agent types may receive different tool subsets. Built-in, custom, and asynchronous agents each face their own filtering rules. Custom or less-trusted agents face additional restrictions beyond the base disallow-list. A tool's trust source — built-in, user-installed, or dynamically loaded — may determine whether it passes through all filtering layers or bypasses some.

**Be cautious when assigning weaker models to sub-tasks.** Orchestrators cannot reliably predict sub-task complexity. Routing "simple" tasks to a cheaper model is a false economy when the complexity assessment itself requires the judgment of a capable model.

**Mode checks happen at call time, not at definition time.** The orchestration mode gates do not remove tools from the schema; they reject calls when invoked under the wrong mode. This means the tool appears available but will fail. Design error handling around this — do not retry the same call expecting a different result.

## Claude Code Evidence

Claude Code implements all three orchestration patterns as mutually exclusive modes within a single agent runtime. Only one mode can be active per session — if coordinator mode is active, forking is disabled, and vice versa. This is a deliberate simplification that eliminates ownership ambiguity at the cost of flexibility.

**Coordinator mode as a distinct operational persona.** When coordinator mode is activated, the agent receives an entirely different system prompt that replaces the default. This prompt encodes the phased workflow (research, synthesis, implementation, verification) and the "always synthesize" rule as first-class instructions. The coordinator dispatches workers as async tool calls and receives their results as structured notifications injected into the conversation. The coordinator distinguishes these notifications from real user messages by their markup structure, preventing confusion between human input and worker output.

**Fork as context-sharing with cache optimization.** Claude Code's fork implementation clones the parent's full message history into each child, then appends a synthetic turn where all tool-result slots contain identical placeholder text. Only the final directive block differs per child. This design was chosen specifically to maximize prompt cache hits — the entire shared prefix (system prompt, message history, tool definitions, and placeholder results) is byte-identical across siblings, so the inference provider can serve all children from the same cached prefix. The single-level guard keeps the delegation tool in fork children's tool schemas (preserving byte-identical tool definitions) but rejects any fork attempt at invocation time with a clear error message.

**Swarm as flat peer topology.** Claude Code's team system assigns each peer a name and runs it in a dedicated process. Peers coordinate through a shared task list rather than through message-passing or peer spawning. The runtime enforces the flat roster constraint with an explicit rejection message when a teammate attempts to create another teammate. In-process teammates face additional lifecycle restrictions — they cannot spawn background agents because their execution is coupled to the leader process — while process-isolated teammates manage their own background work independently.

**Tool filtering as defense in depth.** Claude Code applies multiple layers of tool filtering depending on agent type. All sub-agents face a base disallow-list. Custom agents (those defined by users rather than built into the runtime) face an additional restriction layer. Asynchronous agents are restricted to an explicit allow-list rather than the full filtered pool. Extension-provided tools bypass all filtering — a deliberate design choice reflecting that extensions are user-installed and trusted. This layered approach means each worker operates with the minimum tool surface required for its role.

**Model selection as a coordinator responsibility.** Claude Code's coordinator design guidance recommends against overriding the default model for individual workers, based on the observation that orchestrators cannot reliably predict sub-task complexity. Specifying a weaker model for "simple" tasks is treated as a false economy.

**Continue-vs-spawn as an explicit decision point.** The coordinator pattern surfaces the continue-or-spawn choice as a first-class decision in the orchestration flow. The coordinator can send a follow-up message to an existing worker (preserving its accumulated context) or spawn a fresh worker (starting from a clean slate). Claude Code's design guidance is explicit: continue when the existing context directly overlaps the next task, spawn fresh when it does not — especially for verification, where the implementation worker's context carries assumptions that would compromise independent review.
