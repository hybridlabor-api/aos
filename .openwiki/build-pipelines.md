---
type: concept
title: Build Pipelines
description: The fabric family ships with AOS — the fabric master, fabric-graph (durable dispatcher, with a documented linear run) and fabric-multigraph (throwaway fan-out). This page explains when to use each and how they differ.
tags: [pipeline, fabric, fabric-graph, multi-agent, dispatcher, bdb-core]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-30T02:05:01.845Z
sources:
  - id: openwiki-source-ae46e931615cbc85801c4517
    resource: repo://.agents/graph.md
  - id: openwiki-source-19bcbcf197b9bb7275056749
    resource: repo://.agents/nodes.json
  - id: openwiki-source-e25c3689c6e8b0f176a23311
    resource: repo://.claude/workflows/fabric-dispatch.mjs
  - id: openwiki-source-e6b45cf8164c905c4a3b0635
    resource: repo://skills/basic/fabric-multigraph/SKILL.md
  - id: openwiki-source-ccdc0a604eb4b4fcc6ccf47f
    resource: repo://skills/basic/fabric-graph/SKILL.md
  - id: openwiki-source-9ea9c8f99f05540b8bb94bd9
    resource: repo://skills/basic/fabric/SKILL.md
generated: { by: "codex", at: "2026-09-30T02:05:01.845Z" }
---

# Build Pipelines

AOS ships the fabric skills under `category: bdb-core`. `fabric` picks the mode; otherwise pick the cheapest one that holds.

## Decision rule

Ask one question first: **do the workers need to see each other?**

- **No — independent sub-tasks** → subagents. `fabric-multigraph` or `fabric-graph` run parallel workers that each get a self-contained slice.
- **Yes — they must react to each other or claim work from a shared list** → a team. Currently only `/bdbrainstorm` qualifies.
- **Small task** → do it yourself. A two-file edit needs no pipeline at all.

"Runs in parallel" is not a reason to reach for a team — subagents already run in parallel.

Pipeline variants, cheapest first:

| Skill | What it adds | When to reach for it |
|---|---|---|
| `fabric` | Master: reads the task, picks the mode | Whenever you are unsure which mode fits |
| `fabric-graph` (linear run) | File hand-offs, no state | One project, standard BDB roles, no repair loop needed |
| `fabric-multigraph` | Throwaway 2–4 node fan-out | Any project, small graph, nothing persistent left behind |
| `fabric-graph` | Durable `state.json`, repair loop, quality gate, escalation | BDB build pipeline, or any project that needs retryable automated execution |

---

## fabric-graph linear run

Reference: `skills/basic/fabric-graph/linear.md`. There is no separate command for it.

**Flow:** Architect → TechLead (approve/reject once) → parallel build nodes (UI/UX, Engineering, Media/EventTech) → Reviewer → optional Shipping.

**Characteristics:**
- No `state.json`, no dispatcher process, no repair loop.
- Every hand-off is a file written under `production_artifacts/`.
- Whoever invokes the skill drives each step in turn.
- Shipping is the last step and is **optional** — the pipeline ends at Reviewer by default.

**Use when** the task fits the standard BDB role set and you do not need automated retries or a persistent run record.

---

## fabric-multigraph — throwaway fan-out

Entry point: `skills/basic/fabric-multigraph/SKILL.md`. Invoke with `/fabric-multigraph`.

**Flow:** Design a small graph (2–4 nodes) matched to the task → Plan node → parallel Worker nodes → optional Review node.

**Characteristics:**
- No `.agents/graph.md`, no `state.json`, no persistent files — nothing left behind after the run.
- Model-tiered by role: Opus for planning, Sonnet for review, Haiku or an external CLI for workers.
- Portable: works on any machine, does not require Antigravity, OpenCode, or Codex.
- Accepts `--skill=<name>` to inject a specific skill into the run.

**Use when** you need a quick parallel fan-out in any project without the full `fabric-graph` contract.

---

## fabric-graph — durable dispatcher graph

Entry point: `skills/basic/fabric-graph/SKILL.md`. Invoke with `/fabric-graph`.

**Contracts:**
- Graph contract: `.agents/graph.md`
- Node registry: `.agents/nodes.json`
- Dispatcher: `.claude/workflows/fabric-dispatch.mjs`
- Run state: `state.json` (written at repo root during a run)

**Flow:** Dispatcher reads `nodes.json` → routes work to registered nodes → Reviewer adversarial pass → repair loop if findings remain → automated quality gate → human escalation if no-progress guard triggers.

**Key properties:**
- **Durable:** interrupted runs resume from `state.json`.
- **Repair loop with no-progress guard:** if a repair round reports the same finding the Reviewer already flagged, the dispatcher escalates instead of repeating the cycle.
- **Reviewer is adversarial by design:** reads artifacts and the contract, never the implementer's claim that it is done. Prompted to find what is wrong, not to confirm it looks good.
- **Agents never invoke each other.** The dispatcher decides every next step; routing lives in the graph contract, never inside an agent's prompt.

**Use when** you need retryable, auditable automated execution of the BDB build pipeline.

---

## Adding a build domain to fabric-graph

Add an entry to `.agents/nodes.json`. The dispatcher reads the registry instead of hardcoding `BUILD_NODES` — adding a domain is adding a node entry, not editing the dispatcher source.
