---
name: pb-code-video
description: >-
  The main entry point for video creation: generates a video brief, creates a shot plan, routes to the right render engine (Remotion, Hyperframes, ffmpeg, launch-video, or content-studio), and tracks execution.
category: media-eventtech
kind: playbook
trigger: ["make a video", "create a demo", "generate a video", "render a reel", "edit a video", "animate a motion graphic", "screen recording", "launch film", "promo", "walkthrough", "explainer"]
inputs: [goal, audience, duration, source_assets]
requires:
  skills: [pb-launch-video, pb-content-studio, remotion, brag, "creative-direction (external)", bdbdesignpro]
  agents: []
  mcps: []
  store: []
go_points: [route]
outputs: ["video_brief.md", "shot_plan.md", "production_artifacts/pb-code-video-<date>.md"]
verify: "Execution record shows loaded skills, chosen engine and output paths"
difficulty: intermediate
est_time: 45-120 min
---

# Code-Video Entry Point
The single entry point for making, creating, generating, editing or animating a video, demo, walkthrough, promo, reel, explainer, motion graphic, screen recording or launch film.

## Inputs
- goal - The objective of the video
- audience - The target viewers
- duration - Expected length
- source_assets - Any existing assets or URLs

## Steps
1. Brief - Define a video brief with product framing (problem, scope, unknowns, success measure): goal, audience, duration, aspect ratio, source assets, screen capture yes/no, on-screen text, output formats, and success check.
2. Handoff - If creative direction is new, invoke `creative-direction`. If engine and motion tokens are needed, invoke `bdbdesignpro`.
3. Plan - Create a shot plan format: shot, duration, purpose, source, on-screen copy, motion, transition, audio, acceptance check.
4. Budget - State constraints on render time or generation cost before generation.
5. Route - Select the appropriate route based on this decision table:
   | Task / source | Route |
   |---|---|
   | HTML/CSS motion, titles, typography, designed scenes | Hyperframes (`brag` for a project-folder launch film) |
   | React or data-driven scenes, exact frame timing, batched variants | Remotion, Shotcraft recipes when shot-driven |
   | Existing clips, screens, audio: cut, crop, captions, format | ffmpeg edit path |
   | Live URL product or app demo | `pb-launch-video` |
   | AI-generated shots from a photo or prompt | Creator Extension `content-studio` (Higgsfield if configured, else local) |
   | Unclear source or two engines named | ask one short question, then record the route |
   Write `WAITING FOR GO: route` and stop for approval.
6. Execute - Execute the chosen route.
7. Review Gates - Perform a rough review first to check layout and timing, followed by a final review for polish.
8. Execution record - End the run with a line starting with "Loaded skills: " followed by exact names of loaded skills and misses. Also record the chosen engine, why it was chosen, output paths, and review status.

Rules
- Write in ASD-STE100 Simplified Technical English: short sentences, active voice, one instruction per sentence.
- Never claim a skill was loaded when it was not.
