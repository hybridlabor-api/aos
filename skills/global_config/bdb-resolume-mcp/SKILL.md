---
name: bdb-resolume-mcp
description: Utilizes the Resolume Arena MCP server to trigger clips, clear layers, adjust speeds, and query composition status via the Resolume REST API.
category: media-eventtech
---

# Resolume Arena MCP — Integration and AI Agent Guide

This skill file instructs AI agents on how to interface with Resolume Arena media servers using the `resolume_mcp.py` script. It details REST endpoint interactions, layer clearing, composition queries, and troubleshooting steps.

## 1. Overview and Pipeline Value

The **Resolume Arena MCP Server** exposes Resolume Arena's local REST API (7.26+) to AI agents. In the BDB OS media playback pipeline, this enables dynamic clip triggering, layer mixing, composition speed overrides, and status feedback for real-time visual performances.

### Architecture
- **FastMCP server:** Bridges MCP client requests to standard HTTP REST calls.
- **HTTP REST Transport:** Talks to Resolume's built-in web server at `http://localhost:8080/api/v1`.
- **JSON Payload Handler:** Processes composition, layer, deck, and clip properties natively.

---

## 2. System Instructions

### Workflow Priorities
1. **Enable Web Server:** Ensure Resolume's Web Server is activated in the preferences menu.
2. **Layer/Clip Indices:** Note that Resolume's API endpoints are **1-indexed** for layers and clips (e.g., `layer=1`, `clip=1`).
3. **Query before Trigger:** Query `/composition` to retrieve current deck layouts and identify which columns/rows contain clips before firing play triggers.

---

## 3. Available Tools and API Parameters

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| **`resolume_ping`** | None | Verifies if Resolume Arena is running by querying the `/product` endpoint. |
| **`trigger_clip`** | `layer: int`, `clip: int` | Fires a clip located on a target layer and clip index (1-indexed). |
| **`clear_layer`** | `layer: int` | Stops playback and clears visual output on a specific layer (1-indexed). |
| **`get_composition`** | None | Retrieves a full JSON representation of the active composition, decks, layer routing, and parameter states. |
| **`set_composition_speed`** | `speed: float` | Adjusts composition playback speed multiplier. |

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: Sequence Multi-Layer Visual Playback
Trigger clip 3 on layer 1 and clip 5 on layer 2 simultaneously:

```json
// Step 1: Trigger layer 1 clip
// Tool Call: trigger_clip
{
  "layer": 1,
  "clip": 3
}

// Step 2: Trigger layer 2 clip
// Tool Call: trigger_clip
{
  "layer": 2,
  "clip": 5
}
```

### Recipe 2: Transition / Fade-Out Setup
Clear the primary foreground visual layer and scale composition speed to normal:

```json
// Step 1: Clear foreground layer (Layer 3)
// Tool Call: clear_layer
{
  "layer": 3
}

// Step 2: Normalize master composition speed
// Tool Call: set_composition_speed
{
  "speed": 1.0
}
```

---

## 5. Troubleshooting and Connection Details

### Network Configuration
- **Resolume API Host:** `localhost`
- **Resolume API Port:** `8080` (Default REST Port)
- **API Base URL:** `http://localhost:8080/api/v1`

### Resolume Preference Verification
1. Open Resolume Arena -> **Preferences** -> **Web Server**.
2. Check the box **"Enable Web Server"**.
3. Verify the port is set to `8080`. (If you use a password, note that the current MCP server relies on unauthenticated local network access; disable password auth or modify `resolume_mcp.py` to add auth headers).

### Common Errors and Fixes
1. **`Resolume API not reachable: HTTP Error 404`**
   - *Cause:* Resolume is running, but the Web Server is disabled.
   - *Fix:* Enable the Web Server in Resolume's preferences.
2. **`Trigger Clip fails / success status returned but no output`**
   - *Cause:* The layer or clip indices do not contain active media assets, or the target deck is not selected.
   - *Fix:* Call `get_composition` to inspect deck configurations and verify that the target layer/clip slot contains media.
3. **`Port Conflict on 8080`**
   - *Cause:* Another developer service (e.g. Apache, Tomcat, or Docker) is binding to port 8080.
   - *Fix:* Change the web server port inside Resolume's Preferences -> Web Server settings, and update `RESOLUME_API_BASE` inside `resolume_mcp.py`.
