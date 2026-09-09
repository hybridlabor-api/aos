# Release Notes

## Unreleased (open on the release-please PR as v4.2.0)
Published to npm as `4.2.0-beta.0` under the `beta` dist-tag for testing; `latest`
deliberately stays on 4.1.0, so nobody receives this without asking for it.

- **`--skill=<name>` mandatory skill injection.** Forces a specific skill — typically a
  private one no node's registry allowlist would reach for — into a pipeline run:
  `/startcycle-graph --skill=my-own-skill add OAuth login`. Repeatable. The name is
  validated against installed skills *before* anything runs; one that does not resolve
  escalates instead of silently proceeding without it, as does an empty `--skill=`.
  From there it is a hard requirement: it goes into the plan, TechLead rejects a plan
  that ignores it, and Reviewer treats an artifact showing no sign of it as a blocking
  contract-misread finding. Shipping is deliberately excluded — it runs mechanical gates
  and produces no artifact a skill would shape. Contract in `.agents/graph.md`; the two
  lighter variants document the same syntax, invoker-driven since neither has a
  dispatcher script to carry it. Verified end to end: escalation fires at iteration 0,
  before any agent does work.
- **`/startcycle-graph` first run in a fresh project was broken.** Step 0 copied
  `.agents/graph.md` and `.agents/state.schema.json` but not `.agents/nodes.json`, which
  the dispatcher loads as its very first action and escalates on when absent. Any project
  running the graph for the first time failed before Architect ran, even after following
  the documented bootstrap exactly. Found by running the dispatcher end to end in a
  project that had never run it.
- **OpenWiki daemon could never load its SDK.** Two independent bugs, either alone leaving
  it permanently in collect-only mode: `pip3 install google-genai` fails on any PEP 668
  interpreter (Homebrew/Debian) and the old `2>/dev/null` swallowed the reason; and the
  install went to whichever `python3` was on PATH while the macOS launcher ran the daemon
  under a hardcoded `/usr/bin/python3` — a different interpreter that never saw the
  package. Now installs into `~/.openwiki/venv` and pins the launcher, the key check and
  the printed cron fallback to that same interpreter.
- **Delegation policy, documented for the first time.** AOS had none: the plugin
  delegation subagents (`antigravity:antigravity-delegate`, `opencode:opencode-rescue`,
  `codex:codex-rescue`) were mentioned nowhere, and the only place delegation appeared
  described it purely as raw shell calls. Three rules now in `CLAUDE.md`, `AGENTS.md` and
  `GEMINI.md`: prefer a plugin's subagent over shelling out; delegate only above the
  break-even; **verify the returned content, never the status field** — a failing agy
  delegation returns `{"status":"SUCCESS","usage":{"total":0}}` with an empty body.
  Flagged explicitly as Claude Code plugins that do **not** ship with AOS.
- **agy tier→model mapping.** The wrapper's built-in `flash` tier still points at Gemini
  3.7 while 3.8 ships. Documented the per-task mapping (media and mechanical coding to 3.8
  Flash, review and architecture to Claude Sonnet 4.6 — adversarial review most repays the
  stronger tier, since a Flash model tends to agree with what it is shown) and both ways
  to apply it. Note the env vars belong in `~/.zshenv`, not `~/.zshrc`: the latter is
  sourced only for interactive shells, so tool-invoked ones never see them.
- **Timeout guidance corrected.** A trivial headless `agy` prompt measured **605 s**;
  `agy-delegate` defaults to 5 minutes and reports an empty body while the answer is still
  coming. Pass `--timeout 15m`. This corrects an earlier conclusion in these notes' own
  direction of travel: repeated 300 s failures with zero token counts were read as "the
  prompt never reached the model" and called an upstream break. Neither held — headless
  usage reporting is simply unpopulated.
- **README**: badge row rebuilt into live-status and capability rows; skill count corrected
  154 → 169 (the badge and prose had both drifted).

## v4.1.0 (Plan Canvas & Auxiliary Agents)
First release to ship end-to-end through the repaired automation — tag, GitHub Release and
npm publish all from a single PR merge, with no manual `gh release create` or `npm publish`.

- **Plan Canvas** (`skills/global_config/plan-canvas/`, `aos-plan-canvas` bin): a
  loopback-only browser page for reviewing a plan by pointing at it — Mermaid renders live,
  click-to-annotate, chat side-rail, and Approve / Request-changes buttons whose verdict is
  the confirmation gate. Vendored from the MIT-licensed
  [affaan-m/ECC](https://github.com/affaan-m/ECC); see `THIRD_PARTY_NOTICES.md`. Rebranded
  so a co-installed original cannot collide (port 4519, own app id, own state dir,
  `AOS_PLAN_CANVAS_*` env prefix), and its version decoupled from AOS's `package.json`
  since the installer relocates the vendored tree. Mandatory at the end of `bdbrainstorm`
  and `bdbmediastorm`, optional at `/startcycle`'s Architect→TechLead gate — `/startcycle-graph`
  runs headless by design, so a browser gate is never forced there.
- **Six auxiliary agents** ported from the same source: `silent-failure-hunter`,
  `security-reviewer`, `go-build-resolver`, `database-reviewer`, `opensource-forker`,
  `opensource-sanitizer`. They are **not** pipeline nodes — never in `.agents/nodes.json`,
  never dispatched — but standalone specialists. Defined in `.agents/agents.md` so the
  installer compiles them for every harness rather than leaving them Claude-Code-only.
- **Release automation repaired.** `.release-please-manifest.json` had drifted to 3.12.0
  while the package shipped 4.0.2, because manual version bumps went straight to `main`
  instead of through a release PR; two stale release PRs proposing 3.12.1 were closed.
  `CLAUDE.md` now documents the Conventional Commits requirement and the `feat:` vs
  `fix:`/`chore:` lever that governs how fast the version grows.

## v4.0.2 (ask-tim Skill Discovery Guide)
- **New `/ask-tim` skill**: routes a user or agent to the right skill out of the 150+ available, organized by intent rather than internal category, with explicit overlap guidance (the 3 build pipelines, `n8n-*`/`ui-*`/`firecrawl-*` clusters, `godmode-*` orchestrators vs narrower skills). Defers to `CLAUDE.md` for canonical routing rules instead of duplicating them.
- Self-audited before release: first draft covered 65% of the skill catalog; closed to 91% (agent-orchestration, UX, language-expertise, and architecture clusters were the largest gaps).

## v4.0.1 (Installer Bugfixes)
- **Synapse 3D daemon fix**: the LaunchAgent (macOS) and startup script (Windows) never passed `--port 7781` to the binary, so it bound a different random port every restart while the installer always checked 7781 specifically. Reproduced on every machine, every install. Fixed on both platforms.
- **memB install fix**: prefers `uv pip install --python <venv>` over `-m pip` whenever `uv` is available, since `uv venv --seed` was observed to silently under-deliver `pip` into the venv.
- **README.pt.md**: the entire skill-catalog table (134 of ~155 rows) had never been translated — fixed and verified. Also closed two missing sections (`BDB OS Agent Workspace`, `BDB Synapse`) in both README.de.md and README.pt.md.

## v4.0.0 (AOS — the Rename)
- **Renamed** from `bdb-dev-optimized-agent-skills` to **AOS** (`@hybridlabor-api/aos`) — package, GitHub repo, and CLI bin names. Old package name deprecated on npm, pointing users to the new one.
- **New installer startup sequence**: rotating 3D ASCII intro, gradient wordmark banner, studio hero header, and a pre-flight telemetry card (detected agent platforms, daemon status, install/version state) — all before the first prompt.
- **OpenWiki setup now runs on every Quick Update**, not just fresh installs — previously it only ever ran once and was never offered again to existing installs.
- `bdb-os-agent-workspace` temporarily removed from the tracked module list (main branch frozen upstream while real work sits on unmerged WIP branches) — daemon/LaunchAgent code untouched, only the offer/auto-update path disabled.
- Carried over from the v3.13 "NODEFORGE" development cycle: `/startcycle` split into three variants with a declarative node registry; new `bdb-deploy`, `triage`, and `prototype` skills; `bdbsaas-ops` retired into `bdbsaashost`; OpenWiki modernized to `langchain-ai/openwiki` v0.5.0.
- `bdb-dev-optimized-agent-skills-basic` and `bdb-dev-optimized-antigravity-skills` retired (archived on GitHub, deprecated on npm) — this package is now the only supported one.

## v3.10.0 (Dynamic Gateway Discovery, Windows Daemons & SaaS Academy)
- **Dynamic Gateway Discovery (`setup-saas` CLI)**: Added `bin/setup-saas.mjs` with zero-copypaste browser 2FA loopback handshake (port 8123). Supports interactive domain selection (`--gateway`, `--domain`) and auto-injects FastMCP SSE configurations into Google Antigravity, Claude Desktop, Cursor, and Roo Code.
- **Zero-Leak Enterprise Sanitization**: Purged all static infrastructure metadata, server IPs, and hardcoded private domains from public NPM and GitHub distribution files.
- **BDB SaaS Training Academy (`/bdbsaastraining`)**: 5-station interactive sysadmin and agent harness bootcamp covering Step-CA 2FA, Incus custom profiles, agent sandboxing, FastMCP 4-eyes approval drills, and automated Playwright dark-mode PDF certification.
- **Native Windows Background Daemons**: Implemented headless `.vbs` startup runner engine for Windows, spawning memB WebUI (`:8088`), Synapse 3D (`:7781`), and Agent Workspace (`:3101`) silently without open command prompt windows.
- **Glassmorphic Live-Health Launchpad**: Upgraded `bdb-launchpad.html` with modern matte-dark UI and real-time JavaScript polling indicators across all 8 ecosystem engines.
- **Zero-Trust FastMCP & Agent-Sudo Guardrails**: Hardened `bdbsaashost` skill with strict least-privilege execution rules and 4-eyes HMAC approval workflows.
- **memB Hybrid Engine Synchronization**: Upgraded memB to v2.3.1 with SQLite WAL mode, FTS5 BM25 hybrid search, and FastMCP 8-tool surface.

## v3.9.6 (Automated Patch Release)
- **Patch Release**: Automated version synchronization via Release-Please for package manifest consistency.

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
