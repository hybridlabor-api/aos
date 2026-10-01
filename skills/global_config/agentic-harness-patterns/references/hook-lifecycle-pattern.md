# Hook Lifecycle Pattern

## Problem

Without a centralized hook lifecycle, extensibility degrades into chaos: hook authors attach side effects at arbitrary points in agent execution with no consistent trust enforcement, no deterministic ordering across concurrent hooks, and no structured way to propagate blocking decisions back to the caller. External hooks may execute before workspace trust has been established, enabling remote code execution from untrusted configuration files. Long-running hooks that background themselves without proper registry handoff leave orphaned processes that deliver stale or contradictory signals at unexpected times.

These problems emerge in any agent runtime that supports extensible hook points — they are not specific to a single implementation.

## Golden Rules

### All hooks flow through a single dispatch point

Never allow hook execution to scatter across multiple call sites. A single dispatch function is the chokepoint for trust checks, source merging, type routing, and result aggregation. If a new hook type is added, the dispatch point is the only place that needs to change. Scattered execution sites inevitably diverge on trust enforcement or result handling.

### Trust is all-or-nothing

Before any hook fires, check workspace trust exactly once. If trust has not been established, skip every hook — not just external ones. In-process hooks included. This prevents a half-trusted state where some hooks execute and others do not, which creates unpredictable behavior that is harder to debug than a clean skip-all.

### Multiple sources merge with explicit priority

Hooks arrive from multiple sources: persisted configuration, programmatic SDK registration, and ephemeral session-scoped registrations. Merge them into a single ordered list with a defined priority layering. When enterprise policy restricts hooks, entire source layers are excluded cleanly rather than individual hooks being filtered ad hoc.

### Exit codes carry semantic weight

For external process hooks, reserve specific exit codes for specific meanings. One code means success. One specific code means "block this action and inject my error message into the agent's context." All other non-zero codes mean "warn the user but do not block." This three-tier convention lets external scripts control agent behavior without needing structured JSON output.

### Deny beats ask beats allow

When multiple hooks in the same batch return conflicting permission decisions, apply a strict precedence: deny overrides ask, ask overrides allow, and passthrough never sets the aggregated decision. This deterministic resolution eliminates ambiguity when hooks disagree.

### Session hooks are ephemeral by design

Hooks registered at runtime for a specific agent session must be scoped to that session's ID and automatically cleaned up when the session ends. They should never be written to persisted configuration. If a sub-agent registers a hook, that hook must not fire in the parent agent's session or in a sibling sub-agent's session. This isolation prevents cross-session side effects during parallel fan-out.

## When To Use

- Your agent runtime exposes lifecycle events that external code can hook into.
- You need trust enforcement that cannot be bypassed by any hook type.
- Hooks arrive from multiple configuration sources that must be merged deterministically.
- You support both synchronous blocking hooks and long-running background hooks.
- Multiple hooks can return conflicting permission decisions for the same action.
- You need session-scoped hooks that are automatically cleaned up when a session ends.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Single dispatch point | One place for trust, routing, and aggregation | Every hook type must conform to the same dispatch interface |
| All-or-nothing trust gate | No half-trusted states, simple mental model | In-process hooks that pose no security risk are still blocked |
| Multi-source merge with priority | Clean policy enforcement, predictable ordering | Hook authors must understand which source layer they belong to |
| Multiple hook types | Right tool for each job (process, LLM, HTTP, in-process) | More type surface to document and maintain |
| Async generator composition | Streaming partial results, early exit on blocking errors | Callers must handle incremental accumulation |
| Backgrounding with registry handoff | Long-running hooks do not block the main loop | Orphan risk if the registry handoff is skipped |
| Session-scoped hooks | Ephemeral hooks auto-clean on session end | Hooks scoped to one session do not fire in sub-agent sessions |
| Deduplication across sources | No double-firing when the same hook appears in multiple configs | Dedup key design must account for source-specific prefixes |

## Implementation Patterns

- Route every hook invocation through a single dispatch function. This function is the sole location for the trust check, source merge, type dispatch, and result aggregation.
- Implement the trust check as the first operation in dispatch. If trust is absent, return immediately with an empty result — do not evaluate which hooks would have matched.
- Merge hook sources in a defined priority order (e.g., persisted config, then SDK-registered, then session-scoped). When a policy flag restricts to managed hooks only, exclude entire source layers rather than filtering individual entries.
- Deduplicate across sources using a composite key that includes source-specific context. Two hooks with the same command from different plugins are distinct; the same command from user config and project config collapses to the last-wins entry.
- Support at least these hook type categories: external process (shell command), LLM sub-call, sub-agent delegation, HTTP endpoint, in-process callback with full output control, and lightweight boolean gate for simple allow/deny decisions.
- Run all matched hooks in parallel using async generator composition. Each hook yields typed result fragments as they become available. The dispatch function merges all generators and yields aggregated fragments to the caller.
- For external process hooks, map exit codes to semantic outcomes: one code for success, one reserved code for blocking errors (with the error message on stderr), and all other non-zero codes for non-blocking warnings.
- Support two backgrounding modes: static (declared in hook configuration before execution) and dynamic (the hook signals backgrounding as its first output line). Backgrounded hooks are handed off to a pending-hook registry so they are tracked across turns.
- Scope session hooks to a specific agent or session ID. Hooks registered under the main session do not fire in sub-agent sessions. Provide explicit removal functions, but also clear all session hooks automatically when the session ends.
- When aggregating permission decisions from multiple hooks, apply strict precedence: deny wins over ask, ask wins over allow, passthrough is ignored.
- Choose hook types based on the capability needed. Use external process hooks for shell-level side effects. Use LLM sub-call hooks when the hook itself needs reasoning. Use HTTP hooks for external service integration. Use in-process callbacks when the hook needs full control over structured output fields (permission decisions, injected context, input rewriting). Use lightweight boolean gates when you only need a yes/no decision against conversation history without JSON serialization overhead.
- Register a process-level cleanup handler that terminates all running hooks on shutdown. Without this, backgrounded hooks survive the parent process and become orphans.
- Guard against event-type restrictions: some events may be incompatible with certain hook types. For example, HTTP hooks during early session setup can deadlock if the event fires before the response consumer is ready. Document these restrictions in the dispatch layer rather than relying on hook authors to discover them.

## Gotchas

**The trust gate blocks all hook types, not just external ones.** Every hook — including in-process callbacks and boolean gates — is skipped when trust is absent. Never assume a hook fired just because it runs in-process. If a hook did not fire, check trust status first.

**A missing external script can produce the same exit code as an intentional block.** If a hook script is deleted between registration and execution, the shell itself may exit with the reserved blocking code. Validate that hook scripts exist at registration time, not only at execution time.

**Policy-restricted modes silently drop session hooks.** When enterprise policy limits hooks to managed sources only, session-scoped hooks registered by skills or sub-agents receive zero matches with no error. Tested behavior may differ between managed and unmanaged deployments.

**Background hooks with "rewake" semantics bypass the pending registry.** Normal backgrounded hooks appear in the registry and are resolved before the next turn. Rewake-style hooks survive across turns by design — they inject a notification when they complete. Do not use rewake for hooks that must finish before the next tool call.

**Boolean gate hooks cannot be serialized.** Lightweight in-process gates that return only true/false are inherently ephemeral. They are excluded from configuration snapshots, analytics, and telemetry. Use the full callback type if you need persistence or observability.

**Deduplication uses last-wins, which can surprise multi-scope authors.** When the same hook command appears in both user-level and project-level config, the project-level entry wins. Source-specific prefixes in the dedup key prevent cross-source collisions, but same-source collisions are resolved silently.

**HTTP hooks can deadlock during early lifecycle events.** If an HTTP hook is registered for a session-start or setup event, the outbound request may fire before the response consumer is ready, creating a deadlock. The dispatch layer should explicitly filter incompatible hook-type/event-type combinations rather than leaving this to the hook author.

**Session hooks are invisible after session cleanup.** Once a session ends and its hooks are cleared, there is no record they ever existed. If debugging requires understanding which hooks were active during a past session, you need separate logging — the session store itself is ephemeral.

## Claude Code Evidence

Claude Code's hook system is a production implementation of these principles, supporting six hook types across dozens of lifecycle events.

**Single dispatch with trust gate.** All hook execution flows through one async generator function. The first thing it does is check workspace trust. In interactive mode, this requires the user to have accepted a trust dialog. In SDK (non-interactive) mode, trust is implicit. If trust is absent, the generator returns immediately — no hooks of any type fire.

**Three-layer source merge with policy enforcement.** Hooks are drawn from three sources in priority order: snapshot hooks from settings files, SDK-registered callback hooks, and session-scoped hooks stored in a Map-based session state. When enterprise policy sets a managed-only flag, session and plugin hooks are excluded at the source-merge layer, not filtered individually. This design means policy enforcement is a single conditional that drops entire source lists, rather than per-hook filtering that would need to be maintained for every new hook type.

**Async generator composition for streaming results.** Each hook runs as an independent async generator yielding typed result fragments — blocking errors, permission decisions, additional context, modified inputs. A parallel merge utility combines all generators so the caller receives fragments as they arrive. This is critical for blocking errors: a slow hook in the batch does not delay the blocking signal from a fast hook.

**Map-based session state for concurrency.** Session hooks use a Map rather than a plain object for the session store. Map mutation returns the same container reference, so the application store's equality check sees no change and none of the store's listeners fire. This avoids quadratic listener-notification costs during parallel sub-agent fan-out, where many hooks may be registered in rapid succession. The design lesson is general: when a store-backed data structure receives frequent writes during concurrent operations, choose a container whose mutation does not trigger change-detection cascades.

**Backgrounding with two modes.** Hooks can be backgrounded statically (declared in configuration) or dynamically (the hook emits a backgrounding signal as its first output line before doing real work). A further variant, "rewake" backgrounding, is used for hooks that must survive across multiple agent turns — on completion with a blocking exit code, they inject a task notification that wakes the model rather than appearing in the pending-hook registry. This three-tier backgrounding design reflects the real-world range of hook lifetimes: same-turn, next-turn, and multi-turn.

**Permission precedence.** When multiple hooks return conflicting permission decisions for the same tool-use event, the aggregation follows strict precedence: deny overrides ask, ask overrides allow, passthrough is ignored. This ensures that a single security-minded hook can always veto, regardless of how many permissive hooks also respond.

**Six hook types with distinct roles.** The system supports command hooks (shell processes), prompt hooks (LLM sub-calls), agent hooks (full sub-agent delegation), HTTP hooks (external service calls with mandatory JSON responses), callback hooks (in-process functions with full structured output control), and function hooks (session-only boolean gates against conversation history). The callback/function split is deliberate: callbacks follow the same protocol as external hooks and can influence permissions, inject context, and rewrite inputs. Function hooks receive only the message history and return a boolean — they exist for lightweight validation without JSON serialization overhead and are never persisted or included in telemetry.

**Exit-code discipline.** External command hooks follow a strict three-tier convention: exit 0 is success, exit 2 is a blocking error whose stderr message is injected into the model's context, and any other non-zero exit is a non-blocking warning shown to the user without halting execution. This convention gives shell script authors fine-grained control over agent behavior using only the process exit code.

**Deduplication with source-aware keys.** When the same hook command appears in multiple settings scopes (user, project, workspace-local), the merge layer deduplicates using a composite key. For hooks from the same source, last-wins applies. For hooks from different plugin roots, source-specific prefixes in the dedup key prevent cross-plugin collisions from being silently collapsed.
