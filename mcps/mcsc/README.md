# multi-cli-subagent-configurator (mcsc)

> Sandbox project. Full README pending — design is in `.openwiki/architecture.md`.

Detects which coding-agent CLIs (agy / Google Antigravity, opencode, Codex CLI,
native Claude Code subagents) are installed and authenticated on a machine, and
routes delegated subtasks to the right one via a capability-tier YAML rulebook
— never a pinned model ID, since free-tier model IDs churn within days.

Status: Core package implemented and tested. Includes an **MCP Server** (`packages/mcp/server.js`) that allows any MCP-compatible client to securely delegate tasks to local agent CLIs. The architecture includes rigorous recursion protection (via `MCSC_CALLER` environment variables) to prevent autonomous agents from calling themselves in infinite loops.

See [.openwiki/architecture.md](.openwiki/architecture.md) for the validated design.

```bash
node packages/core/bin/mcsc.js detect --json
node packages/core/bin/mcsc.js route --task-type review
```

## Documentation

Full docs live in [.openwiki/](.openwiki/quickstart.md):
- [quickstart.md](.openwiki/quickstart.md) — where to start
- [architecture.md](.openwiki/architecture.md) — the validated design
- [release_notes.md](.openwiki/release_notes.md) — timeline
