---
name: bdb-blender-mcp
description: Utilizes the Blender MCP server and addon to build 3D assets, apply materials, inspect scenes, and script bpy.
category: media-eventtech
---

# Blender MCP — Integration and AI Agent Guide

This skill file instructs AI agents on how to interact with the Blender MCP server and addon. It details scene manipulation, Python code execution (`bpy`), external asset retrieval, and troubleshooting workflows.

## 1. Overview and Pipeline Value

The **Blender MCP Server** connects AI models to Blender (3.0+) via a local TCP socket bridge. In the BDB OS workflow, this integration speeds up low-poly layouts, scene prototyping, material assignment, rendering, and programmatic asset generation.

### Architecture
- **Blender Addon (`addon.py`):** Runs inside Blender, creating a socket server (default port `9876`) that executes incoming requests on Blender's main thread using the Blender Python API (`bpy`).
- **MCP Server Bridge:** A Node.js or Python-based subprocess (`blender-mcp`) connecting to the addon socket, presenting a clean tool layout to the AI.
- **Generative AI & API Integrations:** Integrates with Poly Haven (materials, HDRIs, models), Sketchfab, Hyper3D Rodin, and Hunyuan3D for AI-assisted asset drafting.

---

## 2. System Instructions

### Workflow Priorities
1. **Connect First:** Ensure Blender is open and the MCP Addon is actively running (click "Connect to Claude" in the Sidebar's **BlenderMCP** tab).
2. **Read the Scene:** Proactively query the active scene layout using introspection tools before placing meshes.
3. **Save Work Proactively:** Running arbitrary script commands can crash the active Blender session. Always instruct the user to back up their project before running custom code.
4. **Clean Code Structure:** When using `execute_blender_code`, write standard `bpy` script blocks. Delete reference meshes (like the default Cube) programmatically if the prompt asks for a clean slate.

---

## 3. Available Tools and API Parameters

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| **`get_scene_info`** | None | Returns document structure, active camera, render settings, and a list of all scene objects. |
| **`create_mesh`** | `type: string`, `location?: float[]`, `scale?: float[]`, `rotation?: float[]`, `name?: string` | Spawns primitive shapes: Cube, Sphere, Cylinder, Cone, Torus, Grid, Monkey, Plane. |
| **`delete_object`** | `name: string` | Removes a named object from the database. |
| **`modify_object`** | `name: string`, `location?: float[]`, `scale?: float[]`, `rotation?: float[]` | Applies transformations to objects. |
| **`create_material`** | `name: string`, `color: float[]`, `metallic?: float`, `roughness?: float` | Creates and configures a Principled BSDF material. |
| **`apply_material`** | `object_name: string`, `material_name: string` | Binds a material to a target mesh. |
| **`execute_blender_code`** | `code: string` | Evaluates arbitrary Python scripts in Blender using the full `bpy` library. |
| **`search_polyhaven`** | `query: string`, `type: string` | Queries HDRIs, textures, or models from the Poly Haven API. |
| **`import_polyhaven_asset`** | `asset_id: string`, `type: string` | Downloads and imports Poly Haven items directly into the viewport. |
| **`generate_hyper3d_model`** | `prompt: string` | Triggers Hyper3D Rodin API to draft a model and load it. |

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: Standard Material Setup and Assignment
Create a metallic red material and assign it to a newly spawned cylinder:

```json
// Step 1: Create the cylinder
// Tool: create_mesh(type="cylinder", location=[0, 0, 2], name="RedColumn")

// Step 2: Create red material
// Tool: create_material(name="MetallicRed", color=[0.8, 0.05, 0.05, 1.0], metallic=0.9, roughness=0.1)

// Step 3: Apply to object
// Tool: apply_material(object_name="RedColumn", material_name="MetallicRed")
```

### Recipe 2: Run Custom Python Script via execute_blender_code
Generate a procedural spiral of spheres using `bpy`:

```python
# Call tool: execute_blender_code(code="...")
import bpy
import math

# Clear default objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Build spiral
count = 30
radius = 5.0
height_step = 0.2
angle_step = 0.3

for i in range(count):
    angle = i * angle_step
    x = math.cos(angle) * radius
    y = math.sin(angle) * radius
    z = i * height_step
    
    # Add sphere
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=(x, y, z))
    sphere = bpy.context.active_object
    sphere.name = f"SpiralSphere_{i}"
```

---

## 5. Troubleshooting and Connection Details

### Configuration and Ports
- **Default TCP Port:** `9876` (Bypasses stdio when communicating with the Blender Addon).
- **Environment Variables:**
  - `BLENDER_HOST`: Local/remote address of the Blender application (default: `localhost`).
  - `BLENDER_PORT`: Port number of the socket listener (default: `9876`).

### Telemetry Control
To disable usage telemetry, set the environment variable:
```bash
DISABLE_TELEMETRY=true
```
Or toggle the Consent checkbox in the Addon settings inside Blender:
`Edit -> Preferences -> Add-ons -> Interface: Blender MCP`

### Connection Verification
Ensure the Blender Addon is actively listening on port `9876`:
```bash
# Check if Blender is holding the socket
lsof -i :9876
```

### Common Errors and Fixes
1. **`Cannot connect to Blender Addon at localhost:9876`**
   - *Cause:* The addon is installed but not running, or connection was closed.
   - *Fix:* In Blender, press `N` to open the sidebar, click the **BlenderMCP** tab, and toggle **Connect to Claude** ON.
2. **`Missing API Keys for Hyper3D or Sketchfab`**
   - *Fix:* Add the API keys directly in the Add-on preferences page in Blender (`Edit -> Preferences -> Add-ons -> Blender MCP`) or inject them as environment variables (e.g. `BLENDERMCP_HYPER3D_API_KEY`) prior to starting the MCP client.
3. **`execute_blender_code fails due to Context`**
   - *Cause:* Blender operators (`bpy.ops`) often require a specific active context (e.g., Edit Mode vs Object Mode, or an active selection).
   - *Fix:* Ensure your Python script sets the active object or overrides context if necessary before executing operators:
     ```python
     bpy.context.view_layer.objects.active = target_obj
     ```
