# Gate profile

A machine-wide, human-set profile that widens or narrows what the go-gate asks for. Status: read side (`lib/gate-profile.mjs`) and CLI skeleton (`bin/aos-gate.mjs`) only. No gate reads it yet (patches P2/P3).

## Profiles

| Profile | Needs Tim | Notes |
|---|---|---|
| `strict` | everything guarded | default, never expires |
| `work` | release class only (see `RELEASE_CLASS`) | default 4 h, max 24 h |
| `off` | hard blocks only | default 1 h, max 2 h |

Hard blocks stay in every profile: writes to the gate store or the config, delete paths built from HOME/`~`/env, recursive delete outside the own worktree, edits to gate hooks and the settings that register them.

## Config

`~/.aos/gate/config.json`, mode 0600, owned by the current uid:

```json
{ "version": 1, "profile": "strict|work|off", "set_at": "ISO", "expires_at": "ISO|null", "set_by": { "uid": 501, "method": "touchid|typed" } }
```

## Fail-closed rules

`readProfile({file, now, uid, fs})` returns `{profile, reason}`. Any doubt gives `strict` plus a reason: missing, unreadable, symlink, FIFO or other non-regular file, over 4 KiB, wrong mode, wrong owner, corrupt JSON, wrong version, unknown profile, bad or future `set_at`, missing expiry for `work`/`off`, expiry beyond the maximum, expired. Expiry is evaluated at read time; nothing is cleaned up or written.

The read is bounded: `O_NONBLOCK | O_NOFOLLOW`, `fstat` must be a regular file, size cap 4 KiB.

## CLI

- `aos-gate status`: read-only, works anywhere. Prints profile, time left, last change.
- `aos-gate profile strict|work|off [--for 4h]`: needs a TTY on stdin and stdout; refuses if a harness session variable is set (`CLAUDE_SESSION_ID`, `CLAUDECODE`, `OPENCODE`, `CODEX_SANDBOX`, `CODEX_SESSION_ID`, `AGY_SESSION_ID`, `ANTIGRAVITY_SESSION_ID`); enforces the maximum durations; loosening requires typing back a random word printed on the TTY; `strict` needs no confirmation. Written via temp file, `O_EXCL`, rename, mode 0600. Refusals write nothing.
- Touch ID is a stub that throws "not enabled until WP-9".
- `AOS_GATE_DIR` redirects the config directory only when `AOS_TEST_SANDBOX=container` (or the test flag is passed to `gateDir`). Otherwise `~/.aos/gate` is used.

## Residuals

- Code running as the user can write `config.json` directly. Only the agent-side store block in the gates mitigates this, not the OS.
- `work` widens the free set, so the release-class list must be exhaustive and must fail closed on parse doubt.
- The typed-code fallback depends on open question D9-4 (typed fallback or Touch ID only).
- No audit line in the gate log yet and no gate integration (later patches).
