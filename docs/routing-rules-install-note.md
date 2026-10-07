# Routing rules — installer note

Owner: the aos orchestrator (installer owner). This work package ships a managed
"Tool routing (automatic)" block plus a SessionStart hint hook. The installer
changes are NOT part of this package — this note tells the installer owner what
to wire.

## The managed block

- File to manage: every instruction template the installer writes
  (`AGENTS.md` and the harness-specific siblings), same set that already gets
  the destructive-actions block (see `lib/destructive-rules.js`).
- Marker convention: follows the existing managed blocks exactly. The
  destructive block is delimited by
  `<!-- aos:destructive-actions:start -->` / `<!-- aos:destructive-actions:end -->`
  (`lib/destructive-rules.js`). The routing block uses the same style:
  `<!-- aos:routing:start -->` / `<!-- aos:routing:end -->`.
- Current location in the repo's own `AGENTS.md`: directly after the
  destructive-actions block, so both managed blocks sit together.
- Upsert semantics should mirror `upsertDestructiveBlock()`: replace the whole
  marker-delimited span in place, append between the last user content and the
  end of file when the markers are absent, and never touch anything outside
  the markers.

## The SessionStart hint hook

- Script: `hooks-shared/aos-session-hint.mjs` (zero dependencies, reads stdin,
  never throws, always exit 0; prints the Claude SessionStart
  `hookSpecificOutput` envelope with a 3-line hint).
- Env behaviour: `AOS_SESSION_HINT=off` prints nothing;
  `AOS_DELEGATE_DEPTH > 0` prints nothing, so delegated workers never get the
  hint — same pattern the A2A sidecar hook uses.

### Registration lines (verified against installer.js only)

- **Claude Code** — the installer already does exactly this for the A2A
  sidecar hook (`installClaudeA2aSessionHook`, installer.js ~line 4827):
  copy the hook file into `~/.claude/hooks/`, then into
  `~/.claude/settings.json`:
  `settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/aos-session-hint.mjs"' }] })`
  guarded by an idempotency check (skip when the file name already appears in
  the settings text), with a timestamped backup of settings.json before the
  write.
- **Google Antigravity** — hooks are copied from the same `.claude/hooks`
  source into `~/.gemini/config/hooks` and merged via `mergeAntigravityHooks`
  on that harness's `hooks.json` (installer.js ~lines 4682-4705). The hint can
  ride the same copy; use Antigravity's own SessionStart entry shape in
  `hooks.json` (verify the exact shape before wiring).
- **Codex and agy** — the installer deliberately does not register session
  hooks there for the sidecar (both are delegation targets, fork-bomb rule,
  comment at installer.js ~line 4818). Do not register the hint in them either.
- **OpenCode** — no settings.json registration; the harness reads plugin
  initialization instead (that is how the A2A sidecar init reaches OpenCode,
  see `installClaudeA2aSessionHook`'s comment and `bin/aos-doctor.mjs`).
  Keep the hint out unless a plugin hook surface is verified.

## Uninstall expectation

Uninstalling must remove exactly two things and nothing else: the
marker-delimited routing block from every instruction file, and the
SessionStart hint entry plus its copied hook file. User-authored content
between other managed blocks is untouched.
