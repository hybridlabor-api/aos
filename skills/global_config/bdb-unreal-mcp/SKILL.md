---
name: bdb-unreal-mcp
description: Utilizes the Unreal Engine MCP server to control UE5 via a native C++ Automation Bridge plugin.
category: media-eventtech
---

# Unreal Engine MCP — Integration and AI Agent Guide

This skill file instructs AI agents on how to interact with the Unreal Engine 5.8+ MCP Server. It details the tool capabilities, API schemas, design patterns, workflows, scripting rules, and troubleshooting steps for asset management, actor manipulation, and level automation.

## 1. Overview and Pipeline Value

The **Unreal Engine MCP Server** bridges AI assistants to Unreal Engine 5 (5.0–5.8+) using a native C++ `McpAutomationBridge` plugin. In the BDB OS ecosystem, this integration automates environment construction, material generation, cinematic sequences (Sequencer), Blueprint orchestration, and visual effects (Niagara). 

### Architecture
- **Dual Transport:** 
  - *Native MCP Mode:* Direct Streamable HTTP/SSE transport (`http://localhost:3000/mcp`) running inside the UE process. No Node.js required.
  - *TypeScript Bridge Mode:* Standard stdio-based bridge using a Node.js process proxying over WebSocket to the plugin's Automation Port (default `8091`).
- **Discovery Mechanism:** Automatically discovers runtime properties, light classes, debug shapes, and track types using Unreal reflection.
- **On-Demand Resilience:** Starts gracefully and will auto-reconnect if the Unreal Editor goes offline or is restarted.

---

## 2. System Instructions

### Workflow Priorities
1. **Introspection First:** Always call `inspect` with `action="inspect_class"` or `action="inspect_cdo"` before mutating parameters. Never guess property names or paths.
2. **Path Conventions:** Use Unreal paths starting with `/Game/` (e.g., `/Game/Materials/M_Chrome`). Respect additional content mount prefixes registered in `MCP_ADDITIONAL_PATH_PREFIXES`.
3. **Safety Rules:** Dangerous console commands are pattern-filtered by the bridge. Use high-level tools (`manage_asset`, `control_actor`) rather than running raw console commands.
4. **Python Scripting:** For complex operations that require native API access not exposed via tools, use `system_control` with `action="execute_python"`. Keep code size under 1MB.

---

## 3. Available Tools and API Parameters

The server exposes 23 canonical MCP tools.

| Tool | Action | Parameters | Description |
| :--- | :--- | :--- | :--- |
| **`manage_asset`** | `list`, `search_assets`, `import`, `duplicate`, `rename`, `move`, `delete`, `create_folder`, `get_asset`, `get_dependencies`, `analyze_graph`, `set_tags`, `validate`, `create_material`, `create_material_instance`, `create_render_target`, `connect_material_pins` | `objectPath: string`, `destinationPath?: string`, `tags?: object` | Creates, deletes, queries, or modifies project assets and materials. |
| **`manage_blueprint`** | `create`, `get_blueprint`, `compile`, `add_component`, `set_default`, `get_scs`, `create_node`, `delete_node`, `connect_pins` | `blueprintPath: string`, `componentName?: string`, `properties?: object` | Manages Blueprints, SCS components, graph connections, and compilation. |
| **`control_actor`** | `spawn`, `spawn_blueprint`, `delete`, `delete_by_tag`, `duplicate`, `set_transform`, `get_transform`, `set_visibility`, `add_component`, `add_tag`, `attach`, `detach` | `actorClass?: string`, `blueprintPath?: string`, `location: float[]`, `rotation: float[]`, `scale: float[]` | Controls spawning, physics, tags, and transforms of actors in the active level. |
| **`control_editor`** | `play`, `stop`, `set_camera`, `console_command`, `screenshot`, `create_bookmark` | `command?: string`, `location?: float[]`, `rotation?: float[]` | Triggers Play-In-Editor (PIE), positions viewports, and captures screenshots. |
| **`manage_level`** | `load_level`, `save_level`, `save_level_as`, `stream`, `unload_level`, `create_level`, `build_lighting`, `add_sublevel` | `levelPath: string`, `shouldSave?: boolean` | Manages map loading, streaming, sublevel structure, and lighting builds. |
| **`build_environment`** | `create_landscape`, `sculpt`, `paint_foliage`, `add_foliage_instances`, `create_procedural_terrain` | `dimensions?: int[]`, `materialPath?: string`, `foliageType?: string` | Automates landscapes, terrain, and foliage placement. |
| **`system_control`** | `execute_python`, `console_command`, `run_tests`, `subscribe`, `unsubscribe`, `set_project_setting` | `code?: string`, `command?: string` | Low-level execution, settings access, log subscriptions, and Python integration. |
| **`inspect`** | `inspect_object`, `inspect_class`, `inspect_cdo`, `set_property`, `get_property` | `objectPath: string`, `propertyName?: string`, `propertyValue?: any` | Reflective inspection of live CDO or instantiated object properties. |
| **`manage_sequence`** | `create`, `add_actor`, `play`, `add_keyframe`, `add_camera`, `add_track` | `sequencePath: string`, `actorPath?: string`, `time?: float` | Creates and drives Sequencer cinematics, tracks, and camera paths. |
| **`manage_audio`** | `create_sound_cue`, `play_sound_2d`, `play_sound_at_location`, `create_audio_component` | `soundPath: string`, `location?: float[]` | Manages MetaSounds, SoundCues, mixes, attenuation, and spatialized playback. |
| **`manage_ai`** | `add_node`, `connect_nodes`, `set_node_properties`, `get_tree` | `treePath: string`, `nodeClass?: string` | Builds and queries Behavior Trees, blackboard keys, and EQS queries. |
| **`manage_geometry`** | `create_box`, `boolean_union`, `boolean_subtract`, `extrude`, `auto_uv`, `convert_to_static_mesh` | `width?: float`, `height?: float`, `meshName?: string` | Procedural modeling in editor using Unreal Geometry Script. |

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: Inline Python Scripting via system_control
To create custom asset chains or perform batch automation directly via Unreal's Python API:

```python
# Call tool: system_control(action="execute_python", params={"code": "..."})
import unreal

def setup_studio_lighting():
    # Retrieve subsystems
    editor_actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    
    # Spawn directional light
    dir_light_class = unreal.DirectionalLight.static_class()
    light_actor = editor_actor_subsystem.spawn_actor_from_class(dir_light_class, unreal.Vector(0, 0, 500))
    light_component = light_actor.get_component_by_class(unreal.DirectionalLightComponent.static_class())
    light_component.set_intensity(10.0)
    
    # Spawn sky light
    sky_light_class = unreal.SkyLight.static_class()
    sky_actor = editor_actor_subsystem.spawn_actor_from_class(sky_light_class, unreal.Vector(0, 0, 1000))
    
    unreal.log("Studio lighting initialized successfully.")

setup_studio_lighting()
```

### Recipe 2: Procedural Geometry Construction
To create a procedural staircase using the Geometry Scripting API:

```python
# Call tool: manage_geometry(action="create_stairs", params={"width": 200, "height": 300, "steps": 12})
# Followed by: manage_geometry(action="convert_to_static_mesh", params={"meshPath": "/Game/Geometry/SM_ProceduralStairs"})
```

### Recipe 3: Material Instance Setup
Create a master material instance and override properties programmatically:

```json
// Tool Call: manage_asset(action="create_material_instance")
{
  "parentMaterialPath": "/Game/Materials/M_MasterShader",
  "destinationPath": "/Game/Materials/Instances/MI_GlossyRed"
}

// Tool Call: inspect(action="set_property")
{
  "objectPath": "/Game/Materials/Instances/MI_GlossyRed",
  "propertyName": "VectorParameterValues",
  "propertyValue": {
    "ParameterName": "BaseColor",
    "ParameterValue": [1.0, 0.0, 0.0, 1.0]
  }
}
```

---

## 5. Troubleshooting and Connection Details

### Connection Setup
- **Native Port:** `3000` (Direct HTTP endpoint: `http://localhost:3000/mcp`)
- **Bridge Port:** `8091` (Used for TS bridge to communicate with the C++ plugin)
- **Status Indicator:** Look for `● MCP :3000 (X)` in the Unreal Editor status bar (bottom-right). Green means active.

### Command Verification
Verify port binding and server availability from terminal:
```bash
# Verify native server
curl http://localhost:3000/mcp/tools
```

### Common Errors
1. **`McpAutomationBridge not loaded`**: Make sure the plugin is enabled in your `.uproject` file under `Plugins` and that your project is compiled.
2. **`Missing Python Subsystem`**: Ensure that the **Python Editor Script Plugin** and **Editor Scripting Utilities** are enabled in the editor preferences.
3. **`Connection Timeout`**: If running over LAN, check that `Listen Host` is set to `0.0.0.0` and that the `Allow Non Loopback` setting is active in the project's plugin settings.
