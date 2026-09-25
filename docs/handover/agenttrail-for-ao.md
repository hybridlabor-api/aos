# agenttrail for AO — waiting questions & GO/Nein handover

AO (the Go daemon shipped as `@hybridlabor-api/bdb-agent-orchestrator`, binary at `~/.local/bin/ao`) can mirror what the agenttrail live map shows: an agent that waits on the human appears as a question with GO / Nein, and AO surfaces "Needs you" in its own UI — then types the human's decision into the waiting session (approved_plan_go.md:25, :57). agenttrail is the live-map daemon vendored into AOS at `skills/global_config/agenttrail/bin/agenttrail.mjs`, run as `aos-trail`; one daemon per repo, bound to 127.0.0.1 only. This document lists the HTTP surfaces AO may call and the things it must never do. The ask/answer endpoints are the AOS patch defined in production_artifacts/00_execution_plan.md ({#ask-engine}, lines 8-13) and production_artifacts/approved_plan_go.md; `/whoami` and `/model` already exist in the vendored daemon (agenttrail.mjs:583-584, :674-675).

## What AO calls

### 1. Find the repo's daemon — `GET /whoami`

Probe `http://127.0.0.1:5330` through `5344` and match `repoPath` against the repo AO is working in — the same pattern the daemon itself uses for boot dedup (agenttrail.mjs:733-741):

```sh
curl -s http://127.0.0.1:$p/whoami
# {"project":"aos","port":5330,"repoPath":"/path/to/project-repo"}
```

Stop at the first match. If no daemon answers there is nothing to mirror — do not spawn a daemon from AO; the asker's CLI already prints `start: aos-trail . --plan …` on stderr (00_execution_plan.md:5). The `AGENTTRAIL_PORT` env var pins a single port and wins over the probe range (agenttrail.mjs:91).

### 2. Read open questions — `GET /model`, `GET /ask/<id>`, `GET /events`

- `GET /model` carries `asks`: one object per question `{id, question, askedBy, askedAt, expiryAt, status: 'pending' | 'go' | 'deny', decidedAt, by, expired}`. Show every ask, oldest first (`askedAt` ascending — approved_plan_go.md:36).
- `GET /ask/<id>` returns one ask plus the last 10 decisions — the "wer · wann · was" log (00_execution_plan.md:13).
- `GET /events` is the SSE stream; activity ticks carry `asks` too (00_execution_plan.md:10), so AO can mirror live instead of polling.

A pending question past `expiryAt` flips to `status: 'deny'` with `expired: true` — render it greyed out (abgelaufen), never as a live GO/Nein pair (00_execution_plan.md:52).

### 3. Answer — `POST /answer`

```sh
curl -s -X POST http://127.0.0.1:$port/answer \
  -H 'Content-Type: application/json' \
  --data '{"id":"<ask-id>","decision":"go"}'   # or "deny"
```

- The `content-type` header must be exactly `application/json` — a missing or different header (`text/plain`, JSON with a charset suffix) is rejected (00_execution_plan.md:13).
- The body `{id, decision}` is capped at 4 KB.
- `origin`: browser callers always send it, and it must equal the daemon's own `http://localhost:<port>` or `http://127.0.0.1:<port>`; AO is a local non-browser caller and may omit the header entirely (00_execution_plan.md:51 — the curl above does). If AO sends an `origin`, it must be the daemon's own.
- A valid answer sets the ask's status + `decidedAt` + `by: 'you'` and appends `{question, decision, by, at}` to the timestamped decision log; timeout denials land there too, as `by: 'timeout'` (00_execution_plan.md:13).
- The daemon binds 127.0.0.1 only (agenttrail.mjs:700) and sets no `Access-Control-*` header and no `OPTIONS` handler anywhere in its route chain (agenttrail.mjs:572-689) — that absence is the CSRF protection for the map's browser buttons. AO must not ask for CORS to be relaxed.

That is the whole surface: AO does not call the daemon's other mutating endpoints (`/spawn`, `/setup`, `/setup-board`, `/hook`) and never writes into the repo — the daemon itself never touches the repo; state lives under `~/.agenttrail` (agenttrail.mjs:307).

## What the answer means

`aos-trail ask "<question>"` blocks until the question is answered or expires and exits 0 on go, 1 on deny/timeout (00_execution_plan.md:5). The default deadline is 30 minutes, overridable per question via the asker's `--timeout <10s|30m|2h|N>`; expiry auto-denies and is logged like a human decision (00_execution_plan.md:52). Questions and the decision log persist across daemon restarts in `~/.agenttrail/<repo-hash>.json` (agenttrail.mjs:308).

## Mirroring in AO's UI

- Pending ask → a pinned "Needs you" card with the question, the asking agent (`askedBy`), elapsed time, and one GO and one Nein button.
- AO answers `POST /answer` only after the human clicked or said the decision for that exact ask id, and only then may it type that decision into the waiting session (approved_plan_go.md:57 — AO already recognizes "Needs You GO" and can write to the terminal, :25).
- Re-check `GET /ask/<id>` immediately before typing: the human may have answered on the map instead, or the question may have expired meanwhile.

## Hard rules

- The AO button never authorizes `git push`, `npm publish`, `npm version` or recursive `rm` (approved_plan_go.md:30). Those four stay under go-gate's sole authority (`.claude/hooks/go-gate.mjs:43-49`), which opens only for the literal, human-typed `GO` as the last message in the session transcript (go-gate.mjs:10-13, transcript-only check in main() :116-151). The ask/answer flow only resolves explicit `aos-trail ask` questions and never writes to any session transcript — the map and AO remain "an observer and an answer relay, never a permission system" (00_execution_plan.md:50, approved_plan_go.md:49).
- Never answer without the human. No batching, no defaults, no "the agent seemed sure" — one answer per explicit human decision, per question id.
- Never auto-retry a timed-out question. Expiry → deny is final (`by: 'timeout'` in the log); only the human asking again starts a new question (approved_plan_go.md:57; the same "no silent retries / a fresh GO per action" rule the gate runs on, go-gate.mjs:13).
- Never read `~/.agenttrail/<repo-hash>.json` or anything else inside `~/.agenttrail/` directly (agenttrail.mjs:307-308). Those files are internal state with no format contract — use the HTTP surfaces above.
- Keep the CSRF contract intact: exact `Content-Type: application/json`, own-or-absent `origin`, and never relay an answer through web content the agent loaded.
