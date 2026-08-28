# REPO RESTRUCTURE PROPOSAL

## Part 1 -- Inventory

*   **Core source:**
    *   `installer.js`, `bin/`, `skills/`, `mcps/`, `scripts/` — The core logic, tools, and execution engine.
    *   `package.json`, `package-lock.json`, `.npmignore` — Primary package manifests.
    *   `mcp_config.json` — Installer template configuration.
    *   `.agents/`, `.claude/`, `.cursor/`, `.codex-plugin/`, `.opencode/` — Native harness configurations injected by the installer into target projects.
*   **Bundled sub-project / vendored dependency:**
    *   `vendor/token-saver/` — Python dependency (manifest: `vendor/token-saver/pyproject.toml`).
    *   `tools/obsidian-memb-plugin/` — Node sub-project (manifest: `tools/obsidian-memb-plugin/package.json`).
    *   `Formula/` — Contains Homebrew formula definitions.
*   **Documentation / branding:**
    *   `README.md`, `README.de.md`, `README.pt.md`, `LICENSE`, `CHANGELOG.md` — Core repository meta-information.
    *   `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `CODEX.md`, `.roomodes` — Harness discovery configurations required at the repository root by external AI agents.
    *   `.openwiki/` — Architecture and engineering documentation.
    *   `assets/` — General repository images.
    *   `bdb_architecture_sketch.jpg`, `bdb_savings_graph_sketch.jpg`, `header.png` — Stray branding/sketch images at root.
    *   `Project-overview.html` — Static HTML overview.
*   **Generated / runtime artifact:**
    *   `production_artifacts/` — Local outputs and plans from agent loops.
    *   `evals/` — Evaluation outputs/cases.
    *   `output.log`, `output_pty.log` — Ephemeral runtime console logs.
*   **Session-scoped working docs:**
    *   `audit-agents.md` — Referenced in `installer.js:2198` as context for a decision.
    *   `SESSION-HANDOVER-v3.13.md`, `AUDIT-HANDOVER-2026-08-28.md`, `BDB_REMOTEOS_MCP_HANDOVER.md` — Pure session history.
    *   `skills_table.md` — Static markdown report.
*   **Orphaned / dead:**
    *   `installer_old.js` — Dead code backup with 0 references.
    *   `patch_single_select.js`, `run_auto.py` — Stale utility scripts with 0 references.

## Part 2 -- Path-reference map

Grep audit against `installer.js`, `bin/setup-saas.mjs`, `scripts/*`, and `package.json` for move/delete candidates:

*   **`Project-overview.html`**:
    *   `package.json:31` (`"Project-overview.html"`)
*   **`audit-agents.md`**:
    *   `installer.js:2198` (`// form (see audit-agents.md F-01): the GO gate lives in a hook,`)
*   **`bdb_architecture_sketch.jpg`, `bdb_savings_graph_sketch.jpg`, `header.png`**:
    *   0 references.
*   **`SESSION-HANDOVER-v3.13.md`, `AUDIT-HANDOVER-2026-08-28.md`, `BDB_REMOTEOS_MCP_HANDOVER.md`**:
    *   0 references.
*   **`installer_old.js`, `patch_single_select.js`, `run_auto.py`, `skills_table.md`, `output.log`, `output_pty.log`**:
    *   0 references.
*   **`Formula/` & `tools/`**:
    *   0 filepath references (string hits for the word "tools" exist in `installer.js`, but refer to MCP capabilities, not the local `tools/` directory).

## Part 3 -- Proposed structure

*   **Keep at Root:** `package.json`, `package-lock.json`, `README.md` (all variants), `LICENSE`, `CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `CODEX.md`, `.roomodes`. (Standard conventions demand these stay at root for agent auto-discovery and NPM). Core dirs like `installer.js`, `skills/`, `mcps/`, `bin/`, and `.agents/` stay as well.
*   **Move to `assets/`:** `bdb_architecture_sketch.jpg`, `bdb_savings_graph_sketch.jpg`, `header.png`. (Consolidates all visual assets).
*   **Move to `docs/sessions/`:** `SESSION-HANDOVER-v3.13.md`, `AUDIT-HANDOVER-2026-08-28.md`, `BDB_REMOTEOS_MCP_HANDOVER.md`, `audit-agents.md`. (Quarantines historical agent conversations away from the root).
*   **Move to `docs/`:** `Project-overview.html`, `skills_table.md`. (Consolidates generated static HTML/Markdown reporting).
*   **Move to `packages/`:** `Formula/` and `tools/`. (Groups non-core bundled sub-projects explicitly, separating them from the main CLI logic).
*   **Delete:** `installer_old.js`, `patch_single_select.js`, `run_auto.py`, `output.log`, `output_pty.log`. (Dead code and ephemeral logs).

## Part 4 -- Risk-ordered execution plan

1.  **Lowest Risk (Zero impact) - Delete Orphaned Files:**
    *   Delete `installer_old.js`, `patch_single_select.js`, `run_auto.py`, `output.log`, `output_pty.log`.
    *   *Verification:* None required. Standard syntax check (`node -c installer.js`) to prove environment stability.
2.  **Low Risk (Zero hardcoded references) - Move Assets & Pure History:**
    *   Move `bdb_architecture_sketch.jpg`, `bdb_savings_graph_sketch.jpg`, `header.png` into `assets/`.
    *   Move `SESSION-HANDOVER-v3.13.md`, `AUDIT-HANDOVER-2026-08-28.md`, `BDB_REMOTEOS_MCP_HANDOVER.md`, `skills_table.md` into new `docs/sessions/` and `docs/` folders.
    *   *Verification:* None required.
3.  **Medium Risk (Single references) - Move `Project-overview.html` and `audit-agents.md`:**
    *   Move `Project-overview.html` to `docs/`. Update `package.json` to include `"docs/"` in the `files` array and remove `"Project-overview.html"`.
    *   Move `audit-agents.md` to `docs/sessions/`. Update the comment in `installer.js:2198` to reference `docs/sessions/audit-agents.md`.
    *   *Verification:* Run `npm pack --dry-run` to confirm the new `docs/` folder is packaged and the HTML file isn't dropped from distribution.
4.  **Medium-High Risk (Sub-projects) - Consolidate `Formula/` and `tools/`:**
    *   Move `Formula/` and `tools/` to `packages/Formula/` and `packages/tools/`.
    *   *Verification:* Run a full dummy deployment: `node installer.js --project-harness` in a clean `$HOME` temp directory. Confirm identical output and successful execution, ensuring no obscure scripts dynamically relied on those root paths.
