---
name: bdb-rhino-mcp
description: Utilizes the Rhino MCP servers (RhinoMCP and golem-rhino-mcp) to create and manipulate 3D models and run Grasshopper graphs.
category: media-eventtech
---

# Rhino 3D MCP — Integration and AI Agent Guide

This skill file instructs AI agents on how to utilize the McNeel Rhino MCP and GOLEM-3DMCP integrations. It details tool prefixes, API structures, geometry operations, Grasshopper automation, and troubleshooting steps.

## 1. Overview and Pipeline Value

The **Rhino MCP Platform** and **GOLEM-3DMCP Server** connect AI agents to McNeel Rhino 7/8. This allows natural language-driven 3D CAD modeling, NURBS reconstruction, structural planning, and parametric scripting in Grasshopper.

### Architecture
- **In-Process socket server:** A custom startup script (`startup.py`) running inside Rhino's Python Script Editor creates a JSON-RPC 2.0 socket server on localhost.
- **MCP Server bridge:** A Python MCP server proxy connects the AI assistant to the socket server, translating MCP tool calls to Rhino API calls.
- **Grasshopper runtime:** Provides direct control over Grasshopper parameters, enabling real-time solver execution and parameter sweeps.

---

## 2. System Instructions

### Workflow Priorities
1. **Scene Audit first:** Always run `scene.get_document_info` or `scene.list_layers` to understand the scale, active units (e.g. millimeters vs. meters), and current hierarchy.
2. **Object Lifecycle:** Many geometry operations (like booleans) consume their input objects and return new GUIDs. Update your working memory with the returned GUIDs and discard the consumed ones to prevent `OBJECT_NOT_FOUND` errors.
3. **Run on UI Thread:** Complex viewport updates or UI-dependent Grasshopper runs require queuing on the Rhino UI thread. The MCP server handles this, but be prepared for a 30s timeout under heavy load.
4. **Grasshopper Workflow:** Run `grasshopper.open_definition` before modifying sliders. Always call `grasshopper.recompute` to update the solver after changing parameter values.

---

## 3. Available Tools and API Parameters

GOLEM-3DMCP provides 105 granular tools across multiple categories.

### Scene Intelligence (`scene.*`)
- **`scene.get_document_info()`**: Returns units, tolerance, layer count, and bounding box.
- **`scene.list_layers()`**: Lists all layers, visibility, lock states, and colors.
- **`scene.list_objects(object_type: string, layer?: string)`**: Lists objects with optional type filters (point, curve, surface, brep, mesh, subd, annotation).
- **`scene.get_object_info(guid: string)`**: Returns precise control points, layer, and metadata.
- **`scene.create_layer(name: string, color?: object)`**: Creates layers (nested with `::` syntax).

### Geometry Creation (`create_*`)
- **`create_box(width: float, depth: float, height: float, corner_x?: float, corner_y?: float, corner_z?: float)`**
- **`create_sphere(radius: float, center_x?: float, center_y?: float, center_z?: float)`**
- **`create_cylinder(radius: float, height: float)`**
- **`create_nurbs_curve(points: list[list[float]], degree?: int)`**
- **`create_polyline(points: list[list[float]], closed?: boolean)`**
- **`create_text(text: string, location: list[float], height: float)`**

### Geometry Operations (`operations.*` & `surfaces.*`)
- **`operations.boolean_union(guids: list[string])`**: Unions closed solids.
- **`operations.boolean_difference(guid_a: string, guids_b: list[string])`**: Cuts `guids_b` from `guid_a`.
- **`operations.offset_curve(curve_id: string, distance: float)`**
- **`operations.fillet_edge(brep_id: string, edge_indices: list[int], radius: float)`**
- **`surfaces.loft(curve_ids: list[string], loft_type?: string)`**
- **`surfaces.sweep1(rail_id: string, shape_ids: list[string])`**

### Grasshopper Automation (`grasshopper.*`)
- **`grasshopper.open_definition(path: string)`**: Loads a `.gh` or `.ghx` definition.
- **`grasshopper.get_parameters()`**: Queries all sliders, panels, and outputs.
- **`grasshopper.set_parameter(name_or_id: string, value: any)`**: Modifies sliders or inputs.
- **`grasshopper.recompute()`**: Forces a solution recalculation.
- **`grasshopper.get_output_value(name_or_id: string)`**: Reads output component values.

### Scripting and Viewports (`scripting.*` & `viewport.*`)
- **`scripting.execute_python(code: string)`**: Runs arbitrary Python script utilizing `Rhino` and `rhinoscriptsyntax`.
- **`viewport.capture_to_file(path: string, width?: int, height?: int)`**: Captures the current view.
- **`viewport.set_camera(location: list[float], target: list[float])`**: Points the camera.

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: Parametric Truss Setup in Grasshopper
Open a Grasshopper file, adjust structural dimensions, and extract the generated geometry:

```json
// Step 1: Load file
// Tool: grasshopper.open_definition(path="/Users/<username>/project/truss.gh")

// Step 2: Modify span and height
// Tool: grasshopper.set_parameter(name_or_id="SpanSlider", value=150.0)
// Tool: grasshopper.set_parameter(name_or_id="HeightSlider", value=22.5)

// Step 3: Recompute solver
// Tool: grasshopper.recompute()

// Step 4: Bake outputs
// Tool: grasshopper.bake_output(name_or_id="TrussGeometry", layer="StructuralTrusses")
```

### Recipe 2: Custom NURBS Loft Creation
To generate custom ribs and loft a skin between them using Python scripting:

```python
# Call tool: scripting.execute_python(code="...")
import rhinoscriptsyntax as rs
import math

curves = []
for i in range(5):
    points = []
    for j in range(10):
        x = i * 20.0
        y = j * 10.0
        z = math.sin(j * 0.5) * 15.0 + (i * 2.0)
        points.append([x, y, z])
    
    # Create curve
    crv = rs.AddNurbsCurve(points)
    curves.append(crv)

# Loft skin
loft = rs.AddLoftSrf(curves)
rs.ObjectName(loft, "ProceduralNurbsCanopy")
print(f"Lofted canopy created with ID: {loft}")
```

---

## 5. Troubleshooting and Connection Details

### Connection Setup
- **Default Port:** `9876` (TCP socket communication)
- **Rhino Startup Script:** `rhino_plugin/startup.py`
- **Verify Connection:**
  ```bash
  # Check if server is running on the port
  lsof -i :9876
  ```

### Common Errors and Fixes

1. **`RhinoConnectionError: Cannot connect to Rhino plugin at 127.0.0.1:9876`**
   - *Cause:* The plugin server is not running inside Rhino.
   - *Fix:* Open Rhino's Python script editor, open `rhino_plugin/startup.py`, and run it. To automate, add it to Options -> RhinoScript -> Startup scripts.
   
2. **`GH not available`**
   - *Cause:* Grasshopper is installed but has not been loaded in the active session.
   - *Fix:* Run the `Grasshopper` command in Rhino once, then restart the GOLEM plugin by running:
     ```python
     import rhino_plugin.startup as golem
     golem.restart_golem()
     ```

3. **`RhinoTimeoutError`**
   - *Cause:* An operation took longer than the default 30-second threshold.
   - *Fix:* Increase the timeout in your `.mcp.json` config:
     ```json
     "env": {
       "GOLEM_TIMEOUT": "120"
     }
     ```
