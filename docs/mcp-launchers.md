# MCP launchers — venv, app gating, and the fixed-port finding

Scope: how the AOS installer sets up the Python/uv-based MCP launchers (memb_mcp,
kicad, openscad), and two open findings that need design decisions before they
change more code. Host paths are `~`-relative on purpose; no usernames in code.

## 1. memb_mcp — venv dependencies (`~/.gemini/config/mcps/memb-mcp/.venv`)

**Verified failure**: the venv exists and is runnable, but `site-packages` has
neither `mcp` nor `fastmcp`, so the entry file `run.py` dies on its first import
(`try: from mcp.server.fastmcp import FastMCP / except ImportError: from fastmcp
import FastMCP`). Neither the package's `requirements.txt` nor its `pyproject.toml`
lists `mcp`, so the requirements reconcile treated the missing SDK as a "note
only" and the import check never guarded the real entry.

**Implemented** (installer.js):
- `reconcileMembVenv` accepts `entryImport` so the check mirrors what the entry
  file actually imports; the memb-mcp pass now runs the FastMCP fallback probe as
  the reconcile import check.
- Before the reconcile, the memb-mcp venv setup verifies the same probe a second
  time and, when it fails, installs the MCP SDK pin `mcp>=1.0.0,<2.0.0` into the
  venv — `uv pip install --python <venv>` first (polluted PATH-proof), falling
  back to the venv's own pip.

The `uv` path is resolved at runtime: PATH first, then `~/.local/bin/uv` and the
other standard install locations, with `home` derived from `os.homedir()` — no
user name is ever hard-coded.

## 2. kicad / openscad — "bad interpreter" venvs

**Verified**: the launchers in `@hybridlabor-api/bdb-hardware-pcb`
(`mcp_servers/kicad-mcp-server`, `mcp_servers/openscad-mcp-server`) run fine when
the venv interpreter exists — the failure mode was a shipped prebuilt `.venv`
whose `bin/python` is a dangling link on the target machine ("bad
interpreter"), after which the launcher falls back to `uv run --project …`,
which needs `uv` (or python 3) on the harness's own PATH.

**Implemented** (installer.js `installHardwarePcb`):
- Before the module's own installer registers anything, each
  `mcp_servers/*` dir with a `pyproject.toml` and a venv whose interpreter
  is missing (fs.existsSync is false for the dangling link) gets an explicit
  `uv sync` (explicit `uv` path) run in that dir.
- After registration, the installer asks **skip-if-app-missing**: 
  KiCad (`KiCad.app`) / OpenSCAD (`OpenSCAD.app`). When the app is absent, the
  kicad/openscad MCP entries the module just registered are removed from the
  harness configs (`~/.claude.json`, `~/.gemini/config/mcp_config.json`,
  `~/.codex/config.toml`), with a plain notice naming the missing app.
  `aos doctor` reports `app missing: KiCad.app` / `app missing: OpenSCAD.app`
  (warning only, fix hint: install the app and re-run the installer).
- The npm-package problem itself lives in the `bdb-hardware-pcb` repo: its
  `package.json` `files` list / `.npmignore` must never ship `.venv` trees.
  This repo's own `.npmignore` excludes `**/.venv/` and the contract test
  keeps that from regressing (tests/hardware-apps.test.js).

## 3. Fixed port 8080 — adobe_uxp_mcp / bdb_grandma3_mcp (RESOLVED, port-collision fix shipped; direct mode now pins 8080)

- `mcps/adobe_uxp_mcp/index.js` no longer hard-codes port 8080. The WebSocket
  port comes from `AOS_UXP_PORT` (`mcps/adobe_uxp_mcp/port.js`, dependency-free
  so tests can require it): unset or invalid (not a decimal integer in
  1024-65535) falls back to 8080; a valid integer is used as-is; `auto` picks
  one free port per process via `listen(0)` on `127.0.0.1` and prints
  `[adobe_uxp_mcp] WebSocket listening on 127.0.0.1:<port>` to stderr.
- **Gateway mode** (`aos-gateway enable`): `adobe_uxp_mcp` stays on the shared
  gateway allow-list (`GATEWAY_SERVERS` in `lib/gateway/config.js`), so the
  gateway spawns ONE instance from the shipped `mcp_config.json` template —
  no `env` block there, hence the default 8080. A different fixed port can be
  given by placing `AOS_UXP_PORT` in the gateway process env via
  `buildUpstreams` `passEnv`.
- **Direct mode** (the installer writes the template into each harness
  config): DIRECT writes the FIXED default port 8080 — the installed Photoshop
  and Premiere UXP plugins hard-code `ws://localhost:8080`
  (`mcps/adobe_uxp_mcp/plugins/*/index.js:3`, `manifest.json:15`), so a free
  per-session port would leave them connected nowhere. The installer
  (`installer.js`, direct-config build) adds
  `env: { AOS_UXP_PORT: "8080" }` to the `adobe_uxp_mcp` entry it writes; only
  one direct instance is supported at a time. Gateway mode keeps one shared
  instance and stays free-port capable. A user-supplied `AOS_UXP_PORT` in the
  entry's env block is kept regardless (`isAosOwned` compares command/args
  only, so ownership detection is unaffected).
- **grandma3** moved off 8080 to avoid the collision: the shipped template
  (`mcp_config.json`) and `mcps/grandma3_mcp.py`'s `--port` default are now
  8081 (still overridable with `--port` as before). The legacy-shape entry in
  `lib/mcp-secrets.js` (`LEGACY_SHAPES`) deliberately keeps `"--port", "8080"`
  — it must match what older releases wrote so those installs stay AOS-owned.
- docs/mcp-gateway.md already documents `adobe_uxp_mcp` in `GATEWAY_SERVERS`
  (one shared instance); no manifest was hand-edited — generated plugin
  manifests are regenerated by the dispatcher.

## Test coverage

`tests/hardware-apps.test.js` (no dependencies): app detection with injected fs,
the register/skip gate, the doctor message contract, shipped-prebuilt-venv
detection, the `.venv` npmignore contract, and the `reconcileMembVenv`
`entryImport` behavior.

`tests/uxp-port.test.js` (no dependencies) adds: `resolveWsPort` default /
invalid-value fallback, valid-range passthrough, the `auto` free-port pick
(single `listen(0)` on 127.0.0.1), the grandma3 8081 default in template and
`--port` parser (with the retained LEGACY_SHAPES 8080 shape), and the
installer/direct-mode `AOS_UXP_PORT: "8080"` injection contract (direct pins
the plugin-side `ws://localhost:8080`; the template itself stays without
`AOS_UXP_PORT`).
