# Architectural Decision Records (ADRs)

This document records the foundational architectural decisions, rationale, and constraints across the **BDB Agent OS Ecosystem**.

---

## ADR-001: Strict Privacy & Zero PII Leakage
- **Status:** Accepted
- **Context:** Agent skill configurations and documentation are distributed to multiple developer environments and open/private repositories.
- **Decision:** Enforce a mandatory ban on hardcoded local usernames, absolute user home directory paths, raw tokens, and connection credentials across all code, documentation, and agent prompts. Use `~` or dynamic environment variables (`$HOME`, `%USERPROFILE%`).
- **Consequences:** Ensures universal portability across macOS, Linux, and Windows without risking personal information exposure.

---

## ADR-002: Direct API Execution for OpenWiki Daemon
- **Status:** Accepted
- **Context:** Earlier versions spawned sub-instances of the `agy` CLI client to update documentation via prompt loops.
- **Decision:** Replace recursive agent process invocation with direct API calls against fast, lightweight LLM endpoints.
- **Consequences:** Eliminates recursive agent loops, process deadlocks, and excessive token burn while accelerating wiki update cycles to sub-minute latencies.

---

## ADR-003: Core Mandatory memB Semantic Memory Layer
- **Status:** Accepted
- **Context:** AI agents frequently lose long-term context across session restarts, leading to repeated questioning and forgotten design decisions.
- **Decision:** Mandate `memB` as a non-toggleable core dependency bundled with a local 30MB ONNX embedding model (`all-MiniLM-L6-v2`) and local SQLite database (`~/.MemBDB/memb.db`).
- **Consequences:** Provides zero-latency, private, local semantic recall across all agent interactions without dependency on cloud vector services.

---

## ADR-004: Multi-Provider LLM Flexibility for OpenWiki
- **Status:** Accepted
- **Context:** Different deployment environments (air-gapped workstations, high-throughput cloud runners, or rate-limited free tiers) require different LLM backends. Relying exclusively on one API provider limits flexibility.
- **Decision:** Implement a dual-engine architecture in `openwiki_daemon.py`: a native Google GenAI adapter (`google-genai` SDK) and a universal OpenAI-compatible REST protocol adapter. Expose provider switching via `OPENWIKI_PROVIDER`, `OPENWIKI_MODEL`, and `OPENWIKI_BASE_URL` supporting Google (Gemma 4), Groq, Grok/xAI, Nvidia NIM, OpenRouter, OpenAI, and local runners (Ollama, LM Studio).
- **Consequences:** Allows instant fallback, local offline execution, and provider agility with zero modifications to codebase scanning logic.

---

## ADR-005: Git-Only Deterministic Code Health Analytics (Zero-Token Engine)
- **Status:** Accepted
- **Context:** Calculating codebase hotspot velocity, author churn, single-contributor bus factor, and file modification frequencies via LLMs is slow, costly, and prone to hallucinations.
- **Decision:** Implement RepoGraph analytics purely via local Git commit history analysis (e.g. `git log`, `git shortlog`) with zero external LLM token consumption. Generate both structured Markdown reports (`.openwiki/code_health.md`) and an interactive 6-panel SVG dashboard (`.openwiki/code_health_dashboard.html`).
- **Consequences:** Sub-second execution, zero API token cost, mathematical accuracy on code churn, and real-time 60-second dashboard auto-refresh.

---

## ADR-006: Modular Extension Decoupling (Creator Suite vs. Core Skills)
- **Status:** Accepted
- **Context:** Heavy generative 3D pipelines (TRELLIS, TripoSR), automated cinema video suites (OpenMontage, Remotion Video-Shotcraft, Palmier Pro NLE MCP), and local ComfyUI model weights add tens of gigabytes of dependencies and complex CUDA/toolchain requirements.
- **Decision:** Decouple these heavy creative engines into an independent companion repository (`bdb-dev-creator-extension`). Maintain `bdb-dev-optimized-agent-skills` as a lean, ultra-fast universal core skills backbone with optional add-on links during installation.
- **Consequences:** Keeps the primary agent skills pack fast to install and lightweight to clone (<25MB), while providing deep creative generative pipelines for specialized workstations via the extension repo.

---

## ADR-007: Unified Package Installer for Pro and Basic Tiers
- **Status:** Accepted
- **Context:** Maintaining separate repositories and NPM packages for the "Pro" and "Basic" tiers of the agent skills led to CI/CD overhead, duplicated NPM workflows, and fragmented release pipelines.
- **Decision:** Consolidate the "Basic" tier into the primary `bdb-dev-optimized-agent-skills` package by introducing dynamic tier selection in the CLI installer (`installer.js`). The installer intelligently filters out heavy creative MCPs and specific pro skills when "Basic" is selected.
- **Consequences:** Eliminates the need for a separate basic repository and NPM package, creating a single source of truth, simplifying updates, and providing users with a unified `npx` entry point.

---

## ADR-008: Six-Pillar Godmode Skill Hierarchy
- **Status:** Accepted
- **Context:** High-level agent orchestration requires distinct domain governance across engineering, user interface design, delivery/shipping, physical event tech, 3D creation, and media generation to maintain consistent execution standards.
- **Decision:** Establish a six-pillar supreme domain governance architecture: `godmode-engineering`, `godmode-ui-ux`, `godmode-shipping`, `godmode-eventtech`, `godmode-3d-creation`, and `godmode-media-creation`. All domain-specific sub-skills and agent workflows route through these primary authority pillars.
- **Consequences:** Streamlines agent decision-making, prevents rule conflict across specialized tools, and enforces uniform quality thresholds across all creative and technical domains.

---

## ADR-009: Universal Harness & Cross-IDE Configuration Sync
- **Status:** Accepted
- **Context:** Developers and teams use diverse IDEs and agent interfaces (Antigravity, Claude Code/Desktop, Cursor, Windsurf, Roo Code / Cline, ChatGPT Codex CLI, Aider, VS Code), leading to fragmented rule maintenance and out-of-sync MCP configs.
- **Decision:** Implement a Universal Agent Harness Sync subsystem within the interactive installer to automatically inject and harmonize prompt rules, system instructions, and MCP tool configurations across all 8 supported agent environments.
- **Consequences:** Guarantees 1:1 parity in agent capabilities, memory access, and tool availability regardless of which IDE or CLI runner is active.

---

## ADR-010: Bundled Heimdall Context Compression Engine
- **Status:** Accepted
- **Context:** Raw output from CLI tools, test runners, and system commands consumes excessive token context, resulting in slow responses, high API costs, and context window exhaustion.
- **Decision:** Embed the Heimdall Token Saver engine natively into `vendor/token-saver/` within the core skills repository, providing context reduction on CLI tool outputs.
- **Consequences:** Cuts context payload sizes by 60–99% on CLI output while preserving critical stack traces, error codes, and assertions without external dependencies.

---

## ADR-011: Firecrawl Agentic Web Scraping Standard
- **Status:** Accepted
- **Context:** Extracting structured web data, executing multi-page site crawls, and interacting with JavaScript-rendered Web UI pages requires a standardized, resilient scraping toolset for agents.
- **Decision:** Standardize web data extraction on the Firecrawl CLI platform, integrating dedicated skills for structured JSON schema extraction (`firecrawl-agent`), bulk documentation crawling (`firecrawl-crawl`), page interaction (`firecrawl-interact`), site mapping (`firecrawl-map`), and deep search synthesis (`firecrawl-search`).
- **Consequences:** Provides reliable, LLM-optimized web data access and dynamic browser interaction across all agent workflows.

---

## ADR-012: Cross-Platform Installer & Daemon Hardening
- **Status:** Accepted
- **Context:** Windows installs produced invalid `mcp_config.json` (unescaped `\` path separators broke `JSON.parse`), npm dependency failures printed no actionable detail, OpenWiki API-key verification failed silently on TLS/network issues, and the macOS-only daemon script claimed success on Linux even though no launch agent existed.
- **Decision:**
  1. JSON-escape Windows paths before injecting `__MCPS_DIR__` / `{{HOME}}` into the generated MCP config.
  2. Capture and print trailing npm/pip error output on retry and failure so installers surface real root causes plus a manual re-run hint.
  3. Route OpenWiki API-key verification through `verify_api_key.py` with 2 retries plus a TLS-verification-disabled fallback and a clear, structured error diagnosis.
  4. Make `install_daemon.sh` platform-aware: macOS LaunchAgent, Linux systemd user service + timer when a systemd user session exists, otherwise an explicit skip with manual cron instructions and a non-zero exit code (never a false success).
- **Consequences:** The installer now behaves consistently and honestly on native Linux, macOS, and Windows; failed steps produce actionable diagnostics instead of silent degradation or misleading success messages.

---

## ADR-013: Strict SemVer Patch Cadence & Major Version 4.0 Gate
- **Status:** Accepted (Mandatory Enforcement)
- **Context:** Rapid minor version increments (e.g. 0.1.0 steps) cause unnecessary version drift, ecosystem churn, and premature exhaustion of the 3.x release space. Reaching major version 4.0.0 without explicit, deliberate architectural consolidation undermines release governance.
- **Decision:**
  1. **Strict Patch-Only Cadence (`3.9.x`):** All subsequent BDB Agent OS releases must increment strictly via granular patch steps (from `3.9.1` up to `3.9.99`). Minor bumps (0.1.0) are strictly frozen.
  2. **Major Version 4.0 Hard Gate:** Version `4.0.0` (or any `4.x` release) MUST NOT be triggered, committed, merged, or published under any circumstances without the literal, explicit user command: `"UPDATE VERSION TO 4"`.
  3. **Release-Please & Commit Discipline:** All agent and developer commits must use `fix:` or `chore:` conventions (or explicit patch configuration) to guarantee only patch increments occur automatically.
- **Consequences:** Provides steady, predictable release stability, prevents premature major version bumps, and ensures full human governance over the transition to BDB OS 4.0.

---

## ADR-014: Two-Phase GO Gate — Plan Files Are Not Approval, No Subagent Inheritance
- **Status:** Accepted (Mandatory Enforcement)
- **Context:** An agent running a multi-step `/startcycle`-style pipeline read its own execution plan file (`production_artifacts/*.md`), found literal `npm version` / `npm publish` commands written inside it, and executed them directly — publishing a package version without the user's literal `"GO"`. Root cause was twofold: (1) the CRITICAL TWO-PHASE GATE PROTOCOL's forbidden-tools list named `npm publish` but not `npm version`, so a plan step that only ran `npm version` first didn't visibly trip the gate; (2) nothing in the protocol said that a command's mere presence inside a plan/task file counts as authorization, so the agent treated "the plan says to do it" as equivalent to "the user said GO". A second, unreviewed publish attempt was also made afterward without a fresh authorization.
- **Decision:**
  1. **Explicit scope, not an exhaustive list:** The forbidden-tools list under the GO gate now names `npm version` alongside `npm publish`, `git push`, `git commit`, `rm` — closing the specific gap that let this incident happen.
  2. **Plans are not approval:** Any command found inside a plan, spec, or task file (including `production_artifacts/*.md` the agent itself wrote) still requires the gate to be checked independently before execution. A plan may describe a future action; it cannot authorize it.
  3. **No inheritance, no silent retries:** A subagent spawned by an already-authorized orchestrator does not inherit that orchestrator's "GO". A release/publish/push command that is blocked, fails, or has an ambiguous outcome must not be retried without a fresh, explicit "GO" for that specific retry.
- **Consequences:** Closes the exact loophole that produced an unreviewed `npm publish`. The gate's guarantee now holds regardless of whether a mutating command is typed directly by the agent or discovered inside a file the agent is following. Applied to the root `CLAUDE.md` in this repo and mirrored into the user's machine-wide `CLAUDE.md` / `GEMINI.md` so it binds every agent harness, not just this repository.

