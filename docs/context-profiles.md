# Context Profiles in BDB Agent OS (AOS)

Context Profiles allow users to select an operational role (`full`, `orchestrator`, `worker`, `small`) to lower start-of-session token consumption without removing any functionality by default.

Default profile: **`full`** (nothing is removed; fully backward-compatible).

---

## 1. Context Profiles Overview

| Profile | Role & Purpose | Gateway MCP Tools | SessionStart Hooks Cap | Estimated Startup Tokens |
|---|---|---|---|---|
| **`full`** *(default)* | Full suite of 300+ tools across all domains (engineering, media, show control, 3D, reverse-engineering). | All tools exposed (`preset=all`) | 2,000 chars | ~62,000 tokens |
| **`orchestrator`** | Multi-agent coordination, architecture planning, dynamic workflow dispatch. Keeps all skills and broad tool access. | All tools exposed (`preset=all`) | 2,000 chars | ~62,000 tokens |
| **`worker`** | Focused engineering (coding, refactoring, testing, git, database, memory). Media upstreams excluded. | Core tools only (`preset=worker`) | 2,000 chars | ~40,500 tokens *(saves ~21.5k)* |
| **`small`** | Low-context, fast, or local models. Minimizes tool catalog and startup context bloat. | Core tools only (`preset=small`) | 1,000 chars | ~40,400 tokens *(saves ~21.6k)* |

---

## 2. Startup Token Breakdown: Measured vs. Estimated

Based on empirical measurements from the context audit (`_context-audit/report.md`), start-of-session token consumption breaks down across components as follows:

| Component | Audit Baseline (Full) | Optimized Profile (`worker` / `small`) | Mechanism |
|---|---|---|---|
| **Gateway MCP Catalog** | ~25,738 tokens (303 tools) | ~4,200 tokens (~45 tools) | Gateway URL preset query (`?preset=worker`). Excludes 10 media upstreams (`davinci`, `unreal`, `blender`, `grandma3`, `touchdesigner`, `after-effects`, `resolume`, `rhino`, `vectorworks`, `uxp`). |
| **Skill Frontmatter Index** | ~17,930 tokens (unbounded descriptions) | ~11,000 tokens (<=250 char budget) | Frontmatter contract validation (`E-DESC01`) in `npm run validate` enforces <= 250 characters per description while preserving search trigger words. |
| **Agent Manifest** | ~4,371 tokens (45 agents) | ~4,371 tokens | Provided by the `bdb-aos` plugin. `aos doctor` detects and warns on redundant copies in `~/.claude/agents`. |
| **Workspace Instructions & Memory** | ~3,848 tokens | ~3,848 tokens | `AGENTS.md`, `CLAUDE.md`, and project context rules. |
| **MCP Server Instructions** | ~557 tokens | ~557 tokens | OpenWiki MCP instructions. |
| **SessionStart Hooks** | ~413 tokens | ~100–350 tokens | Capped at 2,000 characters; disabled via `AOS_SESSION_START_CONTEXT=off`. |
| **Harness Preamble & Base Tools** | ~16,093 tokens | ~16,093 tokens | Fixed harness overhead (Anthropic system prompt, tool definitions). |
| **Total Startup Tokens** | **~68,950 tokens** | **~40,500 tokens** | **Net savings: ~28,450 tokens (~41% reduction)** |

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

The AOS MCP Gateway runs on `127.0.0.1:7901` (managed by 1mcp). 1mcp natively supports server filtering via the `?preset=<name>` HTTP URL query parameter.

When `context` is set to `worker` or `small` in `~/.aos/v5-settings.json`, `pkg-gateway.js` and `lib/gateway/harness.js` configure the harness entry:
- **Claude Desktop / Claude Code (`~/.claude.json`)**:
  ```json
  "aos": {
    "type": "sse",
    "url": "http://127.0.0.1:7901/sse?preset=worker"
  }
  ```
- **ChatGPT Codex CLI (`~/.codex/config.toml`)**:
  ```toml
  [mcp_servers.aos]
  url = "http://127.0.0.1:7901/sse?preset=worker"
  ```
The 10 media upstream servers (which contribute ~162 tools and ~21.5k tokens) are excluded from the catalog. They remain accessible on demand if the user opts in or switches to the `full` profile.

---

## 5. What is NOT Possible (Harness Limitations)

To maintain absolute architectural integrity and adhere to the zero-guesswork rule, the following capabilities cannot be implemented due to harness platform constraints:

1. **Dynamic Skill Filtering per Role in Claude Code**:
   - Claude Code automatically discovers and indexes *all* skills located in installed plugins (`bdb-aos`) and in `~/.claude/skills`.
   - Claude Code provides no configuration setting or hook mechanism to hide a subset of skills from the system prompt dynamically without physically deleting or modifying the skill files.
   - Therefore, all skills remain visible to orchestrators and workers alike. Token reduction on skills is achieved via the 250-character frontmatter description budget.

2. **Role-Based Dynamic Agent Hiding**:
   - Claude Code automatically reads every agent file in `~/.claude/agents` and in active plugins. There is no whitelist/blacklist setting in `settings.json` for selective agent loading.
   - AOS mitigates waste by detecting duplicates with `aos doctor` to prevent identical agents being loaded twice (from both `~/.claude/agents` and the plugin).

3. **Suppressing `CLAUDE.md` or Auto-Memory**:
   - Claude Code always reads project `CLAUDE.md` and `~/.claude.json` / `MEMORY.md`. These cannot be suppressed conditionally via profiles.

4. **Trimming Harness Base Prompts**:
   - The ~16k tokens of harness preamble, built-in tool definitions (Bash, Edit, Glob, Grep), and safety instructions are injected by Anthropic servers and cannot be modified or reduced by client-side configuration.
