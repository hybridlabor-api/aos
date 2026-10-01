---
name: pb-crew-call-sheet
description: >-
  Build a crew call sheet and a load-in / load-out plan for one show day from
  your event tracker or brief and your crew list, and send it to the crew only
  after your GO. Use for "call sheet", "crew call times", "load-in plan",
  "load-out schedule".
category: media-eventtech
kind: playbook
trigger: ["call sheet", "crew call times", "load-in plan"]
inputs: [tracker_csv_or_event_brief, crew_list]
requires:
  skills: [bdb-eventagency-skill, pb-event-tracker]
  agents: []
  mcps: []
  store: []
go_points: [send to crew]
outputs: ["call-sheet.md", "load-plan.md", "run-log.md"]
verify: "every crew member has a call time; load-in ends before doors; load-out starts after show end"
difficulty: beginner
est_time: 10-20 min
---

# Crew call sheet
What you get: a call sheet and a load-in / load-out plan for one show day.

## Inputs
- The `tracker.csv` from pb-event-tracker, or an event brief — a text or document file
- A crew list — a file with name, role and contact for each person
- A save folder — asked once; default `./pb-crew-call-sheet-<date>/`

## Steps
1. Ask once — save folder, tracker or brief, crew list → `run-log.md` — the files are readable; no tracker yet: run pb-event-tracker first or give the brief
2. Read the tracker or brief and the crew list → show date, venue, doors time, show start and end, per crew member name, role, contact — missing times are `?`, never guessed
3. bdb-eventagency-skill (section "5.1 Pre-production", run-of-show and day-minus milestones) — the read data → `call-sheet.md`, one row per crew member: who, role, call time, contact — every crew member has a call time
4. bdb-eventagency-skill (section "5.1 Pre-production") — the read data → `load-plan.md` with load-in, line check, doors, show, load-out, each with a start and end time — load-in ends before doors; load-out starts after show end
5. Show `call-sheet.md` and `load-plan.md` in full and apply your edits until you approve — approval logged
6. [GO] Send the call sheet to the crew through a connector you name, or send it yourself — show every recipient (name + address, `?` blocks sending until you fill it) and the full text of every message first. The run stops here until the human types GO. The GO covers exactly the recipients and messages shown and nothing else; a different or added recipient needs a fresh GO. Never send to anyone not listed in `call-sheet.md`. The go-gate hook does not guard sending: this [GO] is the only guard.

Run log: `run-log.md` in the save folder. One line per step as it completes (`N. done|skipped|failed — file — check result`), and `WAITING FOR GO: <step>` at the gate. Anything other than the literal GO (case-insensitive) is not a GO. If a check fails, stop, write the failure into the log and tell the user.
