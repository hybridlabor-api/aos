# BDB RemoteOS MCP Server

FastMCP server and Execution Gateway for BDB Multi-Cloud SaaS Engine.
Exposes zero-trust tools for Incus container provisioning, lifecycle operations, routing, and 4-eyes approval workflows.

## Usage

### Run via `uvx` (Claude Code, Cursor, Codex, Antigravity)
```bash
uvx bdb-remoteos-mcp
```

### Environment Variables
- `REMOTEOS_GATEWAY_URL`: URL of the remote execution gateway (e.g. `https://gateway.yourdomain.com`). If not set, operates in local mode.
- `REMOTEOS_API_KEY` or `GATEKEEPER_API_KEY`: API key for authentication.
- `GATEKEEPER_DB`: Path to the SQLite queue database (default: `queue.db`).
- `GATEKEEPER_SIGNING_KEY`: 32-byte HMAC key for token generation.
- `GATEKEEPER_WEBHOOK_URL`: Optional Discord/HTTP alert webhook URL.
