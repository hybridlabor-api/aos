# Gate profile

A machine-wide, human-set profile that widens or narrows what the go-gate asks for. Code: the read side lives in `.claude/hooks/gate-profile.mjs` (`lib/gate-profile.mjs` re-exports it), the gate decision in `profileAllows` in `.claude/hooks/go-gate.mjs`, the CLI in `bin/aos-gate.mjs` (`aos-gate` in `package.json` `bin`). The Claude hook and the OpenCode plugin (`.opencode/plugins/bdb-aos.js`) both call `profileAllows`; Codex and agy use the same `go-gate.mjs` when their hook fires (unverified there).

## Profiles

| Profile | Needs Tim | Notes |
|---|---|---|
| `strict` | everything guarded | default, never expires |
| `work` | release class only | default 4 h, max 24 h |
| `off` | hard blocks only | default 1 h, max 2 h |

Release class under `work` (a guarded command still needs a GO): scopes `push-main`, `merge`, `publish`, `destructive`, plus any guarded command whose scope cannot be read and that carries indirection (`eval`, `sh -c`, pipe into a shell, computed or glued heads, `$(...)`, brace heads, `npx` release tools). Other guarded commands (`push-feature`, `github-write`, `container-test`, `workspace`) are free under `work`.

`profileAllows` runs only after hard blocks, the store check, the block cooldown and the command-length cap, so none of those is lifted by any profile.

Hard blocks stay in every profile: writes to the gate store or the config, delete paths built from HOME/`~`/env, recursive delete outside the own worktree, edits to gate hooks and the settings that register them.

## Config

`~/.aos/gate/config.json`, mode 0600, owned by the current uid:

```json
{ "version": 1, "profile": "strict|work|off", "set_at": "ISO", "expires_at": "ISO|null", "set_by": { "uid": 501, "method": "typed" } }
```

`aos-gate` writes `method: "typed"` only.

## Fail-closed rules

`readProfile({file, now, uid, fs})` returns `{profile, reason}`. Any doubt gives `strict` plus a reason: missing, unreadable, symlink, FIFO or other non-regular file, over 4 KiB, wrong mode, wrong owner, corrupt JSON, wrong version, unknown profile, bad or future `set_at`, missing expiry for `work`/`off`, expiry beyond the maximum, expired. Expiry is evaluated at read time; nothing is cleaned up or written.

The read is bounded: `O_NONBLOCK | O_NOFOLLOW`, `fstat` must be a regular file, size cap 4 KiB.

## CLI

- `aos-gate status`: read-only, works anywhere. Prints profile, time left, last change.
- `aos-gate profile strict|work|off [--for 4h]`: needs a TTY on stdin and stdout; refuses if a harness session variable is set (`CLAUDE_SESSION_ID`, `CLAUDECODE`, `OPENCODE`, `CODEX_SANDBOX`, `CODEX_SESSION_ID`, `AGY_SESSION_ID`, `ANTIGRAVITY_SESSION_ID`); enforces the maximum durations; loosening requires typing back a random word printed on the TTY; `strict` needs no confirmation. Written via temp file, `O_EXCL`, rename, mode 0600. Refusals write nothing.
- Touch ID is only a stub (`touchId()` throws "not enabled until WP-9") and is not called by `profile`; confirmation is the typed word.
- `AOS_GATE_DIR` redirects the config directory only when `AOS_TEST_SANDBOX=container` (or the test flag is passed to `gateDir`). Otherwise `~/.aos/gate` is used.

## Residuals

- Code running as the user can write `config.json` directly. Only the agent-side store block in the gates mitigates this, not the OS.
- `work` widens the free set, so the release-class list must be exhaustive and must fail closed on parse doubt. Known gaps are in `docs/gate-residuals.md` (for example `npm dist-tag`).
- The typed-code fallback depends on open question D9-4 (typed fallback or Touch ID only).
- Commands allowed by `work`/`off` are not written to the gate log.
- `RELEASE_CLASS` in `gate-profile.mjs` is a descriptive list; the gate decision uses the scopes above, not that list.
