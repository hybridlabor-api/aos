# Blender MCP — User Guide

This guide sets up a Blender MCP server so an AI agent can inspect and script a Blender scene. The agent guide is `skills/global_config/bdb-blender-mcp/SKILL.md`.

## 1. Requirements

- **Blender 5.1 or newer** for the official Blender Lab server. Tested target: Blender 5.2 LTS.
- **Blender below 5.1** (for example 4.5 LTS) for the community server.
- **uv** installed, because AOS starts the official server with `uvx`.
- A machine where Blender and the agent run locally. Keep the Blender socket on `127.0.0.1`.

Check your Blender version: open Blender, then `Blender -> About`, or run `blender --version` in a terminal.

## 2. Install

### Official server (Blender 5.1+)
1. Follow the add-on install steps on `https://www.blender.org/lab/mcp-server/`. These steps are not repeated here because they come from the upstream page.
2. Enable the add-on and start its server inside Blender.
3. AOS starts the MCP process itself:
   `uvx --from git+https://projects.blender.org/lab/blender_mcp.git@2cea8d566dde07fbac28a61d698909d69724e853#subdirectory=mcp blender-mcp`

### Community server (Blender below 5.1)
1. In Blender: `Edit -> Preferences -> Add-ons`, enable **Blender MCP**.
2. Accept or decline telemetry in the add-on settings. The default AOS setting is off.
3. Press `N` in the 3D viewport, open the **BlenderMCP** tab, and switch **Connect to Claude** on.

## 3. First test

Ask the agent:

> Summarise the open scene.

Expected result: the agent lists the scene's objects or datablocks and does not change anything. If it cannot, see section 6.

## 4. Security checklist

- [ ] Socket bound to `127.0.0.1` only (default `localhost:9876`).
- [ ] No port forwarding or `BLENDER_HOST`-style exposure to other machines. For remote use, use an SSH tunnel.
- [ ] Telemetry off (`DISABLE_TELEMETRY=true`, or the add-on consent box unticked).
- [ ] Safe mode on for the community server (`BLENDER_MCP_SAFE_MODE=1`). It is not a full security boundary.
- [ ] Official server: run in a VM or a separate user account.
- [ ] Only open `.blend` files you trust.
- [ ] Back up the scene before the agent runs code.
- [ ] API keys for asset providers kept out of chat. Disable providers you do not use.
- [ ] Use a pinned version. Current pins: official `v1.0.3` (`2cea8d5`), community `992233bb` (includes the fix for CVE-2026-66004).

Known 2026 CVEs against the community project: CVE-2026-10688 (code injection in `execute_blender_code`), CVE-2026-10661 (injection / file read via `input_image_url`), CVE-2026-10662 (SSRF via `zip_file_url`), CVE-2026-66004 (path traversal, fixed in `30a3308`).

## 5. Licences

| Component | Licence | What you must do |
| :--- | :--- | :--- |
| Official Blender Lab server | GPL-3.0-or-later | Check redistribution terms before bundling. AOS does not bundle it. |
| Community MCP for Blender | MIT | Keep the licence notice with any copy. |
| Poly Haven assets | CC0 | No attribution required. Read the Poly Haven API terms for automated use. |
| Sketchfab models | Per model (often CC-BY) | Check each model's licence and give attribution where required. |
| Hyper3D Rodin, Hunyuan3D | Not verified | Read their terms before any commercial use. |

## 6. Troubleshooting

### Add-on not connected
- **Symptom:** `Cannot connect to Blender Add-on at localhost:9876` (wording may differ by version).
- **Cause:** the add-on is installed but its server is not running, or the connection closed.
- **Fix:** in Blender press `N`, open the **BlenderMCP** tab, and switch **Connect to Claude** on. Then run `get_addon_status` from the agent.

### Port busy
- **Symptom:** the add-on cannot start its server, or a second Blender instance cannot connect.
- **Check:** `lsof -i :9876` shows which process holds the port.
- **Fix:** close the other Blender instance or the other process. Restart Blender, then reconnect.

### Wrong Blender version
- **Symptom:** the official server fails to start, or the add-on does not load.
- **Cause:** the official server needs Blender 5.1+. The community server was tested on 4.5 LTS, not on 5.x.
- **Fix:** install Blender 5.2 LTS for the official server, or use Blender 4.5 LTS with the community server.

### `execute_blender_code` fails with a context error
- **Cause:** `bpy.ops` needs an active object or the right mode (Object or Edit).
- **Fix:** set the active object before the operator, for example `bpy.context.view_layer.objects.active = obj`.

### Agent reports a tool is missing
- **Cause:** the tool list depends on the server version.
- **Fix:** ask the agent to list tools (`tools/list`) and use the names it reports.

## 7. Related

- Agent guide: `skills/global_config/bdb-blender-mcp/SKILL.md`
- Upstream official server: `https://projects.blender.org/lab/blender_mcp`
- Community server: `https://github.com/ahujasid/blender-mcp`
