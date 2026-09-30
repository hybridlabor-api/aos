---
type: concept
title: Event Production Skills
description: Three media-eventtech skills cover different layers of live event work — bdb-eventagency-skill (agency ops), godmode-eventtech (technical show-control execution), and bdbmediastorm (brainstorming). Load the right one for the task; they are not interchangeable.
tags: [event, media-eventtech, godmode-eventtech, bdb-eventagency-skill, bdbmediastorm, routing]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-30T02:05:01.845Z
sources:
  - id: openwiki-source-dcd51a0a627564e7634d49a2
    resource: repo://skills/basic/bdb-eventagency-skill/SKILL.md
  - id: openwiki-source-317d11004d4a65d114640b55
    resource: repo://skills/basic/bdbmediastorm/SKILL.md
  - id: openwiki-source-7888f41b07fc87bde3701e52
    resource: repo://skills/basic/godmode-eventtech/SKILL.md
generated: { by: "codex", at: "2026-09-30T02:05:01.845Z" }
---

# Event Production Skills

Three skills share the `media-eventtech` category and together cover the full event production lifecycle. They have distinct and non-overlapping responsibilities.

## Routing table

| Task | Skill to load |
|---|---|
| Brainstorming / planning a live show architecture | `bdbmediastorm` |
| Signal flow, OSC/DMX protocol binding, hardware limits, MCP orchestration | `godmode-eventtech` |
| Lighting cue execution (grandMA3) | `bdb-grandma3-mcp` |
| Video clip / layer / output control (Resolume) | `bdb-resolume-mcp` |
| 3D scene, render, spatial build | `godmode-3d-creation` |
| Client intake, project scoping, vendor management, production coordination, inbox triage, pre-show logistics, post-show wrap | `bdb-eventagency-skill` |

**The hard boundary:** if the question is *"what signal goes where"* or *"what should this look like"*, load `godmode-eventtech` or `bdbmediastorm`. If the question is *"who is bringing it, what did they promise, and what happens when they don't"*, load `bdb-eventagency-skill`.

---

## bdb-eventagency-skill — agency ops layer

`skills/basic/bdb-eventagency-skill/SKILL.md` · category: `media-eventtech`

The business and production-coordination side of running an event company. Owns everything that happens before, around, and after the show — not the technical execution itself.

**Six sections:**
1. **Routing Table** — which sub-skill to load for which task.
2. **Client & Project Intake** — required fields before committing (date, venue, brief, budget range, technical rider, attendance, decision authority), scoping questions, scope statement rule.
3. **Inbox Triage** — stakeholder classification (vendor / client / sponsor / speaker / venue / internal), priority tiers (Immediate / Today / Tracking), temporal override rules, output shape with typed action items ([OUR ACTION] / [AWAITING] / [APPROVAL NEEDED]).
4. **Vendor Management** — phase-based urgency thresholds (Normal / Planning / Advance / Load-in / Show Day), item status taxonomy (OVERDUE / AT RISK / ON TRACK / BLOCKED), escalation path by vendor type.
5. **Production Coordination** — site survey, paperwork gate (COI / permits / credentials), run-of-show as the single coordination artefact, speaker materials deadline framework (D-30 / D-21 / D-14 / D-7 / D-1), day-of flow, strike manifest, post-show wrap within 72 hours.
6. **Verification** checklist.

This skill never issues a technical execution instruction — it routes to `godmode-eventtech` for any signal-flow or hardware question.

Source: adapted from `talkvalue/event-agency-skills` (Apache-2.0), prose only, no upstream scripts or Python dependencies.

---

## godmode-eventtech — technical show-control execution

`skills/basic/godmode-eventtech/SKILL.md` · category: `media-eventtech`

The architectural authority for real-time performance, signal flow, protocol routing, and hardware limits in live show and event-tech environments.

**Key responsibilities:**
- Zero-latency signal routing (OSC, Art-Net, sACN, DMX, MIDI, SMPTE, NDI, Spout/Syphon).
- Deterministic frame timing — never poll a live server via blocking REST calls at 60fps.
- Hardware boundary enforcement (VRAM fill rate, canvas compositing limits, SDI/HDMI sync timing).
- MCP orchestration across TouchDesigner, Resolume, grandMA3.

**Loads alongside:** `bdb-eventagency-skill` for agency-layer tasks within the same event project.

---

## bdbmediastorm — live show brainstorming

`skills/basic/bdbmediastorm/SKILL.md` · category: `media-eventtech`

The brainstorming entry point for event technology, live show control, and real-time media systems. Initiates a multi-agent planning session with specialized subagents (Real-Time Architect, etc.) that analyze the show architecture from opposing technical angles.

**Scope:** signal routing, hardware limits, network protocols, real-time graphics engines (TouchDesigner, Resolume, grandMA3, Unreal Engine live production). **Not** for media asset creation (use `godmode-media-creation`) or 3D mesh generation (use `godmode-3d-creation`).
