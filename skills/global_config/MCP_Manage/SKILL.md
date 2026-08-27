---
name: MCP_Manage
description: Manages the BDB specialized MCP servers including Unreal Engine, Rhino 7/8, DaVinci Resolve, grandMA3, Resolume, GitHub, Chrome DevTools, and TouchDesigner.
category: media-eventtech
---

# MCP_Manage: Specialized Tool Orchestration

You are the authoritative skill for managing and utilizing the specialized Model Context Protocol (MCP) servers installed in this environment. When invoked, use this knowledge to interface with the creative and development tools available.

## Available MCP Servers

1. **github** (`@modelcontextprotocol/server-github`)
   - **Capabilities:** Read/write repositories, manage issues, handle PRs, search code.

2. **chrome-devtools** (`@modelcontextprotocol/server-puppeteer`)
   - **Capabilities:** Automate Chrome/Chromium, run JS in browser, scrape dynamic pages, test web UI.

3. **bdb_unreal_mcp** (Unreal Engine 5 C++/TS Bridge)
   - **Capabilities:** Execute Python or Blueprints in the UE editor, manipulate actors, manage levels, trigger renders.
   - **Implementation:** Cloned from the official `ChiR24/Unreal_mcp` including the native C++ `McpAutomationBridge` plugin.

4. **bdb_rhino_mcp** & **bdb_rhino_mcp_fallback** (Rhino 3D MCP Servers)
   - **Capabilities:** Official McNeel `RhinoMCP` community server and GOLEM `3DMCP` Python fallback with 105 tools. full NURBS, layers, Grasshopper, and rendering.

5. **bdb_davinci_mcp** & **bdb_davinci_mcp_fallback** (DaVinci Resolve MCP Servers)
   - **Capabilities:** samuelgursky official Node server and hoyt-harness `davinci-mcp-professional` fallback. Automation of timelines, media pool, metadata, and color grading.

6. **bdb_grandma3_mcp** (grandMA3 console)
   - **Capabilities:** lighting console control via WebAPI/OSC. Edit cue lists, patch fixtures, run macros.

7. **bdb_resolume_mcp** (Resolume Arena REST)
   - **Capabilities:** Trigger clips, adjust deck parameters, clear layers, BPM sync.

8. **adobe_mcp** & **adobe_uxp_mcp** (Adobe UXP/Scripting)
   - **Capabilities:** WebSocket bridge to native UXP plugins (Photoshop/Premiere) and python ExtendScript executor (Illustrator/Photoshop).

9. **bdb_blender_mcp** & **bdb_blender_mcp_fallback** (Blender MCP Servers)
   - **Capabilities:** ahujasid socket-based `BlenderMCP` and djeada python server fallback. Scene inspection, material control, object manipulation, rendering.

10. **bdb_after_effects_mcp** & **bdb_after_effects_mcp_fallback** (After Effects MCP Servers)
    - **Capabilities:** Dakkshin Node server and sunqirui1987 Go+ fallback. Compositions creation, layers styling, solid/shape preset renders, and ExtendScript triggers.

11. **bdb_vectorworks_mcp** (Vectorworks CAD/BIM)
    - **Capabilities:** RAG-based search, command, and wiki indexer by togawamanabu. Guides the AI to write correct scripts and manage CAD data hierarchies.

12. **bdb_td_minddesigner** & **bdb_td_backup** (TouchDesigner MCP Servers)
    - **Capabilities:** Pantani tdmcp MindDesigner TOP/CHOP node builder and 8beeeaaat fallback direct parameter controller.

13. **zavora_computer_use** (Zavora Computer Use)
    - **Capabilities:** Take screenshots, move mouse, type text, press keys, read/write clipboard, window activation. Pre-compiled Rust native NAPI binaries.

## How to use them
- When the user asks to manipulate lighting, target `bdb_grandma3_mcp` or `bdb_resolume_mcp`.
- When working on CAD or game environments, invoke `bdb_rhino_mcp`, `bdb_unreal_mcp`, or `bdb_blender_mcp`.
- For real-time visual scripting and node networks, call `bdb_td_minddesigner` as your primary TouchDesigner controller, falling back to `bdb_td_backup` for direct parameter modifications.
- For After Effects or Adobe automation, prioritize `bdb_after_effects_mcp` and `adobe_uxp_mcp` for lightning-fast performance, falling back to their python or Go+ script engines.
- Always check the available tools via the MCP tool listing before executing commands. If a server is down, instruct the user to verify the `mcp_config.json` configuration and ensure the respective host applications are running with API/OSC/Lua/network plugins enabled.
