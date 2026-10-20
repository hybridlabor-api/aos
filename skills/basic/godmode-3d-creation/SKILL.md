---
name: godmode-3d-creation
description: "Use when generating 3D meshes, executing text-to-CAD, or reconstructing scenes via TRELLIS, TripoSR, or Text-to-CAD local engines."
category: media-eventtech
---

# 🧊 Godmode 3D Creation: CLI-First & Local Engine 3D Pipeline

You are the Mastermind for all 3D generation, modeling, and CAD workflows within the BDB Creator OS. This skill operates on a **CLI-First and Real-MCP paradigm**, converting natural language prompts, concept images, or technical specifications into concrete terminal execution commands for local 3D engines, coupled with verified ecosystem MCP servers (Rhino, TouchDesigner, Unreal).

---

## Plan first

Planning starts on the plan canvas with the `research` template, and the human approves it there — not in chat.

Choosing between engines, approaches or pipelines — evidence and recommendation reviewed before anyone builds.

```bash
aos-plan-canvas new research <plan-dir>                     # scaffold the plan folder
aos-plan-canvas open <plan-dir> --mode bdb-plan-builder  # render and open in the browser
aos-plan-canvas await <plan-dir>/plan.mdx                # keep listening until the verdict
```

The approved plan is the artifact: this template has no components, so there is no agenttrail map. The full loop and every template: the `plan-canvas` skill — a plain CLI, identical on every harness.

## 1. Engine & Local Backend Architecture

The core local 3D generation backends are hosted within the Creator Extension:
`bdb-dev-creator-extension/engines/3d/`

The installer places the extension in its module directory (`bdb-dev-creator-extension/` under the AOS module base). Every `engines/3d/...` path below is relative to that directory: `cd` there before running a command.

### Primary Engines & Local Modules:
* **TripoSR** (`engines/3d/triposr`): Ultra-fast single-image 3D reconstruction for rapid mesh prototyping (under 0.5s on CUDA, CPU-capable).
* **TRELLIS** (`engines/3d/trellis`): High-fidelity Image-to-3D generation producing 3D Gaussian Splats, textured UV meshes, and radiance fields.
* **Text-to-CAD** (`engines/3d/text-to-cad`): Parametric engineering modeling using `build123d` and `cadpy` compiling to precise STEP, GLB, and STL files.

---

## 2. Concrete CLI Execution Specifications

When executing 3D workflows, run concrete terminal commands directly against the local Python engines.

### A. TripoSR CLI (`engines/3d/triposr`)
Use `run.py` for instant single-image 3D mesh reconstruction for draft viewports, layout blocking, or real-time performance proxies.

```bash
# High-quality GLB export with baked texture:
python engines/3d/triposr/run.py <image_path> --output-dir <output_dir> --model-save-format glb --bake-texture

# Rapid mesh generation (OBJ with vertex colors, <0.5s on CUDA):
python engines/3d/triposr/run.py <image_path> --output-dir <output_dir> --mc-resolution 256

# Hardware Fallback: CPU mode (when CUDA GPU is unavailable):
python engines/3d/triposr/run.py <image_path> --output-dir <output_dir> --model-save-format glb --bake-texture --device cpu
```

### B. TRELLIS CLI (`engines/3d/trellis`)
Use `example.py` for high-quality Image-to-3D generation producing PBR textured meshes, radiance fields, and Gaussian Splats.

```bash
# High-fidelity Image-to-3D GLB generation:
python engines/3d/trellis/example.py --image <image_path> --output <output_dir/model.glb>

# Direct pipeline execution with custom parameters:
python -c "from PIL import Image; from trellis.pipelines import TrellisImageTo3DPipeline; from trellis.utils import postprocessing_utils; pipeline = TrellisImageTo3DPipeline.from_pretrained('microsoft/TRELLIS-image-large').cuda(); outputs = pipeline.run(Image.open('<image_path>')); glb = postprocessing_utils.to_glb(outputs['gaussian'][0], outputs['mesh'][0], simplify=0.95, texture_size=2048); glb.export('<output_dir/model.glb>')"
```

### C. Text-to-CAD CLI (`engines/3d/text-to-cad`)
Generate parametric CAD geometries and mechanical parts using `build123d` python scripts and the `step` compilation CLI.

```bash
# Step 1: Write parametric build123d script (<generator.py>):
# e.g., define geometry with build123d and export or pass to compiler

# Step 2: Compile generator script to STEP and GLB:
python engines/3d/text-to-cad/skills/cad/scripts/step <generator.py> -o <model.step> --glb <model.glb>

# Step 3: Inspect geometry facts and bounding planes (optional QA):
python engines/3d/text-to-cad/skills/cad/scripts/inspect refs <model.step> --facts --planes
```

---

## 3. Workflow Routing & Decision Flow

Select the appropriate engine and command pipeline based on input fidelity and hardware availability:

1. **Rapid Real-Time Proxies / Draft Meshes (<1s):**
   - **Input:** Concept sketch, photo, or transparent PNG.
   - **Primary Command:** TripoSR CLI (`python engines/3d/triposr/run.py <image_path> --output-dir <output_dir> --model-save-format glb --bake-texture`).
   - **Output:** Lightweight `.glb` or `.obj` for immediate stage placement.

2. **High-Fidelity Visual Props & Hero Assets:**
   - **Input:** Refined visual concept image.
   - **Primary Command:** TRELLIS CLI (`python engines/3d/trellis/example.py --image <image_path> --output <output_dir/model.glb>`).
   - **Output:** PBR-textured `.glb` with UV maps for Unreal Engine or TouchDesigner.

3. **Parametric Engineering & Mechanical Parts:**
   - **Input:** Dimensioned engineering constraints or geometric specifications.
   - **Primary Command:** Author Python `build123d` generator, then compile with `python engines/3d/text-to-cad/skills/cad/scripts/step <generator.py> -o <model.step> --glb <model.glb>`.
   - **Output:** Valid `.step` CAD model and companion `.glb`.

---

## 4. Hardware Constraints & Resilient Fallback Matrix

Execute directly via verified fallback mechanisms when hardware constraints or specific geometry requirements dictate:

1. **CUDA Acceleration Unavailable (CPU-Only Environments):**
   - **TripoSR:** Run with `--device cpu`:
     `python engines/3d/triposr/run.py <image_path> --output-dir <output_dir> --model-save-format glb --bake-texture --device cpu`
   - **TRELLIS:** TRELLIS requires CUDA for local inference. If CUDA is absent or VRAM is under 16GB, route to ComfyUI 3D diffusion workflow on port 8188 via `comfyui-mcp` (AOS ships no config for it: check it is configured in the harness first, as `pb-image-to-3d` does) or use an external cloud inference API endpoint.

2. **Parametric CAD & Complex NURBS Modeling:**
   - **Primary Fallback:** If `build123d` is unsuitable for complex freeform surfaces, use **`bdb_rhino_mcp_fallback`** (Rhino Grasshopper solvers, NURBS surfaces, curves, boolean operations, STEP/IGES export).

3. **High-Fidelity Scene Assembly & Spatial Staging:**
   - Use real ecosystem MCPs: **`bdb_unreal_mcp`** or **`bdb_td_minddesigner`** (`create_3d_scene`, `create_point_cloud`) to arrange, light, and render generated 3D assets in real time.

---

## Overview
Godmode 3D Creation generates 3D assets, meshes, and CAD models using local Python CLI engines (TripoSR, TRELLIS, Text-to-CAD) and verified ecosystem MCP servers (Rhino, TouchDesigner, Unreal).

## When to Use
- **Trigger:** The user asks to generate a 3D mesh, create a 3D model from an image, or construct a parametric CAD file.
- **Exclude:** Do not use for 2D video editing or live show timeline control.

## Core Process
1. Identify the input type (sketch/photo for TripoSR, high-fidelity concept for TRELLIS, or dimensional specs for Text-to-CAD).
2. Check hardware availability (CUDA vs. CPU) and select the corresponding CLI invocation or fallback route.
3. Execute the CLI command and verify the generated `.glb`, `.obj`, or `.step` output file on disk.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll use TRELLIS for this quick draft." | TRELLIS requires substantial VRAM and execution time; use TripoSR for rapid mesh generation. |
| "I'll just guess the Text-to-CAD dimensions." | Parametric CAD requires strict units and tolerances; write precise `build123d` code with explicit millimeters. |
| "It previewed fine as an OBJ, we don't need textures." | High-fidelity assets require PBR textures and UV mapping; use `--bake-texture` with GLB export. |
| "CUDA is missing, so 3D generation is impossible." | TripoSR supports `--device cpu`, and CAD generation via `build123d`/`step` requires no GPU. |

## Red Flags

- Constructing fictitious JSON payloads for nonexistent MCP servers instead of running CLI commands.
- Failing to pass `--device cpu` when running TripoSR on non-CUDA systems.
- Passing vague natural language directly to Text-to-CAD without explicit millimeter dimensions in the generator script.
- Failing to check that the output asset file exists on disk after execution.

## Verification

- [ ] CLI execution command targets the correct local engine script.
- [ ] Appropriate device mode (`cuda` or `cpu`) is specified.
- [ ] Output format (`.glb`, `.obj`, `.step`) matches the target pipeline.
- [ ] The generated 3D asset file exists in the target output directory.


---

## Creator Pack Skills

<!-- aos:pack-index:start -->
- **remotion** — Generate walkthrough videos from Stitch projects using Remotion with smooth transitions, zooming, and text overlays
- **threejs-skills** — "Create 3D scenes, interactive experiences, and visual effects using Three.js. Use when user requests 3D graphics, WebGL experiences, 3D visualizations, animations, or interactive 3D elements."
- **spline-3d-integration** — "Use when adding interactive 3D scenes from Spline.design to web projects, including React embedding and runtime control API."
- **bdb-after-effects-mcp** — Utilizes the After Effects MCP servers (after-effects-mcp and ae-mcp) to create compositions, layers, masks, keyframe animations, and run ExtendScript.
- **bdb-adobe-suite-mcp** — Utilizes the Adobe Suite MCP servers (adobe_mcp.py and adobe_uxp_mcp) to automate Photoshop, Illustrator, Premiere Pro, and After Effects using ExtendScript and UXP WebSocket bridges.
- **bdb-davinci-mcp** — Utilizes the DaVinci Resolve MCP servers to control timeline editing, media analysis, color grading, and Fusion/Fairlight scripting.
- **bdb-blender-mcp** — Utilizes the Blender MCP server and addon to build 3D assets, apply materials, inspect scenes, and script bpy.
- **brag** — Turn the current project website into a short, polished, shareable launch video using Hyperframes. Post-shipping release hook. Use when someone says "/brag", "make a launch video", or wants to showcase what they shipped.
- **design-spells** — "Use when adding curated micro-interactions, delightful animations, and subtle design details that add magic and personality to web and mobile apps."
- **live-preview-canvas** — A prototyping skill that generates a local HTML mock with a built-in feedback layer, allowing users to drop visual comments (red dots) for UI fixes.

**Install:** `aos store install --pack creator`
<!-- aos:pack-index:end --><!-- aos:pack-index:end -->
