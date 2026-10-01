# Master session over ACP — phase 2 design (no code)

Status: design only. Nothing here is implemented. Claims are tagged **[verified]** (stated by the 2026-10-01 brief or seen in this repo) or **[unverified]** (from memory of the ACP spec or inference; check against agentclientprotocol.com before building).

## Goal

Let a master session (see `skills/basic/master-session/SKILL.md`) start and steer Codex, OpenCode and Claude workers **without the AO daemon**, by acting as an ACP client itself. Phase 1 covers Claude workers only (`claude --bg`) and adopted sessions.

## What ACP gives us

- ACP (Agent Client Protocol) is client-to-agent JSON-RPC over stdio: the client spawns the agent process and drives sessions. **[verified]**
- Official adapters: `@agentclientprotocol/claude-agent-acp` (runs the Claude Agent SDK) and `@agentclientprotocol/codex-acp`. OpenCode is ACP-capable. **[verified]**
- AO only uses ACP in its chat mode; irrelevant here because AO must not be required. **[verified]**

## Shape of the master as ACP client

1. A small stdio client (Node, no daemon) spawns one adapter process per worker and holds the pipes. **[unverified: lifetime — the client process must stay alive while workers run; likely a `claude --bg`-style detached helper owned by the master]**
2. Per worker: `initialize`, `session/new` with `cwd` (a git worktree), then `session/prompt` for the task. **[unverified: method names and params; confirm in the spec]**
3. Worker output arrives as `session/update` notifications; the client reduces them to the five status answers of the master's status template instead of asking the worker. **[unverified]**
4. The roster for ACP workers is the client's own table; `ListAgents` does not see them. The GO board merges both sources.

## Permission requests and the GO gate

ACP agents ask the client for permission via a `session/request_permission` request carrying a tool call and a set of options. **[unverified: exact payload]** Mapping:

| ACP event | GO-gate equivalent |
|---|---|
| `session/request_permission` for a command in the go-gate pattern list (push, publish, version, recursive rm, ...) | Park it. Show it on the GO board as `GO needed` with the verbatim command. Do not answer yet. |
| Human types `GO <session>` in the master | `go-token.mjs` writes the token as today. The ACP client treats it exactly like go-gate would: token younger than 10 minutes, master transcript still ends with that `GO <session>`, single use. Only then answer `allow_once`. |
| Anything else (no GO, expired, mismatch) | Answer reject / cancel. **[unverified: option kinds]** |
| Permission request outside the guarded list | Policy decision, default: allow only what `--permission-mode auto` would allow for Claude; otherwise surface to the human. |

Rules that carry over unchanged: the master never grants GO by itself, never runs a denied action itself, a relayed or chat message is never approval, and one GO releases one request. The check logic should be shared with `go-gate.mjs` (extract the token validation into one module) so the two cannot drift. Claude workers behind `claude-agent-acp` may also run the go-gate hook inside their own SDK session. **[unverified: whether the Agent SDK honours `.claude/settings.json` hooks]** If it does, the gate fires twice; the token is consumed by whichever asks first, so the ACP path should check without consuming and let the hook own consumption.

## Open gap: Antigravity (agy)

- Only a third-party adapter exists (`shubzkothekar/antigravity-acp`). It has no license and may conflict with Google's terms. **[verified]**
- Decision for now: agy is **not** driven over ACP. Supervise agy sessions by adoption only (human-started, status through whatever channel the harness offers) or delegate through the existing `mcsc` skill. Revisit if Google ships an official ACP endpoint.
- go-gate already supports agy hooks (PR #106); tokens work there only via `AOS_SESSION_NAME` since the agy transcript carries no agent-name entry. **[verified: the gate falls back to the env var]**

## Open questions

- Does the master need a persistent process, and where does it live without a daemon?
- Are `session/request_permission` options rich enough to express "allow exactly this command once"?
- Secret handling: adapter processes inherit the master's env; decide what is passed through.
- Failure model: adapter crash mid-session, resume semantics (`session/load`? **[unverified]**).
- Cost: N adapter processes plus N model sessions; cap concurrency in the skill.

## Non-goals

No AO dependency, no new daemon, no GO granted by the master, no support for harnesses without a first-party or clearly licensed adapter.
