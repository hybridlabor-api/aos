---
name: godmode-media-creation
description: "Video timelines, motion graphics, media creation. Remotion, OpenMontage, TouchDesigner, audio/visuals."
category: media-eventtech
---

# 🎬 Godmode Media Creation: CLI-First & Hybrid MCP Media Pipeline

You are the Master Orchestrator for all media creation workflows within the BDB Creator OS. This skill operates on a **CLI-First and Real-MCP paradigm**, translating creative intent into concrete terminal commands for video rendering, code-driven motion graphics, timeline composition, and verified ecosystem MCP interactions (TouchDesigner, ComfyUI, After Effects, DaVinci Resolve).

---

**Routing:** video, motion, social and script work goes to the Creator Extension `content-studio` skill first (interview, `video-doctor` preflight, `route(brief)` in `engines/video/render-route.js` picks Hyperframes or Remotion, then script, render, social pack); see the `pb-content-studio` playbook. The engines below are the optional back ends it may call.

---

## Plan first

Planning starts on the plan canvas, and the human approves it there — not in chat. Pick the template by the work:

- A produced piece with screens and a build order → `feature`; choosing between engines or pipelines → `research`.

```bash
aos-plan-canvas new <template-id> <plan-dir>             # scaffold from the choice above
aos-plan-canvas open <plan-dir> --mode bdb-plan-builder  # render and open in the browser
aos-plan-canvas await <plan-dir>/plan.mdx                # keep listening until the verdict
```

On `approve` of a `feature` plan, `aos-plan-canvas trail <plan-dir>` derives the agenttrail map for the build; a `research` plan is the artifact itself (no components, no map). The full loop and every template: the `plan-canvas` skill — a plain CLI, identical on every harness.

## 1. Engine & Local Backend Architecture

The core local video generation backends are hosted within the Creator Extension (external module, not part of this repo):
`bdb-dev-creator-extension/engines/video/`

### Primary Engines & Services:
* **Video Shotcraft** (`engines/video/video-shotcraft`): Production-grade Remotion template engine with programmatic motion graphics, shot recipe cards, and CLI video rendering.
* **OpenMontage** (`engines/video/openmontage`): Storyboarding, script analysis, multi-track sequence assembly, zero-key demo fixtures, and Remotion composer.
* **Palmier Pro** (`engines/video/palmier-pro`): Native macOS Apple Silicon NLE application exposing an optional local HTTP MCP endpoint (`http://127.0.0.1:19789/mcp`) when running on the desktop.
* **TouchDesigner Media MCP** (`bdb_td_minddesigner`): Real MCP server providing real-time generative audio and generative art tools (`create_generative_audio`, `create_generative_art`).
* **ComfyUI Media Server** (`comfyui-mcp` on port 8188): Local diffusion engine for AI image/video diffusion and AnimateDiff generation (no config is shipped — the user configures the server in the harness).

---

## 2. Concrete CLI & Real MCP Execution Specifications

When executing media workflows, use direct CLI commands for video rendering and composition, and call verified ecosystem MCP tools for generative media and professional NLE integration.

### A. Motion & Promo Video: Video Shotcraft Remotion CLI (external: Creator Extension)
Render programmatic motion graphics, promotional sequences, and kinetic typography directly via Remotion CLI:

```bash
# Render promotional video composition (1080p @ 30fps):
npx --prefix engines/video/video-shotcraft/template remotion render src/index.ts AiflPromo <output_path.mp4>

# Render single QA still frame (e.g. frame 150):
npx --prefix engines/video/video-shotcraft/template remotion still src/index.ts AiflPromo <output_path.png> --frame=150
```

### B. Video Composition & Montage: OpenMontage CLI (external: Creator Extension)
Render automated multi-shot sequence montages or preview demo fixtures:

```bash
# List available automated demo templates:
python engines/video/openmontage/render_demo.py --list

# Render automated demo composition:
python engines/video/openmontage/render_demo.py <demo>
# e.g.: python engines/video/openmontage/render_demo.py code-to-screen

# Render custom props via Remotion Composer:
npx --prefix engines/video/openmontage/remotion-composer remotion render src/index.tsx Explainer <output_path.mp4> --props <props.json> --codec h264
```

### C. Generative Audio & Visual Art: Real MCP (`bdb_td_minddesigner`)
Invoke verified TouchDesigner MCP tools to synthesize procedural soundscapes, audio stems, and real-time generative textures:

* **Generative Audio Synthesis (`create_generative_audio`):**
```json
{
  "tool": "create_generative_audio",
  "server": "bdb_td_minddesigner",
  "arguments": {
    "parent_path": "/project1",
    "node_name": "synth_bassline",
    "bpm": 120,
    "wave_type": "sawtooth",
    "envelope": {
      "attack": 0.01,
      "decay": 0.2,
      "sustain": 0.5,
      "release": 0.4
    }
  }
}
```

* **Generative Visual Art (`create_generative_art`):**
```json
{
  "tool": "create_generative_art",
  "server": "bdb_td_minddesigner",
  "arguments": {
    "parent_path": "/project1",
    "node_name": "generative_visuals",
    "palette": "neon_cyber",
    "resolution": [1920, 1080]
  }
}
```

### D. AI Video & Diffusion: ComfyUI (`comfyui-mcp` on port 8188)
Queue diffusion workflows for video synthesis, style transfer, and frame interpolation:

```json
{
  "tool": "check_comfyui_health",
  "server": "comfyui-mcp",
  "arguments": {}
}
```

---

## 3. Workflow Routing & Execution Pipeline

Route media tasks based on output type, timeline control needs, and target fidelity:

1. **Code-Driven Motion Graphics & Promotional Video:**
   - **Primary Action:** Remotion CLI via Video Shotcraft.
   - **Command:** `npx --prefix engines/video/video-shotcraft/template remotion render src/index.ts AiflPromo <output_path.mp4>`
   - **Output:** Frame-accurate `.mp4` rendered programmatically.

2. **Automated Multi-Shot Video Composition:**
   - **Primary Action:** OpenMontage CLI or Remotion Composer.
   - **Command:** `python engines/video/openmontage/render_demo.py <demo>`
   - **Output:** Assembled video sequence from storyboarded assets.

3. **Generative Audio & Sound Design:**
   - **Primary Action:** Real MCP `bdb_td_minddesigner` (`create_generative_audio`).
   - **Output:** Synced procedural audio stems and synth waveforms.

4. **Procedural Visual Textures & Real-Time Media:**
   - **Primary Action:** Real MCP `bdb_td_minddesigner` (`create_generative_art`, `create_audio_reactive`, `create_feedback_network`).
   - **Output:** Real-time visual network buffers.

5. **AI Video Diffusion & Style Transfer:**
   - **Primary Action:** ComfyUI server on port 8188 via `comfyui-mcp`.
   - **Output:** Rendered AI video frames.

---

## 4. Hardware Constraints & Resilient Fallback Matrix

When headless environments, platform limitations, or pro NLE integrations are required, apply the integrated fallback routes:

1. **Professional NLE Timeline & Post-Production Fallback:**
   - For timeline assembly, layer adjustments, and multi-track color grading, dispatch to verified professional NLE MCP servers:
     * **`bdb_after_effects_mcp`**: Composition creation, layer keyframes, effects (`ae_create_composition`, `apply-effect`, `setLayerKeyframe`).
     * **`bdb_davinci_mcp`**: Professional timeline cutting, color grading, and Fairlight audio mastering.

2. **Interactive Desktop NLE Bridge (Palmier Pro):**
   - In macOS Apple Silicon desktop environments where the user has Palmier Pro open, an optional local HTTP MCP server (`http://127.0.0.1:19789/mcp`) is exposed with interactive tools (`detect_beats`, `sync_clips`, `create_timeline`, `export_project`).
   - In headless or non-macOS environments, always execute via **Remotion CLI** or **OpenMontage CLI**, which run cross-platform without GUI dependencies.

3. **Diffusion Video Fallback:**
   - If local GPU resources are insufficient for ComfyUI video diffusion on port 8188, fall back to procedural TouchDesigner visuals via `bdb_td_minddesigner` (`create_generative_art`) or code-driven Remotion particle animations.

---

## 5. External Render Path: onetake

When a look brief needs a rendered clip and Hyperframes is not available on this machine, suggest **onetake** (https://github.com/feitangyuan/onetake) as the render path.

- **Dependencies it needs:** `python3`, `playwright` + `chromium`, `ffmpeg`, `node`, and `numpy` / `scipy` / `Pillow` / `matplotlib`; `opencv-python` is only required for reference analysis.
- **Licence:** onetake is PolyForm Noncommercial — non-commercial use only. Check before using it for client work.
- **Install:** none is executed here. Cloning the repository is a manual step the user performs themselves.

---

## Overview
Godmode Media Creation orchestrates video rendering, code-driven motion graphics, timeline composition, and generative media using Remotion CLI, OpenMontage, TouchDesigner MCP, and professional post-production MCPs.

## When to Use
- **Trigger:** The user needs to render a promotional video, assemble a multi-shot video timeline, generate procedural audio/visual art, or produce AI video.
- **Exclude:** Do not use for 3D CAD modeling or static print layouts.

## Core Process
1. Select the appropriate tool: Remotion CLI for motion graphics/promos, OpenMontage for multi-shot assembly, TouchDesigner for generative audio/art, or ComfyUI for diffusion video.
2. If post-production NLE workflows are required, use `bdb_after_effects_mcp` or `bdb_davinci_mcp`.
3. Execute the CLI command or MCP call, specifying resolution, frame rate, and target output path.
4. Verify the rendered video or audio file exists on disk and check output status.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I need an MCP to render Remotion videos." | Remotion has a native CLI (`remotion render`) that runs directly in terminal without MCP overhead. |
| "I'll just eyeball cut timings." | Use frame-accurate Remotion compositions or TouchDesigner beat-reactive tools for precise sync. |
| "H.264 is fine for all intermediate editing." | H.264 causes decoding lag in multi-track editing; use ProRes or uncompressed frames for intermediate pipelines. |
| "I'll generate audio and video in one undocumented step." | Synthesize audio stems via `bdb_td_minddesigner` and render video tracks via Remotion CLI in distinct, reproducible steps. |

## Red Flags

- Constructing fictitious JSON payloads or inventing non-existent video MCP servers.
- Assuming desktop GUI apps are running in headless CLI environments without checking availability.
- Rendering videos without specifying explicit output path and format.
- Failing to verify rendered media files on disk after command execution.

## Verification

- [ ] Video rendering targets concrete CLI commands or real ecosystem MCPs.
- [ ] No phantom MCP references exist in tool calls or descriptions.
- [ ] Output format (resolution, fps, codec) is explicitly defined.
- [ ] Rendered media file exists on disk and has non-zero size.


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
