---
name: bdb-eventagency-skill
description: "Use for event agency operations: client intake, project scoping, vendor management, crew coordination, production planning, pre-show logistics, and post-show wrap. Delegates technical execution to godmode-eventtech and bdbmediastorm."
category: media-eventtech
source: talkvalue/event-agency-skills
---

# BDB Event Agency Skill

The **agency-ops layer** for Hybridlabor Global — the business and production-coordination side of running an event company. This skill owns everything that happens *before, around, and after* the show. It does not own the technical execution itself.

Techniques adapted from [talkvalue/event-agency-skills](https://github.com/talkvalue/event-agency-skills) (Apache-2.0). Prose only — no upstream code, no scripts, no dependencies.

---

## 1. Routing Table

| Task | Route to |
|---|---|
| Signal flow, protocol binding, OSC/DMX, hardware limits, MCP orchestration | `godmode-eventtech` |
| Live show architecture brainstorming, creative direction | `bdbmediastorm` |
| Lighting cue execution, patch, playback | `bdb-grandma3-mcp` |
| Video clip, layer, and output control | `bdb-resolume-mcp` |
| 3D scene, render, spatial build | `godmode-3d-creation` |
| Client intake, scoping, budget, scheduling, vendor, crew, pre-show logistics, post-show wrap | **stay in this skill** |

**Boundary rule:** if the question is *"what should this look like"* or *"what signal goes where"*, route out. If it is *"who is bringing it, what did they promise, and what happens when they don't"*, it stays here. This skill never issues a technical execution instruction — it routes.

---

## 2. Client & Project Intake

An event request is not a booking until these are known. Anything guessed here becomes a change order later.

### Required fields before committing

| Field | Why it is required | If missing |
|---|---|---|
| **Date** (and whether date or time is flexible) | Drives every downstream deadline in this skill | Cannot scope. Ask first. |
| **Venue** (named, or shortlist with constraints) | Venue holds all vendor access; determines power, load-in window, noise curfew | Cannot plan load-in or vendor sequencing |
| **Brief** — what must happen, who must be in the room | Distinguishes an event from a venue rental | Ask: *"What does success look like when the last guest leaves?"* |
| **Budget range** — a band, not a number | Drives the action policy: which classes are `never` vs `criteria` | Do not quote. Scope verbally only. |
| **Technical rider** | AV, staging, power, network, FOH position | Route to `godmode-eventtech` for feasibility |
| **Attendance estimate** | Drives catering counts, staffing, registration, capacity | Cannot close catering or staffing |
| **Client contact + decision authority** | Who can actually say yes | Every later "we'll confirm" is a no |

### Scoping questions to ask before any commitment

1. **Who signs?** Not "the client" — a name. The person who can approve a change order on show day.
2. **What is non-negotiable?** Date, venue, budget, talent, or brand. Everything else is negotiable; know which one is not.
3. **What has been promised already, in writing, to anyone?** Sponsors and speakers hold commitments that predate you.
4. **What is the failure mode we are least able to absorb?** Late AV is a catastrophe; late florals are an inconvenience. Escalation urgency (§4) follows from this answer.
5. **Is there a technical rider yet?** If not, that is a Phase 0 action, not a show-week action.

### Scope statement rule

Produce a written scope before any deposit. It must name: date, venue, attendance band, the ten action classes with their modes (default-deny — see `.aos/factory.yaml`), what is explicitly out of scope, and the change-order trigger. A scope without an out-of-scope list will be expanded by the client by default.

---

## 3. Inbox Triage

Run this at the start of a working day on an active event, before a production meeting, or after time away. It produces a **point-in-time snapshot**, not a live feed.

### Stakeholder classification

| Type | Key signals | Default tier |
|---|---|---|
| **Vendor** | AV, catering, security, decor, transport, staffing, rentals, print | 2 |
| **Client** | Contracting organisation, corporate domain, C-suite/VP | 2 |
| **Sponsor** | Activation budget or in-kind contribution — **distinct from the client even when the client also sponsors** | 3 |
| **Speaker** | Bureau domain, rider, session, keynote, bio/headshot request | 3 |
| **Venue** | Hotel, convention centre, outdoor site, venue coordinator, venue-employed catering manager | 2 |
| **Internal** | Own domain, team aliases, automated notifications | 3 |

When a thread is ambiguous, default to the type with the higher production impact: **Vendor > Venue > Speaker** for operational threads.

### Priority tiers

| Tier | Label | Response window | Criteria |
|---|---|---|---|
| **1** | Immediate | 1–2 hours | Blocked deliverable, payment deadline within 48h, client waiting on confirmation, venue or vendor escalation, load-in unresolved within 72h of the event |
| **2** | Today | Business hours | Advancing information requests, assets for review, draft approvals, speaker logistics more than 72h out |
| **3** | Tracking | None | FYIs, confirmations of receipt, vendor acknowledgements, threads you are CC'd on |

### Temporal override rules — apply before finalising tiers

These override the table above:

- Any vendor email mentioning **load-in, install, delivery window, or rider compliance** is Tier 1 if the event is within 14 days.
- Any client email containing **a question in subject or body** is Tier 1.
- Any Tier 1 thread with **no outbound reply in 24h+** escalates to flagged regardless of its original tier.

**Rationale:** the tier table is a prior. The overrides exist because the failure mode of event email is a request that looked like an FYI and was not one.

### Output shape

A dated digest containing: event name, timestamp, event phase, period covered, counts per tier, then the tier-1 and tier-2 threads with the *specific* action each needs and who owns it. Every extracted action item must be one of:

- **[OUR ACTION]** — a commitment we made, with a date
- **[AWAITING]** — a commitment someone else made, with a date
- **[APPROVAL NEEDED]** — a decision only the client can make

Never mix these three. An action with no owner is not an action item.

---

## 4. Vendor Management

Track **existing** vendor commitments and deliverables. This skill does not source vendors, negotiate contracts, or process payments.

### Vendor types, lead times, and failure impact

| Type | Typical lead time | Failure impact |
|---|---|---|
| AV / Technical | 2–4 weeks | **Critical** — no AV, no event |
| Venue | Contracted months ahead | **Critical** — venue holds all vendor access |
| Catering / F&B | 2–3 weeks (final count 72h) | High — dietary and count changes cascade |
| Transport / Logistics | 1–2 weeks | High — gear and people movement |
| Security | 1–2 weeks | High — compliance and safety |
| Entertainment / Talent | Rider-dependent | High — contracted, non-fungible |
| Decor / Floral | 1–2 weeks | Medium — visual, not operational |
| Staffing Agencies | 1–2 weeks | Medium — replaceable if flagged early |
| Signage / Print | 5–10 business days | Medium — wayfinding and branding |
| Rentals | 1 week | Medium — tables, chairs, linens |

### Phase-based urgency

Urgency is relative to **event proximity**, never absolute time. The same 48-hour silence is fine in month one and a production risk in advance week.

| Phase | Window | Overdue threshold | Escalation speed |
|---|---|---|---|
| Normal | T-30 and out | 48h no response | Standard: email → wait → follow-up |
| Planning | T-30 to T-8 | 24h no response | Accelerated: email → same-day follow-up |
| Advance | T-7 to T-2 | 12h no response | Urgent: email → phone within 4h |
| Load-in | T-1 | 2h no response | Emergency: phone immediately, escalate to production lead |
| Show day | T-0 | 1h no response | Emergency: phone + contingency activation |

### Item status taxonomy

| Status | Meaning |
|---|---|
| **OVERDUE** | Past deadline, no confirmation |
| **AT RISK** | Deadline approaching, last contact exceeds the phase threshold |
| **ON TRACK** | Confirmed, or within the normal response window |
| **BLOCKED** | **Waiting on us, not the vendor** |

**BLOCKED items are the most important row in the table and are routinely under-reported.** When a vendor is waiting on our headcount, floor plan, or approval, that is our team's problem. Surface it first.

### Escalation path

| Attempt | AV / Venue / Catering | Decor / Signage / Rentals | Staffing / Transport |
|---|---|---|---|
| 1st | Follow-up email quoting the original request | Follow-up email | Follow-up email |
| 2nd | Phone the account manager within 4h | Phone next business day | Phone next business day |
| 3rd | Escalate to production lead + contingency research | Source a backup vendor | Source a backup vendor |

**On show day: skip email entirely. Phone or in-person only.** Never send a follow-up email on T-0.

### Drafting rules for vendor follow-ups

- Reference the **specific** original request or deliverable — not "following up on my last email".
- State the deadline explicitly.
- Ask for a **specific confirmation** ("Can you confirm delivery by 14 March?"), not an open question.
- **No guilt, no pressure.** Vendors respond better to clarity than to escalation tone.
- For a phone call, prepare: vendor name, account manager, the specific item, the deadline and why it matters, and the fallback question — *"If the original plan isn't possible, what's the alternative?"*

### Budget and invoice context

| Age | Status | Action |
|---|---|---|
| Within terms | Current | None |
| 1–30 days | Nudge | Friendly reminder — assume oversight |
| 31–60 days | Firm request | Direct ask with date and amount |
| 60+ days | Escalation | Account lead; consider late fee or hold |

Variance alerts: **Venue 5% over** (largest single line, small % = big dollars), **Catering 10%** (per-head counts fluctuate), **Marketing 15%** (most flexible), **Contingency 0% drawn before T-14** (should not be touched), **all others 10%**.

---

## 5. Production Coordination

### 5.1 Pre-production

**Site survey — non-negotiable for any first-time venue.** Record: power distribution and available amperage by area, network drops and their throughput, load-in vehicle access and dock dimensions, door widths for the largest scenic element, FOH position and sightlines, noise curfew, and rigging points with their load ratings. Route the technical read to `godmode-eventtech` — this skill records the findings and flags blockers, it does not validate the signal plan.

**Paperwork gate.** Nothing loads in without: certificate of insurance (COI) from every vendor on site, venue access permits, and crew credentials. These are the most common cause of a T-1 access failure.

**Run-of-show (ROS) is the single coordination artefact.** One document, versioned, owned by the production lead, distributed to every vendor. It defines: load-in window and sequence, soundcheck, doors, show start, each cue block, and load-out. A conflict discovered in the ROS is cheap. A conflict discovered at the dock is not.

**Speaker materials — deadline framework:**

| Milestone | Due | Deliverables |
|---|---|---|
| D-30 | Bio (25 / 50 / 100-word variants, third person) + headshot (min 300×300px) | |
| D-21 | Session abstract (75 words, attendee-focused), learning outcomes, AV requirements | |
| D-14 | Final slide deck, event template applied | |
| D-7 | Travel, hotel, ground transport, dietary and accessibility requirements | |
| D-1 | Attendance and schedule confirmed | |

Learning outcomes use action verbs only — **implement, apply, build, create, deploy, evaluate, identify, master**. Never: *explore, discuss, learn about, understand, discover, dive into, unpack*.

Banned in any bio or session description: *thought leader, visionary, guru, passionate about, world-class, cutting-edge, revolutionary, groundbreaking, leverage, synergize, transformative, innovative*. Replace with specific numbers, named clients, measurable outcomes, concrete credentials.

### 5.2 Day-of flow

| Phase | Anchor | What must be true to advance |
|---|---|---|
| **Load-in** | T-1 or earlier | COI and permits verified per vendor, power patched and tested, ROS sequence confirmed with the dock |
| **Soundcheck** | Fixed slot, never "when ready" | Line check done, cue stack loaded, FOH and monitors positioned, walk-through with the client if contracted |
| **Doors** | Published start | House open, accessibility routes clear, front-of-house briefed on the ROS |
| **Show** | Per cue block | Production lead confirms each block against the ROS; deviations logged, not improvised |
| **Strike** | After clearance | Equipment accounted for against the load-in manifest, rentals checked out before the truck leaves |

**The strike manifest is the load-in manifest.** Count on the way in, count on the way out. Rentals left on site are invoiced at loss.

### 5.3 Post-show wrap

Within 72 hours of strike:

- **Debrief** — what worked, what did not, what nearly failed. Blameless, specific, and it feeds the next ROS.
- **Invoice triggers** — headcount actuals vs. quoted, rental shortfalls, overtime hours, damage claims. Capture while the evidence exists.
- **Thank-you and forward look** — personalised, referencing what the attendee actually did, not a broadcast.
- **Asset archiving** — recorded content, photography, final ROS, run sheets, and the vendor contact list with performance notes, filed where the next production can find them.
- **Vendor performance note per vendor** — this is the input to §4's escalation tiers for the next event. A vendor who delivered three times running is not escalated on the first silence.

### 5.4 Post-event reporting

Performance tiers: **Exceeded** (beat goal by 10%+ on primary metrics), **Met** (within 10%), **Missed** (more than 10% below on one or more), **Mixed** (hit some, missed others — say which and why).

Report structure: performance summary → what worked (with evidence) → what did not (with likely cause) → key insights (each tied to a data point) → specific recommendations for the next event → sponsor ROI if applicable.

Channel attribution is **inherently imperfect** — most attendees meet several touchpoints before registering. Report it honestly, acknowledge mixed sources, and never over-credit a single channel.

---

## 6. Verification

- [ ] Every event is classified into a phase (Normal / Planning / Advance / Load-In / Show Day) and that classification is stated, not assumed.
- [ ] Urgency thresholds are applied relative to event proximity, not absolute days.
- [ ] Every BLOCKED item names our team as owner — no BLOCKED item is left attributed to a vendor.
- [ ] Technical execution questions were routed to `godmode-eventtech` / `bdbmediastorm` rather than answered from this skill.
- [ ] No signal-flow, protocol, hardware-limit, or cue-execution instruction was issued from this skill.
- [ ] COI, permits, and crew credentials are confirmed before load-in, per vendor.
- [ ] The run-of-show is versioned, distributed, and owned by the production lead.
- [ ] Speaker materials are checked against the D-30 / D-21 / D-14 / D-7 / D-1 framework.
- [ ] Banned fluff words are absent from every bio, abstract, and session description.
- [ ] On show day, no vendor follow-up was sent by email.
- [ ] The strike manifest reconciles against the load-in manifest.
- [ ] Invoice triggers captured within 72 hours of strike.
- [ ] Attribution figures are presented with their acknowledged uncertainty.
- [ ] No upstream script, Python file, or Composio tool dependency was added.
