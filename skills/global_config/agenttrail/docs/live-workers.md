# Why workers do not show up live on the map

Root cause audit of node attribution for multi-agent runs, as of `feat/trail-workers`.
The contract: attribution arrives in two forms — `AOS_TRAIL_NODE` env stamped by a
dispatcher (primary, wins) or a `[trail-node:<id>]` marker inside the worker's prompt/brief
(fallback). Events without one of these have no node and stay invisible on the plan.

## The flow

1. A hook/plugin relays a raw payload to the daemon at `/hook`.
2. `.claude/hooks/trail-relay.mjs:82-84` stamps `ev.task = { id: <node>, status: 'doing', plan }`
   **only from `process.env.AOS_TRAIL_NODE`**. If the env var is missing, nothing is stamped.
3. `skills/global_config/agenttrail/lib/events.mjs:140` (in `fromLegacyHook`) keeps a `task`
   only if the relay already put one on the payload. No marker scanning anywhere.
4. `sessions.mjs:66-67` turns a relayed task into `s.currentTask` (any non-stop event),
   and `hub-model.mjs:106-116` (`liveTasksFor`) shows it live only when
   `task.plan` resolves to the instance's plan file — so `AOS_TRAIL_PLAN` matters too.

## (a) Claude Code subagents (Agent tool / Workflow script)

- The relay's only attribution source is the *env of the hook process*: `trail-relay.mjs:81-84`.
  A subagent's hooks run in the CLI process env, not the dispatcher's shell. Exporting
  `AOS_TRAIL_NODE` in the dispatcher shell before `claude` starts stamps the whole CLI
  (dispatcher + every subagent) with one node — cluster attribution, not per-node.
- Per-subagent env is not passed with the Agent tool call, so a Workflow script that marks
  nodes via env has no per-worker channel (unverified whether any Claude Code version
  forwards custom env into subagents).
- `SubagentStart` / `PreToolUse(Task)` payloads carry the subagent prompt in `tool_input`
  (exact field lay-out unverified per CC version), but `fromLegacyHook` (`events.mjs:100-147`)
  never reads a prompt for node ids. Result: no `task`, no node, no worker card.

## (b) OpenCode workers (`opencode run`)

- `.opencode/plugins/bdb-aos.js` relays telemetry via `postTrail` with the payloads built at
  `trail()` (line ~356) and `PreToolUse` at line ~468. Nothing there reads
  `process.env.AOS_TRAIL_NODE` (the env var the dispatcher may legitimately set when
  launching `opencode run`) and nothing scans the first user message for
  `[trail-node:<id>]`, even though `chat.message` already captures the prompt text into
  `s.prompt` (line ~438 region).
- So a worker launched with the env set or with a marked brief relays
  `session.start`/`tool.pre`/`tool.post` events that carry no `task` — the session appears
  in the session list but never on its plan node.

## (c) Plain shell workers

- No hooks run at all. Attribution can only come from an explicit
  `aos-trail emit task.update --task <node> --plan <file>` per event
  (SKILL.md:56). A worker that emits nothing shows nothing — expected — but the common
  wrap-`sleep`-run loop never sets `AOS_TRAIL_NODE` in a place any consumer reads it
  (`trail-relay.mjs` is hook-only; the plugin reads its own env). There is no
  shell-worker fallback that turns `AOS_TRAIL_NODE` + commands into a heartbeat.

## Fix implemented in this branch

- Marker path: `trail-nodeFromText` / `stampTrailNode` in `lib/events.mjs` — the relay scans
  the raw hook payload and the OpenCode plugin scans the first user message, so
  `[trail-node:<id>]` anywhere in a brief attaches that worker to node `<id>`.
  `AOS_TRAIL_NODE` remains primary and wins when both exist (`events.mjs` stamping rule).
- Worker card: `liveTasksFor` returns a `workers` array per task
  (name, harness, model if known, state, last file + seconds since), rendered as chips in
  the hub task rows (`public/hub/app.js`) — same components, new attribute.
- Ticking: `aos-trail tick <plan-file> <task-id>` flips exactly the `- [ ]` line carrying
  `{#task-id}`; the map reloads the plan file (fs watcher) and the node turns done/green.
