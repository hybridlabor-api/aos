# <PROJECT NAME> — Agent Rules

One-paragraph description of what this project is and who uses it. An agent
that reads only this file should understand what it is touching.

> Harness files: `CLAUDE.md`, `RULES.md` and `CODEX.md` point to this
> file. Every rule lives here exactly once.
>
> **Note for monorepos:** Nested `AGENTS.md` files take precedence over this root file for their respective subdirectories.

## Stack

- Language / runtime:
- Framework:
- Package manager:
- Database / storage:
- Deploy target:

## Build and test commands

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

## Non-negotiable

1. **Git snapshot first.** Before modifying, refactoring, or deleting files, commit or snapshot the current state so the change can be reverted.
2. **English only.** All generated content (code, docs, commit messages) ships in English.
3. **Never leak local paths containing usernames.** Use `~` or `$HOME`, never `/Users/<name>/` or `/home/<name>/`.
4. **Never commit `.env` files, API keys, or credentials.** Live `.env` files stay outside the repo; the repo carries placeholders only.
5. **GitHub repositories are Private by default.** Verify rather than assume.
6. **Ask before destructive actions.** Mass deletion, history rewriting, and anything that discards uncommitted work needs explicit confirmation.
7. **Zero guesswork.** Do not invent APIs, libraries, endpoints, or CLI commands. Verify against project source and tests, then official docs for the exact installed version, and name the source you used.

## Local map

Where things live on this machine, so an agent does not have to guess. Use `~`
for the home directory, never a username. Keep secret *values* out of this file:
name the place, not the content.

- Secrets / env files: `~/…` (e.g. `~/.aos/secrets.env`)
- Hosts / servers:
- Related projects / repos:
- Docs / wiki: `openwiki/`

## Code style

- Formatting:
- Linting:

## CI

- Pipeline:

## Commits

- Convention:

## PRs

- Requirements:

## Security

- Rules:

## Domain notes

Non-obvious constraints, hardware quirks, external-service limits, and
decisions that would look like bugs to someone reading the code cold. This
section is why the file exists — keep it current.

## Out of scope

What agents should not touch here (generated files, vendored code, another
team's directory).
