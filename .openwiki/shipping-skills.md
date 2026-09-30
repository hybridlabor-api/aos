---
type: concept
title: Shipping Skills
description: Two engineering-method skills cover shipping — bdb-shipping-skill handles pre-build problem framing, reversibility classification, decision logging, and outcome verification; godmode-shipping runs the technical release gate (tests, CI, feature flags, rollback). Load each for its distinct job.
tags: [shipping, engineering-method, bdb-shipping-skill, godmode-shipping, adr, decision-log]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-30T02:05:01.845Z
sources:
  - id: openwiki-source-f5e5a2f7c34ff49c9a9b55e9
    resource: repo://skills/basic/bdb-shipping-skill/SKILL.md
  - id: openwiki-source-82aa9e74ac02986e1fa5eabb
    resource: repo://skills/basic/godmode-shipping/SKILL.md
generated: { by: "codex", at: "2026-09-30T02:05:01.845Z" }
---

# Shipping Skills

Two skills share the `engineering-method` category for shipping work. They are deliberately separate — one frames the decision, the other executes the gate.

## Routing table

| Task | Skill to load |
|---|---|
| Starting a significant build — framing the problem before writing code | `bdb-shipping-skill` |
| Classifying a change as one-way or two-way door | `bdb-shipping-skill` |
| Recording a significant architectural or product decision | `bdb-shipping-skill` |
| Confirming a ship actually delivered its stated value | `bdb-shipping-skill` |
| Running pre-launch checks, CI gate, WCAG, feature flags, rollback planning | `godmode-shipping` |
| Handling transient errors, rate limits, concurrent locks | `bdbresilience` |

A "significant build" is any work that takes more than one commit, touches a public contract, or requires a decision that is not immediately reversible. For a one-liner fix or a pure chore, skip `bdb-shipping-skill`.

---

## bdb-shipping-skill — pre-build framing and decision log

`skills/basic/bdb-shipping-skill/SKILL.md` · category: `engineering-method`

Fills four decision-quality gaps that neither `godmode-shipping` nor `bdbresilience` covers: problem framing, reversibility classification, decision logging, and outcome verification.

### 1. Pre-Build Problem-Framing (Pre-Flight)

Five questions to answer before the first file is written:

| Question | What a non-answer looks like |
|---|---|
| Q1 — What problem does this solve? | Cannot write one sentence → problem not understood |
| Q2 — Why now, not next sprint? | "It would be nice" is not a forcing function |
| Q3 — What is explicitly out of scope? | At least one excluded item required |
| Q4 — What does success look like, measurably? | "It works" is not measurable |
| Q5 — Is this reversible? | Leads to door classification (below) |

### 2. One-Way / Two-Way Door Classification

**Two-way doors** (proceed normally): UI changes, internal refactors, config behind a feature flag, additive-only endpoints, internal test infrastructure.

**One-way doors** (require written justification + explicit GO before executing):
- Public API contract changes
- Database schema changes (dropping columns, changing types, removing tables)
- `npm publish` / `npm version`
- Pricing or billing model changes
- Security model changes
- Removing or renaming a public CLI command or config key
- Any change that alters an external integration contract

When the classification is unclear, default to one-way. The cost of an unnecessary GO gate is one conversation turn; the cost of treating a one-way door as reversible can be irreversible.

### 3. ADR-lite Decision Log

Record every significant architectural or product decision (including all one-way doors) as a file in `docs/decisions/` or `production_artifacts/decisions/`, named `YYYY-MM-DD-<slug>.md`.

Fields: title, date, status (proposed / accepted / superseded-by), context (one sentence), options considered, decision, reversibility type + migration path, revisit trigger.

Reference the ADR from the PR description. No framework, no tool, no meeting required.

### 4. Post-Ship Outcome Loop

Define before shipping: check-back trigger (time-based or metric-based), success signal (the observable outcome from Q4), rollback signal (a named metric and threshold — not "something seems wrong"), and who checks. Post-ship check is mandatory for one-way door changes.

---

## godmode-shipping — technical release gate

`skills/basic/godmode-shipping/SKILL.md` · category: `engineering-method`

The final gatekeeper: pre-launch checks, feature-flag rollouts, WCAG accessibility, SEO, CI gate, and rollback planning. No code reaches production without passing these checks. Requires all open `blocking` findings to be resolved and an explicit GO in `state.approvals` before shipping.
