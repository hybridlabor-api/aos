# Context Selection and Progressive Disclosure

## Problem

Agent runtimes that eagerly load all available context on every turn pay a compounding tax: token costs grow with catalog size, startup latency scales with the number of information sources, and concurrent agents duplicate the same expensive I/O. The model receives thousands of tokens it never reads while the data it actually needs arrives late or not at all. Without deliberate selection, the context window becomes a landfill — technically full, practically empty.

These problems appear in any agent that maintains a growing skill catalog, reads from multiple persistent stores, or serves concurrent requests. They are not specific to any single runtime.

## Golden Rules

### Lazy beats eager

Load context at the moment it becomes relevant, not at the moment the session starts. Eagerly injecting everything "just in case" means every API call pays for tokens the model may never use. Deferring the load means you pay only when the model actually activates a capability. The one-time latency of a just-in-time fetch is almost always cheaper than the per-turn cost of a bloated prompt.

### Three-tier progressive disclosure

Structure every context source into three tiers of increasing cost:

1. **Metadata** (~100 tokens per item): names, descriptions, and trigger hints. Always present. This is the "is this relevant?" signal.
2. **Instructions** (bounded, e.g. < 5000 tokens): the full body of the activated capability. Loaded only on activation.
3. **Resources** (unbounded): reference files, scripts, data assets. Loaded only when the agent explicitly requests them.

The discovery cost (tier 1) scales with catalog size, but the execution cost (tiers 2-3) is constant per activated item. Keeping discovery cheap lets you maintain a large catalog without paying for it on every turn.

### Memoize the promise, not the result

When multiple callers request the same expensive context simultaneously, memoize the in-flight promise so all callers share a single I/O operation. Memoizing only the resolved value creates a window where concurrent callers each see the cache as empty and launch duplicate work. The promise itself is the deduplication key.

### Invalidate at the mutation site, not on a timer

Cache expiration based on time or reactive subscriptions either serves stale data or rebuilds too often. Instead, place explicit invalidation calls at each known mutation point. This is more work to maintain — every new write path must add its own invalidation — but it guarantees that the cache is exactly as fresh as the most recent deliberate change.

## When To Use

- The skill or capability catalog is growing and the always-on prompt is becoming expensive.
- Startup latency is high because context is built eagerly on every turn.
- Multiple concurrent agents or invocations duplicate the same expensive I/O.
- You need to support a large catalog without linearly increasing per-turn token cost.
- Context sources span multiple directories, stores, or services that may overlap.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Lazy loading | Low idle token cost | One round-trip latency on first activation |
| Progressive disclosure (3 tiers) | Large catalogs stay cheap | Model cannot reason about unactivated capabilities |
| Promise memoization | No duplicate I/O under concurrency | Cache logic is more subtle than simple value caching |
| Manual invalidation at mutation sites | Only rebuilds when necessary | Every new write path must include its own invalidation call |
| Token budget for discovery tier | Catalog cost is bounded and predictable | Each entry must fit within a tight character cap |
| Path-conditional activation | Domain-specific skills stay dormant until relevant | Activation state must survive process restarts or be re-evaluated |

## Implementation Patterns

- Wrap every expensive context builder in a memoized async function. Store the promise itself so concurrent callers share the same in-flight request rather than spawning duplicate I/O.
- Expose a named cache-clear call for each memoized builder. Invoke it only from known mutation handlers — never from a general observer or polling loop.
- For capability catalogs, compute an estimated token count from metadata fields only (name, description, trigger hint). Store the full body in a deferred closure, fetched only on activation.
- Cap the total discovery-tier budget at a fixed fraction of the context window (e.g., ~1%), with each entry limited to a tight character ceiling.
- Use path-condition metadata to gate domain-specific capabilities: a capability stays dormant until a matching file or directory is touched in the session.
- Deduplicate multi-source loads by canonical path. Resolve symlinks and normalize before inserting into the active set — string comparison of original paths produces false negatives, and inode comparison is unreliable on virtual or network filesystems.
- Mark shared state as deeply immutable. Document any fields excluded from the immutability wrapper (e.g., function-typed fields) at the point of exclusion, not silently.

## Gotchas

**Stale context after mutation.** Because the cache never expires automatically, any external change (new file, toggled flag, updated store) is invisible until the cache is explicitly cleared. Every mutation point must call the corresponding invalidation. Missing one means the model operates on stale data for the rest of the session.

**Concurrent initialization races without promise memoization.** If two invocations trigger the same extraction simultaneously and both see the cache as empty, both will attempt the same I/O. Only one will succeed cleanly; the other may fail or produce corrupt output. Memoizing the promise eliminates the race entirely.

**Premature disclosure inflates every turn.** Injecting full capability bodies into the system prompt means every API call pays for tokens the model may never use. With 20+ capabilities, this can consume a significant share of the context budget before the first user message arrives.

**Conditional capabilities must track activation state.** Capabilities gated by path conditions are dormant until a matching file is touched. If activation state is lost (e.g., process restart), the capability must be re-evaluated against current context — otherwise it silently disappears from the session.

**Deduplication must use canonical paths, not original paths.** The same file can appear under different paths when symlinks, mounts, or multiple search directories are involved. String comparison of the original paths will miss duplicates; resolve to canonical paths before comparing.

## Claude Code Evidence

Claude Code's context system is a production implementation of these principles, managing a growing catalog of skills across multiple source directories:

**Memoize-plus-manual-invalidate, not reactive subscriptions.** Both the system context builder and the user context builder are memoized async functions. The cache persists for the entire process lifetime. When something must change — for instance, a system prompt injection is updated — the runtime calls cache-clear explicitly at that specific mutation point. This is a deliberate choice: context is cheap to serve from cache and expensive to rebuild. A reactive model that rebuilt on every state update would defeat the purpose of caching entirely.

**Promise memoization for concurrent initialization.** The bundled skills extraction stores the extraction promise itself rather than the resolved value. If two skill invocations race during startup, both await the same promise. Without this design, both would attempt to write the same extracted files concurrently, and the second would fail or corrupt the output.

**Token count as the gating metric for progressive disclosure.** The skill loader computes an estimated token count from only the name, description, and trigger hint fields — never from the full markdown body. The body is stored in a deferred closure and fetched only at invocation time. This cleanly separates the "is this relevant?" signal (cheap, always present) from the "what does this skill do?" content (expensive, deferred). The total listing budget is capped at roughly one percent of the context window, with each entry limited to approximately 250 characters.

**Realpath deduplication across multiple source directories.** When loading skills from managed, user, project, and additional directories, the same skill file can appear under symlinked paths. The loader resolves every file to its canonical path before inserting into a seen-set. The team chose canonical-path comparison over inode comparison because inodes are unreliable on virtual and network filesystems.

**Deeply immutable shared state.** The main application state is wrapped in a deep-immutability type to prevent accidental in-place mutation across concurrent agents. Task state is excluded from the immutability wrapper because it contains function types that the wrapper cannot handle — but the exclusion is documented at the point of exclusion, not silently dropped.
