---
name: bdbsaashost
description: "Master SaaS Webagency Server Infrastructure Builder. Provisions Multi-Cloud environments across Netcup VPS (x86_64), Oracle Cloud (ARM64 24GB), Google Cloud Free Tier (SSO/Monitoring), and GitHub Codespaces with Authelia/LLDAP SSO, Incus Fleet Hypervisor, Caddy Zero-Trust Reverse Proxy, and bdb-remoteos-mcp FastMCP Execution Gateway."
category: infrastructure-automation
risk: safe
source: bdb-agency
date_added: "2026-08-18"
---

# 🚀 BDB SaaS Host - Multi-Cloud Infrastructure Builder & FastMCP

This skill provides autonomous AI developer agents across any harness (Google Antigravity, Claude Code, Cursor, Roo Code, Codex) with the exact, deterministic blueprint and automation scripts to build, secure, and operate enterprise-grade SaaS server infrastructure and FastMCP execution gateways (`bdb-remoteos-mcp`).

---

## 🏗️ The Multi-Cloud Webagency Reference Topology

```mermaid
flowchart TD
    classDef edge fill:#f59e0b,stroke:#fff,stroke-width:2px,color:#fff
    classDef netcup fill:#3b82f6,stroke:#fff,stroke-width:2px,color:#fff
    classDef oracle fill:#ea580c,stroke:#fff,stroke-width:2px,color:#fff
    classDef gcp fill:#4285f4,stroke:#fff,stroke-width:2px,color:#fff
    classDef user fill:#10b981,stroke:#fff,stroke-width:2px,color:#fff

    DEV("💻 Devs & Agents (Claude / Codex / Antigravity)"):::user

    subgraph Edge ["Cloudflare Zero Trust & WAF (yourdomain.com)"]
        CF{{"☁️ Cloudflare Proxy (Strict SSL, Obfuscated Subdomains)"}}:::edge
    end

    subgraph GCP ["☁️ Google Cloud Free Tier (auth.yourdomain.com)"]
        AUTH["🔐 LLDAP + Authelia (SSO & WebAuthn / Passkeys / 2FA)"]:::gcp
        MONITOR["📊 Uptime Kuma (24/7 Watchdog & Alerts)"]:::gcp
        STEPCA["🗝️ Step-CA (SSH Certificate Authority)"]:::gcp
    end

    subgraph NetcupNode ["🖥️ Netcup VPS RS 1000 G12 (Debian 12/13)"]
        CADDY{"🌐 Caddy Auto-SSL Reverse Proxy"}:::netcup
        GATEWAY["🛡️ BDB RemoteOS FastMCP Gateway (Port 8100)"]:::netcup
        INCUS["📦 Incus Hypervisor (Multi-Tenant Containers & VMs)"]:::netcup
        APP_PROD["⚛️ Production Web & API (app.yourdomain.com)"]:::netcup
        APP_STAGE["🧪 Staging Instances (staging1/2.yourdomain.com)"]:::netcup
        COCKPIT_NET["🎛️ Cockpit Web Console (Port 443 via Caddy)"]:::netcup
    end

    subgraph OracleNode ["⚡ Oracle Cloud Always Free (Ampere A1 - 24GB ARM64)"]
        ORA_WORKER["⚙️ Background Job Queues (BullMQ)"]:::oracle
        ORA_REPLICA["🐘 PostgreSQL Read / Analytics Replica"]:::oracle
        ORA_MEDIA["🐳 Media / PDF Engines"]:::oracle
    end

    DEV -->|MCP Tool Calls (uvx bdb-remoteos-mcp)| GATEWAY
    DEV -->|Codespace Push/PR| NetcupNode
    CF --> NetcupNode
    CF --> GCP
    GCP -.->|SSO Authentication| NetcupNode
    GCP -.->|SSO Authentication| OracleNode
    GATEWAY -->|4-Eyes HMAC Authorization| INCUS
```

---

## ⚡ FastMCP Server Integration (`bdb-remoteos-mcp`)

Run directly inside any agent environment:
```bash
uvx bdb-remoteos-mcp
```

### Available MCP Tools:
- `remoteos_create_instance`: Create new Incus system containers or micro-VMs with zero-trust guardrails.
- `remoteos_manage_instance`: Manage instance lifecycle (start, stop, restart, delete) with 4-eyes approval on destructive actions.
- `remoteos_add_route`: Configure Caddy reverse proxy routes with Authelia 2FA protection.
- `remoteos_approval_queue_list`: List pending administrative approval requests.
- `remoteos_approval_queue_decide`: Authorize and execute approved actions via HMAC tokens.
- `remoteos_get_system_status`: Node health and gateway connectivity overview.

---

## 🛠️ Step-by-Step Provisioning Workflow (For Agents)

### Option A: Interactive CLI Installer
```bash
./server-config/scripts/install.sh
```

### Option B: Automated Headless Remote Deployment
```bash
BDB_REMOTE_IP=1.2.3.4 \
BDB_DOMAIN=yourdomain.com \
BDB_PROVIDER=netcup \
BDB_ADMIN1_GH=username1 \
BDB_ADMIN2_GH=username2 \
BDB_SERVICES="s1 s2 s3 s10 s14 s15" \
BDB_TOOLS="1 7 13" \
./server-config/scripts/agent-deploy.sh
```
