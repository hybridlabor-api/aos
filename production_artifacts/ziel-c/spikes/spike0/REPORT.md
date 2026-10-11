# Ziel C phase 0 spike: report

Date 2026-10-06. Worker: sonnet. Result re-verified by the orchestrator: `checks/p0.sh` reports 19/19 PASS, rc 0, and no processes left behind.

## What works
- Two echo sidecars ("claude-a", "opencode-b") on 127.0.0.1 with random ports. Each serves an Agent Card at `.well-known/agent-card.json` with an HTTP bearer scheme and the skill `echo`. The process refuses to start when the bind address is not loopback.
- Each sidecar writes a registry file `sessions/<name>.json` (mode 0600; contains name, harness, pid, url, cardUrl, token, ts) and removes it on SIGTERM/SIGINT.
- `send.mjs` reads the registry, then sends `SendMessage` with the bearer token. The task ends in `TASK_STATE_COMPLETED` with an artifact attached.
- A wrong or missing token gets 401. Sending to a dead peer fails cleanly.

## SDK (@a2a-js/sdk 1.3.0, implements spec v1.0.0)
- Peer dependency: `express` only. The package is ESM-only.
- Server side: `DefaultRequestHandler`, `InMemoryTaskStore` and `AgentExecutor {execute, cancelTask}` publish through `bus.publish` and `bus.finished`. The Express side uses `jsonRpcHandler({requestHandler, userBuilder})` and `agentCardHandler`.
- Client side: `new ClientFactory().createFromUrl(origin, path)` and `client.sendMessage(req, {serviceParameters})`. `serviceParameters` are sent as HTTP headers, which is how the bearer gets through.

## Wire
- Method `SendMessage`. Params are proto-JSON. The result is `{result:{task|message}}` with `TASK_STATE_*` states. Header `A2A-Version: 1.0`.
- The JSON-RPC route accepts only `Content-Type: application/json`; `application/a2a+json` returns -32005.

## Deviations from plan v2
1. `AgentCard` has no free-form `metadata` field. Harness, model, write, mode and cwd go into `capabilities.extensions[]` as `{uri, params}` (untested). For now the harness sits in `description` and in a skill tag.
2. Auth runs as an Express middleware placed before `jsonRpcHandler`, with constant-time compare. `userBuilder` only maps token → caller, used for `ListTasks` scoping.
3. The card is public by design, so it must hold nothing sensitive.
4. Token location is still undecided: registry JSON (spike) or a separate `<name>.token` file (plan §2).

## Next (phase 1)
- Card generator from the profile, with roles as skills and an extension entry for the metadata.
- Registry module: 0700 dir, stale-PID pruning, `started` and `cwd` fields. Must handle SIGKILL leaving a stale file, and PID reuse.
- `userBuilder`, 8 KiB body cap, concurrency cap.
- Streaming (`sendMessageStream`), and the `input-required` / `auth-required` states for phase 4.

## Limits
- The two "harnesses" are labels only. No real Claude or OpenCode session was involved.
