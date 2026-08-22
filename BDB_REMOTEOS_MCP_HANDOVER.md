# 🏰 Handover & Integration Blueprint: `bdb-remoteos-mcp` for `bdb-dev-optimized-agent-skills`

**Target Repository:** `https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills`  
**Purpose:** Enable any AI agent (Claude Code, Codex, Antigravity, Cursor, Roo Code) to deploy, configure, and manage Multi-Cloud Linux server infrastructure via standard MCP tools and the `bdbsaashost` skill.

---

## 📦 1. Artifacts & Source Locations

| Component | Source Location | Target in `bdb-dev-optimized-agent-skills` |
| :--- | :--- | :--- |
| **MCP Server** | `/Users/timrennings/bdb-saashost-engine/packages/bdb-remoteos-mcp/` | `mcps/bdb-remoteos-mcp/` |
| **Skill Definition** | `/Users/timrennings/bdb-saashost-engine/server-config/skills/bdbsaashost/SKILL.md` | `skills/global_config/bdbsaashost/SKILL.md` |
| **Server Engine** | `https://github.com/hybridlabor-api/bdb-saashost-engine` | External Infrastructure Engine |

---

## 🛠️ 2. MCP Tool Specifications

The `bdb-remoteos-mcp` implements FastMCP (stdio and SSE) with 15 passing Red-Team tests:

```json
[
  {
    "name": "remoteos_get_system_telemetry",
    "description": "Query host CPU, RAM, Disk, Inodes, PSI Pressure, and Load averages",
    "tier": "Tier 0 (Read-Only)"
  },
  {
    "name": "remoteos_manage_service",
    "description": "Manage Systemd service lifecycle (status, start, stop, restart, reload, enable)",
    "tier": "Tier 1 (Safe / Idempotent)"
  },
  {
    "name": "remoteos_query_journal_logs",
    "description": "Query filtered, window-bounded JSON system logs without flooding LLM context",
    "tier": "Tier 0 (Read-Only)"
  },
  {
    "name": "remoteos_storage_cleanup",
    "description": "Perform safe disk vacuum (journal vacuum, apt cache, podman prune)",
    "tier": "Tier 1 (Safe)"
  },
  {
    "name": "remoteos_backup_snapshot",
    "description": "Trigger encrypted Restic / Rclone S3 snapshots and inspect ZFS/Incus pools",
    "tier": "Tier 1 (Safe)"
  },
  {
    "name": "remoteos_audit_security",
    "description": "Inspect UFW firewall, Fail2ban jails, TLS cert expiry, and Sudoers integrity",
    "tier": "Tier 0 (Read-Only)"
  },
  {
    "name": "remoteos_create_instance",
    "description": "Provision Incus container/VM from templates (Froxlor, AI Sandbox, WordPress)",
    "tier": "Tier 1 (Safe)"
  },
  {
    "name": "remoteos_manage_instance",
    "description": "Start, stop, or restart an Incus instance",
    "tier": "Tier 1 (Safe)"
  },
  {
    "name": "remoteos_list_instances",
    "description": "List all active instances, IP addresses, and resource allocations",
    "tier": "Tier 0 (Read-Only)"
  },
  {
    "name": "remoteos_add_route",
    "description": "Add Caddy reverse proxy route with optional Authelia 2FA gatekeeper",
    "tier": "Tier 1 (Safe)"
  },
  {
    "name": "remoteos_delete_instance",
    "description": "Delete instance (automatically creates pre-delete snapshot and enqueues in 4-eyes queue)",
    "tier": "Tier 2 (Destructive / 4-Eyes Queue)"
  },
  {
    "name": "remoteos_approval_queue_list",
    "description": "List pending destructive operations waiting for admin confirmation",
    "tier": "Tier 0 (Read-Only)"
  },
  {
    "name": "remoteos_approval_queue_decide",
    "description": "Approve or reject a pending request with a cryptographic HMAC token",
    "tier": "Tier 2 (Admin Decision)"
  }
]
```

---

## ⚙️ 3. Installer Integration (`installer.js`)

In `bdb-dev-optimized-agent-skills/installer.js`:

1. Add `bdb-remoteos-mcp` to available MCP options:
```javascript
const availableMcps = [
  'memb-mcp',
  'bdb-remoteos-mcp', // Multi-Cloud Server & Host Operations
  'touchdesigner-mcp',
  'davinci-mcp-professional',
  'unreal_mcp',
  // ...
];
```

2. Register configuration in `mcp_config.json`:
```json
{
  "bdb-remoteos": {
    "command": "python3",
    "args": ["-m", "bdb_remoteos_mcp"],
    "env": {
      "REMOTEOS_GATEWAY_URL": "https://gateway.yourdomain.com",
      "REMOTEOS_API_KEY": "${REMOTEOS_API_KEY}"
    }
  }
}
```

---

## 🎯 4. Agent Instruction Prompt

When starting a session in `bdb-dev-optimized-agent-skills`, use this exact prompt:

> **"Implementiere den neuen MCP-Server `bdb-remoteos-mcp` und den Skill `bdbsaashost` in unser Skillpack gemäß des Blueprints in `BDB_REMOTEOS_MCP_HANDOVER.md`. Aktualisiere `installer.js` und `mcp_config.json`, damit jeder Nutzer beim Installieren des BDB Agent OS die Multi-Cloud Server-Administration direkt auswählen kann."**
