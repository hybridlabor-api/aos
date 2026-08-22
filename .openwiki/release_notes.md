# Release Notes

## Unreleased — Two-Phase GO Gate Hardening (see ADR-014)
- **Fix:** `npm version` added to the CRITICAL TWO-PHASE GATE PROTOCOL's forbidden-tools list in `CLAUDE.md` (was previously only `npm publish`, leaving a gap a plan-driven agent could walk through).
- **Fix:** Gate now explicitly states that commands found inside a plan/task file (e.g. `production_artifacts/*.md`) are not a "GO" — they still require independent gate approval before execution.
- **Fix:** Gate now explicitly states subagents don't inherit an orchestrator's "GO", and a blocked/failed release command must not be silently retried without a fresh one.
- **Status:** Change is written to this repo's `CLAUDE.md` (uncommitted) and mirrored to the user's machine-wide `CLAUDE.md`/`GEMINI.md`. Intentionally left uncommitted here pending the next update cycle's commit/push, per the very gate this change enforces — no `git commit`/`git push` without an explicit "GO".

## v3.9.0 (1-Click Quick Update Mode, State Detection & Seamless Daemon Reload)
- **1-Click Quick Update Mode (`executeQuickUpdate`)**: Intelligent top-level update flow detecting existing installations (`~/.agents/.bdb-manifest.json`). Enables instant 5-second non-interactive upgrades of all 160 skills, rules, and MCP configs while keeping existing API keys, tokens, and custom user MCPs intact.
- **Interactive Top-Level Status Banner**: Clear terminal prompt displaying local vs. remote version (`v3.8.0 ➔ v3.9.0`). Highlights `[1] ⚡ Quick Update` if updates are available, or `🛠️ Re-configure / 🔄 Repair` if already up-to-date.
- **Post-Update New Module Discovery (`promptNewModules`)**: Automatically synchronizes all previously installed submodules first, and then selectively offers newly introduced ecosystem modules without asking 10 upfront configuration questions.
- **Automated Daemon Reload (`reloadDaemons`)**: Triggers zero-downtime background reloads for Synapse 3D (`com.bdb.synapse`), Remote Gateway (`com.hybridlabor.bdb-remote`), and Agent Workspace (`com.bdb.ao.daemon`).
- **Persistent State Manifest (`saveManifest`)**: Writes machine-readable `.bdb-manifest.json` under `~/.agents/` for reliable cross-platform version discovery and drift prevention.

## v3.8.1 (Windows CLI Execution, Color Escaping & Path Normalization)
- **Cross-Platform `execSync` Hardening**: Replaced shell redirection `2>/dev/null` with `{ stdio: ['ignore', 'pipe', 'ignore'] }` across all version inspection checks, eliminating Windows `cmd.exe` path errors (`Das System kann den angegebenen Pfad nicht finden`).
- **Terminal Color Formatting**: Added missing `blue` ANSI color token in `colors` palette, fixing `undefined` prefixes in module prompts.
- **AI Vault Path Normalization**: Unified Windows forward/backward slash formats in `memB_Vault` generators using `os.path.normpath`.
- **Ecosystem Verification Path Fix**: Corrected package lookup directory to `srcDir` for accurate local version auditing.

## v3.8.0 (Live Drift-Checker, Multi-Repo Ecosystem Sync & Port Registry)
- **Live Version Drift-Checker (`downloadOrUpdateModule`)**: Added autonomous NPM remote version detection across all standalone modules (`bdb-synapse`, `memB`, `bdb-os-remote`, `bdb-dev-tool-installer`, `bdb-dev-creator-extension`, `bdb-os-agent-workspace`). Automatically downloads `@latest` tarballs if upstream releases exist on NPM.
- **memB v2.3.0 Engine Upgrade**: Synced full hybrid vector store with SQLite WAL concurrency, FTS5 BM25 keyword boosting (1.25x), SHA-256 deduplication, and 8-tool FastMCP interface.
- **BDB Standard Port Registry (`77xx` standard)**: Implemented isolated port allocation (`:7781` Synapse, `:9080` Remote Gateway, `:7785` SaaS Console, `:7790` memB Dashboard) with live discovery via `~/.bdb/ports.json` and automatic `EADDRINUSE` auto-increment fallback.
- **Persistent LaunchAgents**: Configured background autostart daemons for Synapse 3D (`com.bdb.synapse.plist`) and BDB Remote Gateway (`com.hybridlabor.bdb-remote.plist`).

## v3.7.0 (Ecosystem Auto-Updater & SaaS Server Management Decoupling)
- **Ecosystem Auto-Updater**: Automated module upgrade pipelines in `installer.js` replacing manual git clone prompts with self-healing NPM package downloads.
- **SaaS Server Management Decoupling**: Decoupled `bdb-remoteos-mcp` from standard installation into an on-demand SaaS & Cloud Server Management module.

## v3.6.0 (Zero-Trust Tailscale Multiplexer & Config Injector)
- **BDB OS Remote Gateway v2.0**: Integrated high-speed MCP multiplexing over Tailscale SSE tunnels, allowing thin-client agent harnesses (AGY, Codex, Claude Desktop) to invoke workstation MCPs and clone workspaces with zero latency.
- **Heimdall Token Saver v2.6.3**: Production-hardened CLI context compression engine saving 60–99% token bandwidth on large git diffs, build outputs, and MCP JSON responses.

## v3.5.0 (Synapse 3D Visualizer v1.1.0 & Multi-Harness Session Mapping)
- **Synapse 3D Integration**: Native 3D codebase visualizer and session replay engine parsing Antigravity (`transcript.jsonl`), Claude Code, Codex, and Pi agent traces.
- **Multi-Agent Workspace Topology**: Automated graph layout, real-time code velocity coloring, and subagent hierarchy clustering.

## v3.1.6 (OpenWiki Model Fix)
- **Valid default Google model**: The OpenWiki Google default in the API key verifier was `gemma-4-12b-it`, which does **not** exist in the Google API (confirmed `404 NOT_FOUND`), so verification always failed. The verifier now probes the verified default `gemma-4-26b-a4b-it` and keeps the provider wizard / daemon on the verified Google models (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`, `gemini-2.5-pro`, `gemini-3.5-flash`).
- **Automatic model discovery**: `verify_api_key.py` and `openwiki_daemon.py` now query the models API and automatically fall back to the first available `generateContent`-capable Gemini/Gemma model when the configured one is unknown, so a valid key never reports a false failure because of a wrong model name.
- **Verified model lists synced**: Provider wizard labels and hints updated to the verified availability lists (OpenAI `o1`, OpenRouter `openai/gpt-4o`, Ollama `gpt-oss-20b`).

## v3.1.5 (Cross-Platform Installer Hardening — Native Linux/macOS/Windows)
- **Bug 1 — JSON escaping on Windows**: Paths injected into the generated `mcp_config.json` (`__MCPS_DIR__`, `{{HOME}}`) are now JSON-escaped, fixing the `Bad escaped character in JSON` crash that broke MCP config writing on Windows.
- **Bug 2 — npm verbose diagnostics**: `runNpmWithRetry` now captures and prints trailing npm output plus a manual re-run command on retries and final failure, so failures like the `after-effects-mcp` install show the real root cause instead of a bare `Command failed`.
- **Bug 3 — OpenWiki key verification**: New `verify_api_key.py` validates `GEMINI_API_KEY` with two retries and a TLS-verification-disabled fallback, then reports a clear, structured error diagnosis instead of silently degrading to collect-only mode.
- **Bug 4 — Linux daemon detection**: `install_daemon.sh` now installs a systemd user service + timer on Linux when a systemd user session exists; without systemd it prints an explicit skip with cron instructions and exits non-zero (no false success). macOS LaunchAgent path unchanged.
- **OpenWiki skill refresh**: `SKILL.md`, `.openwiki/` docs and `openwiki_daemon.py` updated for Linux support; `google-genai` is now only required for the `google` provider.

## v3.1.4 (Installer Robustness)
- **Installer:** Robust JSON config parsing and correct daemon task error handling.

## v3.1.3 (Windows memB Fix)
- **Installer:** Prevent memB pip install hang on Windows.

## v3.1.2 (Windows Compatibility)
- **Installer:** Windows compatibility — UTF-8, npm retries, scheduler fallback, OpenCode support.

## v3.1.1 (Installer Hang Fix)
- Prevent installer hang by using async daemon startup.

## v3.1.0 (OpenWiki Provider Expansion)
- **Feature:** Expand OpenWiki LLM provider wizard with additional models.
- **CI:** Use `npm install` for release publish without lockfile.

## v3.0.7 (CI Repair)
- **CI:** Repair release-please workflow for v3.0.6 release automation.

## v3.0.6 (Installer Stabilization & Broken MCP Cleanup)
- **Installer:** Inject Gemini API key for memB and make DaVinci Resolve MCP setup unattended.
- **MCP:** Add `setuptools_scm` version spoofing for the Rhino fallback server.
- **MCP:** Replace invalid `uv run -r` with `--with-requirements` and fix `setuptools_scm` version lookup for the DaVinci fallback.
- **MCP:** Resolve port conflicts, missing `uv` PATH, missing `anyio`, and the open_design daemon URL.

## v3.0.5 (Universal Harness UI)
- **Installer UI polish:** Option (0) now seamlessly combines the official 'Universal Agent Harness' architectural branding with the dynamic list of detected environments.

## v3.0.4 (Credential Reuse)
- **Installer UX upgrade:** If existing API keys are detected, the installer offers a 1-click option to keep all existing credentials and skip the setup wizard completely.

## v3.0.3 (Environment Detection UI)
- **Installer UI enhancement:** Option (0) now dynamically displays all detected agent environments directly in the selection menu.

## v3.0.2 (Credential Auto-Detection)
- **Installer UX upgrade:** Auto-detects existing API keys and `.env` credentials from previous installations and allows one-key Enter reuse.

## v3.0.1 (MCP Fixes)
- Fix open-design-mcp package 404 error and add `GEMINI_API_KEY` fallback support to memB MCP.

## v3.0.0 (Godmode Architecture, Universal Agent Harness & Ecosystem Integrations)
- **Six-Pillar Godmode Architecture**: Introduced supreme domain governance pillars (`godmode-engineering`, `godmode-ui-ux`, `godmode-shipping`, `godmode-eventtech`, `godmode-3d-creation`, `godmode-media-creation`) routing all sub-skills under master governance rules.
- **BDB Ecosystem Integrations**: Full companion links and architecture pairing with `bdb-dev-creator-extension` (heavy 3D/video/ComfyUI CUDA compute) and `bdb-os-agent-workspace` (desktop IDE meta-harness orchestrator).
- **Universal Agent Harness Sync**: Multi-IDE rule and MCP injection supporting Antigravity, Claude Code/Desktop, Cursor, Windsurf, Roo Code / Cline, ChatGPT Codex CLI, Aider, and VS Code.
- **Bundled Heimdall Token Saver**: Embedded context compression engine (`vendor/token-saver/`) reducing CLI tool output overhead by 60–99%.
- **Firecrawl Agentic Web Scraping Suite**: Specialized agent set for structured JSON data extraction, website crawling, browser interaction, and search synthesis.
- **Improved Design Skill Environment**: Major upgrades to frontend and UI/UX design skills, including rigid adherence to enterprise accessibility, fluid motion dynamics, and strict anti-slop visual quality gates.
- **Open-Design MCP Integration**: Integrated the new open-design MCP server into the installer for seamless extraction and inspection of design assets.
- **Interactive Installer Overhaul**: Improved multi-platform menu, promptMode sync, and Basic vs. Pro tier management (consolidating installer logic to dynamically handle both package tiers).

## v2.4.0 (Multi-Provider OpenWiki, RepoGraph Code Health & Creator Decoupling)
- **Multi-Provider LLM Engine for OpenWiki**: Decoupled `openwiki_daemon.py` from single-provider constraints. Fully supports Google Gemini (`gemini-2.0-flash` via `google-genai`), Groq (`llama-3.3-70b-versatile`), Grok/xAI (`grok-2-latest`), Nvidia NIM (`meta/llama-3.3-70b-instruct`), OpenRouter (`anthropic/claude-3.5-sonnet`), OpenAI (`gpt-4o-mini`), Ollama (`llama3`), LM Studio, and custom OpenAI-compatible endpoints via environment variables.
- **RepoGraph Deterministic Code Health Engine**: Introduced zero-token, zero-inference local Git analytics in OpenWiki. Computes 90-day hotspot velocity, maintainability index, commit distribution, and single-author bus factor risk scoring without external API calls.
- **Interactive Code Health Dashboard (`code_health_dashboard.html`)**: Added a Repowise-grade visual dashboard in `.openwiki/` featuring 6 SVG visual panels (Galaxy Cluster Map, Defect Risk Donut, Bus Factor Matrix, Commit Velocity Churn, Hotspot Leaderboard, Architecture Radar), 60-second live auto-refresh, and real-time memB ADR synchronization.
- **Architectural Decoupling of Creator Suite**: Decoupled heavy generative 3D pipelines (TRELLIS, TripoSR, text-to-cad), cinema video generation (OpenMontage, Remotion Video-Shotcraft, Palmier Pro NLE MCP), and local ComfyUI rendering into the standalone `bdb-dev-creator-extension` repository.
- **MCP Installer Sanitization**: Enhanced `installer.js` directory scanning to filter out dotfiles, `.DS_Store`, and `__pycache__` artifacts during interactive and automated MCP setup.

## v2.3.0 (Ecosystem Phase 4)
- **Agentic Ingestion**: Discarded dumb crawling. `memb_ingest.py` is now explicitly driven by LLMs via `--project` and `--category` flags, ensuring highly semantic, intelligent physical categorization.
- **Auto-Pruning Vault**: The AI-first Vault (`God_Mode.md`) is now perfectly self-pruning and strictly sanitizes filenames for Obsidian WikiLink compatibility.
- **Loose Coupling Fusion (memB + OpenWiki)**: Implemented cross-skill synergistic triggers. OpenWiki can now autonomously trigger memB ingestion via silent background CLI handoffs.
- **Global AI-First Directives**: Deployed strict navigation directives to `memb-skill`, forcing all agents (Antigravity, Cursor, Claude) to read `God_Mode.md` instead of blindly scanning files.

## v2.2.1
- **memB Core Architecture Update**: `memb_ingest.py` now natively generates an AI-first flat-file markdown vault (Top-Down Radial God Mode Topology) to allow native zero-compute context navigation for local 30MB SLMs.
- Replaced `_CLAUDE.md` with a universal `agent.md` operating manual for the vector engine in the vault.

## v2.2.0
- Relicensed project under Apache 2.0 Licensing.
- Added **memB Deep Ingestion Tool** (`memb_ingest.py`) and new `/memb-ingest` skill.
- Created native **Obsidian Vault Plugin** for memB synchronization and removed static obsidian scripts.
- Added Obsidian Vault exporter and Mermaid knowledge graph visualizer tool (with radial mindmap layout).
- Implemented a non-blocking auto-update checker for npm releases.
- Added new `/bdbmediastorm` skill and updated `/bdbrainstorm` scaffolding rules.
- Added new `github-repo` skill for repository standards.
- Added trilingual README support (English, German, Portuguese) with 1:1 complete section parity.
- Synced latest BDB MCP token-saver processors.
- Fixed grandMA3 MCP architecture configuration to avoid OSC port conflicts.

## v2.1.0
- Split package into `-pro` (with OpenWiki and memB background daemons) and `@legacy` tags on NPM.
- Rewrote the OpenWiki daemon to use direct Gemma 4 API calls, fixing infinite recursion bugs and `agy` agent spawning issues.
- Updated the CLI installer with an interactive colored menu for MCP selection.
- Automated daemon deployment and `.env` credentials storage via the installer.

## v2.0.0
- Refined skill selection down to 143 highly optimized skills.
- Integrated OpenWiki documentation support.
- Cleaned up PII and added strict privacy guidelines.

## v1.1.0
- Official v1.1.0 release. Includes all agent skills, installer, memB, and Token Saver.
