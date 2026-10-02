---
name: bdb-memb-mcp
description: >-
  Model Context Protocol interface to the memB persistent agent memory layer.
  Use when an agent needs to add, search, list or delete persistent memories
  locally and offline. Exposes add_memory, search_memory, list_memories and
  delete_memory.
category: bdb-core
---

# BDB memB Persistent Memory MCP Server

The `memb-mcp` server provides a standard Model Context Protocol (MCP) interface to the **memB** persistent agent memory layer. It allows any compatible developer agent (such as Cursor, Google Antigravity, Claude Code, or VS Code Cline) to read, write, and query persistent memories locally and offline.

---

## 🛠️ MCP Server Specifications

*   **Server Name:** `memb-mcp`
*   **Command:** `__MCPS_DIR__/memb-mcp/.venv/bin/python` (macOS/Linux) or `__MCPS_DIR__/memb-mcp/.venv/Scripts/python.exe` (Windows)
*   **Arguments:** `["__MCPS_DIR__/memb-mcp/run.py"]`
*   **Environment Variables:**
    - `MEMB_DATA_DIR`: Path to the SQLite database and config folder (defaults to `~/.MemBDB`).
    - `GEMINI_API_KEY`: User Google API key for reasoning.

---

## 🔌 Exposed MCP Tools

### 1. `add_memory`
Saves a new fact, coding preference, or workaroud to the local SQLite database.
*   **Parameters:**
    - `text` (string, required): The fact or guideline to store.
    - `user_id` (string, optional): Owner of the row. Default: env `MEMB_USER_ID` (fallback `$USER`). Pass a group id from `MEMB_GROUP_IDS` only to write a shared group row on purpose.
    - `category` (string, optional): Default `project_card` when `project_id` is set, else `task_learnings`. Options: `project_card`, `architecture_decisions`, `bug_fixes`, `coding_conventions`, `tooling_setup`, `anti_patterns`, `task_learnings`, `user_preferences`, `dependency_decisions`, `performance_findings`, `security_constraints`, `testing_patterns`, `data_model`, `api_contracts`, `deployment_runbook`, `team_norms`, `domain_glossary`, `godmode`.
    - `project_id` (string, optional): Active workspace folder to isolate search queries.
    - `source`, `harness`, `session` (string, optional): Provenance, stored in the row metadata.

### 2. `search_memory`
Queries both global `godmode` memory and the active `project_id` memories in parallel, returning semantic matches ranked by cosine similarity.
*   **Parameters:**
    - `query` (string, required): Keyword or semantic question.
    - `user_id` (string, optional): Restrict to one owner id. Default: the user plus the group ids in `MEMB_GROUP_IDS` (default `bdb_developer`).
    - `limit` (integer, optional, default: `5`): Maximum matching memories to return.
    - `project_id` (string, optional): Active workspace folder.

### 3. `list_memories`
Lists all memories currently registered in the database for the active user.
*   **Parameters:**
    - `user_id` (string, optional): Restrict to one owner id. Default: the user plus `MEMB_GROUP_IDS`.
    - `limit` (integer, optional, default: `50`): Maximum results.

### 4. `delete_memory`
Deletes a specific memory segment using its UUID.
*   **Parameters:**
    - `memory_id` (string, required): The unique UUID of the memory item.

---

## 🔒 Security Hardening

The `memb-mcp` server has **no automatic credential filter** today: it stores whatever an agent sends it.
*   Never ingest credentials: API keys (Google Cloud, OpenAI, GitHub, etc.), plaintext passwords, database URLs.
*   The protection is the rule in this skill (and in `memb-skill`) plus human review of stored memories.
*   An automatic pre-ingestion filter is planned but not released.
