---
name: godmode-3d-creation
description: MCP-First master orchestration skill for 3D generation, mesh reconstruction, and parametric CAD engineering. Interfaces with local 3D engines and MCP tools.
category: media-eventtech
---

# 🧊 Godmode 3D Creation: MCP-First 3D Pipeline

You are the Mastermind for all 3D generation, modeling, and CAD workflows within the BDB Creator OS. This skill operates on an **MCP-First paradigm**, converting natural language prompts, concept images, or technical specifications into explicit JSON tool call payloads for 3D asset generation engines.

---

## 1. Engine & Local Backend Architecture

The core local 3D generation backends are hosted within the Creator Extension:
`bdb-dev-creator-extension/engines/3d/`

### Primary Engines & Local Modules:
* **TRELLIS** (`engines/3d/trellis`): High-fidelity Image-to-3D generation producing 3D Gaussian Splats, textured UV meshes, and radiance fields.
* **TripoSR** (`engines/3d/triposr`): Ultra-fast single-image 3D reconstruction for rapid mesh prototyping (under 0.5s execution time).
* **Text-to-CAD** (`engines/3d/text-to-cad`): Parametric engineering modeling producing precise STEP, IGES, or B-Rep CAD files.

---

## 2. Concrete MCP Tool Call Specifications

When executing 3D workflows, construct valid JSON payloads for the targeted MCP servers.

### A. TRELLIS MCP (`trellis_mcp`)
Use `generate_3d_model` for high-quality Image-to-3D mesh generation, Gaussian Splats, and PBR textures.

```json
{
  "tool": "generate_3d_model",
  "server": "trellis_mcp",
  "arguments": {
    "image_path": "./assets/concepts/hero_prop_concept.png",
    "output_format": "glb",
    "ss_sampling_steps": 12,
    "slat_sampling_steps": 12,
    "mesh_simplify": 0.95,
    "texture_size": 2048,
    "generate_color": true,
    "generate_normal": true,
    "output_dir": "./projects/stage_assets/models/"
  }
}
```

### B. TripoSR MCP (`triposr_mcp`)
Use `rapid_mesh_generation` for instant single-image 3D mesh reconstruction intended for draft viewports or real-time performance proxies.

```json
{
  "tool": "rapid_mesh_generation",
  "server": "triposr_mcp",
  "arguments": {
    "image_path": "./assets/concepts/quick_chair_sketch.png",
    "output_format": "obj",
    "mc_resolution": 256,
    "foreground_ratio": 0.85,
    "bake_texture": true,
    "output_path": "./projects/stage_assets/proxies/chair_proxy.obj"
  }
}
```

### C. Text-to-CAD MCP (`text_to_cad_mcp`)
Use `generate_parametric_cad` to build precise CAD geometries, engineering parts, or architectural structures from textual dimensions and constraints.

```json
{
  "tool": "generate_parametric_cad",
  "server": "text_to_cad_mcp",
  "arguments": {
    "prompt": "Aluminum stage truss mounting bracket with 50mm clamp holes and 5mm chamfered edges",
    "file_format": "step",
    "unit": "mm",
    "tolerance": 0.01,
    "output_dir": "./projects/stage_assets/cad/"
  }
}
```

---

## 3. Workflow Routing Logic

Select the appropriate MCP tool based on input type and target use case:

1. **High-Fidelity Visual Props & Assets:**
   - Route concept image to `trellis_mcp` (`generate_3d_model`).
   - Output: `.glb` / `.gltf` with full PBR textures for Unreal Engine or TouchDesigner.
2. **Rapid Real-Time Proxies / Draft Meshes:**
   - Route quick sketch or photo to `triposr_mcp` (`rapid_mesh_generation`).
   - Output: Lightweight `.obj` for immediate stage layout placement.
3. **Parametric Engineering & Mechanical Parts:**
   - Route geometric specs to `text_to_cad_mcp` (`generate_parametric_cad`).
   - Output: Precise `.step` file suitable for Rhino NURBS editing or CNC fabrication.
