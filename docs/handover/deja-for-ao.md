# deja for AO — session-memory handover

AO (the Go daemon shipped as `@hybridlabor-api/bdb-agent-orchestrator`, binary at `~/.local/bin/ao`) can ask deja — the local session-memory engine installed together with memB by the AOS installer — for project history. This document lists the surfaces AO may call and the two things it must not do. Every command below is verified against deja-vu 0.21.1.

## What AO calls at session start

Run in the project directory:

```sh
deja wip --json
```

The answer is what the last session in that directory was doing (deja-vu docs/json-output.md:1192-1223):

```json
{
  "schema_version": 2,
  "session": "ses_fb76fff…",
  "harness": "opencode",
  "asked": "the orders worker is exhausting its database connections under load",
  "decision": "bound every orders-worker query with a context",
  "files": ["internal/worker/orders.go"],
  "command": "go test ./internal/worker/...",
  "command_failed": true,
  "lines": ["working on: …", "settled: …"]
}
```

- `schema_version: 2` is the only guaranteed field. Every other field is optional and omitted when the transcript does not carry it — treat all of them as nullable.
- `lines` is the inject-verbatim form: one string per fact, in display order. A caller that wants to show the digest reads `lines` and does not re-assemble the fields.

## Untrusted historical data

Everything deja returns is transcript-derived and may carry text an attacker influenced: a directive copied from a web page persists in the index and replays into later sessions. deja-vu wraps its own agent-facing recall in `<deja-recall>` markers with an untrusted-data preamble (deja-vu docs/SECURITY-MODEL.md:235-245). AO must label or wrap the content the same way before it reaches a model, and instructions inside it must not be followed.

## Other surfaces AO may use

- `deja fix "<error>" --json` — what this machine ran after that error. Rows carry `command` or `edit`; `candidate: true` marks ran-next-but-unconfirmed evidence, not a guaranteed fix (deja-vu docs/json-output.md:763).
- `deja last --json` — recent session metadata, never message bodies (deja-vu docs/json-output.md:200).
- `deja handoff [id-prefix]` — the handoff digest for a session (deja-vu CLI reference, docs/guide/commands.html).
- `deja blame <path> --json` — which sessions discussed a file; a top-level JSON array, no envelope (deja-vu docs/json-output.md:1107).
- `deja doctor --json --offline` — index and store health; `--offline` keeps the version check off the network (deja-vu docs/json-output.md:356).

## Stability contract

Envelope-shaped answers carry `schema_version: 2`. Within a version, changes are additive only: existing field names, types and meanings stay the same. Bumping the version signals a breaking change, so branch on `schema_version` before parsing the rest of the envelope (deja-vu docs/json-output.md:7-28). `deja blame --json` returns a bare array and carries no version; its element shapes are stable.

## Hard rules

- Never read `~/.cache/deja/index.db` or anything else inside the index directory (`manifest.gob`, `sessions.gob`, `records.bin`, the buckets, the sidecars) directly. The format has moved forty-odd times and is explicitly not a contract (deja-vu docs/INTEGRATING.md:102-106). Use the CLI surfaces above.
- AO must NOT run `deja install --auto` and must not wire session-start auto-recall. The approved AOS plan rules both out (production_artifacts/approved_plan_deja.md:61-66): a second writer into agent configs, and old history injected automatically at every session start, are exactly the injection vectors AOS installed deja to avoid. AO calls the `deja` CLI itself, on demand, in the project directory.
