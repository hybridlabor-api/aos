# Architecture

This document tracks the technical architecture and modular structure of the **BDB Agent OS Ecosystem**.

---

## 🏛️ Ecosystem Topology & Modular Decoupling

The ecosystem is partitioned into dedicated modular layers to balance high-speed agent agility with desktop orchestration and specialized heavy-compute creative pipelines:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│           bdb-os-agent-workspace (Desktop IDE Meta-Harness)             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Architecture & Workspace Pairing
┌────────────────────────────────────▼────────────────────────────────────┐
│              bdb-dev-optimized-agent-skills (Core Backbone)             │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Six-Pillar Godmode Architecture                                   │  │
│  │ (engineering, ui-ux, shipping, eventtech, 3d-creation, media)    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │ Universal Agent  │  │ memB Semantic    │  │ OpenWiki Multi-LLM    │  │
│  │ Harness Sync     │  │ Memory Engine    │  │ & RepoGraph Engine    │  │
│  └──────────────────┘  └──────────────────┘  └───────────────────────┘  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │ Heimdall Token   │  │ Firecrawl Web    │  │ 6-Stage Agent         │  │
│  │ Saver CLI Engine │  │ Scraping Suite   │  │ Pipeline Engine       │  │
│  └──────────────────┘  └──────────────────┘  └───────────────────────┘  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Modular Add-on Architecture
┌────────────────────────────────────▼────────────────────────────────────┐
│               bdb-dev-creator-extension (Heavy Compute)                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │ 3D Generation    │  │ Video Production │  │ ComfyUI MCP Engine    │  │
│  │ (TRELLIS/TripoSR)│  │ (OpenMontage/NLE)│  │ (FLUX/SDXL/Wan2.1)    │  │
│  └──────────────────┘  └──────────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

1. **Core Skills Backbone (`bdb-dev-optimized-agent-skills`)**:
   - Ultra-lightweight, high-speed skill execution engine.
   - Bundles the Six-Pillar Godmode Architecture, Universal Agent Harness Sync, 22 core local MCP servers, memB semantic memory, OpenWiki daemon, Firecrawl web scraping suite, and Heimdall Token Saver.
2. **Desktop Orchestration Harness (`bdb-os-agent-workspace`)**:
   - Desktop IDE meta-harness orchestrator providing multi-workspace coordination and UI environment setup.
3. **Creator Extension Suite (`bdb-dev-creator-extension`)**:
   - Standalone modular extension containing heavy CUDA/ML models, 3D parametric & mesh generators (TRELLIS, TripoSR, text-to-cad), automated cinema video pipelines (OpenMontage, Remotion Video-Shotcraft, Palmier Pro NLE MCP), and local ComfyUI rendering workflows.

---

## ⚙️ Core Subsystems

### 1. Six-Pillar Godmode Architecture
A supreme domain governance framework structuring agent execution under 6 master skills:
- `godmode-engineering`: Fullstack software engineering, clean code, TDD, refactoring, and API patterns.
- `godmode-ui-ux`: Frontend design, visual excellence, responsiveness, design systems, and micro-interactions.
- `godmode-shipping`: CI/CD pipelines, release orchestration, documentation synchronization, and git management.
- `godmode-eventtech`: Show control, lighting (grandMA3), media servers (Resolume), TouchDesigner, and live hardware protocols.
- `godmode-3d-creation`: Parametric CAD, McNeel Rhino, Grasshopper, Unreal Engine 5, and 3D asset workflows.
- `godmode-media-creation`: DaVinci Resolve video editing, Adobe ExtendScript automation, motion graphics, and audio processing.

### 2. Universal Agent Harness Sync Subsystem
Automated multi-IDE configuration and rule synchronization engine:
- Injects and harmonizes system prompts, agent instructions, and MCP tool definitions across 8 supported agent environments: **Antigravity**, **Claude Code / Desktop**, **Cursor**, **Windsurf**, **Roo Code / Cline**, **ChatGPT Codex CLI**, **Aider**, and **VS Code**.
- Eliminates configuration drift and maintains strict 1:1 functional parity across all developer tools.

### 3. BDB Ecosystem Integrations
Deep architectural pairing across the BDB ecosystem:
- **`bdb-dev-creator-extension`**: Companion link handling heavy CUDA/ML tasks, local ComfyUI rendering, 3D mesh synthesis, and cinema video generation.
- **`bdb-os-agent-workspace`**: Desktop meta-harness desktop orchestrator for environment management and multi-agent coordination.

### 4. Multi-Provider OpenWiki Engine (`openwiki_daemon.py`)
A continuous, non-intrusive background daemon that maintains codebase documentation, changelogs, architecture specs, and design decisions in `.openwiki/`.
- **Multi-Provider LLM Support:** Fully decoupled from vendor lock-in with unified OpenAI-compatible and Google GenAI adapters:
  - **Google:** `gemma-4-26b-a4b-it` (via `google-genai` SDK, automatic model discovery fallback)
  - **Groq:** `llama-3.3-70b-versatile` (ultra-low latency)
  - **Grok / xAI:** `grok-2-latest`
  - **Nvidia NIM:** `meta/llama-3.3-70b-instruct`
  - **OpenRouter:** `anthropic/claude-3.5-sonnet` and 200+ models
  - **OpenAI:** `gpt-4o-mini` / `gpt-4o`
  - **Local Offline / Self-Hosted:** Ollama (`llama3`), LM Studio, or any custom OpenAI-compatible endpoint
- **Configuration:** Controlled via `OPENWIKI_PROVIDER`, `OPENWIKI_MODEL`, and `OPENWIKI_BASE_URL` environment variables.
- **Cross-Platform Daemon Registration:** `install_daemon.sh` installs a macOS LaunchAgent (`StartInterval` 2h) or, on Linux with a systemd user session, a systemd user service + timer (2h); without systemd it reports an explicit skip with cron instructions and a non-zero exit code. `install_daemon.ps1` registers a Windows Scheduled Task with a Startup-folder fallback.
- **Key Verification:** `verify_api_key.py` validates `GEMINI_API_KEY` with two retries plus a TLS-verification-disabled fallback and prints a concrete error diagnosis on failure so the daemon never silently falls back to collect-only mode.

### 5. RepoGraph Deterministic Code Health Analytics (Zero-Token Git Engine)
A 100% deterministic, zero-token cost analysis subsystem embedded in the OpenWiki pipeline:
- **90-Day Hotspot Tracking:** Scans commit velocity and file churn frequency over rolling 90-day intervals to compute relative defect risk.
- **Single-Author Bus Factor Analysis:** Automatically identifies mission-critical files touched by only one contributor.
- **Maintainability & Churn Scoring:** Evaluates codebase stability without sending source files to external LLMs.
- **Interactive HTML Dashboard (`.openwiki/code_health_dashboard.html`):** Repowise-grade visualization featuring:
  - 6 SVG visual panels: Galaxy Cluster Map, Defect Risk Donut, Bus Factor Matrix, Commit Velocity Churn, Hotspot Leaderboard, Architecture Health Radar.
  - 60-second live auto-refresh (`<meta http-equiv="refresh" content="60">`).
  - Integrated memB sync card displaying recent Architectural Decision Records (ADRs).

### 6. memB Local Semantic Memory Brain
An offline-first, local vector database and knowledge management engine:
- **Vector Embedding Engine:** Pre-quantized 30MB `all-MiniLM-L6-v2` ONNX model coupled with a local SQLite database (`~/.MemBDB/memb.db`).
- **Semantic Ingestion Tool (`memb_ingest.py`):** Ingests `.openwiki`, `agent.md`, ADRs, and session transcripts using targeted `--project` and `--category` flags.
- **Physical Radial Vault (`God_Mode.md`):** Generates an AI-first directional markdown vault (`~/.MemBDB/memB_Vault`) designed for zero-compute orientation by local SLMs.
- **Obsidian Graph Plugin (`obsidian-memb-plugin`):** Directional parent-to-child graph visualizer preventing context clustering.

### 4. Heimdall Token Saver CLI Context Compression Engine
- Reduces agent context overhead by **60–99%** on high-volume CLI tool outputs across 36 specialized processors.
- Enforces strict zero-information-loss rules on stack traces, exit codes, and test assertions with automated secret redaction.

---

## 🔄 BDB Agent Pipeline Architecture

The structured lifecycle enforces quality, deterministic verification, and automated memory ingestion across all AI agents:

```text
                      ┌──────────────────────────────────────────────┐
                      │ 1. ENTWICKLUNG & PIPELINE                    │
                      │    (spec ──▶ plan ──▶ build ──▶ test)        │
                      └──────────────────────┬───────────────────────┘
                                             │
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │ 2. RELEASE & DOCS GATE                       │
                      │    • openwiki-skill scannt Git-Diff          │
                      │    • Aktualisiert .openwiki/ & README.md     │
                      └──────────────────────┬───────────────────────┘
                                             │
                            ┌────────────────┴────────────────┐
                            ▼                                 ▼
             ┌───────────────────────────────┐ ┌──────────────────────────────┐
             │ 3a. OPENWIKI (.openwiki/)     │ │ 3b. MEMB VECTOR & VAULT       │
             │     • quickstart.md           │ │     • SQLite Vector Embeddings│
             │     • architecture.md         │ │     • AI-Vault: God_Mode.md   │
             │     • release_notes.md        │ │     • Triggered via ingest.py │
             └──────────────┬────────────────┘ └──────────────┬────────────────┘
                            │                                 │
                            └────────────────┬────────────────┘
                                             │
                                             ▼
                      ┌─────────────────────────────────────────────┐
                      │ 4. KONTEXT-ABRUF FÜR NEUE AGENTEN            │
                      │    • AGENTS.md / CLAUDE.md ──▶ .openwiki      │
                      │    • search_memory Tool ──▶ memB             │
                      └──────────────────────────────────────────────┘
```

### 🚀 Autonomous Multi-Agent Macro: `/startcycle`
Dispatcher-mediated graph (v2) using a 7-agent team — see `.agents/graph.md`
and `.agents/state.schema.json` for the full contract (state schema, node
table, edge predicates). Summary:
1. **`Architect`** → **`TechLead`**: goal ➔ plan ➔ capability-map approval, written to `production_artifacts/state.json` / `00_execution_plan.md`.
2. **Build nodes** (dispatcher-invoked independently, not chained):
   - `Godmode_UI_UX`: Frontend & design token styling ➔ `production_artifacts/01_frontend_spec.md`.
   - `Godmode_Engineering`: DDD models, APIs, and schemas ➔ `production_artifacts/02_backend_schema.md`.
   - `Godmode_Media_EventTech`: TouchDesigner, Unreal, DaVinci, DMX ➔ `production_artifacts/03_media_pipeline.md`.
3. **`Reviewer`**: adversarial review of build output against the plan's contract ➔ `state.findings`, with a repair loop back to the owning build node on any blocking finding.
4. **`Godmode_Shipping`**: automated testing, linting, WCAG, and SEO audit gate ➔ `production_artifacts/04_release_report.md`. Ships only with all gates green and a `GO`.
5. **Knowledge Loop (`/ship`)**: automatic documentation sync with `openwiki-skill` and SQLite vector indexing with `memb-ingest`.

---

## 📁 Repository Directory Structure

```text
bdb-dev-optimized-agent-skills/
├── .openwiki/                       # Living architectural & codebase documentation
│   ├── quickstart.md                # Developer onboarding and setup
│   ├── architecture.md              # System design, data flows, and subsystem topology
│   ├── decisions.md                 # Architecture Decision Records (ADRs)
│   ├── release_notes.md             # Version changelogs and feature history
│   ├── code_health.md               # Deterministic RepoGraph metrics & hotspot report
│   └── code_health_dashboard.html   # Repowise-grade 6-panel live SVG dashboard
├── mcps/                            # 22 local MCP servers for creative & system tooling
│   ├── bdb_adobe_mcp/               # macOS AppleScript & Windows COM ExtendScript bridges
│   ├── bdb_davinci_mcp/             # Resolve 162-tool suite & local AI audio models
│   ├── bdb_rhino_mcp/               # McNeel Rhino 3D & Grasshopper connectors
│   ├── bdb_touchdesigner_mcp/       # MindDesigner TouchDesigner TCP/OSC bridge
│   ├── bdb_unreal_mcp/              # Unreal Engine 5 Web Remote Control bridge
│   ├── bdb_ma3_mcp/                 # grandMA3 OSC/UDP automation
│   ├── bdb_resolume_mcp/            # Resolume Arena REST API controller
│   ├── memb-mcp/                    # memB local SQLite + ONNX vector memory server
│   └── zavora_computer_use/         # Native precompiled OS automation binaries
├── skills/                          # 154 curated agent skills
│   ├── global_config/               # System skills (openwiki-skill, memb-skill, MCP docs)
│   └── ...                          # Domain-specific development and creative skills
├── tools/                           # Ecosystem tool extensions (e.g. obsidian-memb-plugin)
├── installer.js                     # Interactive CLI installer and daemon manager
└── README.md                        # Master documentation and quick reference
```
