---
name: memb-ingest
description: Deep scan and ingest project files (.md, .json, agent.md, .openwiki) and past conversation logs into the local memB vector memory engine.
---

# memB Deep Memory Ingestion Skill

When this skill is invoked via `/memb-ingest` or requested, you MUST orchestrate a deep scan of the user-specified project path or conversation logs to populate the **memB local vector database (`~/.MemBDB/memb.db`)**.

## Core Workflow & Instructions

### 1. Target Path & Filter Selection
- Ask the user: *"Which directory or project path would you like to scan into memB memory?"* (Default: Current Workspace or active project directory)
- Ask if they would also like to include **past Antigravity chat transcripts (`--transcripts`)** or filter specific file patterns (e.g., `*.md`, `agent.md`, `.openwiki/`).

### 2. Execution
Locate the `memb-mcp` installation (e.g., `~/.gemini/config/mcps/memb-mcp/` or `~/.gemini/mcps/memb-mcp/`) and execute the ingestion script via its virtual environment:

```bash
# Run ingestion with project detection & optional transcript indexing
~/.gemini/config/mcps/memb-mcp/.venv/bin/python ~/.gemini/config/mcps/memb-mcp/memb_ingest.py "<TARGET_DIRECTORY>" --transcripts
```

### 3. Verification
Query memB using `search_memory` or inspect `~/.MemBDB/memb.db` to confirm that the project architecture and key decisions are indexed.

## Execution Rules
1. **Never skip path confirmation:** Always verify the target path before running the scan.
2. **Filter Noise:** Ignore `node_modules`, `.venv`, `.git`, `dist`, and temporary cache directories.
3. **Report Summary:** Present a clear count of indexed documents to the user upon completion.
