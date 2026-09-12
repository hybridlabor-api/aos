---
name: bdb-memb-mcp
description: >-
  Model Context Protocol interface to the memB persistent agent memory layer
  enabling read, write, update, and semantic search of memories locally and
  offline across compatible developer agents.
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
    - `user_id` (string, optional, default: `"bdb_developer"`): Target user identifier.
    - `category` (string, optional, default: `"godmode"`): Focus domain (options: `"godmode"`, `"media"`, `"web"`, `"software"`).
    - `project_id` (string, optional): Active workspace folder to isolate search queries.

### 2. `search_memory`
Queries both global `godmode` memory and the active `project_id` memories in parallel, returning semantic matches ranked by cosine similarity.
*   **Parameters:**
    - `query` (string, required): Keyword or semantic question.
    - `user_id` (string, optional, default: `"bdb_developer"`): Target user identifier.
    - `limit` (integer, optional, default: `5`): Maximum matching memories to return.
    - `project_id` (string, optional): Active workspace folder.

### 3. `list_memories`
Lists all memories currently registered in the database for the active user.
*   **Parameters:**
    - `user_id` (string, optional, default: `"bdb_developer"`): Target user.
    - `limit` (integer, optional, default: `50`): Maximum results.

### 4. `delete_memory`
Deletes a specific memory segment using its UUID.
*   **Parameters:**
    - `memory_id` (string, required): The unique UUID of the memory item.

---

## 🔒 Security Hardening

The `memb-mcp` server runs a pre-ingestion regex filter that blocks or redacts standard credential patterns:
*   API keys (Google Cloud, OpenAI, GitHub, etc.)
*   Plaintext passwords
*   Database URLs
This safeguards your workspace metadata and prevents credentials from leaking into vector repositories.
