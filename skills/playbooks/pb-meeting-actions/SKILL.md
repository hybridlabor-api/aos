---
name: pb-meeting-actions
description: >-
  Turn a meeting transcript into clean notes, the decisions, and who does
  what by when, then draft the follow-up mail and send it only after your GO.
  Use for "meeting notes", "action items from this meeting", "who did what
  in this transcript", "who does what after the call".
category: bdb-core
kind: playbook
trigger: ["meeting notes", "action items from this meeting", "follow-up mail"]
inputs: [transcript_file]
requires:
  skills: [memb-skill]
  agents: []
  mcps: []
  store: []
go_points: [send follow-up]
outputs: ["notes.md", "decisions.md", "actions.md", "followup-draft.md", "run-log.md"]
verify: "every decision and action in the files cites a transcript line"
difficulty: beginner
est_time: 10-20 min
---

# Meeting notes and action list
What you get: clean notes, the decisions, and who does what by when, from a meeting transcript.

## Inputs
- A transcript file (.txt, .md, .vtt or .srt) — exported from your meeting tool; an audio file alone is not enough
- A save folder — asked once; default `./pb-meeting-actions-<date>/`

## Steps
1. Ask once — save folder and transcript file → `run-log.md` (create the folder only after the file check passes) — the file is readable; if you only have audio, ask for the transcript export instead (no transcription is available here)
2. Read the transcript → `notes.md` with attendees and at most 10 summary bullets — each bullet cites a timestamp or line
3. Read the transcript → `decisions.md` — each decision traced to a transcript line
4. Read the transcript → `actions.md` as a table: owner, task, due, source — an unknown owner or due date is written as `?`, never guessed
5. Show notes, decisions and actions in full and apply your edits until you approve — approval logged
6. Write `followup-draft.md`, one mail per recipient group, each recipient as name + address (`?` blocks sending until you fill it) — draft only, nothing is sent
7. [GO] Send the follow-up through a connector you name; without one, you copy the draft yourself — show every recipient and the full text of every message first. The run stops here until the human types GO. The GO covers exactly the recipients and messages shown and nothing else; a different or added recipient needs a fresh GO. Never send to anyone not listed in `followup-draft.md`.
8. memb-skill — optional, ask first: store the decisions — memory ids logged

Run log: `run-log.md` in the save folder. One line per step as it completes (`N. done|skipped|failed — file — check result`), and `WAITING FOR GO: <step>` at the gate. Anything other than the literal GO (case-insensitive) is not a GO. If a check fails, stop, write the failure into the log and tell the user.
