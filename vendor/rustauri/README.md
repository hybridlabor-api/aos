# @hybridlabor-api/aos-rustauri

Optional AOS package providing Rust and Tauri v2 development skills, desktop testing, and review capabilities.

## Skills Shipped
- **`rust-pro`**: Idiomatic Rust patterns, borrow-checker solutions, memory layout optimization, and production-ready concurrency.
- **`tauri-pilot`**: Interactive testing CLI and MCP server for Tauri v2 apps: inspect the UI, click and fill elements, assert state, record/replay sessions, and run TOML scenarios over a local socket.

## CLI & MCP Server Pin
The `tauri-pilot-cli` binary acts as both the test runner CLI and the `tauri-pilot` MCP server.
- **Pinned Version:** `0.8.1` (tracked as `TAURI_PILOT_VERSION` in `installer.js`).
- **Install Command:**
  ```bash
  cargo install tauri-pilot-cli --version 0.8.1 --locked
  ```
- **Prerequisite Handling:** Cargo is required only to compile the `tauri-pilot-cli` binary. If `cargo` is missing from `PATH`, the AOS installer issues a warning only; the `rust-pro` and `tauri-pilot` skills remain fully installed and usable.

## Associated Roles & Agents
- **`rust-reviewer`**: Independent read-only Rust code reviewer.
- **`tauri_expert`**: Shipped role in `lib/roles/shipped-roles/tauri_expert.json` configured with `rust-pro`, `tauri-pilot`, and `pb-tauri-e2e`.
- **`desktop-app`**: Shipped team in `lib/roles/teams/desktop-app.json` for Tauri desktop app development and E2E audits.
