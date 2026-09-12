---
name: bdb-davinci-mcp
description: Utilizes the DaVinci Resolve MCP servers to control timeline editing, media analysis, color grading, and Fusion/Fairlight scripting.
category: media-eventtech
---

# DaVinci Resolve MCP — Integration and AI Agent Guide

This skill file instructs AI agents on how to interface with the DaVinci Resolve MCP Server integrations (including `davinci-resolve-mcp` and `davinci-mcp-professional`). It details page requirements, media analysis, edit loops, versioning pipelines, and troubleshooting steps.

## 1. Overview and Pipeline Value

The **DaVinci Resolve MCP Server** exposes the complete scripting API of DaVinci Resolve Studio (18.5 to 21+) to AI models. In the BDB OS workflow, this server acts as an intelligent assistant that can automate timeline assembly, perform source-safe audio/video analysis, manage color grade metadata (CDLs/LUTs/stills), write timeline markers, and compile extension scripts.

### Architecture
- **Local Scripting API:** Communicates with Resolve via the official external Python scripting interface.
- **Two Operational Modes:**
  - *Compound Mode (Default):* Exposes 32 structured tools containing 136 guarded workflow kernels. Keeps the model's context footprint lean.
  - *Granular Mode (`--full`):* Exposes 341 tools representing a one-to-one mapping of every Resolve scripting API method.
- **Local Control Panel:** Includes a browser dashboard (`venv/bin/python -m src.control_panel`) for visual inspection, timeline rollback, and manual analysis review.

---

## 2. System Instructions

### Page Requirements
Resolve is page-centric. Many tool calls will fail if the application is on the wrong page. Always verify or transition the page before invoking page-specific tools:

| Workflow | Page Required | Transition Command |
| :--- | :--- | :--- |
| **Media Ingest / Bins** | Media | `resolve_control(action="open_page", params={"page": "media"})` |
| **Timeline Assembly / Edits** | Edit or Cut | `resolve_control(action="open_page", params={"page": "edit"})` |
| **Color Grading / LUTS / CDL** | Color | `resolve_control(action="open_page", params={"page": "color"})` |
| **Audio Configuration** | Fairlight | `resolve_control(action="open_page", params={"page": "fairlight"})` |
| **Effects / Compositing** | Fusion | `resolve_control(action="open_page", params={"page": "fusion"})` |
| **Render Setup / Queues** | Deliver | `resolve_control(action="open_page", params={"page": "deliver"})` |

### Media Analysis and Visual Verification (host_chat_paths)
1. **Source Media Safety:** Never transcode, modify, or create derivatives of original camera files. Write report files only to the `davinci-resolve-mcp-analysis` scratch directory.
2. **Visual Analysis Flow:** 
   - `analyze_clip` or `analyze_bin` extracts keyframes to disk and returns a deferred payload with `frame_paths` and a verification token.
   - The AI agent must read these image frames, generate a structured description, and finalize the analysis by calling `media_analysis(action="commit_vision", params={clip_id, visual, vision_token})`.
   - **Do not skip `commit_vision`**; doing so leaves the clip in a `pending_host_vision_analysis` error state.

### Evidence-Based Editing (`edit_engine`)
Every timeline edit operates on a **Plan → Confirm → Execute** loop:
- `plan_tighten` or `plan_selects` calculates trims (e.g., dead air removal from transcription evidence) and returns a `plan_id`.
- The user must review this plan (optionally via the browser UI).
- Run `execute_tighten(plan_id)` with a verification token to write the edits to a new timeline version.

---

## 3. Available Tools and API Parameters

Key tools on the compound server include:

| Tool | Action | Parameters | Description |
| :--- | :--- | :--- | :--- |
| **`resolve_control`** | `launch`, `get_page`, `open_page`, `api_truth`, `quit` | `page?: string` | Manages active page contexts and Resolve application states. |
| **`project_manager`** | `list`, `get_current`, `create`, `load`, `save`, `import_project`, `export_project`, `lint`, `apply_spec` | `name?: string`, `path?: string`, `spec?: object` | Handles project CRUD, backup archives, health linting, and declarative YAML specs. |
| **`media_pool`** | `get_clips`, `import_media`, `move_clips`, `setup_multicam_timeline`, `get_selected` | `paths?: string[]`, `target_path?: string` | Organizes media pool folders, imports files, and sets up multi-cam stacks. |
| **`media_pool_item`** | `get_metadata`, `set_metadata`, `get_clip_property`, `set_clip_color`, `get_audio_mapping` | `clip_id: string`, `key: string`, `value?: any` | Sets search tags, notes, track mapping, and clip colors in Resolve. |
| **`media_analysis`** | `plan`, `coverage_report`, `analyze_clip`, `detect_sync_events`, `publish_clip_metadata`, `commit_vision`, `build_embeddings`, `find_similar` | `clip_id?: string`, `kinds?: string[]`, `vision_token?: string` | Handles visual keyframing, audio transcriptions, sync detection, and semantic vector indexing. |
| **`edit_engine`** | `plan_selects`, `execute_selects`, `plan_tighten`, `execute_tighten`, `plan_swap`, `execute_swap` | `plan_id?: string`, `timeline_name?: string`, `alternate_index?: int` | Plans and executes video trimming, select reels, and alternate take swaps. |
| **`timeline_versioning`** | `begin_run`, `end_run`, `archive_current`, `list_versions`, `diff_versions`, `diff_timelines` | `timeline_name?: string`, `reason?: string` | Records edit logs, structures version diffs, and rolls back edits. |
| **`script_plugin`** | `run_inline`, `execute`, `safe_install_extension`, `safe_remove_extension` | `source: string`, `language: string` | Authoring utility that runs or installs custom Lua/Python script extensions. |

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: CDL Grade Backup and Export
Snapshot a clip's grade, inspect CDL, and export a look:

```json
// Step 1: Switch to Color page
// Tool: resolve_control(action="open_page", params={"page": "color"})

// Step 2: Snapshot active item's grade
// Tool: timeline_item_color(action="grade_version_snapshot", params={"version_name": "BeforeAdjustment"})

// Step 3: Set CDL parameters for mild primary grade adjustment
// Tool: timeline_item_color(action="safe_set_cdl", params={"slope": [1.05, 1.0, 0.95], "offset": [0.01, 0.0, -0.01]})
```

### Recipe 2: Run Inline Scripting for Batch Meta Change
Use `run_inline` to quickly rename clips matching a specific prefix inside the Media Pool:

```json
// Tool: script_plugin(action="run_inline", params={"language": "python", "source": "..."})
// Source value:
import sys
resolve = BmdResolveAPI()
projectManager = resolve.GetProjectManager()
project = projectManager.GetCurrentProject()
mediaPool = project.GetMediaPool()
rootFolder = mediaPool.GetRootFolder()

def rename_clips(folder):
    for clip in folder.GetClipList():
        name = clip.GetName()
        if name.startswith("CAM_A_"):
            clip.SetClipProperty("Clip Name", name.replace("CAM_A_", "AngleA_"))
    for subfolder in folder.GetSubFolderList():
        rename_clips(subfolder)

rename_clips(rootFolder)
print("Rename complete")
```

---

## 5. Troubleshooting and Connection Details

### Configuration and Ports
- **Application Port:** Controlled via system environment variables. Resolve communicates natively with the local Python runtime.
- **Control Panel Dashboard:** `http://localhost:5000` (by default) or path printed upon running:
  ```bash
  venv/bin/python -m src.control_panel
  ```
- **Requirements:**
  1. **DaVinci Resolve Studio** (Scripting APIs are blocked in the free version).
  2. **External Scripting Mode:** Go to DaVinci Resolve -> Preferences -> System -> General, set "External scripting using" to **Local** or **Developer**.
  3. **Python Registry (Windows):** Python must be installed system-wide for Resolve to find it in the registry (pyenv or virtual environments will not work if the host installer isn't registered).

### Diagnostic Connection Verification
Test if the local Python bridge can reach Resolve:
```bash
# Verify the Python scripting modules are discoverable
python -c "import DaVinciResolveScript as dvr; print(dvr.scriptapp('Resolve'))"
```

### Common Errors
1. **`Resolve is not running or scripting is disabled`**
   - Ensure the Studio version is active.
   - Verify that preferences are set to "External scripting using: Local".
2. **`Visual Analysis stuck in pending_host_vision_analysis`**
   - The agent has not called the `commit_vision` tool with the results of visual frame descriptions. Check the manifest files in your scratch analysis directory to recover the token.
3. **`Fusion.Execute() returns False or no-op`**
   - Resolve 20+ has limitations with remote execution of Lua scripts. Use the `run_inline` tool which leverages a temporary file fallback mechanism.
