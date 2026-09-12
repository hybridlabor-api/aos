# Quickstart Guide

Welcome to the **bdb-dev-optimized-agent-skills** core repository. This guide provides immediate orientation for configuring and utilizing the core skills pack, OpenWiki documentation daemon, RepoGraph code health dashboard, and memB memory layer.

---

## 🚀 Quick Setup

### 1. Global Installation via NPX
Run the interactive CLI installer to deploy skills, local MCP configurations, and background daemons:
```bash
npx -y @hybridlabor-api/bdb-dev-optimized-agent-skills
```

### 2. Manual Setup via Git
```bash
git clone https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills.git
cd bdb-dev-optimized-agent-skills
npm install
node installer.js
```

---

## 🌐 OpenWiki & Code Health Daemon

### 1. Configure Multi-Provider LLM Backend
OpenWiki supports multiple LLM providers via environment variables:
```bash
# Example: Using Google Gemma 4 (Default)
export OPENWIKI_PROVIDER="google"
export GEMINI_API_KEY="your-gemini-key"

# Example: Using Groq (Ultra-Fast)
export OPENWIKI_PROVIDER="groq"
export GROQ_API_KEY="your-groq-key"

# Example: Using Local Ollama (Offline)
export OPENWIKI_PROVIDER="ollama"
export OPENWIKI_MODEL="llama3"
```

### 2. View Interactive Code Health Dashboard
Open the Repowise-grade Code Health dashboard in your default browser:
```bash
open .openwiki/code_health_dashboard.html
```
*Features 6 live visual panels with 60-second auto-refresh and integrated memB sync telemetry.*

### 3. Run the Daemon as a Background Service
The installer registers the daemon automatically. Manual registration:
```bash
# macOS (LaunchAgent)
bash ~/.gemini/config/skills/openwiki-skill/scripts/install_daemon.sh

# Linux (systemd user session required)
bash ~/.gemini/config/skills/openwiki-skill/scripts/install_daemon.sh

# Windows (Scheduled Task)
powershell -ExecutionPolicy Bypass -File install_daemon.ps1
```
During install the API key is verified by `verify_api_key.py` (2 retries + TLS fallback). If verification fails the daemon stays in collect-only mode and the installer prints the concrete reason. On Linux without systemd the script skips with cron instructions instead of reporting a false success.

---

## ✅ Before You Commit a Skill Change

```bash
npm run validate   # the skill contract, exactly as CI enforces it
npm test           # the validator's selftest, then the contract
```

A skill is a **directory containing `SKILL.md`** — every harness discovers
skills as `<skill-name>/SKILL.md`, so a loose `.md` file in a category
directory is invisible to all of them. Required frontmatter:

```yaml
---
name: exactly-the-directory-name
description: >-
  Use the folded form for anything longer than one line. An unquoted
  multi-line description swallows the category below it.
category: design-ui-ux | engineering-method | media-eventtech | bdb-core | saas-ops | library
---
```

The full contract and the category routing table live in
[AGENTS.md](../AGENTS.md).

---

## 🧠 memB Semantic Memory Synchronization

To ingest project context and architecture into the local SQLite vector database (`~/.MemBDB/memb.db`):
```bash
python mcps/memb-mcp/memb_ingest.py .openwiki --project "bdb-dev-optimized-agent-skills" --category "Architecture_and_Wiki"
```

---

## 🎨 Heavy Generative Extensions

For generative 3D mesh creation (TRELLIS, TripoSR), automated cinema video production (OpenMontage, Palmier Pro), and local ComfyUI rendering, link the companion suite:
```bash
git clone https://github.com/hybridlabor-api/bdb-dev-creator-extension.git
```
