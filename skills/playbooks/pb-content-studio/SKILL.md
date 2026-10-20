---
name: pb-content-studio
description: >-
  Idea to published-ready content: brief, script and render via the Creator
  Extension content-studio skill (Hyperframes or Remotion), then a social
  pack.
category: media-eventtech
kind: playbook
trigger: ["make a reel", "idea to video", "content from this idea", "script and render a clip"]
inputs: [idea, platforms, length, formats, "source_url?"]
requires:
  skills: [brag, remotion, pb-launch-video, pb-social-pack, "content-studio (external)", "hyperframes (external)", "ffprobe (external)"]
  agents: []
  mcps: []
  store: []
go_points: [publish]
outputs: ["renders/<project>/brief.md", "renders/<project>/script.md", "renders/<project>/<name>_<fmt>.mp4", "social/<project>/", "production_artifacts/pb-content-studio-<date>.md"]
verify: "ffprobe shows the asked WxH and duration per file; every post claim traces to the brief"
difficulty: intermediate
est_time: 45-120 min
---

# Content studio: idea to render to social pack
What you get: a script, a rendered clip per format checked with ffprobe, and a social pack, handed off for publishing after your GO.
Availability: needs the Creator Extension (separate module) for the `content-studio` skill, `engines/video/render-route.js` and `engines/video/video-doctor.js`. Without it, stop at step 1.

## Inputs
- idea — one paragraph: goal, audience, message
- platforms — where it will be posted
- length — target duration in seconds
- formats — for example 16:9 (1920x1080), 9:16 (1080x1920)
- source_url — optional live URL or repo to build from

## Steps
1. Preflight — `node engines/video/video-doctor.js` from the Creator Extension root; report each `MISS` and its fix line — ffmpeg, ffprobe and node 18+ present; on a miss stop with "Missing tool: <name>"
2. Brief — idea, platforms, length, formats, source_url → `renders/<project>/brief.md` using the content-studio interview (step a) — stops for approval
3. Route — `node engines/video/render-route.js "<brief>"` → `hyperframes`, `remotion` or `ask`; on `ask` the human picks; the chosen renderer is written into the brief — Remotion needs an existing Remotion project path
4. Script — beat-by-beat script (duration, on-screen text, visual, audio cue) per content-studio step d → `renders/<project>/script.md` — stops for approval
5. Render — one file per format with the chosen renderer (content-studio step e). For a launch video of a live URL run `pb-launch-video`, for a project folder run `brag`; do not duplicate their steps — files exist per format
6. ffprobe — per file: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height:format=duration -of json <file>` — equals the asked WxH, duration within 1 s of length; on a mismatch stop, do not publish; then the clips stop for approval (taste review)
7. Social pack — run `pb-social-pack` with the brief as recap and the rendered clips → `social/<project>/` — posts and clips per platform, every claim cites the brief
8. [GO] publish — destination and the full file list shown. The run stops here until the human types GO. The GO releases the hand-off only: files plus captions; nothing is posted by this playbook

Run log: `production_artifacts/pb-content-studio-<date>.md` in the start directory, never committed

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- GO is by contract in every harness. The go-gate hook is only a backstop on Claude Code, OpenCode and agy (Codex: unverified; Cursor, Kimi: none). A missing hook is never permission to proceed.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
