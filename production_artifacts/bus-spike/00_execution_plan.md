# Bus spike: master → running OpenCode session

Branch `feat/bus-spike` (base `feat/master-session-skill`, PR #111). Spike, minimal. OpenCode only.

**Goal:** a master session drops a message into an inbox file. The AOS OpenCode plugin, already loaded in a running OpenCode TUI (no `--port`, no restart), picks it up within 2 s and injects it into that session as a **synthetic** part. A bus message can never act as a human `GO`.

## Verified facts this plan relies on

- **Injection call** (`@opencode-ai/sdk` 1.18.29 types in `~/.config/opencode/node_modules`, v1 client = `PluginInput.client`):
  - `client.session.prompt({ path:{id}, query:{directory}, body:{ noReply?: boolean, parts: TextPartInput[] } })`.
  - `TextPartInput` has `synthetic?: boolean`, `ignored?: boolean`, `metadata?: {[k]: unknown}`.
  - The API has **no non-user message**. `session.prompt` always stores a `role: "user"` message. So exclusion has to be done through `synthetic: true` on the part, not through the role. `noReply: true` stores the message without starting an assistant turn.
  - The plugin already uses `client.session.prompt` for the #68 graph nudge, so there is precedent.
- `client.tui.showToast({ body:{ title?, message, variant } })` exists. It is a best-effort, human-visible notice, because the TUI may hide synthetic parts.
- **Existing go-gate paths already skip `synthetic` parts:**
  - plugin `chat.message`: `fullText` filters `!p.synthetic`. That text feeds `s.prompt` and `issueGoToken`.
  - plugin fallback `client.session.messages`: filters `!p.synthetic`.
  - `go-gate.mjs` `opencodeLastUser()`: the SQL over `part.data` filters `!p.synthetic`.
  - **Result:** if `synthetic: true` persists in `opencode.db`, no go-gate code change is needed. The live smoke must prove that it persists.
- **agenttrail** (`skills/global_config/agenttrail/bin/agenttrail.mjs`):
  - Its session list is the in-memory `runs{}` map. It is fed by HTTP hook POSTs to a per-repo daemon on ports 5330–5344 and persisted in that daemon's repo-scoped state file.
  - **Decision:** do not extend it. Delivery would then depend on an optional, per-repo daemon being up, and its run ids are not addressable names.
  - Use a tiny `~/.aos/bus/sessions/<name>.json` registry instead. agenttrail can read that registry later (out of scope).

## Design (one new file + plugin edit)

- **`.claude/hooks/aos-bus.mjs`** holds both sides. The installer already copies all of `.claude/hooks/` to `plugins/aos-hooks/` (installer.js:3781), so the plugin imports it like the other hooks.
  - It is both a library and a CLI, using the `isMain` pattern from `go-token.mjs`.
  - `bin: "aos-bus"` goes into package.json.
  - Why not extend `aos-acp`: it is an ACP-spawn client, and bolting `send` onto it is unnatural.
- **Paths:**
  - Registry: `~/.aos/bus/sessions/<name>.json` (0600, dir 0700), contents `{name, harness:"opencode", pid, cwd, sessionID, inbox, ts}`.
  - Inbox: `~/.aos/bus/inbox/<name>/` (0700). One file per message: `<ms>-<rand>.json` = `{v:1, from, text, ts, wake?}`.
- **Name:** `slug(AOS_SESSION_NAME)` if set, else the OpenCode `sessionID`.
  - Titles are not used because they change after the first message.
  - The same env var already names the session for GO tokens.
  - With `AOS_SESSION_NAME` set, the most recent root session in the process claims the name.
- **Defense in depth against GO:**
  1. The part is `synthetic: true` with `metadata.aos_bus = {from, uid, ts}`.
  2. The text is always prefixed `[aos-bus from <from>] `, so it can never equal `GO` or match `^GO\s+`, even if a future OpenCode drops the flag.
  3. The existing `!synthetic` filters (above).
- **Known side effect (fail-closed, documented):**
  - A bus message is the newest `role:user` row, so after it the last human `GO` no longer opens that session's gate.
  - In a master session, it also invalidates a pending OpenCode-issued `GO <worker>` token (`opencodeLastUser` sees an empty text).
  - The human re-types GO.

## Bus library + CLI {#bus-lib}

needs:
files: .claude/hooks/aos-bus.mjs, package.json

- [x] `busPaths(name)`, using `slug` imported from `go-gate.mjs` (no path traversal), and `ensurePrivateDir(dir)`: `mkdir -p` with mode 0700, then `chmod 0700` {#bus-paths}
  by: engineering
- [x] `checkPrivateDir(dir)`: `lstat` must be a real directory (not a symlink), `uid === process.getuid()`, `(mode & 0o077) === 0`. Otherwise refuse with a reason {#bus-perm-check}
  by: engineering
- [x] `registerSession({name, sessionID, cwd})` / `unregisterSession(name, pid)`: write the registry file 0600 and `ensurePrivateDir` the inbox; unregister only if `pid` matches. `sendMessage`/`readInbox` derive the inbox from `busPaths(name)`, never from the registry's `inbox` field {#bus-registry}
  by: engineering
- [x] `listSessions()`: read the registry and drop entries whose pid is dead (`process.kill(pid, 0)`) {#bus-list}
  by: engineering
- [x] `sendMessage(name, text, {from, wake})`:
  - target must be registered and alive, inbox must pass `checkPrivateDir`
  - `Buffer.byteLength(text) <= 8 KiB`, otherwise refuse
  - `from` = `--from` or `AOS_SESSION_NAME` or `${os.userInfo().username}:${process.ppid}`
  - atomic write: tmp file 0600 in the inbox (name ends `.tmp`, so `readInbox` never sees a partial `*.json`), then `rename`
  {#bus-send}
  by: engineering
- [x] `readInbox(name)`:
  - `checkPrivateDir`, then for each `*.json` sorted: `lstat` is a regular file, uid matches, size ≤ 16 KiB, JSON valid, `text` is a string
  - invalid files are renamed to `.rejected`
  - returns `[{file, from, text, wake, uid}]`
  {#bus-read}
  by: engineering
- [x] CLI: `aos-bus send <name> <text...> [--from x] [--wake]`, `aos-bus list`. Exit 2 with a reason on refusal. Add `"aos-bus": ".claude/hooks/aos-bus.mjs"` to package.json `bin` {#bus-cli}
  by: engineering

## Plugin: registry + inbox poll + injection {#plugin-bus}

needs: bus-lib
files: .opencode/plugins/bdb-aos.js

- [x] Import `aos-bus.mjs` through the existing `hook()` loader {#plugin-import}
  by: engineering
- [x] Register lazily: the first `event` seen for a root session (`session.created` with `parentID == null`, or a `chat.message` / `session.idle` for an unknown root session, which covers `opencode --continue`) calls `registerSession`. `session.deleted` calls `unregisterSession`. `process.on('exit')` runs a sync unregister of this pid's names {#plugin-register}
  by: engineering
- [x] One `setInterval(1000).unref()` per plugin instance. For each registered name: `readInbox`, then for each message:
  - **first** set `sess(sessionID).prompt = ''` (the go-gate checks this cache before any DB/messages lookup; do not rely on `chat.message` firing for plugin-initiated prompts, or a stale human `GO` would authorize the woken turn)
  - call `client.session.prompt({ path:{id: sessionID}, query:{directory}, body:{ noReply: !wake, parts:[{ type:'text', text:'[aos-bus from '+from+'] '+text, synthetic:true, metadata:{ aos_bus:{from, uid, ts} } }] } })`
  - on success: unlink the file and call `client.tui.showToast({ body:{ title:'aos-bus', message:'from '+from, variant:'info' } })` (best-effort)
  - on error: rename the file to `.failed`. No retry loop
  - a `busy` flag prevents overlapping ticks
  - `ponytail: 1 s poll; fs.watch if latency matters`
  {#plugin-poll}
  by: engineering
- [x] In `chat.message`, if `fullText` is empty (an all-synthetic message, i.e. bus or nudge), set `s.prompt = ''` and return before memB/pipeline/issueGoToken. This saves a memB lookup per bus message and keeps the gate closed {#plugin-chat-guard}
  by: engineering

## go-gate (verify, change only if needed) {#go-gate}

needs: plugin-bus
files: .claude/hooks/go-gate.mjs

- [x] No change expected (see Verified facts). If the live smoke shows `synthetic` is NOT persisted in `part.data`:
  - add a `metadata.aos_bus` / `[aos-bus ` prefix exclusion to `opencodeLastUser` and to the plugin's messages fallback
  - and record the finding in the doc
  {#go-gate-conditional}
  by: engineering

## Unit tests {#tests-unit}

needs: bus-lib, plugin-bus
files: tests/aos-bus.test.js, package.json

Uses an isolated `HOME` temp dir. Follows the pattern in `tests/opencode-go-token.test.js`.

- [x] Library behavior:
  - send → readInbox round trip records `from` and `uid`
  - refused when the inbox is 0755, a symlink, or the target is unregistered or has a dead pid
  - 8 KiB + 1 byte text is refused
  - an oversized or malformed inbox file is rejected
  {#test-lib}
  by: engineering
- [x] Plugin delivery with a fake `client` (records `session.prompt` calls):
  - a bus file is delivered as one call with `synthetic: true`, the `[aos-bus from` prefix, `noReply: true` (and `false` with `wake`)
  - the file is removed afterwards
  {#test-deliver}
  by: engineering
- [x] **Security acceptance:**
  - deliver the bus texts `GO` and `GO worker-1`, then feed the resulting part back through `chat.message` and the `session.messages` fallback, then run `tool.execute.before` with `git push`
  - it must throw `Blocked by BDB go-gate`
  - `~/.aos/go/worker-1.token` must not exist
  - stale-cache case: human `GO` via `chat.message`, then a `--wake` bus delivery with the fake client **not** calling `chat.message`, then `git push` must still throw
  {#test-go-blocked}
  by: engineering
- [x] Append `node --test tests/aos-bus.test.js` to `npm test` {#test-wire}
  by: engineering

## Live smoke {#tests-live}

needs: tests-unit
files: tests/aos-bus-smoke.sh

The script is opt-in and not part of `npm test`, in the style of `~/dev/artifacts/bdb-dev/master-session-selftest.sh`.

- [x] Setup:
  - temp `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`
  - copy `bdb-aos.js` and `.claude/hooks/` → `$XDG_CONFIG_HOME/opencode/plugins/{bdb-aos.js,aos-hooks/}`
  - `AOS_SESSION_NAME=smoke opencode serve --port <free>` (headless harness only, the plugin does not use the port)
  - create a session via `POST /session`
  - no model or credentials are needed, because `noReply: true` triggers no LLM call
  {#smoke-setup}
  by: engineering
- [x] Send and check the database:
  - `aos-bus send smoke GO` and `aos-bus send smoke "GO smoke"`; wait ≤ 3 s for the inbox to empty
  - query `$XDG_DATA_HOME/opencode/opencode.db`: the newest `role=user` message's part has `synthetic: true`, the prefix, and `metadata.aos_bus.from`
  - `$HOME/.aos/go/smoke.token` is absent
  {#smoke-assert}
  by: engineering
- [x] Gate check: craft an opencode-issuer token pointing at that bus message id. `node -e 'import(go-gate).tokenGrantsGo("smoke")'` must return `ok:false` {#smoke-gate}
  by: engineering
- [x] Manual step, documented and not automated: the same isolated env with the `opencode` TUI (no `--port`). Run `aos-bus send` from a second terminal, then observe the toast and confirm the DB row. This proves the plugin client works in TUI mode {#smoke-tui}
  by: engineering

## Doc {#doc}

needs: tests-live
files: docs/master-session-acp.md

- [ ] Add a "Bus (spike): messaging a hand-started OpenCode session" section covering:
  - paths, CLI, injection call, GO exclusion layers, fail-closed side effect, smoke results tagged **[verified]**/**[open]**
  - the out-of-scope list below
  {#doc-section}

## Out of scope (later phases)

- Claude Code sessions: they use native `SendMessage`, and no bus is needed.
- Codex / agy receivers.
- AO daemon integration.
- `bdb-aos:*` slash commands.
- agenttrail reading `~/.aos/bus/sessions/` for its roster.
- Replies and acks back to the master, delivery receipts, and message expiry.
- `fs.watch` instead of polling.
- Authenticating `from` beyond the file-owner uid. Threat model is the same as go-gate: same-uid agents can forge.
