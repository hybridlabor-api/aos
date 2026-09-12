# <PROJECT NAME> — Agent Rules

One-paragraph description of what this project is and who uses it. An agent
that reads only this file should understand what it is touching.

> Harness files: `CLAUDE.md`, `GEMINI.md` and `CODEX.md` are symlinks to this
> file. Every rule lives here exactly once.

## Stack

- Language / runtime:
- Framework:
- Package manager:
- Database / storage:
- Deploy target:

## Commands

```bash
# install
# dev
# test
# lint / typecheck
# build
```

Run the test and typecheck commands before reporting any change as done.

## Architecture

Where the code lives and which direction dependencies point. Name the
boundaries an agent must not cross, not every file.

- `src/…` —
- `…` —

## Project rules

1. **Git snapshot first.** Commit or snapshot before refactoring or deleting.
2. **English only** in code, docs and commit messages.
3. **No secrets in the repo.** Live `.env` files stay outside it; the repo
   carries placeholders only.
4. **Private repository** unless explicitly decided otherwise.
5. **Ask before destructive actions** — mass deletion, history rewriting,
   discarding uncommitted work.

## Domain notes

Non-obvious constraints, hardware quirks, external-service limits, and
decisions that would look like bugs to someone reading the code cold. This
section is why the file exists — keep it current.

## Out of scope

What agents should not touch here (generated files, vendored code, another
team's directory).
