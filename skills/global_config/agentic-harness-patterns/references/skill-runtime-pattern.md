# Skill Runtime and Packaging Pattern

## Problem

Without a skill system, every reusable workflow must be re-explained in each conversation. The agent cannot self-select behaviors from a library of instructions, and there is no structured way to package permissions, model overrides, or lifecycle hooks alongside a prompt. The agent becomes a blank slate on each invocation, requiring the user to manually reconstruct context for repeated tasks.

A skill system introduces its own scaling problem: if the runtime loads every skill's full body into the system prompt, the context window fills before the first user message arrives. The runtime needs a discovery layer that is cheap enough to run at startup and a loading layer that defers the expensive content until the moment the skill is actually invoked.

These problems emerge in any agent runtime that supports reusable instruction sets — they are not specific to a single implementation.

## Golden Rules

### Metadata must have a single source of truth

All skill metadata — name, description, trigger hints, tool permissions, execution mode, hooks — should be co-located with the skill's instruction content rather than split into a separate sidecar file. A separate metadata file (JSON manifest, YAML config, etc.) creates a synchronization problem: the two sources can drift, and the runtime must decide which wins. A single source of truth eliminates this class of bug entirely. Common implementations use frontmatter blocks, header annotations, or inline structured comments — the specific mechanism matters less than the guarantee that there is exactly one authoritative location for each metadata field.

### Discovery is budget-constrained; loading is lazy

At startup, the runtime lists all available skills in the system prompt so the model knows what it can invoke. This listing includes only metadata — a short description and trigger hints per skill — never the full body. Each entry is hard-capped at a fixed character limit, and the total listing is capped at a small fraction of the context window (on the order of one percent). The full skill body is loaded only when the model or user actually invokes the skill. This two-phase approach — cheap discovery, deferred loading — keeps the first-turn prompt small and cacheable while preserving the model's ability to self-select the right skill.

### Trigger language is a design surface, not an afterthought

A skill has two distinct text fields for discovery: a short label (the description) and a detailed trigger guide (the "when to use" field). The description is what appears in listings. The trigger guide carries example phrases, situational cues, and invocation conditions that help the model decide when to activate the skill automatically. Both fields are concatenated for the discovery listing, but separating them lets authors write a concise label and a verbose trigger guide without conflating the two. The quality of trigger language directly determines whether the model selects the right skill without user intervention.

### Bundled skills are privileged but not exempt from all limits

Skills compiled into the agent binary occupy a privileged trust tier. When budget pressure forces the listing to shrink, bundled entries retain their full descriptions while external entries are progressively trimmed. However, all entries — including bundled — face a per-entry character cap on the concatenated description. Bundled skills are also registered programmatically rather than discovered from the filesystem, and their assets are extracted securely at runtime. This privilege reflects a trust boundary: bundled skills are authored by the runtime maintainers and can be granted capabilities that external skills cannot.

### Inline is the default; isolation is opt-in

When a skill executes inline, its content is injected into the current conversation as a user message and the model processes it within the existing context. The user can steer the skill mid-execution, and the skill's work is visible in the conversation history. Isolated (forked) execution spawns a separate sub-agent with its own token budget and its own conversation context. The parent sees only the final result. Isolation is opt-in — the skill author must explicitly declare it — because inline execution is almost always preferable: it is simpler, more transparent, and allows human-in-the-loop steering.

### Deduplication follows the filesystem, not the name

When skills are loaded from multiple overlapping directories (user-wide, project-local, plugin), the same physical file can appear under different search paths. The runtime resolves each skill file to its canonical filesystem path and deduplicates on that identity. This prevents the same skill from appearing twice in the listing and avoids double-registration bugs without requiring unique naming conventions across independent skill sources.

## When To Use

- Your agent needs a library of reusable instruction sets that persist across conversations.
- You need to list available capabilities in the system prompt without exhausting the context window.
- Skills come from multiple trust levels — built-in, user-installed, project-local, and remote/plugin sources.
- Some skills must run in isolation to avoid contaminating the parent conversation's context.
- You want skill authors to package permissions, model preferences, and hooks alongside the instructions themselves.
- The skill catalog is large enough that naive full-body inclusion would crowd out the user's actual work.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Co-located metadata as sole source | Single source of truth, no sync bugs | All metadata must fit the chosen co-location format |
| Budget-capped discovery listing | First-turn prompt stays small and cacheable | Long descriptions are silently truncated; model may miss poorly-described skills |
| Lazy body loading on invocation | Context window is not wasted on unused skills | One extra round-trip to load content at invocation time |
| Inline execution by default | User can steer mid-process; work is visible | Skill output consumes parent context window tokens |
| Opt-in isolated (forked) execution | Clean context boundary; parent stays uncluttered | Forked skill cannot read or write parent conversation state |
| Bundled skills exempt from budget degradation | Core capabilities retain descriptions under pressure | Non-bundled skills get less budget headroom as bundled catalog grows |
| Realpath-based deduplication | Same file is never listed twice regardless of symlinks | Depends on filesystem returning consistent canonical paths |
| Secure exclusive-create for bundled asset extraction | Prevents symlink-following attacks on temp directories | Slightly more complex file creation; requires exclusive-open semantics |

## Implementation Patterns

- Discover skills from four source categories at startup: bundled (compiled-in), user-installed (user home directory), project-local (workspace directory), and plugin/remote (MCP or equivalent). Load them in this order so that precedence is predictable.
- Parse only the co-located metadata block of each skill file (e.g., YAML frontmatter). Extract at minimum: name, description, trigger hints, tool permissions, execution mode, and any hook definitions. Ignore sidecar files entirely.
- Register each discovered skill as a command object with a deferred body loader — a closure or callback that reads the full Markdown content only when the skill is invoked. Do not read the body at discovery time.
- Resolve each skill file to its canonical filesystem path before registration. If two search paths yield the same canonical path, register the skill only once.
- Build the discovery listing by concatenating each skill's description and trigger hints, then hard-truncating each entry at a fixed character limit. Sum all entries and cap the total at a small percentage of the context window.
- When budget pressure forces truncation, apply a graceful degradation sequence: first drop trigger hints from non-bundled skills, then drop descriptions entirely, then fall back to names only. Bundled skills are exempt from degradation but still face the per-entry character cap.
- On invocation, check the skill's declared execution mode. If inline (the default), inject the skill's full Markdown body as a user message in the current conversation. If isolated, spawn a sub-agent with its own token budget, run the skill body there, and return only the result text to the parent.
- For bundled skills that include reference files, extract those files to a per-process temporary directory at first invocation. Use exclusive-create file semantics (fail if the file already exists) and refuse to follow symlinks during extraction to prevent symlink-based attacks.
- Block inline shell execution for skills sourced from untrusted remote origins. Only bundled and local disk skills should be able to embed executable commands.
- Validate that skills declaring restricted invocation modes (such as "model cannot invoke this skill") are enforced at the tool validation layer, not at the listing layer. The skill should still appear in listings if appropriate; the restriction applies only to programmatic invocation by the model.

## Gotchas

**There is no sidecar metadata file.** All metadata must live co-located with the skill's instruction content (e.g., in a frontmatter block). If a runtime consumer places a separate JSON or YAML metadata file next to the skill document, it should be silently ignored. This is the most common integration mistake.

**Description truncation is silent.** If the combined description and trigger-hint text exceeds the per-entry character cap, the listing entry is hard-truncated with an ellipsis. The model sees the truncated version and may fail to trigger the skill. Keep both fields concise, or accept reduced auto-invocation reliability.

**Forked execution discards parent conversation state.** A skill running in isolated mode cannot read or modify the parent's conversation messages. It receives a fresh context. Use inline execution for any skill that needs to observe or update the ongoing conversation.

**Budget overflow degrades non-bundled skills first.** If non-bundled skills collectively exceed the remaining character budget after bundled entries are reserved, non-bundled entries progressively lose their descriptions, then fall to names-only. The model can still invoke them by name but cannot auto-select them based on purpose. Authors who depend on auto-invocation must keep their metadata compact.

**Realpath deduplication depends on filesystem fidelity.** On virtual, container, or network filesystems that return degenerate inode values, realpath-based deduplication may behave unexpectedly. On filesystems with inode precision loss, false deduplication can occur. The runtime should use canonical path resolution consistently rather than mixing inode and path strategies.

**Restricted invocation modes are not the same as hidden skills.** A flag that prevents the model from invoking a skill programmatically is distinct from a flag that hides the skill from user-facing listings. A skill can be visible to users but blocked from model invocation, or vice versa. Confusing the two creates either a security gap or a usability gap.

**Invalid hook schemas are silently dropped.** If a skill declares hooks in its frontmatter but the schema does not match what the runtime expects, the hooks are ignored without an error. The skill loads and runs, but the hooks never fire. Validate hook schemas during development, not in production.

## Claude Code Evidence

Claude Code's skill system is a production implementation of these principles, supporting four distinct skill sources and managing discovery under tight budget constraints.

**Four-source discovery architecture.** Skills are loaded from bundled (compiled directly into the binary), user-installed (under the user's home configuration directory), project-local (under the workspace configuration directory), and MCP-sourced (remote plugin) origins. Each source is scanned independently at startup and merged into a single command registry. Symlink-aware deduplication ensures that overlapping directories — common when a user's home config and project config share symlinked skill directories — never produce duplicate listings.

**YAML frontmatter as the metadata contract.** Claude Code uses YAML frontmatter at the top of each skill's Markdown file as the single source of truth for all metadata. There is no sidecar metadata file — if one exists alongside a skill document, it is silently ignored. This eliminates the synchronization bugs that arise when metadata lives in two places.

**Budget-constrained listing with graceful degradation.** The listing budget is set at one percent of the context window, with each individual entry capped at 250 characters — a cap that applies to all entries, including bundled. Each entry concatenates the skill's short description, a separator, and its trigger-hint text. When the non-bundled catalog exceeds the remaining budget after bundled entries are reserved, the runtime progressively strips descriptions from non-bundled skills, eventually reducing them to bare names. Bundled skills are not subject to this degradation — they retain their full (but character-capped) descriptions regardless of budget pressure.

**Lazy body loading via deferred closures.** Each skill registers a deferred body loader at discovery time rather than reading its full Markdown content upfront. The body is materialized only when the model or user invokes the skill. This keeps startup fast and the first-turn system prompt compact — critical for turn-one cache efficiency in production workloads with large skill catalogs.

**Inline versus forked execution.** The default execution path injects the skill body directly into the parent conversation. When a skill declares isolated context, the runtime spawns a forked sub-agent with its own token budget, runs the skill body there, and returns only the result text. The fork path is explicitly opt-in because inline execution is almost always preferable — it allows the user to steer mid-process and keeps the skill's intermediate reasoning visible.

**Secure extraction of bundled skill assets.** Bundled skills that ship with reference files extract those files to a per-process temporary directory using exclusive-create semantics and symlink-following prevention. The directory name includes a cryptographic nonce to resist path prediction attacks. This design reflects the principle that even trusted, compiled-in assets should be extracted defensively — the temporary filesystem is a shared attack surface.

**Trigger language as a first-class design surface.** The separation of description and trigger-hint fields is deliberate. Skill authors are guided to write a short, human-readable description and a separate, detailed trigger guide starting with phrases like "Use when..." followed by example user utterances. The concatenated form is what the model sees in the discovery listing, but the structural separation encourages authors to optimize each field for its purpose rather than cramming everything into a single line.
