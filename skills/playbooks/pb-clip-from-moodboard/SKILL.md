---
name: pb-clip-from-moodboard
description: >-
  Turn a look brief and reference images into a finished social clip:
  concept, TouchDesigner look and palette, ComfyUI stills, a recorded take,
  a cut in DaVinci Resolve or Remotion, 9:16 and 16:9 exports, publish only
  after GO. Use for "moodboard to clip", "make a social clip from these
  references", "look brief to video".
category: media-eventtech
kind: playbook
trigger: ["moodboard to clip", "social clip from references", "look brief to video"]
inputs: [brief, reference_images, project, comfy_workflow, cut_tool, formats?]
requires:
  skills: [bdbmediastorm, bdb-touchdesigner-mcp, bdb-davinci-mcp, remotion, "ffprobe (external)"]
  agents: []
  mcps: [bdb_td_minddesigner, comfyui-mcp, bdb_davinci_mcp]
  store: []
go_points: [publish]
outputs: ["renders/<project>/concept.md", "renders/<project>/look.tox", "renders/<project>/stills/", "renders/<project>/clip_9x16.mp4", "renders/<project>/clip_16x9.mp4", "production_artifacts/pb-clip-from-moodboard-<date>.md"]
verify: "ffprobe shows 1080x1920 and 1920x1080 at the asked duration; comfyui get_history status success; get_td_node_errors empty"
difficulty: advanced
est_time: 1-3 h
---

# Moodboard to social clip
What you get: a 9:16 and a 16:9 clip built from your look brief and references, checked with ffprobe, handed off for publishing after your GO.
Availability: needs the comfyui-mcp server configured in the harness (no config is shipped). Missing → stop at preflight with that message.

## Inputs
- brief — the look brief, asked in step 2
- reference_images — a folder of reference images, asked in step 2
- project — a slug for `renders/<project>/`, asked in step 2
- comfy_workflow — path to a ComfyUI API-format workflow JSON, required, never invented
- cut_tool — `davinci` or `remotion` (remotion needs an existing Remotion project)
- formats (optional) — default 9:16 and 16:9

## Steps
1. Preflight — ask cut_tool first; then one probe per server, before any file is written: `get_td_info` on `bdb_td_minddesigner`; `check_comfyui_health` on `comfyui-mcp`; `get_resolve_status` on `bdb_davinci_mcp` (only if cut_tool = davinci); `command -v ffprobe`. MCP tools may be deferred in the harness: try to load the tool once via the harness MCP list before declaring it missing. Tool not loaded, call errors, or the payload fails its pass condition (TD `get_td_info`: `connected: true`; ComfyUI `check_comfyui_health`: `status` is `"online"`; Resolve `get_resolve_status`: no `error` key) → stop with "Missing MCP: `<server>` (`<tool>` unavailable). Start <TouchDesigner|ComfyUI|DaVinci Resolve> and check `mcpServers.<server>` in your harness config." (comfyui-mcp: use the Availability message above) and write nothing except the run log; davinci missing while cut_tool = remotion → continue, logged — all probes answered
2. Ask — brief, reference image folder, project slug, ComfyUI workflow JSON path, cut_tool, formats (default 9:16 and 16:9), length → run log and `renders/<project>/` — all answered, workflow path exists
3. bdbmediastorm — brief → `renders/<project>/concept.md` (look, palette intent, shot list, length) — stops for approval
4. bdb-touchdesigner-mcp — references → `moodboard_to_system` / `extract_palette` → network and palette; `get_td_node_errors` empty, `get_preview` shown (stops for approval), then `export_look_tox` → `renders/<project>/look.tox` — errors empty
5. ComfyUI — the workflow file's text (palette and prompt filled in) as the JSON string for `queue_prompt` → `get_history <prompt_id>` status success → `get_output_media_info` paths copied to `renders/<project>/stills/` and loaded into the TD network (e.g. as a `moviefilein` TOP feeding the look) before step 6, then `get_td_node_errors` empty again — at least 1 still; `local_path` is only set when `COMFYUI_DIR` is set, so if `local_path` is empty or `exists_locally` is false, stop with a clear message and copy nothing
6. Record — TD `record_movie` → `renders/<project>/raw.mov` — `ffprobe` duration > 0
7. Cut — either way the output is the two clips, and `ffprobe` shows the asked width, height and duration per file:
   - davinci: `create_project` → `import_media` → `create_timeline` → `append_to_timeline` → `set_render_settings` per format → `add_render_job` → `start_rendering` → `get_render_job_status` complete
   - remotion: from the Remotion project dir, copy `raw.mov` into its `public/`, then `npx remotion render <Composition> <out>` per format (network/npm on first run needs approval; the skill's Stitch steps do not apply)
   - `ffprobe` is the gate, since nothing proves `set_render_settings` sets 1080x1920: on a width/height mismatch stop with "export <format> has WxH, expected ...", log it, do not publish, invent no conversion command, and tell the human what to change in Resolve
   - then the clips stop for approval (taste review)
8. [GO] publish — the destination and the full file list shown. The run stops here until the human types GO. No publish MCP or CLI exists on this machine, so the GO releases the hand-off: the files plus the caption in `renders/<project>/publish.md`; upload is manual unless the human named a tool in step 2 — hand-off file written

Run log: `production_artifacts/pb-clip-from-moodboard-<date>.md` in the start directory, never committed

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- GO is by contract in every harness. The go-gate hook is only a backstop on Claude Code, OpenCode and agy (Codex: unverified; Cursor, Kimi: none). A missing hook is never permission to proceed.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
