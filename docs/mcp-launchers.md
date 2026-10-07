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

## 3. Fixed port 8080 — adobe_uxp_mcp / bdb_grandma3_mcp (port binding VERIFIED, second-session collision UNVERIFIED)

- `mcps/adobe_uxp_mcp/index.js:9` opens `new WebSocket.Server({ port: 8080 })`
  at module load, before the MCP stdio handshake. A second harness session on
  the same machine therefore starts into `EADDRINUSE`, and the harness marks
  the whole server "failed" even though the stdio transport itself was never
  port-bound.
- The shipped MCP template binds grandma3's WebAPI to `127.0.0.1:8080`
  (`mcp_config.json`: `--port 8080 --mode webapi_only`), which makes the
  collision likely rather than hypothetical.

**Proposed (not implemented here)**, pick one:
1. per-session port: in `mcps/adobe_uxp_mcp/index.js` read
   `const WS_PORT = Number(process.env.ADOBE_UXP_WS_PORT) || 8080`, and let the
   AOS installer write a stable per-harness value into the config `env` block —
   one port per harness config means no cross-harness collision while each
   config still has a deterministic port;
2. shared instance via the AOS MCP gateway: `lib/gateway/config.js` already
   routes `adobe_uxp_mcp` and `bdb_grandma3_mcp` through the shared gateway
   socket, so gateway users never spawn a second copy of either server —
   making the two servers gateway-only (migration column in
   docs/mcp-gateway.md) removes the per-session spawn entirely.

Option 1 is the small fix; option 2 is the architectural one.

## Test coverage

`tests/hardware-apps.test.js` (no dependencies): app detection with injected fs,
the register/skip gate, the doctor message contract, shipped-prebuilt-venv
detection, the `.venv` npmignore contract, and the `reconcileMembVenv`
`entryImport` behavior.
