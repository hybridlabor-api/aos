---
name: agenttrail
description: >-
  Live map of a multi-agent build in the browser: which plan component is being
  worked on, by which agent or harness, what is done and what is stuck. Use when
  a multi-agent pipeline starts (/startcycle, /startcycle-graph,
  /teamwork-preview) or after a plan-canvas approve, or when the user asks to
  see what the agents are doing.
category: bdb-core
metadata:
  version: "0.2.0"
  origin: sodiumsun/agenttrail@e4ba2da
  license: MIT
---

<!-- Source: sodiumsun/agenttrail bin/agenttrail.mjs + public/index.html — MIT, see THIRD_PARTY_NOTICES.md -->

# agenttrail — live pipeline map

agenttrail serves a browser board that mirrors a multi-agent build in real time: which plan component is being worked on, by which agent or harness, what is done and what is stuck. It observes only — it never runs agents and never marks tasks done.

## Start the map

```bash
aos-trail . --plan production_artifacts/00_execution_plan.md --no-open
```

It prints the URL (default http://localhost:5330, next free port if taken). Open that URL for the user. If running inside AO (env var `AO_BROWSER_CAPABILITY` is set), run `ao preview <url>` so it shows in AO's Browser tab. Without a plan file, start it with just `aos-trail .` — it then shows file activity only.

## Plan convention

The plan file uses components and tasks:

- `## Plain-language name {#id}` = a component (5-9 per plan), stable ids
- under it optional lines: `needs: [id, id]`, `links: [id]`, `files: [src/**]`, `url: production_artifacts/00_architecture.html`
- tasks: `- [ ] Outcome {#task-id}`; mark `[~]` BEFORE starting, `[x]` when done, `[!]` when stuck, and add an indented `by: <agent>` line (claude, codex, agy, opencode)
- save the file immediately after each status change; never batch updates to the end
- Mermaid blocks and prose may stay in the file; the map ignores them.

## Live agent events

The AOS installer registers `.claude/hooks/trail-relay.mjs --agent <harness>` for Claude Code (PreToolUse, PostToolUse, SessionStart, Stop, SubagentStop), Antigravity and Codex (PreToolUse, Stop). The OpenCode plugin and mcsc (for the CLI workers it delegates to) post events directly. Events are fire-and-forget (300 ms cap) and never block a tool call; with no map running they are dropped.

A component's `url:` may be a path under `production_artifacts/` — the map serves that folder, so e.g. `url: production_artifacts/00_architecture.html` opens the archify diagram from the card.

## Stop

The daemon runs until its terminal/process ends; `aos-trail up` relaunches saved boards.

## Rules

- Never create a root `PLAN.md` in a user repo during an AOS pipeline — always point at the pipeline's plan with `--plan`.
- Never mark `[x]` without evidence in the code.
