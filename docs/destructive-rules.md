# Destructive-actions rules: per-turn injection and deny rules

The five "Destructive Actions" bullets live in `lib/destructive-rules.js` (single source) and are written as a managed block into every instruction file. A long session can compact that block away, so two further layers exist.

## Once-per-session injection (`.claude/hooks/rules-inject.mjs`)

Prints the five bullets as context on the first prompt of a session, and again after `/clear` or compaction (a `SessionStart` hook with source `clear`/`compact` drops the session marker; the hook prints nothing itself). The marker is `~/.aos/state/rules-seen/<session_id>` (Antigravity: conversationId), pruned after 7 days. Without a session id the rules are printed every time. OpenCode keeps the flag in memory per session and resets it on the `session.compacted` event (event name unverified). Reads only the bundled text (repo `lib/`, else `~/.agents/lib/destructive-rules.js`, which the installer copies). Fails open: any error prints nothing and exits 0, the prompt is never blocked. Measured about 90 ms wall time, almost all of it Node startup.

| Harness | Mechanism | Output shape |
|---|---|---|
| Claude Code | `UserPromptSubmit` hook in `settings.json` (`$HOME`-anchored, honours `CLAUDE_CONFIG_DIR`) | `hookSpecificOutput.additionalContext` |
| Codex | `[[hooks.UserPromptSubmit]]` in `~/.codex/config.toml` | same as Claude Code |
| Antigravity | handler in the `aos-context` `PreInvocation` hook | `injectSteps[].ephemeralMessage` |
| OpenCode | `chat.message` in the AOS plugin adds a synthetic text part | n/a |

The output shapes are the ones `memb-inject.mjs` already uses on each harness. Antigravity's `PreInvocation` can fire more than once per user turn, the marker keeps it to one injection per conversation. Antigravity compaction cannot re-arm it (no SessionStart source known; unverified), so there the instruction-file block is the compaction safety net.

## `permissions.deny` (Claude Code only)

The installer adds `Bash(rm * ~)`, `Bash(rm * ~/)`, `Bash(rm * $HOME)`, `Bash(rm * "$HOME")` and the other spellings listed in `CLAUDE_DENY_RULES` to `permissions.deny` of the Claude `settings.json`. Per https://code.claude.com/docs/en/permissions, Bash rules match the literal command text and `*` stands in for any text, so `rm * ~` matches `rm -rf ~` in any flag order but not `rm -rf ~/dev/build`. There is deliberately no `rm -rf:*`, which would also block GO-approved deletes, and no `~/*` form because the docs describe no way to match a literal `*`.

The docs also say a Bash deny rule "isn't a security boundary" (`/bin/rm`, `bash -c '...'` are not matched); the go-gate HARD block remains the real protection.

- Idempotent: rules already present are skipped.
- The installer records only the rules it added (`claudeDeny` in `~/.agents/.bdb-uninstall-records.json`); `aos-uninstall` removes exactly those and never your own.
- A `settings.json` that does not parse, or whose `permissions` or `permissions.deny` has an unexpected type, is left untouched.
- `aos-doctor` reports both layers as warnings when missing.

Codex and OpenCode: no deny mechanism is wired. OpenCode's `permission.bash` patterns were not verified for this change, so only the rule text and the plugin injection apply there.
