---
name: aos-update
description: >-
  Update the installed AOS: check for a new version, preview, run the update and verify. Use when asked to update, upgrade or check for a new AOS release.
category: bdb-core
disable-model-invocation: true
---

# AOS Update

Keeps AOS (`@hybridlabor-api/aos`) up to date. Formerly `bdb-updater`, which remains as an alias pointing here. Since v4.0.0 (renamed from
`@hybridlabor-api/bdb-dev-optimized-agent-skills`, which is deprecated on
npm and frozen at its last pre-rename version — never check that name,
it will never report a real update again).

## 1. Check for an update

```bash
npm view @hybridlabor-api/aos dist-tags --json
```

Compare against the locally installed version: `aos version`, or `aos status`
(read-only; lists every package with its installed version and whether an
update is available). `aos doctor --net` also compares against npm.

Two dist-tags exist:
- **`@latest`** — the stable channel. CI (`release-please`) publishes here
  automatically on every release; this is what real users should run.
- **`@next`** — an ad-hoc staging tag used occasionally to validate a large
  change (a rename, a major version bump) before promotion to `@latest`.
  It is not a standing parallel channel — don't default to it unless the
  user is specifically testing a migration.

## 2. Run the update

```bash
aos update --dry-run      # preview, writes nothing
aos update                # installed AOS: updates in place
npx -y @hybridlabor-api/aos@latest   # no `aos` on PATH, or a first install
```

An interactive `aos update` asks the update mode (notify, auto or off) once and
remembers it; `-y` or no TTY never asks. If something is broken after an update,
`aos repair` re-applies it.

`-y` runs it fully non-interactively. If an install already exists, this
takes the **Quick Update** path (refreshes skills, re-syncs installed
submodules, refreshes the OpenWiki daemon schedule) rather than a full
reinstall — it does not need a `--force` flag or any special handling for
"already installed."

The installer syncs skills to every detected harness in one pass, not
just one: `~/.claude/skills`, `~/.gemini/config/skills` (Antigravity),
`~/.agents/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.roo/skills`.
Don't assume Gemini/Antigravity is the only target.

## 3. Verify the result

After running, `aos status` and the status table printed at the end of the run
are the ground truth — it checks each tracked
submodule's actual installed version against its own npm dist-tags
(`bdb-synapse`, `memB`, `heimdall-token-saver`, `bdb-dev-creator-extension`,
`bdb-os-remote`, `bdb-dev-tool-installer`, and `aos` itself). Read that
table rather than assuming success from a clean exit code — a partial
failure (e.g. a daemon not responding on its port) still exits 0 and logs
a warning, not an error.

Report the new version and anything flagged as a warning in that table
(not just "update complete"). Don't report success without having actually
looked at the status table's contents.

## 4. Scheduled updates

If the user wants recurring checks, recommend `/schedule` with the current
package name:
`/schedule CronExpression="0 10 * * 1" Prompt="Check if there is a new version of @hybridlabor-api/aos via npm view and update it"`
