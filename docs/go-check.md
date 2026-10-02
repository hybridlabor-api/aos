# go-check: one GO check for callers that are not a hook

`go-check.mjs` answers "may this worker run this guarded command?" with the same classifier and token logic as `go-gate.mjs`, so AO (or any other supervisor) does not rebuild transcript and token handling. The installer places it at a fixed path you can find without running `aos` (an `aos` call starts the installer):

```
~/.aos/bin/go-check.mjs          the CLI
~/.aos/bin/go-gate.mjs           copy it imports (same directory)
~/.aos/bin/guarded-patterns.json the guarded patterns, for reference
```

Source: `bin/go-check.mjs`, `bin/guarded-patterns.json` (regenerate with `node bin/go-check.mjs --write-patterns bin/guarded-patterns.json`; a test fails on drift).

## Call

```
node ~/.aos/bin/go-check.mjs --session <Name> --command "<shell string>" [--consume]
```

- `--session` is the stable worker slug (`AOS_SESSION_NAME`). The token for `GO <Name>` is looked up under that name.
- `--command` is a **shell string**, not an argv array. The patterns are anchored on `^`, `;`, `|`, `&&`, `$(`, backticks and wrappers (`sudo`, `env`, `bash -c`, ...). The caller must build the string from its provider's tool input (for ACP, `RawInput`). If the form of an `execute` call is unknown, treat it as guarded-unknown: hand it to the human approval surface, never allow it automatically.
- Without `--consume` the token is only verified. With `--consume` it is used up (one token, one guarded command). Pass `--consume` only on the final allow.

## Output and exit codes

stdout is one JSON line: `{"guarded": bool|null, "ok": bool, "scope": [...]|null, "reason": "..."}`.

| Exit | Meaning | Caller |
|---|---|---|
| 0 | allowed: not guarded, or a valid GO token (consumed with `--consume`) | allow |
| 1 | guarded and no valid GO (also: the command touches the GO/grant store) | hand over to the human surface |
| 2 | error (bad arguments, missing `go-gate.mjs`, unreadable state) | treat as denied, never allow |

`scope` is the list of grant scopes the command needs (`push-feature`, `push-main`, `merge`, `publish`, `destructive`, `github-write`), or `null` when a guarded part has no scope. Scopes are informational here: they do not select a grant.

## What it deliberately does not do

- **Tokens only (v1).** A valid `~/.aos/go/<Name>.token` (under 10 min old, names this session, master transcript still ends with that `GO <Name>`, not yet used) covers any guarded command, including `gh pr merge 117`. `GO #117` style PR-scoped GOs live in the transcript path of `go-gate.mjs` and are not read here.
- **Mode `soft` grants are never read.** They belong to the human session (`~/.aos/gate`), and a worker must not be able to use them.
- **Mode `off` never applies.** go-check does not look at the gate store at all.
- **It never mints a token.** With `AOS_ACP_CLIENT=1` (set in every AO worker environment) the result is the same: no token is written anywhere. Tokens are created only by the `UserPromptSubmit` hook `go-token.mjs` from a human-typed `GO <Name>`.
- **No network, no stdin, no subprocess.** One call takes roughly 60 to 150 ms. Callers should still apply their own timeout (3 s suggested); a timeout counts as exit 2.

## Coverage limits (inherited, say them out loud)

- The ACP client only sees what the agent asks for. `bypassPermissions` never sends `session/request_permission`, and a TUI (PTY) session has no AO interception point. The hook inside the harness stays the main layer; go-check is the second layer for harnesses without hooks.
- Whether Claude's hook fires under `bypassPermissions`, and whether Codex hooks fire under ACP, is UNVERIFIED (see `docs/codex-gate-smoke.md`).
- A token that is still valid is not bound to one command: it covers the next guarded command the worker asks about. `--consume` makes it one command.

## Patterns file

`guarded-patterns.json` holds `{version, source, scopes, patterns: [{source, flags}]}` in JavaScript RegExp syntax. It uses lookaheads, which Go's RE2 does not support, so do not port it. Call go-check instead; the file exists so AO can show or diff the list.

## Failure cases for AO

| Situation | Behaviour |
|---|---|
| `~/.aos/bin/go-check.mjs` missing (AOS not installed) | feature off, AO behaves as before |
| installed, exit 2, no `node`, or timeout | do not allow; hand over |
| exit 1 | hand over to the approval surface |
| exit 0 | allow; `--consume` only at the final allow |
