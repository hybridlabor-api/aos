---
name: codebase-memory
description: Code research over indexed codebase. Graph queries: calls, chains, architecture, dead code, routes. Token-efficient exploration.
category: bdb-core
---

# codebase-memory — indexed code knowledge graph over MCP

`codebase_memory_mcp` is the MCP server for the third-party
[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) binary: it
indexes a repository into a persistent, local SQLite knowledge graph and answers
structural queries in-process. Everything stays on the machine — no cloud calls,
no API keys. **Prerequisite:** requires the `codebase-memory-mcp` binary on PATH. Install with:
`curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash` (or `npm install -g codebase-memory-mcp`).
If the server is absent, ask the user to install it per
`docs/codebase-memory.md`; do not pretend to have graph access.

## Core workflow

1. **Index once:** say "index this project" or run
   `codebase-memory-mcp cli index_repository '{"path": "."}'` before deep dives.
2. **Prefer graph queries over file reads** when the question is structural:
   `get_architecture` (one call for the whole repo), `trace_path`
   (call chains), `search_graph` (regex/label search), `detect_changes`
   (git-diff impact). Only open a file to confirm the findings you already have.
3. **Context minimisation:** one graph query replaces dozens of grep/read
   cycles (~99% fewer tokens). Never paste file contents to "explore"; query
   the graph and read only the cited file, then cite it in your answer.

## Synergy with the AOS local stack

- **memB:** the graph holds structure, memB (`memb-mcp`) holds project memory
  and conversation semantics — query memB for "what we decided", the graph for
  "how the code is wired".
- **Synapse:** Synapse visualises the codebase spatially (`synapse map <repo>`);
  use the graph for precise symbol-level questions and Synapse for spatial
  orientation, then the source files for verbatim confirmation.
