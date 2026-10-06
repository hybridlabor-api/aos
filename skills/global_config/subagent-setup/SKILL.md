---
name: subagent-setup
description: Configure and synchronize multi-harness subagents (Claude Code, Google Antigravity, OpenCode, ChatGPT Codex CLI) with optional per-harness model overrides and single source of truth in .aos/pipeline.json.
category: bdb-core
risk: low
source: bdb
date_added: "2026-09-20"
---

# Skill: subagent-setup — Multi-Harness Subagent Configuration

Manages and synchronizes autonomous subagent roles across all four supported execution harnesses:
1. **Claude Code** (`.claude/agents/*.md`)
2. **Google Antigravity** (`~/.gemini/config/agents/*.json`)
3. **OpenCode** (`.opencode/agents/*.md`)
4. **ChatGPT Codex CLI** (`.codex/agents/*.toml` & `.codex/agents/*.md`)

Single Source of Truth: **`.aos/pipeline.json`** (compatible with AO Orchestrator Pipeline Wizard).

---

## 1. Models

AOS pins no model. Agents inherit the session model on every harness. A model is written only when `.aos/pipeline.json` sets one for that role and harness, as a free-form string passed through verbatim. Shape, per-harness examples and the `aos-doctor` format check: `docs/agent-models.md`.

---

## 2. CLI Usage

### View Current Pipeline Status
```bash
node skills/global_config/subagent-setup/scripts/setup-subagents.mjs --show
```

### Initialize Default Pipeline Configuration
```bash
node skills/global_config/subagent-setup/scripts/setup-subagents.mjs --init-default
```

### Update a Specific Role
```bash
# Example: Set Reviewer to Codex with o3-mini
node skills/global_config/subagent-setup/scripts/setup-subagents.mjs \
  --set-role reviewer --harness codex --model o3-mini

# Example: Set Shipping to OpenCode with Free Tier
node skills/global_config/subagent-setup/scripts/setup-subagents.mjs \
  --set-role shipping --harness opencode --model opencode/muse-spark-1.3-contributor-free

# Example: Enable or Disable a Role
node skills/global_config/subagent-setup/scripts/setup-subagents.mjs --set-role media_eventtech --enable
```

### Synchronize to All Harnesses
```bash
node skills/global_config/subagent-setup/scripts/setup-subagents.mjs --sync
```

---

## 3. Integration with `aos-project-init` & AO Orchestrator
- **AO Orchestrator (Port 3101)**: The Pipeline Wizard (Schritt 3 von 4: Agenten & Rollen) directly reads and writes `.aos/pipeline.json`.
- **`aos-project-init`**: Offers subagent configuration during project interview, with no model pinned by default.

---

## 4. Running an installed copy

The script imports the AOS `installer.js` module. In a repo checkout it finds it by relative path. An installed copy (`~/.agents/skills/subagent-setup/scripts/`) has no repo around it: set `AOS_HOME` to the AOS package folder (the one that contains `installer.js`), or install `@hybridlabor-api/aos` globally. Without either it exits with code 2 and lists the paths it tried.
