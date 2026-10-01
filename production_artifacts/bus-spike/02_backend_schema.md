# Bus spike: build notes

**Built:** a master drops a message into `~/.aos/bus/inbox/<name>/`. The AOS OpenCode plugin in a running session picks it up within about 1 s and injects it as a synthetic part (`[aos-bus from <from>] ...`). A bus message cannot act as a human `GO`.

## Files
- `.claude/hooks/aos-bus.mjs`: library (`busPaths`, `ensurePrivateDir`, `checkPrivateDir`, `registerSession`, `unregisterSession`, `listSessions`, `sendMessage`, `readInbox`) and CLI (`send`, `list`)
- `package.json`: `bin.aos-bus`, `aos-bus.test.js` appended to `npm test`
- `.opencode/plugins/bdb-aos.js`: lazy root-session registration, 1 s inbox poll, injection, `chat.message` early return
- `tests/aos-bus.test.js`, `tests/aos-bus-smoke.sh`, `docs/master-session-acp.md` (new Bus section)
- go-gate unchanged: `synthetic` is persisted, so the conditional fallback was not needed

## Run
- `aos-bus list`; `aos-bus send <name> "text" [--from x] [--wake]`
- `npm test` (includes `node --test tests/aos-bus.test.js`)
- `tests/aos-bus-smoke.sh` (opt-in; needs `opencode`, `sqlite3`)

## Results
- `npm test`: exit 0, 342 tests, 0 fail
- `tests/aos-bus.test.js`: 10/10, including a mutation check that the stale-cache test fails without the prompt-cache reset
- Live smoke (opencode 1.18.30): all PASS. `synthetic:true`, prefix and `metadata.aos_bus` stored in `opencode.db`; bus texts `GO` and `GO smoke` created no token and did not unlock a push; `tokenGrantsGo` rejected a token pointing at the bus message

## Advisories applied
- (a) busy-session error: file stays, retry next tick (unit-tested with a fake client); other errors rename to `.failed`
- (b) `chat.message` returns early only when `parts.length > 0` and every part is synthetic

## Open
- **[open]** real busy-session error shape from OpenCode (matched by `/busy/i`)
- **[open]** TUI mode and toast (manual step in the smoke script)
- **[open]** `--wake` with a real model turn (needs credentials); a wake turn is awaited, so it delays later messages until it ends
- Fail-closed side effect: a bus message invalidates the last human GO and a pending `GO <worker>` token for that session
