---
name: subagent-setup
description: Configure and synchronize multi-harness subagents (Claude Code, Google Antigravity, OpenCode, ChatGPT Codex CLI) with canonical model tiers and single source of truth in .aos/pipeline.json.
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

## 1. Canonical Model Tiers (Resilience against Model Churn)

To prevent breaking configurations when providers update model names, roles map to canonical tiers:

| Tier | Description | Claude Code | Antigravity | OpenCode | Codex CLI |
|---|---|---|---|---|---|
| `reasoning_max` | Deep reasoning, planning, adversarial review | `opus` | `gemini-3.1-pro-high` | `opencode/muse-spark-1.3-contributor-free` | `o3-mini` |
| `standard_fast` | Fast coding, frontend/backend engineering | `sonnet` | `gemini-3.8-flash-high` | `opencode/muse-spark-1.3-contributor-free` | `gpt-4o` |
| `trivial_low` | Mechanical tasks, summaries | `haiku` | `gemini-3.8-flash-low` | `opencode/muse-spark-1.3-contributor-free` | `gpt-4o-mini` |

*Note:* Custom model IDs can also be set directly per role and harness.

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
  --set-role reviewer --harness codex --model o3-mini --tier reasoning_max

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
- **`aos-project-init`**: Offers subagent configuration during project interview, defaulting to the canonical tier matrix.
