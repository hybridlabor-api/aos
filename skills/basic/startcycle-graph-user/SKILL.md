---
name: startcycle-graph-user
description: Use when a task needs a small, throwaway multi-agent fan-out (a couple of parallel workers plus a review pass) in ANY project, without the full /startcycle-graph contract — no .agents/graph.md bootstrap, no state.json schema, no persistent files. Model-tiered by role (opus plan, sonnet review, haiku or an external CLI for workers) and portable across machines that may not have Antigravity/OpenCode/Codex installed.
category: bdb-core
---

# ⚡ Light Graph — disposable multi-agent fan-out

`/startcycle-graph`'s dispatcher graph is a permanent, project-scoped contract: seven
fixed BDB roles, a `state.json` schema, a repair loop, a Stop-hook gate. That's
the right tool for the BDB build pipeline — and the wrong tool for "spawn me 3
workers for this one thing right now" in a project that has never heard of
`.agents/graph.md` and never should. This skill is that lighter tool: a graph
sized to the task in front of you, run once, nothing left behind.

## 1. Design the graph — you do this, before touching any tool

Read the task. Decide how many nodes it actually needs — most tasks need 2 to
4, not seven:

- **Plan** (always, even if it's one line): what are the parallel workstreams,
  and what does "done" look like for each.
- **Workers** (1 to N, run in parallel): the actual fan-out. If the task
  doesn't parallelize, this is one node, not several for appearance's sake.
- **Review** (usually, skip only for genuinely trivial work): one adversarial
  pass over the workers' output before you call it finished.

Do not invent more structure than the task has. A two-file edit doesn't need
a Plan node — just do it. This skill is for the cases actually shaped like a
small graph, not an excuse to always draw one.

## 2. Detect what's available — before deciding how workers run

```bash
command -v agy      >/dev/null 2>&1 && echo agy
command -v opencode  >/dev/null 2>&1 && echo opencode
command -v codex     >/dev/null 2>&1 && echo codex
```

This machine may have none of these — the skill (and whoever installed this
package) cannot assume Antigravity, OpenCode, or a Codex plugin connector is
present. Pick the worker path in this priority order, first one found wins:

1. **agy present** → workers run via `agy-job start --tier flash [--yolo] "<task>"`
   (or `pro` for harder reasoning) — see the `antigravity` skill for the exact
   invocation pattern and cost discipline. Separate compute pool, zero
   Anthropic tokens for the work itself.
2. **opencode present** → route worker tasks through it the same way (its own
   subagent/session primitive), if the project already uses it.
3. **codex present** → same idea, via the Codex CLI's own task-delegation
   surface if this project has that plugin wired up.
4. **none present** → fall back to Claude Code's own `Agent` tool for each
   worker, with an explicit `model: "haiku"` override. This is the only path
   that costs Anthropic tokens for the worker step, and the only one
   guaranteed to exist everywhere — it is the floor, not the default.

**This decision happens here, in your own turn, via Bash — never inside a
`Workflow` script.** A `Workflow` script's body has no shell or filesystem
access (ambient `agent()`/`pipeline()` globals only), so it cannot itself
check `command -v` or shell out to `agy-job`. If you reach for the `Workflow`
tool for the worker step, that already means you're on the haiku fallback
path (case 4) — cases 1-3 are driven directly from your own Bash calls, no
`Workflow` tool involved.

## 3. Model tiers — fixed by role, not by whatever the session happens to be set to

| Role | Model | Why |
|---|---|---|
| Plan | `opus` | Mistakes here propagate to every worker; the one place worth paying for. |
| Workers | `haiku` (fallback path) or external CLI (agy/opencode/codex) | Mechanical execution once the plan is concrete. Never sonnet/opus for this. |
| Review | `sonnet` | Needs real judgment to be adversarial, not full Opus reasoning. |

Force these explicitly on every `Agent`/`agent()` call (`model: "opus"` /
`"haiku"` / `"sonnet"`) — do not let a node inherit the main session's current
model. If the user has the session set to Opus for everything, a worker node
that silently inherits that is the exact waste this tiering exists to avoid.

## 4. Run it, once

- Plan node: one call, produces the concrete work-list for the worker nodes
  (file-level or task-level, whatever the task needs).
- Worker nodes: fan out per step 2's chosen path, in parallel where the tasks
  are actually independent.
- Review node: one adversarial pass ("find what's wrong," not "does this look
  good") over the combined worker output, sonnet-tier.
- Report the outcome directly to the user. Nothing gets written to
  `.agents/`, no `state.json`, no persistent contract — this graph existed for
  the duration of the task and is gone once it's done.

## 5. When to reach for `/startcycle-graph` instead

If the task turns out to actually need the full pipeline — multiple build
domains (UI/UX, Engineering, Media/EventTech), a real repair loop with a
no-progress guard, or a durable record of what happened for future
sessions — stop and use `/startcycle-graph`, not this. This skill is deliberately
too small for that job; don't stretch it to cover what the real dispatcher
graph (`.agents/graph.md`) already does properly.

## 6. Common Rationalizations

| Rationalization | Reality |
|---|---|
| "agy is on my machine, so it'll be on everyone's." | It won't. Always run the detection step; never hardcode a tool as present. |
| "The session is already on Opus, so the worker call inherits it fine." | That's exactly the cost this skill exists to avoid — force the tier explicitly every time. |
| "This task has one obvious step, but a 3-node graph looks more thorough." | More nodes than the task needs is overhead, not rigor. Size the graph to the work. |
| "I'll just call the Workflow tool and let the script figure out which backend to use." | The script can't — it has no shell access. That decision is yours, before the Workflow call, or not via Workflow at all. |

## 7. Red Flags

- Any worker node running on sonnet/opus without a specific reason forced by the task.
- Assuming agy/OpenCode/Codex is present without checking.
- Writing `.agents/`, `state.json`, or any persistent file for a task this skill was invoked for — that's `/startcycle-graph`'s job, not this one's.
- A "light" graph with more nodes than the task actually has independent workstreams.

## 8. Verification

- [ ] Detection step actually ran (`command -v` checks), not assumed.
- [ ] Each node's model was explicitly forced, not inherited.
- [ ] Nothing persistent was left behind after the task completed.
