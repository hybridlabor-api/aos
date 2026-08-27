---
name: token-saver-config
description: Context window output compression engine for CLI commands (60-99% token reduction).
category: bdb-core
---

# Heimdall Token Saver Configuration & Diagnostics

Heimdall Token Saver is a drop-in context-window optimizer for AI coding assistants. It compresses the verbose terminal output your agent reads — `git diff`, `pytest`, `npm install`, `terraform plan`, `kubectl`, `docker` — so you spend fewer tokens, stay under your LLM context limit, and get faster, cheaper, more focused responses.

## Key Capabilities & CLI Diagnostics

After installation via `bdb-dev-optimized-agent-skills`, the `token-saver` command is available system-wide:

- **Check Installed Version:**
  ```bash
  token-saver version
  ```

- **View Savings Statistics:**
  ```bash
  token-saver stats
  token-saver stats --json
  ```

- **Benchmark Command Compression:**
  ```bash
  token-saver benchmark 'git diff'
  token-saver benchmark 'pytest' --format json
  token-saver benchmark 'git log -n 20' --dry-run
  ```

- **Check & Apply Updates:**
  ```bash
  token-saver update
  ```

## BDB MCP Processors (90-95% Savings on Creative & Media MCPs)

Heimdall includes **6 specialized BDB MCP Processors** for creative media and system tools (`bdb_td_*`, `bdb_unreal_*`, `bdb_after_effects_*`, `bdb_davinci_*`, `bdb_resolume_*`, `memb_mcp`):
- 🔮 **With Heimdall BDB MCP Processors: You cut token consumption by 90-95% per MCP tool call, allowing your agent to run 10x longer without hitting context limits.**

## Compression Engine Rules & Guarantees

1. **Short Outputs:** Commands outputting < 200 characters pass through unchanged.
2. **Zero Information Loss:** All errors, stack traces, test failure details, and actionable diffs survive intact.
3. **Source Code Protection:** Pure source code reads (`cat *.py`, `cat *.ts`) pass through without compression.
4. **Secret Redaction:** Environment files (`.env`) automatically redact secrets before returning to the LLM.
