# Trail events — `trail-event/1`

One JSON object per event, one documented endpoint, every harness. A reporting hook
must never block a tool call, so delivery is fire-and-forget: the caller does not wait
for an answer and never treats a failure as an error.

## Endpoint

```
POST http://127.0.0.1:5350/v1/events
Content-Type: application/json
Body: one event object, or an array of them
```

Responses: `204` accepted, `400` invalid (`{"error": "..."}`), `413` body over 16 KB,
`421` unexpected `Host`. Callers ignore all of them.

Probe a running hub with `GET /whoami`.

The endpoint accepts non-browser callers without an `Origin` header, but rejects any
request that carries a foreign `Origin`, and it can never produce a decision.

## Format

```json
{
  "v": 1,
  "ts": "2026-10-06T12:00:00.000Z",
  "agent": "claude|opencode|agy|codex|other",
  "session": { "id": "string<=128", "name": "string<=64 optional" },
  "cwd": "/abs/path",
  "kind": "session.start|session.end|session.stop|tool.pre|tool.post|task.update|waiting|blocker|go.request|note",
  "tool": { "name": "Edit", "detail": "src/x.ts" },
  "task": { "id": "task-id", "status": "todo|doing|done|stuck", "plan": "production_artifacts/00_execution_plan.md" },
  "file": "relative/path optional",
  "message": "<=500 chars optional",
  "ref": { "a2a_task": "optional", "gate_request": "optional" }
}
```

Rules:

- `v`, `agent`, `session.id`, `cwd` and `kind` are required; `cwd` must be absolute.
- Unknown fields are dropped. An unknown `kind` is rejected with `400` and counted.
- `ts` defaults to the receive time and must be within ±24 h of it.
- Strings are length-capped and stripped of control characters.
- `task.update` is **advisory**. It never edits a plan file. The plan file stays the
  source of truth for task status; events only carry activity and ownership.
- `go.request` is an **untrusted claim** that some agent is waiting for a GO. It never
  creates a decision and is shown without a button. Real GO requests come from the
  gate's own files.

## CLI

```bash
aos-trail emit <kind> [--agent a] [--session id] [--name n] [--cwd dir] \
  [--tool name] [--detail s] [--task id] [--status todo|doing|done|stuck] \
  [--plan file] [--file f] [--message s]

aos-trail emit --json -      # one event as JSON on stdin
```

Always exits `0`. `--agent` defaults to `$AOS_HARNESS` else `other`; `--session` to
`$AOS_SESSION_ID` or `$CLAUDE_SESSION_ID` else a stable hash of cwd+ppid; the port to
`$AGENTTRAIL_PORT` else `5350`.

```bash
# from any harness hook, no dependencies
aos-trail emit tool.post --tool Edit --file src/app.ts
aos-trail emit waiting --message "needs a GO for the push"
```

## Plain curl

```bash
curl -sS --max-time 0.3 -X POST http://127.0.0.1:5350/v1/events \
  -H 'content-type: application/json' \
  -d '{"v":1,"agent":"other","session":{"id":"manual"},"cwd":"/path/to/repo","kind":"note","message":"hello"}'
```

## Per harness

| Harness | How |
|---|---|
| Claude Code | `trail-relay.mjs --agent claude` maps the hook payload and posts here |
| Antigravity (agy) | `trail-relay.mjs --agent agy` |
| Codex | `trail-relay.mjs --agent codex` |
| OpenCode | the OpenCode plugin and mcsc call the same `lib/events.mjs` `emit()` |
| Anything else | `aos-trail emit ...` from a hook, or the one-line curl above |

## Legacy hook payload

`POST /hook` accepts the current Claude/agy/Codex hook payload unchanged and maps it
with a pure adapter:

| `hook_event_name` | `kind` |
|---|---|
| `SessionStart` | `session.start` |
| `Stop` | `session.stop` |
| `SessionEnd` | `session.end` |
| `PreToolUse` | `tool.pre` |
| `PostToolUse` | `tool.post` |
| `Notification` | `waiting` |
| `SubagentStop` | `note` |
| `TodoWrite` / `update_plan` todos | `task.update` |

An unrecognised hook name is ignored.

## A2A

The hub reads the A2A registry `~/.aos/sessions/*.json` for session discovery (name,
harness, pid, cwd) and maps A2A task states for display: `working` shows as tool
activity, `input-required` as `waiting`, `completed` as `session.end`, `failed` as
`blocker`. Nothing arriving over A2A can decide anything: an A2A message never counts
as a GO and never reaches a gate endpoint. Making the hub an A2A peer is deferred.