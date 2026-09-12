---
name: bdb-adobe-suite-mcp
description: Utilizes the Adobe Suite MCP servers (adobe_mcp.py and adobe_uxp_mcp) to automate Photoshop, Illustrator, Premiere Pro, and After Effects using ExtendScript and UXP WebSocket bridges.
category: media-eventtech
---

# Adobe Creative Suite MCP — Integration and AI Guide

This skill file instructs AI agents on how to control Adobe Creative Suite applications (Photoshop, Illustrator, After Effects, and Premiere Pro) using both ExtendScript (`adobe_mcp.py`) and UXP WebSocket (`adobe_uxp_mcp`) bridges.

## 1. Overview and Pipeline Value

The **Adobe Suite MCP integrations** combine two distinct automation strategies for Creative Cloud applications:
1. **ExtendScript Bridge (`adobe_mcp.py`):** Uses OS-level scripting (AppleScript `osascript` on macOS; PowerShell COM objects on Windows) to send JSX code directly to Photoshop, Illustrator, and After Effects. This runs without installing plugins.
2. **UXP (Unified Extensibility Platform) Bridge (`adobe_uxp_mcp`):** Connects to Photoshop and Premiere Pro via a local WebSocket server (default port `8080`). This provides modern, fast, and sandboxed JS API interactions but requires UXP developer plugins to be active in the application.

---

## 2. System Instructions

### Tool Selection Matrix
When asked to automate Photoshop, choose between the two interfaces based on application state:
- If UXP plugins are connected, use `adobe-uxp-mcp` tools (`ps_get_active_document`, `ps_add_layer`).
- If UXP is unavailable, fall back to ExtendScript tools (`ps_add_text_layer`).

### OS Platform Routing
The ExtendScript bridge dynamically routes script payloads:
- **macOS:** Targets application bundle IDs (e.g. `id "com.adobe.Photoshop"`) using AppleScript `do javascript` / `DoScript`.
- **Windows:** Instantiates COM interfaces (e.g., `Photoshop.Application`, `Illustrator.Application`, `AfterFX.Application`) using PowerShell and processes transient `.jsx` scripts.

---

## 3. Available Tools and API Parameters

### ExtendScript Tools (`adobe_mcp.py`)
- **`ps_add_text_layer(text: string, font_size?: int)`**: Adds a new text layer with contents to the active Photoshop file.
- **`ae_render_active_comp()`**: Appends the active composition to the After Effects render queue and kicks off the render.
- **`ai_draw_rectangle(width?: float, height?: float, red?: int, green?: int, blue?: int)`**: Spawns a document in Illustrator (if empty) and draws a filled path rectangle.

### UXP Tools (`adobe_uxp_mcp`)
- **`ps_get_active_document`**: Retrieves the file name of the frontmost document in Photoshop.
- **`ps_add_layer(name: string)`**: Adds a new layer in Photoshop.
- **`pr_get_active_sequence`**: Retrieves the active sequence name from the Premiere Pro project.

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: Draw Custom Vector Layout in Illustrator
Generate a filled RGB path inside Adobe Illustrator via the ExtendScript bridge:

```json
// Tool Call: ai_draw_rectangle
{
  "width": 500.0,
  "height": 250.0,
  "red": 0,
  "green": 128,
  "blue": 255
}
```

### Recipe 2: UXP Photoshop Layer Control
Retrieve the active document name, check context, and add a layer via UXP:

```json
// Step 1: Read active file name
// Tool Call: ps_get_active_document

// Step 2: Create a layer named "Background_Tint"
// Tool Call: ps_add_layer
{
  "name": "Background_Tint"
}
```

### Recipe 3: Batch rendering a composition (After Effects ExtendScript)
Queue and render:

```json
// Tool Call: ae_render_active_comp
{}
```

---

## 5. Troubleshooting and Connection Details

### Configuration and Ports
- **UXP WebSocket Port:** `8080` (Standard WebSocket connection `ws://localhost:8080`)
- **Bridge Setup:**
  - *ExtendScript:* Requires zero installation beyond standard macOS or Windows system settings.
  - *UXP Server:* Start the server (`node mcps/adobe_uxp_mcp/index.js`). Then open Photoshop/Premiere and load the respective plugin folder located in `mcps/adobe_uxp_mcp/plugins/` using the **Adobe UXP Developer Tool (UDT)**.

### Common Errors and Fixes
1. **`Adobe Application is not connected to the UXP MCP Bridge`**
   - *Cause:* The UXP plugin has not been loaded via the UXP Developer Tool.
   - *Fix:* Launch the Adobe UXP Developer Tool, click **Add Plugin**, navigate to `mcps/adobe_uxp_mcp/plugins/photoshop/manifest.json`, and click **Load**.
2. **`COM Object Instantiation Failed (Windows)`**
   - *Cause:* Adobe software is not registered correctly in the Windows Registry, or is running with different privilege elevations.
   - *Fix:* Ensure the targeted Adobe application is open and registered. Run your CLI terminal with administrator privileges if User Account Control (UAC) blocks COM access.
3. **`osascript User interaction is not allowed`**
   - *Cause:* macOS Accessibility permissions are blocking terminal commands from driving GUI applications.
   - *Fix:* Add Terminal / Cursor / Claude to **Accessibility** and **Automation** folders in Privacy & Security settings.
4. **`Port 8080 already in use`**
   - *Cause:* The UXP WebSocket server conflicts with a running Docker container or Web developer server.
   - *Fix:* Edit the `WS_PORT` constant inside `adobe_uxp_mcp/index.js` and matching plugin configs to utilize an alternate port (e.g. `8888`).
