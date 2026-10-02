# Master session over ACP — phase 2 (implemented)

Status: `bin/aos-acp.mjs` ships. Facts below are tagged **[verified]** (checked against the ACP v1 schema, the adapter repos, or a live run on 2026-10-01) or **[open]**.

## Goal

Let a master session (`skills/basic/master-session/SKILL.md`) start and steer Codex, OpenCode and Claude workers **without the AO daemon**, by acting as an ACP client itself. The AO daemon stays optional.

## Protocol facts used

From `schema/v1/schema.json` + `meta.json` of agentclientprotocol/agent-client-protocol **[verified]**:

- Agent methods: `initialize` (`protocolVersion: 1`, `clientCapabilities`), `session/new` (`cwd`, `mcpServers` — both required; result `sessionId`), `session/prompt` (`sessionId`, `prompt: ContentBlock[]`; result `stopReason` ∈ `end_turn | max_tokens | max_turn_requests | refusal | cancelled`), `session/cancel` (notification).
- Client methods: `session/update` (notification; `update.sessionUpdate` ∈ `agent_message_chunk | agent_thought_chunk | tool_call | tool_call_update | plan | available_commands_update | usage_update | ...`, text in `update.content.text`), `session/request_permission` (request; `toolCall {toolCallId,title,kind,rawInput}`, `options [{optionId,name,kind: allow_once|allow_always|reject_once|reject_always}]`; answer `{outcome:{outcome:'selected',optionId}}` or `{outcome:{outcome:'cancelled'}}`), plus `fs/*` and `terminal/*`, which `aos-acp` does not advertise and answers with `-32601`.

## Adapters

| Harness | Command | Live smoke (`reply with OK`, temp dir) | Inner AOS gate | Token consumed by |
|---|---|---|---|---|
| opencode | `opencode acp --cwd <dir>` (opencode 1.18.30) | **[verified]** `OK`, `end_turn` | OpenCode plugin `bdb-aos.js` (loads in ACP mode; `--pure` would disable it) | plugin (`aos-acp` verifies only) |
| claude | `npx -y @agentclientprotocol/claude-agent-acp` (Apache-2.0) | **[verified]** `OK`, `end_turn` | the user's Claude Code hooks run inside the SDK session — `go-gate` blocked a `git push` **[verified]** | hook (`aos-acp` verifies only) |
| codex | `npx -y @agentclientprotocol/codex-acp` (Apache-2.0, v2.1.0) | handshake **[verified]**; `session/new` → `-32000 Authentication required` (no `OPENAI_API_KEY`/ChatGPT login on this machine) **[open]** | none | `aos-acp` |
| agy | — | — | go-gate via `hooks.json` (name from `AOS_SESSION_NAME`) | — |

agy: the only adapter is third-party `shubzkothekar/antigravity-acp` (MIT). Its README quotes Google's Antigravity terms ("using third party software ... to access the Service ... is a breach") and warns of account suspension **[verified]**. Not shipped; `aos-acp agy` exits 2 and points to the `mcsc` skill. Revisit if Google ships an official ACP endpoint.

## Permission requests and the GO gate

`session/request_permission` → `decidePermission()` in `bin/aos-acp.mjs`:

| Case | Answer |
|---|---|
| `rawInput.command` matches the go-gate list (`git push`, `npm publish`, `npm version`, `gh pr merge`, `gh release create`, `git reset --hard`, `git clean -f`, recursive `rm`) | `allow_once` only if `tokenGrantsGo(name)` (imported from `.claude/hooks/go-gate.mjs`: `~/.aos/go/<name>.token`, < 10 min, names this worker, master transcript still ends with `GO <name>`). `--go-wait <sec>` polls for the token and logs `permission_pending` meanwhile — that is the `GO needed` row on the GO board. Otherwise `reject_once`. |
| anything else | `--allow-default deny|allow` (deny). |
| no option of the wanted kind | `allow_always`/`reject_always` as fallback, else `cancelled`. |

Rules that carry over unchanged: the master never grants GO, never runs a denied action itself, a relayed or chat message is never approval, one GO releases one request.

Double gate: opencode and claude workers also run their own AOS gate inside the agent process, and `aos-acp` passes `AOS_SESSION_NAME=<name>` so that gate finds the same token. Only one side may delete the token, so `aos-acp` defaults to `--no-consume` for those two and `--consume` for codex; override with the flags. The OpenCode plugin (`.opencode/plugins/bdb-aos.js`) accepts the token (name from `AOS_SESSION_NAME`, else the session title) with the same rules, copied inline because the plugin is installed as a single file.

## Run log

`~/.aos/acp/<name>.jsonl` (override `--log`): `start`, `send`, `initialized`, `session`, `text`, `tool_call`, `tool_call_update`, `permission_pending`, `permission`, `done`, `error`, `agent_stderr`. The master builds its roster and GO board for ACP workers from these files; `ListAgents` does not see them.

The same run is also posted to agenttrail with mcsc's protocol (`mcps/mcsc/packages/core/src/trail.js`): `SessionStart` and `SessionEnd` (session id `aos-acp-<pid>-<ms>`, agent `<adapter>:<name>`), and `PreToolUse` / `PostToolUse` per ACP `tool_call` / `tool_call_update` (`tool_name` from the ACP `kind`, `tool_input.file_path` from `locations`, `tool_input.command` from `rawInput`). Best effort, 300 ms per port, `AGENTTRAIL_PORT` overrides the 5330 to 5344 scan.

## Open points

- Codex live run not verified (auth). With `OPENAI_API_KEY` or a ChatGPT login it should pass the same smoke.
- The Claude token path end to end needs the installed `~/.claude/hooks/go-gate.mjs` to be the version with `tokenGrantsGo` (installer copies it); the copy on the test machine predates it, so the live chain was only verified up to "the hook fires inside the SDK session".
- OpenCode token path end to end needs the installed plugin updated; verified by unit test only.
- Neither live adapter sent `session/request_permission` for a shell command in the smoke runs (the inner gate answered first); the mapping is covered by the fake-agent tests.
- One `aos-acp` process per worker; no resume (`session/load`) and no concurrency cap yet.

## Bus (spike): messaging a hand-started OpenCode session

A master can drop a message into a running OpenCode session (no `--port`, no restart). OpenCode only.

- **Paths:** registry `~/.aos/bus/sessions/<name>.json` (0600), inbox `~/.aos/bus/inbox/<name>/` (0700), one `<ms>-<rand>.json` per message. `<name>` is `slug(AOS_SESSION_NAME)`, else the OpenCode session id. The inbox path is always derived from the name, never from the registry file.
- **CLI:** `aos-bus send <name> <text...> [--from x] [--wake]`, `aos-bus list`. Exit 2 with a reason on refusal (unregistered or dead pid, inbox not a private real dir owned by you, text over 8 KiB).
- **Injection:** the plugin polls the inbox every 1 s and calls `client.session.prompt` with `noReply: true` (`false` with `--wake`) and one text part `[aos-bus from <from>] <text>`, `synthetic: true`, `metadata.aos_bus`. The API has no non-user message, so the stored row is `role: user`; exclusion from GO rests on the part flag.
- **GO exclusion (3 layers):** `synthetic: true` (existing `!synthetic` filters in `chat.message`, the `session.messages` fallback and `opencodeLastUser`); the `[aos-bus from ...]` prefix, so the text can never be `GO` or `GO <name>`; the plugin clears its cached prompt before each injection and returns early from `chat.message` for all-synthetic messages.
- **Fail-closed side effect:** a bus message becomes the newest user row, so the last human `GO` no longer opens that session's gate, and a pending OpenCode-issued `GO <worker>` token for it is invalidated. The human re-types GO.
- **Delivery rules:** only the registered owner (pid + session) polls. Each file is claimed by renaming `<x>.json` to `<x>.inflight` before the prompt, so a message is delivered by at most one process; a failed claim means someone else has it. Success deletes the claim. A busy session gets the file renamed back to `.json` and retried every tick for up to 10 min counted from the first busy attempt (`AOS_BUS_BUSY_MAX_MS`), then `.failed`. A prompt not finished within 10 min (`AOS_BUS_PROMPT_TIMEOUT_MS`) is parked as `.timeout`: the prompt is not aborted, so delivery state is unknown and it must not be resent blindly. Any other error parks the file as `.failed` (not delivered).
- **Smoke:** `tests/aos-bus-smoke.sh` (opt-in, isolated HOME/XDG, `opencode serve`).
  - **[verified]** `synthetic: true`, prefix and `metadata.aos_bus` persist in `opencode.db`; no token file; `tokenGrantsGo` rejects a token pointing at the bus message.
  - **[open]** TUI mode (toast, plugin client without `--port`), `--wake` (needs model credentials), real busy-session behaviour.
- **Out of scope:** Claude Code receivers (native `SendMessage`), Codex/agy, AO daemon, slash commands, agenttrail roster, replies/acks/expiry, `fs.watch`, authenticating `from` beyond file-owner uid.
