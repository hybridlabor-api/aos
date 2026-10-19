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

## Why memB stopped growing (2026-10) and what writes now

Nothing in AOS wrote memB automatically. The last rows (2026-10-14 21:27) came from one `memb_ingest` batch;
after that the only write path was an agent calling `add_memory`, and nothing told agents to. The MCP itself
works (verified against a temp `MEMB_DATA_DIR`: `add_memory` falls back to a verbatim save when extraction fails).
Three writers now exist:

1. **Agent hint.** The SessionStart block carries one line naming `memb_mcp add_memory`.
2. **Session-end save** (`memb-session-save.mjs`): Claude `SessionEnd`, agy `Stop` (payload unverified on live agy). OpenCode has no hook yet.
   It condenses the transcript to `Task: ... Outcome: ...` (last assistant answer), hands it to memb-mcp `add_memory(infer=False)` in a
   detached child (no LLM, no key, never delays the session) with `harness`/`session` provenance.
   Skips sessions under 4 user turns or without a substantial last answer, saves each session id once
   (`~/.aos/cache/memb-save/<id>`), drops env-like lines and redacts token shapes (memb-mcp filters again).
   Off with `AOS_MEMB_AUTOSAVE=off`, `AOS_SESSION_START_CONTEXT=off`, delegated workers, or `"memorySave": "off"` in `~/.aos/v5-settings.json`.
   Wired only when unified memory and context hooks are on.
3. **Nightly ingest** (`bin/aos-memb-ingest.mjs`): launchd job `com.bdb.memb.ingest` (03:30) or systemd user timer on Linux, written by the memB
   install step (none on Windows). Ingests each project under the workspace root (setting `memoryIngest.workspace`, default `~/dev/bdb-dev`) that has
   `.openwiki` or `AGENTS.md`, skipping `-wt-` worktrees. Exits immediately when `memb` is excluded; `"memoryIngest": "off"` disables it.

## LLM provider for memB extraction

`infer=True` extraction uses an LLM. memB ships adapters for many providers, but its `run.py` hard-wires `gemini`, and the AOS gateway only
passed `GEMINI_API_KEY` from `~/.aos/secrets.env`. A key the user stored for OpenWiki (`~/.openwiki/.env`: `OPENWIKI_PROVIDER`, `OPENWIKI_MODEL_ID`,
`<PROVIDER>_API_KEY`) was never seen by memB. This regressed when v5 moved secrets out of the harness configs (4.19.1, `d53f7cc3`): the old inline
`GEMINI_API_KEY` placeholder was filled from the installer's stored env; the launcher reads only `secrets.env`, where the key is not.

Now `aos-mcp-env --memb-llm` (added to the `memb_mcp` entry by `wrapServer`) resolves the provider via `lib/memb-llm.js`, in order: environment,
`~/.aos/secrets.env` (`MEMB_LLM_PROVIDER`, `MEMB_LLM_MODEL`, `MEMB_LLM_API_KEY`, `MEMB_LLM_BASE_URL`), then the OpenWiki choice
(gemini, openai, openrouter, nvidia, openai-compatible incl. groq/xai/ollama/lmstudio, anthropic). It exports `MEMB_LLM_*` and, when found anywhere,
`GEMINI_API_KEY`, so current memB works again with the Gemini key. Honouring `MEMB_LLM_*` needs the memB change in
`docs/patches/memb-llm-provider.patch` (applies to memB `run.py`, `patch -p1`; verified with `--dry-run`, openai/openrouter path checked; anthropic
needs `pip install anthropic` in the venv). Until memB releases it, only Gemini works.

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
- **Gap for AO 2.0:** OpenCode session-end capture, and a Windows scheduler for the nightly ingest.
