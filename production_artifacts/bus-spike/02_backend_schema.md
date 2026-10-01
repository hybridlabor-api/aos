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

## Repair round 1
Blocking
- **BUS-01 fixed:** `busPaths` throws `invalid session name` for empty names and names starting with `.` (test covers `.`, `..`, ` . `, `/./`, `../../etc/x`, `.hidden`, `///`)
- **BUS-02 fixed:** the poll loop reads the registry file and delivers only if `pid === process.pid && sessionID === the registered session`. Test: two plugin instances with `AOS_SESSION_NAME=dup`; only the last registered owner receives (mutation-checked: fails without the guard)
- **BUS-03 fixed:** smoke runs `exec opencode serve`; after a run no `opencode serve` process remains

Advisories
- **A1 fixed:** `readInbox` strips control chars and `]` from `from`, caps it at 64 chars, and drops a non-numeric `ts` (tested)
- **A4 fixed:** each bus prompt is raced against a 10 min timeout (`AOS_BUS_PROMPT_TIMEOUT_MS`); on timeout the file is parked as `.failed`
- **A5 fixed:** `busy` retries stop after 10 min of file age (`AOS_BUS_BUSY_MAX_MS`), then `.failed` (tested); plan `{#plugin-poll}` text updated
- **A7 fixed:** a registration failure is logged with `console.error`; an invalid name is not retried
- **A8 fixed:** smoke greps `^smoke<TAB>` and pins the `master session no longer ends with this GO` reason
- **N1 fixed:** unused `existsSync` import removed
- **A3 skipped:** the OpenCode plugin API used here exposes no dispose hook, so the interval and `exit` listener cannot be cleared; BUS-02's owner check removes the misdelivery it fed

Open
- **[open]** A2: SIGTERM skips `process.on('exit')`, so a stale registry entry can survive; no expiry
- **[open]** A6: `.rejected` and `.failed` files are never cleaned up
- **[open]** A3: no teardown of the poll interval / exit listener (no dispose hook)

Results: `npm test` exit 0 (`aos-bus.test.js` 12/12); smoke all PASS, no leaked daemon.
