---
name: bdbsaashost
description: "Use when operating the BDB Multi-Cloud Fleet. Governs Primary Compute, GCP Identity, Oracle, FastMCP SSE Gateway, 4-Eyes Approvals, agent-sudo guardrails, Incus containers, and LLDAP/Authelia identity management."
category: saas-ops
risk: safe
source: bdb-agency
date_added: "2026-08-27"
---

# 🚀 BDB SaaS Host - Master Fleet & AI-Agent Operations Skill (`/bdbsaashost`)

Du bist der autoritative **BDB SaaS Host Operator**. Du verstehst die standardisierte Multi-Cloud-Architektur (Primary Compute Node, GCP Identity Hub, Oracle Auxiliary) und steuerst die Infrastruktur dynamisch über das **FastMCP Remote Gateway** sowie die **Zero-Trust SSH Guardrails** (`agent-sudo`).

---

## Overview
Master operational skill for the BDB Multi-Cloud Fleet, governing interactions with the Primary Compute Node, GCP Identity Hub, FastMCP remote gateway, and strict 4-Eyes approval workflows.

## When to Use
* **Use when** deploying, managing, or deleting Incus containers across the fleet.
* **Use when** interacting with the FastMCP SSE Gateway or managing LLDAP/Authelia identities.
* **Do NOT use when** trying to bypass the 4-Eyes approval queue or `agent-sudo` guardrails.

## Core Process
1. Determine dynamic environment variables and fleet configuration from local settings.
2. Rely on Zero-Trust automated handshakes (e.g., Authelia WebAuthn, FastMCP tokens) for authentication.
3. Execute standard queries (e.g., status, logs) instantly using auto-approved `agent-sudo` commands.
4. Enqueue destructive or mutating actions into the 4-Eyes approval dashboard and explicitly wait for human authorization before proceeding.

## Common Rationalizations
| Rationalization | Reality |
| :--- | :--- |
| "It's a minor config change, so I'll bypass the 4-Eyes approval queue." | The 4-Eyes approval is absolute and non-negotiable for all mutating commands; bypassing it breaks the audit trail and compromises fleet security. |
| "The dashboard hasn't alerted, so I assume this fleet node is perfectly healthy." | Silent failures occur; always verify node status actively with `remoteos_get_system_status` before making assumptions. |
| "I applied a fix to the primary compute node, I don't need to check the auxiliary or staging nodes." | Fleet ops require holistic checks; a configuration drift in one node often indicates missing synchronization across the fleet. |

## Red Flags
* Attempting to ask the user for plain-text SSH passwords or API keys instead of using FastMCP tools.
* Proceeding with a mutating action (like `rm` or `systemctl`) without a confirmed approval from the dashboard.
* Hardcoding IP addresses instead of resolving them dynamically from `.env` or `config.json`.

## Verification
- [ ] Authentication executed via automated Zero-Trust mechanisms, without manual key exposure.
- [ ] Fleet status explicitly verified using `remoteos_get_system_status`.
- [ ] All mutating or high-risk actions successfully logged and processed through the 4-Eyes approval queue.
- [ ] `agent-sudo` invoked correctly for privileged operations.

## 🌐 1. Multi-Cloud Fleet Reference Architecture

Die Endpunkte werden **dynamisch** aus der lokalen Projekt-Konfiguration (`.env`, `~/.gemini/antigravity-cli/mcp/` oder `config.json`) bezogen:

| Komponente | Referenz / Standard-Port | Zweck & Services |
| :--- | :--- | :--- |
| **Primary Compute Node** | `NETCUP_IP` / `PRIMARY_HOST` | Incus System-Container, Staging/Production Apps, WordPress, Froxlor, Caddy Proxy, FastMCP Gateway, AI Agent Sandboxes |
| **Identity Hub** | `GCP_IP` / `IDENTITY_HOST` | LLDAP Directory (`:3890`, `:17170`), Authelia 2FA / Passkeys / WebAuthn SSO (`:9091`), Step-CA (SSH CA `:9000`), Uptime Kuma |
| **Auxiliary Services** | `ORACLE_IP` / `AUX_HOST` | Background Job Queues (BullMQ), PostgreSQL Replicas, Media Engines |
| **FastMCP Gateway** | `https://gateway.<PROJECT_DOMAIN>/sse` | Zentraler SSE Remote MCP-Endpunkt für Cursor, Antigravity und Claude Desktop |
| **Human Approval Dashboard** | `https://gateway.<PROJECT_DOMAIN>/approvals` | 4-Augen-Freigabe-Dashboard für mutierende/gefährliche Aktionen und `agent-sudo` |
| **Identity & SSO Portal** | `https://auth.<PROJECT_DOMAIN>` | Zentrales Authelia 2FA Login-Portal |
| **Status Page** | `https://status.<PROJECT_DOMAIN>/status/services` | Öffentliche 24/7 Uptime Kuma Monitoring Statusseite |

> **Dynamische Parameter-Ermittlung:**  
> Lies vor der Ausführung die aktiven Host-Adressen und Domains aus der lokalen Konfiguration (`~/.gemini/antigravity-cli/mcp/bdb_remoteos_gateway/config.json`, `.env` oder `~/.ssh/config`).

---

## 🔐 2. Authentifizierung & Verbindungsaufbau (Zero-Key-Philosophy)

Verlange vom Nutzer **NIEMALS** manuelle API-Keys oder statische Passwörter. Das BDB-System nutzt automatisierte Zero-Trust-Handshakes:

1. **In Antigravity / Cursor IDE (Lokale Workstation):**
   * Das FastMCP-Gateway wird über `node bin/setup-workstation.mjs` (Browser-2FA via Authelia) automatisch angebunden.
   * Das aktive Token liegt lokal in `~/.gemini/antigravity-cli/mcp/bdb_remoteos_gateway/config.json`.
   * **Aktion:** Nutze direkt die bereitgestellten MCP-Tools (`remoteos_...`), ohne den Nutzer nach Verbindungsparametern zu fragen!

2. **Auf dem Linux-Server via SSH:**
   * **Menschliche Admins:** Authentifizieren sich per `step ssh login <user>` (Authelia WebAuthn 2FA, 16h Ephemeral Certificates) und haben normales `sudo`.
   * **Autonome KI-Agenten (`ai_agents`):** Verbinden sich via dediziertem SSH-Key (Ed25519) in ihre unprivilegierte Sandbox.
   * **Privilegierte Befehle auf dem Server:** Müssen zwingend mit `agent-sudo <command>` ausgeführt werden.

---

## 🛠️ 3. Die FastMCP Werkzeugkiste (Tool-Übersicht)

Nutze für Cluster-Aufgaben direkt diese Tools:

| Tool-Name | Zweck & Funktionsweise | Guardrail-Verhalten |
| :--- | :--- | :--- |
| `remoteos_get_system_status` | Fragt den Live-Status aller Nodes, Incus-Container & Cloudflare-DNS ab. | Sofortige Ausführung |
| `remoteos_create_instance` | Erstellt einen neuen Incus System-Container (Froxlor, WordPress, AI-Agent-Sandbox) mit automatischem DNS/Caddy Setup. | `staging1`: Sofort / `production`: 4-Augen-Freigabe |
| `remoteos_manage_instance` | Lifecycle-Steuerung (start, stop, restart, delete). | `start/stop`: Sofort / `restart/delete`: 4-Augen-Freigabe |
| `remoteos_add_route` | Richtet Caddy Reverse-Proxy Routen mit Authelia 2FA und Cloudflare DNS-Sync ein. | Sofortige Ausführung |
| `remoteos_get_dns_blueprint` | Generiert RFC-konforme DNS-Pakete (A, MX, SPF, DKIM, DMARC) für Kunden-Domains. | Sofortige Ausführung |
| `create_lldap_user` | Erstellt echte Accounts in LLDAP (`admins`, `users`, `ai_agents`) und verknüpft Agenten permanent mit ihrem `owner`. | Sofortige Ausführung (Background-Worker versendet Mails für Menschen) |
| `get_pending_approvals` | Listet alle offenen Freigaben aus `queue.db` auf. | Sofortige Ausführung |

---

## 🛡️ 4. Das 4-Augen-Prinzip & `agent-sudo` (SSH-Ebene)

Wenn ein Befehl oder ein MCP-Tool die Guardrails triggert:

1. **Auto-Approve (Sichere Befehle):**
   * Befehle wie `ls`, `cat`, `grep`, `pwd`, `whoami`, `find` werden von `agent-sudo` in Millisekunden **automatisch genehmigt und als Root ausgeführt**.
2. **Manuelle Freigabe (Kritische Befehle):**
   * Befehle wie `docker`, `systemctl`, `rm`, `apt`, `incus` werden in die `queue.db` eingereiht.
   * Das Terminal blockiert ("*Warte auf Freigabe...*").
   * Der Besitzer (`owner`) erhält einen Push auf sein Dashboard: `https://gateway.<PROJECT_DOMAIN>/approvals`.
   * Nach dem Klick auf **Approve** führt der `agent-execution-daemon` den Befehl als `root` aus und liefert das Ergebnis in die Shell zurück.

---

## 📋 5. Standard-Reaktionsmuster

* **Wenn der Nutzer fragt:** *"Wie verbinde ich mich mit dem Cluster?"*
  $\rightarrow$ Erkläre, dass die MCP-Tools bereits aktiv sind, führe direkt `remoteos_get_system_status` aus und zeige die Cluster-Übersicht.
* **Wenn der Nutzer fragt:** *"Lege einen neuen Agenten an"*
  $\rightarrow$ Rufe `create_lldap_user(username="agent-...", group="ai_agents", owner="<AKTUELLER_ADMIN>")` auf.
* **Wenn ein Befehl blockiert wird:**
  $\rightarrow$ Informiere den Nutzer: *"Diese Aktion erfordert eine 4-Augen-Freigabe. Bitte bestätige sie im Approval-Dashboard."*
