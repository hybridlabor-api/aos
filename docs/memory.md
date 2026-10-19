# Memory: who writes, who reads, when

Four parts, four jobs. Install and profile switches are in [unified-memory.md](unified-memory.md).

| Part | Holds | Writer | Reader | When read |
|---|---|---|---|---|
| memB | Durable facts: decisions, conventions, project cards, godmode identity rows | The agent, on purpose, via MCP `memb_mcp` `add_memory`; or batch `memb_ingest.py` (skill `memb-ingest`). **No hook writes.** | `memb-inject` hook (read-only SQLite), plus MCP `search_memory` | SessionStart: persona + godmode rows + project cards + `deja wip`. Every prompt: FTS recall only |
| deja | What was done: transcript index of past sessions | deja itself, indexing harness transcripts | `deja wip` inside `memb-inject` (4 lines); `deja` MCP / CLI for search | SessionStart only |
| OpenWiki | What the code is: grounded project docs in `.openwiki/` | `openwiki` daemon (its own lifecycle) | File reads, `openwiki` MCP | On demand, never injected |
| codebase-memory | Code graph (callers, call chains) | Its indexer (opt-in, coding mode) | `codebase-memory` MCP | On demand |

Rule of thumb: memB = what is decided, deja = what happened, OpenWiki = how the code works, codebase-memory = who calls what.

## Harness coverage

| Harness | Memory block | Session hint |
|---|---|---|
| Claude Code | SessionStart + UserPromptSubmit hooks | SessionStart hook |
| OpenCode | plugin `chat.message`, synthetic part (first turn = SessionStart shape) | same plugin, first root turn |
| Antigravity (agy) | `PreInvocation` hook, first call per conversation gets the full block (stamp in `~/.aos/cache/memb-agy/`) | `PreInvocation` hook, once per conversation (stamp in `~/.aos/cache/hint-agy/`) |
| Codex | hooks in `config.toml` (needs `/hooks` trust; unverified) | SessionStart hook |

All inject at most 2000 chars and fail open.

## Why memB stopped growing (2026-10)

Nothing in AOS writes memB automatically. The last rows (2026-10-14 21:27) came from one `memb_ingest` batch;
since then the only write path is an agent calling `add_memory`, and nothing told agents to. The MCP itself
works (verified against a temp `MEMB_DATA_DIR`: `add_memory` falls back to a verbatim save without a valid
`GEMINI_API_KEY`). Fix in AOS: the SessionStart block now carries one line naming `add_memory`. If you want
automatic capture, that is a new Stop/SessionEnd hook calling `add_memory`; it does not exist yet.

Not the cause, but visible in logs: `GEMINI_API_KEY` is not set for the gateway (`~/.aos/secrets.env`), so
`infer=True` extraction fails and rows are stored verbatim; and the `com.bdb.memb.webui` LaunchAgent is not
loaded (WebUI on 8088 is down; it is not a write path).

## Overlap today

- **memB vs OpenWiki:** `memb_ingest` also ingests project `.md` and `.openwiki` files, so the same text exists
  as OpenWiki pages and as memB chunks. Ambient recall skips imported file chunks (`[file|...]` prefix), so no
  double injection; the duplicate is only in the DB. Not fixed: dropping `.openwiki` from the ingest scope is a memB change.
- **memB vault:** `~/.MemBDB/memB_Vault/` is a generated Markdown mirror of `memb.db`. Treat it as a view, not a source.
- **Standing facts:** `~/.MemBDB/ambient-persona.txt`, `godmode` rows and `AGENTS.md` can say the same thing. Keep persona lines for
  personal habits only; repo rules belong in `AGENTS.md`.
- **deja:** only `memb-inject` calls `deja wip`; no second injector (checked, none).

## What AO / AO 2.0 needs to reuse it

- **Store:** `~/.MemBDB/memb.db` (SQLite). Tables `memb_vectors(id, collection, vector BLOB, payload JSON, created_at)` and FTS5
  `memb_fts(id, collection, content)`; collection `bdb_agent_memory`. `memb-inject` creates this empty schema when the file is missing.
  Override the directory with `MEMB_DATA_DIR` (memb-mcp only; the hook reads `~/.MemBDB`).
- **Row payload (JSON):** `category`, `project_id` / `project`, `user_id`, optional `source`, `harness`, `session`, `type`.
  Injected categories: `godmode`, `project_card`, or any row bound to the current project.
- **Identity:** `MEMB_USER_ID` (fallback `$USER`) plus `MEMB_GROUP_IDS` (default `bdb_developer`).
- **Write:** MCP `memb_mcp.add_memory(text, project_id, category, harness, session)`. AO workers should pass `harness` and `session`.
  Writes go through `memb-mcp` (Python, `~/.gemini/config/mcps/memb-mcp/run.py`, also exposed via the AOS gateway), never raw SQL.
- **Read:** import `buildMemoryBlock({event, prompt, cwd})` from `.claude/hooks/memb-inject.mjs` (as the OpenCode plugin does) and
  `buildHint()` from `.claude/hooks/aos-session-hint.mjs`. `event` is `SessionStart` or `UserPromptSubmit`.
- **Switches:** `AOS_SESSION_START_CONTEXT=off`, `AOS_SESSION_HINT=off`, `AOS_DELEGATE_DEPTH>0` (delegated workers stay silent).
- **Gap for AO 2.0:** a capture hook (Stop/SessionEnd to `add_memory`) and a fixed ingest scope are the two missing pieces.
