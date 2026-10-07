# Codebase Memory MCP (optional module)

Third-party server: <https://github.com/DeusData/codebase-memory-mcp> (MIT). A
self-contained stdio binary that indexes a repo into a local SQLite knowledge
graph (`~/.cache/codebase-memory-mcp/`) and answers structural queries with
~99% fewer tokens than file-by-file exploration. No cloud calls, no API keys.
AOS never downloads it; the MCP entry is registered only where the binary is
present (`mcp_picks.json` group `codebase_memory`). aos doctor reports
`app missing: codebase-memory-mcp` when the binary is absent.

## Post-GO runtime steps (run these yourself)

1. Install the binary:
   `curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash`
   (or `npm install -g codebase-memory-mcp`).
2. Register the server scope-wide:
   `claude mcp add codebase-memory-mcp --scope user -- codebase-memory-mcp`
   (empty args). The AOS installer does the same for the harnesses it manages
   once the binary is on PATH — re-run the installer instead if you prefer.
3. Verify: `claude mcp list` shows 17 tools; restart the agent.
4. Recherche test on a real repo (measure tokens, not claims):
   1. Index once: `codebase-memory-mcp cli index_repository '{"path": "<repo>"}'`.
   2. Ask the same ten structural questions ("who calls X", "what routes does
      service A expose") twice on a copy of the index repo — once with the MCP
      server enabled, once with it removed, fresh session each time.
   3. Compare per-session token usage (~52k in ~= baseline gap; the README
      measured 412k vs 3.4k) and answer quality; keep the server only if both
      are convincing on your repos.
