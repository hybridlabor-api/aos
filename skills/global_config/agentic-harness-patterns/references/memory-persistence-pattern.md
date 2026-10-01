# Memory and Persistence Pattern

## Problem

Without persistent memory, an agent loses all user preferences, project context, and behavioral feedback the moment a session ends. Users must repeat corrections every session ("use bun, not npm"), and the agent cannot accumulate the working knowledge that makes it genuinely useful over time. A single flat memory store also fails: instruction-level rules need different durability than transient working notes, and organization-wide conventions must coexist with per-project and per-user overrides without colliding.

These problems emerge in any agent runtime that persists across sessions — they are not specific to a single implementation.

## Golden Rules

### Separate layers by scope and durability

Not all memory is equal. Instruction-level rules ("always use tabs") belong in version-controlled files that travel with the project. Personal workflow preferences ("open diffs in VS Code") belong in a user-scoped store that spans all projects. Transient working notes belong in an auto-memory layer that the agent manages itself. Merging these into a single store destroys the ability to share, audit, or override each independently. Design at least three tiers: organization/team, user, and project — with a local override that is never shared.

### Local overrides win — always

When the same topic is addressed at multiple scopes, the most-local instruction takes priority. Organization-wide policy sets the floor, user-level preferences narrow it, project-level conventions narrow further, and a local override file has final say. Concatenate layers in ascending priority order so the most-local content appears last and receives the most model attention. Builders must understand this hierarchy or they will set a global rule expecting it to dominate, only to have a local file silently override it.

### Taxonomize auto-memory by type, not by recency

Auto-memory entries should each carry a type drawn from a small, fixed taxonomy — who the user is, behavioral corrections, project context not derivable from code, and stable reference facts. A type taxonomy prevents the memory store from devolving into a chronological dump and makes it possible to audit, prune, and promote entries systematically. Exclude anything derivable from the codebase or version history — saving it wastes index space and goes stale.

### Two-step save: write the topic file, then update the index

Every memory write is a two-step operation: first write the full content to a dedicated topic file, then append a one-line pointer to the index. If the process crashes between steps, the worst outcome is an orphaned topic file — the index remains consistent. Never write memory content directly into the index; the index is a table of contents, not a document.

### The index is bounded always-on context; topic files are on-demand detail

The memory index is loaded into every conversation — its cost is paid on every turn. Keep it small: one line per entry, under a hard line-count and byte-count cap with a truncation warning when the cap fires. Full detail lives in topic files that the agent recalls on demand. This separation keeps context cost constant regardless of how much the agent has learned.

### Background extraction writes directly to auto-memory

Session memory extraction should run as a background process that reads the session transcript after the agent produces a final response. The extractor directly writes auto-memory entries — topic files and index updates — following the same two-step save invariant used by the main agent. This keeps extraction off the critical path (no added latency to user-visible responses) while producing durable memories autonomously. Human control is preserved at the cross-layer boundary: promoting auto-memory entries to project conventions, personal instructions, or team-shared memory is a separate propose-and-review workflow that never applies changes without explicit approval.

### The main agent and the extraction agent are mutually exclusive

If the main agent wrote to memory during a turn (because the user explicitly asked it to remember something), the background extractor skips that turn entirely and advances its cursor. Two writers targeting the same memory store in the same turn will produce conflicts. Enforce mutual exclusion per turn, not per file.

### Sandbox the extraction agent

The background extractor runs with restricted permissions: it may read freely but may only write to the auto-memory directory, and it must not execute arbitrary commands. Cap its turn count (a small number like five) to prevent verification rabbit-holes. It shares the parent's prompt cache to keep cost low, but it must not inherit the parent's full write surface.

## When To Use

- Your agent persists across sessions and must recall user preferences, project context, or behavioral corrections.
- Multiple scopes of instruction coexist (organization, user, project, local) and need a clear priority ordering.
- The agent should learn from sessions without the user manually curating a knowledge base.
- You need a cross-layer review process that proposes promotions between memory tiers.
- Your runtime supports background work and you want extraction to happen without blocking the user.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Layered memory with four+ scopes | Each scope can be shared, audited, and overridden independently | More files to discover and concatenate at startup |
| Local-wins priority ordering | Users can always override without touching shared files | A global rule can be silently overridden — surprising if untested with the full stack |
| Type taxonomy for auto-memory | Structured pruning, promotion, and audit | Taxonomy must be defined upfront; miscategorized entries degrade quality |
| Two-step save (topic file then index) | Crash-safe — index never points at missing content, orphaned files are harmless | Two writes per save; cleanup of orphaned topic files is a separate concern |
| Bounded index with on-demand topic files | Constant context cost regardless of total memory volume | Agent must perform an extra retrieval step to access full detail |
| Background extraction via forked agent | No latency added to user-visible responses; shares prompt cache | Race window between extraction and next user turn; failed extractions may retry stale content |
| Mutual exclusion per turn | No write conflicts between main agent and extractor | Extraction is skipped entirely when the main agent writes — some turns produce no extraction |
| Sandboxed extractor with turn cap | Prevents runaway loops and unintended side effects | May miss nuanced memories that require deeper reasoning |
| Propose-not-auto-write for cross-layer promotion | Human stays in control of what enters shared or version-controlled memory | Adds a manual review step; unreviewed proposals accumulate |

## Implementation Patterns

- Define a small, fixed taxonomy of auto-memory types (e.g., user identity, behavioral feedback, project context, stable reference) and document what belongs in each. Exclude anything derivable from the codebase or version history.
- Ensure the memory directory exists before the agent's first write via an idempotent creation step. Do not ask the agent to check for existence at runtime.
- Treat the memory index as a table of contents: one line per entry with a title, a link to the topic file, and a one-line summary hook. Enforce a per-entry character budget (around 150 characters) to stay within the index's hard caps.
- Give each topic file structured frontmatter with at minimum a name, description, and type field drawn from the taxonomy.
- Implement the two-step save invariant: write the topic file first, then append to the index. Never reverse the order.
- Discover instruction files at startup by walking a known hierarchy of locations (organization-managed, user home, project root and ancestors, local override). Concatenate in ascending priority order.
- Support an include directive in instruction files so that large configurations can be composed from smaller fragments.
- Fire background extraction only after the agent produces a final response with no pending tool calls. If the main agent wrote to memory during that turn, skip extraction and advance the cursor.
- Restrict the extraction agent's write surface to the auto-memory directory. Allow reads broadly but deny arbitrary command execution.
- Cap extraction turns at a small number to prevent verification loops. Coalesce concurrent extraction requests so only one runs at a time.
- Drain in-flight extractions before process shutdown, after the response is flushed but before any shutdown failsafe timer fires.
- Build a review mechanism that audits across all layers and proposes promotions (to project conventions, personal instructions, team-shared memory, or remain in auto-memory) — but never applies changes without explicit user approval.
- Provide an environment variable or setting to disable auto-memory entirely for contexts where persistence is undesirable (ephemeral runs, CI, remote sandboxes).

## Gotchas

**Index truncation is silent until it fires.** Hard caps on line count and byte count are enforced at read time. Long-line entries (multi-sentence summaries instead of one-line hooks) can hit the byte cap while staying under the line cap. Keep entries short and put detail in topic files.

**Priority ordering is counterintuitive.** Local overrides beat project rules, which beat user rules, which beat organization rules. If you inject a rule at the user level expecting it to dominate, a local override file in the project root will silently win. Always test with the full instruction-file stack present.

**Extraction timing creates a race window.** The background extractor fires at the end of a response, but the user can start the next turn before extraction completes. The overlap guard coalesces concurrent calls and the cursor only advances after a successful run — but a failed extraction means those messages are reconsidered next time, potentially producing duplicate proposals.

**Derivable content does not belong in memory.** Architecture, code patterns, and version history are re-derivable from the project itself. Saving them wastes index space and goes stale. The type taxonomy should exclude derivable content by design, but agents will still attempt to save it unless the prompt explicitly forbids it.

**Team-shared memory depends on auto-memory being enabled.** If auto-memory is disabled (via environment variable or settings), team memory is also disabled because the shared layer builds on the same directory and index infrastructure. Disabling one silently disables both.

**Do not use memory for within-session state.** Plans, task lists, and scratchpads are better handled by dedicated in-session primitives. Memory is for cross-session recall only. Mixing the two inflates the index with ephemeral content that is stale by the next session.

**Orphaned topic files are harmless but accumulate.** If the process crashes after writing a topic file but before updating the index, the topic file becomes an orphan. Orphans do not corrupt the index, but they consume disk space. A periodic sweep that deletes topic files not referenced by the index is a reasonable maintenance step.

## Claude Code Evidence

Claude Code's memory system is a production implementation of these principles across five cooperating subsystems:

**Four-level instruction hierarchy.** Claude Code discovers CLAUDE.md files at four scopes: a managed location for organization-wide policy, a user-home location for personal instructions, project-root and ancestor-directory locations for project conventions (including a rules subdirectory), and a CLAUDE.local.md file for private per-project overrides that is never checked into version control. Files are concatenated in ascending priority order so local overrides appear last in the prompt. An @include directive allows composition from fragments. A recommended per-file character cap prevents any single instruction file from dominating context.

**Four-type auto-memory with bounded index.** Auto-memory lives in a per-project directory with a MEMORY.md index and individual topic files. Each topic file carries YAML frontmatter with name, description, and type fields. The four types — user, feedback, project, and reference — are documented in the prompt so the agent categorizes entries consistently. The index is capped at 200 lines and 25,000 bytes; a truncation warning is appended when either cap fires. The directory is created idempotently before prompt construction so the agent never encounters a missing path.

**Team memory as a shared extension.** When a feature gate and an enablement check both pass, a second directory within the same project slug is added for team-shared memory. It uses the same four-type taxonomy and index structure. Team memory requires auto-memory to be enabled — disabling auto-memory via environment variable also disables team memory.

**Background session extraction with mutual exclusion.** At the end of each query loop, a forked sub-agent examines the session transcript and writes memories directly to the auto-memory directory. The fork shares the parent's prompt cache to keep cost low. If the main agent already wrote to a memory path during that turn, the extractor skips entirely and advances its read cursor. The extractor's tool permissions are restricted: it may read, search, and glob freely, but may only write to the auto-memory directory and may not execute arbitrary shell commands. A hard turn cap of five prevents verification rabbit-holes. Concurrent extraction requests are coalesced so only one runs at a time, with a trailing run picking up any messages that arrived during the active run. In-flight extractions are drained after the response is flushed but before the shutdown failsafe timer fires.

**Propose-not-auto-write review skill.** A bundled "remember" skill audits across all memory layers and proposes promotions grouped by action: promote to project conventions, promote to personal instructions, promote to team memory, clean up, ambiguous, or no action. It never applies changes autonomously — it presents a structured report and waits for explicit user approval before touching any files. The four promotion destinations mirror the four instruction-file scopes.
