# Tool Registry Pattern

## Problem

Without a centralized registry, agents scatter tool definitions across call sites, causing duplicate registration, inconsistent defaults (some tools forgetting permission checks, others accidentally marked as safe for concurrent execution), and no single place to apply cross-cutting concerns like deny-rule filtering or concurrency classification. Feature-flagged tools become invisible to the orchestrator unless every consumer independently replicates the same conditional logic, leading to silent tool-pool divergence between code paths. Plugin-provided tools interleave unpredictably with built-in tools, destroying prompt-cache stability whenever the plugin set changes.

These problems emerge in any agent runtime that supports extensible tool sets -- they are not specific to a single implementation.

## Golden Rules

### Fail closed on every safety-relevant default

When a tool definition omits a safety classification, the registry must assume the most restrictive posture: not safe for concurrency, not read-only, not destructive. A tool that forgets to declare its concurrency class runs serially, which is safe even if slow. The inverse -- defaulting to concurrent -- could corrupt shared state. The same logic applies to permission checks: an omitted permission handler should defer to the general permission system, not silently auto-allow or auto-deny.

### One authoritative list, progressively narrowed

Maintain exactly one function that returns the full candidate set of tools, respecting build-time flags. Every consumer narrows from this single source rather than assembling its own list. The narrowing chain applies deny-rules, mode-gating, and context-specific filtering in layers. If a second code path constructs its own tool list, those two lists will inevitably diverge when a new tool or deny-rule is added.

### Concurrency classification is per-call, not per-tool-type

A single tool type can be safe for some inputs (a read-only file glob) and unsafe for others (a file write). The concurrency classifier must evaluate the parsed input at dispatch time, not at registration time. Consecutive safe calls merge into one concurrent batch; any unsafe call starts a new serial batch. If the classifier throws, treat the call as unsafe and fall back to serial execution -- never let an error escalate to a crash.

### Partition, then sort, then concatenate for cache stability

When combining built-in tools and plugin-provided tools into a single pool, sort each partition independently before concatenating. Interleaving the two groups would invalidate cached prompt keys whenever a plugin tool alphabetically sorts between built-ins. Built-in tools always appear first in the final list, and built-ins win on name collision -- a plugin cannot silently shadow a built-in.

### Gate feature-flagged tools at list-construction time

Conditional tools are included or excluded inside the single authoritative list using feature-flag checks at construction time, not at call time. This keeps all gating logic in one place and prevents every downstream consumer from needing to replicate the same conditions. If gating leaks to consumers, adding a new flag requires updating every call site -- a guaranteed source of drift.

### Preserve backward compatibility through aliases

When renaming a tool, keep the old name as an alias on the tool definition. When a tool call arrives for an unknown name, the execution layer falls back to the full tool list and accepts the tool only if the incoming name matches an alias, never a primary name. This supports renamed tools without breaking old conversation transcripts or cached model completions.

## When To Use

- Your agent runtime supports an extensible set of tools (built-in, plugin, or both).
- You need cross-cutting defaults (permissions, concurrency, destructiveness) applied uniformly to every tool.
- You combine tools from multiple sources (built-in and plugin) into one pool and need cache-stable ordering.
- Feature flags or environment variables control which tools are available per session.
- Tools are renamed over time and old transcripts must continue to resolve correctly.
- Your tool catalog is large enough that sending every schema on every turn wastes tokens.
- Deny-rules or mode switches must hide tools from the model without leaving stale references.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Fail-closed safety defaults | A forgotten classification is safe, not dangerous | Some tools run slower than necessary until explicitly opted in |
| Single authoritative list | One place to add tools, one place to audit | All tool additions route through the same file, creating merge contention |
| Per-call concurrency classification | Accurate batching even for polymorphic tools | Classification runs on every dispatch, adding per-call overhead |
| Partition-sort-concatenate ordering | Prompt-cache keys survive plugin set changes | Plugin tools always appear after built-ins, regardless of name |
| Feature-flag gating at list construction | Consumers never replicate gating logic | Toggling a flag mid-session requires re-assembling the tool pool |
| Alias-based backward compatibility | Old transcripts and cached completions keep working | Alias set grows monotonically and must be checked on every unknown-name fallback |
| Deferred tool loading | Token budget scales with actually-used tools, not catalog size | Model must perform an extra discovery call before invoking a deferred tool |
| Deny-rule filtering at assembly AND execution | Defense in depth against stale tool pools | Permission logic runs twice per denied tool -- once at assembly, once at call |

## Implementation Patterns

- Define every tool through a single builder that fills safe defaults for all safety-relevant fields. Never construct a raw tool object directly -- the builder is the chokepoint for fail-closed defaults.
- Register feature-flagged tools inside the single authoritative list using conditional includes. Do not scatter conditional logic across consumers.
- Override the concurrency-safety classifier to return true only for genuinely read-only, stateless operations. The default is false.
- Override read-only and destructive flags independently. They are not derived from each other -- a tool can be read-only but flagged as destructive if it has security-relevant side effects.
- Provide a classifier hint for any tool with security-relevant side effects. An empty hint silently skips the security classifier, which may be the right choice for benign tools but is dangerous if omitted by accident on a sensitive one.
- Override the permission handler only when the tool needs logic beyond the general permission system (path-based access control, quota checks, etc.). The default should defer, not deny.
- Attach aliases to tool definitions when renaming. Do not remove old names immediately -- they must survive at least one full deprecation cycle.
- For tools that support deferred loading, attach a short search hint (a few words describing capabilities not already in the tool name) so the discovery mechanism can match user intent to deferred tools without sending full schemas.
- Set an explicit maximum result size for each tool. Use unbounded output only for tools where persisting output would create a circular dependency (a file-read tool summarizing its own output, for example).
- Assemble the combined tool pool through the registry's assembly function, never through ad-hoc concatenation. The assembly function handles deduplication, partition-stable sorting, and deny-rule filtering.
- Never call the full unfiltered list in hot paths (per-request). Always call through the narrowing chain so deny-rules and mode-gating are applied.
- For tools that create import cycles (tool A depends on module B which depends on the tool registry), load the tool lazily inside a getter rather than at module top-level. This breaks the cycle without runtime cost.

## Gotchas

**A concurrency classifier that throws is treated as "unsafe."** The dispatch layer wraps the classifier call in an error boundary and falls back to serial execution. A tool that throws during classification will silently serialize rather than crash. This is safe but can mask bugs -- monitor for unexpected serialization in tools that should be concurrent.

**Context modifiers from concurrent tools are deferred, not immediate.** When a batch of concurrent tools runs, any context-modification callbacks they produce are queued and applied after the entire batch completes, not after each individual tool. Tools in a concurrent batch must not depend on context changes made by sibling tools in the same batch.

**Mode-restricted tools are stripped from the pool, not just hidden.** If a runtime mode restricts which tools are available (e.g., a sandboxed REPL mode that replaces primitive file tools with VM-hosted equivalents), the restricted tools are removed from the pool entirely. Registering a tool in the authoritative list is not enough if the current mode excludes it.

**Deny-rule filtering happens at two layers, and both are necessary.** The assembly function filters by deny-rules so the model never sees blocked tools. But if the tool pool is assembled before deny-rules update (a mid-session config change, a dynamic policy push), the model may still attempt to call a now-denied tool. The execution layer must re-check permissions per call as a second line of defense.

**Built-ins win name collisions silently.** If a plugin registers a tool with the same name as a built-in, the built-in wins without warning. Log or alert when this happens to avoid invisible plugin tool shadows that waste plugin authors' time debugging.

**Deferred tools require a discovery step before invocation.** Tools marked for deferred loading are sent to the model without their full schema. If the model attempts to call a deferred tool without first performing a discovery query, schema validation will fail. The execution layer should return a hint pointing at the discovery mechanism, but this costs an extra round-trip.

## Claude Code Evidence

Claude Code's tool system is a production implementation of these principles, managing several dozen tools from multiple sources:

**Fail-closed defaults in a single builder.** The runtime defines a defaults object that sets concurrency-safe to false, read-only to false, and destructive to false. Every tool is constructed through a builder that merges the tool's overrides onto these defaults. Permission handling defaults to deferred allow, meaning tools that omit a custom permission check delegate entirely to the general permission system rather than silently passing or blocking.

**Single authoritative list with progressive narrowing.** One function returns the exhaustive candidate set, including feature-flagged tools gated by conditional includes. A second function narrows this list by stripping deny-ruled and mode-gated tools. A third function combines the narrowed built-ins with plugin-provided tools, sorting each partition independently for prompt-cache stability. Consumers always call the narrowest function appropriate for their context -- the unfiltered list is reserved for alias lookups and introspection.

**Per-call concurrency classification with input-dependent batching.** The dispatch layer calls each tool's concurrency classifier with the parsed input at dispatch time. A file-search tool, for example, is safe for read-only glob patterns but unsafe for patterns that trigger writes. Consecutive safe calls merge into one concurrent batch; any unsafe call starts a new serial batch. If the classifier throws, the runtime logs a warning and falls back to serial execution rather than crashing.

**Alias fallback for renamed tools.** When a tool call arrives for an unknown name, the execution layer loads the full unfiltered tool list and checks whether the name matches any tool's alias set. If it matches an alias, the tool is accepted; if it matches a primary name (which should have been found by the normal path), it is rejected to avoid masking a deeper bug. This design lets old conversation transcripts and cached completions survive tool renames without manual migration.

**Deferred loading for large tool catalogs.** Tools marked for deferred loading are sent to the model with a loading-deferred flag and no schema. The model must call a discovery mechanism (analogous to a search index over tool descriptions and hints) to retrieve the full schema before invocation. This keeps the per-turn token budget proportional to the tools actually used, not the size of the full catalog. The runtime attaches a short search hint to each deferred tool so the discovery mechanism can match user intent without sending full schemas on every turn.

**Lazy loading to break circular dependencies.** A small number of tools create import cycles because they depend on modules that themselves depend on the tool registry. These tools are loaded inside getter lambdas rather than at module top-level, deferring the import until first access and breaking the cycle without runtime cost or architectural compromise.
