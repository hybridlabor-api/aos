# Context Profiles in BDB Agent OS (AOS)

Context Profiles allow users to select an operational role (`full`, `orchestrator`, `worker`, `small`) to lower start-of-session token consumption without removing any functionality by default.

Default profile: **`full`** (nothing is removed; fully backward-compatible).

---

## 1. Context Profiles Overview

| Profile | Role & Purpose | Gateway MCP Tools | SessionStart Hooks Cap | Estimated Startup Tokens |
|---|---|---|---|---|
| **`full`** *(default)* | Full suite of 300+ tools across all domains (engineering, media, show control, 3D, reverse-engineering). | All tools exposed (`preset=all`) | 2,000 chars | ~62,000 tokens |
| **`orchestrator`** | Multi-agent coordination, architecture planning, dynamic workflow dispatch. Keeps all skills and broad tool access. | All tools exposed (`preset=all`) | 2,000 chars | ~62,000 tokens |
| **`worker`** | Focused engineering (coding, refactoring, testing, git, database, memory). Media upstreams excluded. | Core tools only (`preset=worker`) | 2,000 chars | ~47,300 tokens *(saves ~21.6k)* |
| **`small`** | Low-context, fast, or local models. Minimizes tool catalog and startup context bloat. | Core tools only (`preset=small`) | 1,000 chars | ~47,200 tokens *(saves ~21.7k)* |

---

## 2. Startup Token Breakdown: Measured vs. Estimated

Based on empirical measurements from the context audit (`_context-audit/report.md`), start-of-session token consumption breaks down across components as follows:

| Component | Audit Baseline (Full) | Optimized Profile (`worker` / `small`) | Mechanism |
|---|---|---|---|
| **Gateway MCP Catalog** | ~25,738 tokens (303 tools) | ~4,200 tokens (~45 tools) | Gateway URL preset query (`?preset=worker`). Excludes 10 media upstreams (`davinci`, `unreal`, `blender`, `grandma3`, `touchdesigner`, `after-effects`, `resolume`, `rhino`, `vectorworks`, `uxp`). With gateway lazy loading (default on) the catalog is 3 meta-tools (`tool_list`, `tool_schema`, `tool_invoke`) until a schema is requested; the figures here are the non-lazy baseline. Opt out: `lazyLoading: false` in `~/.agents/gateway/gateway.json`. |
| **Skill Frontmatter Index** | ~17,930 tokens | ~17,930 tokens (no reduction) | Every installed skill is listed by Claude Code; profiles cannot hide skills. The validator only warns (`W-DESC01`) when a description exceeds 250 characters. |
| **Agent Manifest** | ~4,371 tokens (45 agents) | ~4,371 tokens | Provided by the `bdb-aos` plugin. `aos doctor` detects and warns on redundant copies in `~/.claude/agents`. |
| **Workspace Instructions & Memory** | ~3,848 tokens | ~3,848 tokens | `AGENTS.md`, `CLAUDE.md`, and project context rules. |
| **MCP Server Instructions** | ~557 tokens | ~557 tokens | OpenWiki MCP instructions. |
| **SessionStart Hooks** | ~413 tokens | ~100–350 tokens | Capped at 2,000 characters; disabled via `AOS_SESSION_START_CONTEXT=off`. |
| **Harness Preamble & Base Tools** | ~16,093 tokens | ~16,093 tokens | Fixed harness overhead (Anthropic system prompt, tool definitions). |
| **Total Startup Tokens** | **~68,950 tokens** | **~47,300 tokens** | **Net savings: ~21,600 tokens (~31% reduction)** |

---

## 3. How to Change Context Profile

### Method A: `aos context` CLI Command
Check the active context profile and breakdown:
```bash
aos context
```
Switch to a specific profile:
```bash
aos context worker
# or: aos context small, aos context orchestrator, aos context full
```

### Method B: Interactive Settings Menu
1. Run `aos` (when installed, opens the operation menu).
2. Choose **Settings**.
3. Select **Context Profile (now: <current>)**.
4. Select `full`, `orchestrator`, `worker`, or `small`.

### Method C: Setup Wizard
Run `aos setup` (or initial installation) to answer the Context Profile step interactively.

---

## 4. How the Gateway Preset Mechanism Works

The AOS MCP Gateway runs on `127.0.0.1:7790` (managed by 1mcp). 1mcp natively supports server filtering via the `?preset=<name>` HTTP URL query parameter.

When `context` is set to `worker` or `small` in `~/.aos/v5-settings.json`, `pkg-gateway.js` and `lib/gateway/harness.js` configure the harness entry:
- **Claude Desktop / Claude Code (`~/.claude.json`)**:
  ```json
  "aos": {
    "type": "sse",
    "url": "http://127.0.0.1:7790/mcp?preset=worker"
  }
  ```
- **ChatGPT Codex CLI (`~/.codex/config.toml`)**:
  ```toml
  [mcp_servers.aos]
  url = "http://127.0.0.1:7790/mcp?preset=worker"
  ```
The 10 media upstream servers (which contribute ~162 tools and ~21.5k tokens) are excluded from the catalog. They remain accessible on demand if the user opts in or switches to the `full` profile.

---

## 5. What is NOT Possible (Harness Limitations)

To maintain absolute architectural integrity and adhere to the zero-guesswork rule, the following capabilities cannot be implemented due to harness platform constraints:

1. **Dynamic Skill Filtering per Role in Claude Code**:
   - Claude Code automatically discovers and indexes *all* skills located in installed plugins (`bdb-aos`) and in `~/.claude/skills`.
   - Claude Code provides no configuration setting or hook mechanism to hide a subset of skills from the system prompt dynamically without physically deleting or modifying the skill files.
   - Therefore, all skills remain visible to orchestrators and workers alike. Skill descriptions are not reduced by any profile; the 250-character budget only produces a validator warning (`W-DESC01`).

2. **Role-Based Dynamic Agent Hiding**:
   - Claude Code automatically reads every agent file in `~/.claude/agents` and in active plugins. There is no whitelist/blacklist setting in `settings.json` for selective agent loading.
   - AOS mitigates waste by detecting duplicates with `aos doctor` to prevent identical agents being loaded twice (from both `~/.claude/agents` and the plugin).

3. **Suppressing `CLAUDE.md` or Auto-Memory**:
   - Claude Code always reads project `CLAUDE.md` and `~/.claude.json` / `MEMORY.md`. These cannot be suppressed conditionally via profiles.

4. **Trimming Harness Base Prompts**:
   - The ~16k tokens of harness preamble, built-in tool definitions (Bash, Edit, Glob, Grep), and safety instructions are injected by Anthropic servers and cannot be modified or reduced by client-side configuration.

---

## 6. Measured injected context (before / after)

`node scripts/measure-session-context.mjs --home DIR [--cwd DIR] [--prompts N] [--json]` sums the text a fresh Claude Code session gets from files under a HOME, from the same sources as the context viewer: `CLAUDE.md`, `MEMORY.md` of the cwd project, the skill and agent listings (name + description of `~/.claude/skills`, `~/.claude/agents` and plugin caches), and the real output of the context hooks (`memb-inject`, `rules-inject`, `aos-session-hint`) run against the `SessionStart` and `UserPromptSubmit` entries of `HOME/.claude/settings.json`. Tokens are chars / 4.

**Not measurable from files (Claude Code itself):** the system prompt, built-in tool schemas, MCP server instructions, and MCP / connector tool names. Per the viewer these are the bulk of what remains after the AOS parts are trimmed.

Run: temp HOME per commit, hooks installed with `installGlobalHooks` (base = `b970a259`, i.e. the 5.3.x behaviour of the hooks; after = this branch), real `~/CLAUDE.md` and `MEMORY.md` copied in, no memB database (memb-inject prints nothing), 8 prompts. Skills and agents are not installed in either HOME (the skill and agent listings are changed by another workstream; the viewer shows ~16.6k tokens skills, ~4.7k duplicate agents before that fix).

| Part | Base (chars) | After (chars) |
|---|---|---|
| CLAUDE.md + MEMORY.md | 11,070 | 11,070 |
| SessionStart hooks | 368 | 368 |
| UserPromptSubmit rules block, prompt 1 | 2,939 | 2,939 |
| UserPromptSubmit rules block, prompts 2..8 | 2,939 each (20,573) | 0 |
| **Hook text after 8 prompts** | **23,880 (~5,970 tok)** | **3,307 (~827 tok)** |
| Session total after 8 prompts (files only) | 34,950 (~8,740 tok) | 14,377 (~3,600 tok) |

Rules text alone: ~735 tokens per prompt before, ~735 tokens once per session (plus once after each `/clear` or compaction) after. A 20-prompt session saves ~14k tokens of conversation context from this hook, and the saving grows with every prompt. The total effect on a brand new session (prompt 1 only) is zero for the rules; the per-profile `small` cap shortens `memb-inject` and `aos-session-hint` output to 1,000 chars (unit-tested in `tests/rules-inject.test.js`; the empty-memB run above never reaches the cap).

A rule block is also skipped when the project `AGENTS.md`/`CLAUDE.md` already holds it. If a hook is killed by its timeout before it writes the marker (heavy load), the block is simply injected once more on the next prompt.

## 7. Per-harness verification of install and context profiles

| Harness | Install profile `minimal` / `--no-hooks` | Context profile `small` |
|---|---|---|
| Claude Code | Context hooks dropped from `settings.json` (`dropContextHooks`); gates stay. Verified in `mergeBdbSettingsHooks`. | SessionStart text capped by `session-cap.mjs` (new). Gateway entry gets `?preset=small` via `harness.enable({ contextProfile })`. Skills, agents, CLAUDE.md, MEMORY.md cannot be reduced. |
| Codex | `mergeCodexTomlHooks` writes the gate-only snippet when `contextHooksOn` is false. Verified by code reading. | Same hook scripts, so the cap applies (`session-cap.mjs` is in the Codex copy list through `HOOK_IMPORTS`). Gateway preset per section 4. |
| agy | `aos-trail-relay` is deleted explicitly; removal of `aos-context` (`PreInvocation`) goes through `droppedHook` and was not traced end to end (unverified). | Cap applies to `memb-inject`. `rules-inject` is now once per `conversationId`. |
| OpenCode | `aos-profile.json` flag (`contextHooks:false`) switches memB, rules and trail off in the plugin. The `--help` text claimed the opposite; corrected. | Gap fixed: the plugin did not cap memB text at all; it now uses `session-cap.mjs`. |

Open gaps (not fixed, need a decision or an unverified API):
- **OpenCode compaction re-arm**: the plugin resets the once-per-session flag on a `session.compacted` event; that event name is unverified against the OpenCode SDK. Without it the rules are sent once per session only.
- **agy / Codex compaction re-arm**: no known SessionStart `source` for agy; Codex SessionStart `source` values (`clear`, `compact`) are unverified. The instruction-file rule block is the safety net there.
- **Gateway presets**: `small` and `worker` presets exist only when 1mcp created them (`createPresets` falls back to the plain URL with a warning); not exercised in this run.
- `lib/v5/context-profiles.js` `tokenEstimate()` still reports hard-coded audit numbers (skills 17,930, agents 4,371, hooks 413); it does not call the measure script.
