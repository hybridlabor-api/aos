---
name: bdb-blender-mcp
description: Drives Blender through a Blender MCP server (official Blender Lab server for Blender 5.1+, community "MCP for Blender" fallback) to inspect scenes and run bpy code. Use for Blender scene work from an agent.
category: media-eventtech
---

# Blender MCP — Agent Guide

Use this skill when an agent must inspect or change a Blender scene through MCP. For user setup, see `docs/blender-mcp.md`.

## 1. When to use

- Inspect an open `.blend` (datablocks, missing files, linked libraries, scene objects).
- Run plain `bpy` code inside the running Blender session.
- Do not use it for live show control or for rendering pipelines that are not Blender.

## 2. Choose the server

| Installed Blender | Server AOS uses | Notes |
| :--- | :--- | :--- |
| 5.1 or newer (tested target: 5.2 LTS) | **Official Blender Lab server**, tag `v1.0.3`, commit `2cea8d566dde07fbac28a61d698909d69724e853` | AOS picks it automatically (`mcp_picks.json`). |
| Below 5.1 (for example 4.5 LTS) | **Community server "MCP for Blender"** (`ahujasid/blender-mcp`, renamed 2026-09-16), pinned commit `992233bb` | Bundled in AOS at `mcps/blender-mcp`. Not tested on Blender 5.x. |

- **Official:** AOS starts it with:
  `uvx --from git+https://projects.blender.org/lab/blender_mcp.git@2cea8d566dde07fbac28a61d698909d69724e853#subdirectory=mcp blender-mcp`
  AOS only references this repository; it does not bundle its code.
- **Community:** bundled and pinned in AOS. Its code is MIT.

## 3. Setup per server

### Official (Blender 5.1+)
1. Install the Blender Lab add-on in Blender. The exact steps are in the official page `https://www.blender.org/lab/mcp-server/`. Not verified here, so follow that page.
2. Start Blender with the add-on enabled and its server running.
3. Let the agent start the MCP process (command in section 2). Confirm with `tools/list`.

### Community (Blender below 5.1)
1. In Blender, open `Edit -> Preferences -> Add-ons` and enable the **Blender MCP** add-on from the bundled version.
2. Open the sidebar (`N`), select the **BlenderMCP** tab, and switch **Connect to Claude** on. The add-on listens on `localhost:9876`.
3. Confirm the agent sees `get_addon_status` returning connected. Tool names may differ by add-on version; check `tools/list`.

## 4. Tools

### Official server (Blender Lab, v1.0.3)
| Tool | Use for |
| :--- | :--- |
| `execute_blender_code` | Run Python `bpy` in the session |
| `execute_blender_code_for_cli` | Same, CLI variant |
| `get_blendfile_summary_datablocks` (and `_for_cli`) | Summarise datablocks in the file |
| `get_blendfile_summary_missing_files` (and `_for_cli`) | List missing external files |
| `get_blendfile_summary_of_linked_libraries` (and `_for_cli`) | List linked libraries |

The full list and argument schemas come from `tools/list`. The server's `readme_tools.rst` lists more tools than shown here.

### Community server (MCP for Blender)
| Tool | Use for |
| :--- | :--- |
| `get_scene_info` | Scene objects and scene structure |
| `execute_blender_code` | Run Python `bpy` in the session |
| `look` | Check `tools/list` for its behaviour |
| `generate_3d` | Generate a model with an external provider (check licence first, section 7) |
| `search_assets` | Search external asset providers |
| `import_asset` | Import a found asset into the scene |
| `get_addon_status` | Check that the add-on is connected |
| `disable_telemetry` | Turn off usage telemetry for this session |
| `record_trajectory_feedback` | Feedback record; check `tools/list` before use |

Argument names: always take them from `tools/list`. Do not guess.

## 5. Recipes

Both recipes use only the tools above.

### Recipe 1: Scene summary (read-only)
1. Official: call `get_blendfile_summary_datablocks`. Community: call `get_scene_info`.
2. Report object names, types and counts. Do not change the scene.

### Recipe 2: Add a primitive with plain bpy
Call `execute_blender_code` with:

```python
import bpy

cube = bpy.data.objects.new("AgentCube", bpy.data.meshes.new("AgentCubeMesh"))
bpy.context.collection.objects.link(cube)
cube.location = (0.0, 0.0, 1.0)
```

Recipe 2 is not yet run on Blender 5.2. Verify it on the target Blender before relying on it.

## 6. Security (mandatory)

- **No authentication.** The add-on socket (`localhost:9876`) has no auth and no encryption.
- **Arbitrary code.** `execute_blender_code` runs any Python with full `bpy` access.
- **Localhost only.** Never bind the socket to anything other than `127.0.0.1`. For remote use, use an SSH tunnel.
- **Safe mode.** The community server's `BLENDER_MCP_SAFE_MODE=1` is opt-in and is not a security boundary. AOS ships it on.
- **Telemetry.** AOS ships telemetry off. Equivalent env var: `DISABLE_TELEMETRY=true`.
- **Isolation.** Blender recommends a VM or a separate user account for the official server.
- **Untrusted files.** Do not open untrusted `.blend` files. Back up the scene before running agent code.
- **Known CVEs (2026):**
  - `CVE-2026-10688`: code injection in `execute_blender_code`. Upstream treats this as a feature, so do not assume the tool is restricted.
  - `CVE-2026-10661`: injection / file read through `input_image_url`.
  - `CVE-2026-10662`: SSRF through `zip_file_url`.
  - `CVE-2026-66004`: path traversal in `download_polyhaven_asset`. Fixed in `30a3308`, which is included in the pinned community commit `992233bb`.
- **Official server:** runs code without guards (per Blender). Run it in a VM or separate account.

## 7. Licences

- **Official Blender Lab server:** GPL-3.0-or-later. AOS only references it. Check redistribution terms before bundling it.
- **Community server:** MIT.
- **Poly Haven assets:** CC0. The Poly Haven API has separate API terms; read them before automated use.
- **Sketchfab models:** licence is per model. Many are CC-BY and need attribution. Check each one.
- **Hyper3D Rodin and Hunyuan3D (`generate_3d` providers):** commercial terms are not verified. Check before any commercial use.

## 8. Workflow rules

1. Confirm the server is connected (`tools/list` works, add-on status is connected) before any scene task.
2. Read the scene before adding or changing objects.
3. Ask the user to back up the `.blend` before running code that changes the scene.
4. Remove the default Cube programmatically only when the user asks for a clean scene.
5. For `bpy.ops` calls, set the active object or context first. Operators fail without the right context.
