# Worktree-scoped permissions for A2A workers

How `--allow-default scoped` on `aos-acp` keeps a delegated worker inside its
job worktree.

## Decision rules

- `lib/a2a-permissions.mjs` exports `decide(toolCall, { cwd })`, which
  classifies one permission request against the worker's worktree.
- File-write tools (`edit`, `delete`, `move`) are allowed only when the target
  stays inside the worktree after resolving symlinks; a not-yet-existing
  target is resolved through its existing parent directory.
- Escapes are denied: symlinks out of the worktree, direct paths outside it or
  relative paths that leave it via `..`.
- Shell commands run only when the go-gate neither hard-blocks nor guards them
  and the command's cwd is inside the worktree. A guard match is never
  auto-denied: it falls through to the existing GO path unchanged.
- Everything else is denied with a reason string that lands in the run log.

## Back-compat

- `--allow-default allow` keeps the old behaviour; `deny` stays the CLI
  default. Scoped mode is opt-in per run, and guarded commands still consume
  the same single-use GO tokens as before.
