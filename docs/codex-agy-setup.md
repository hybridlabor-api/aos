# Codex and Antigravity (agy) plugin setup

Both manifests are generated from `plugin-commands.json` by `node scripts/build-plugin-manifest.mjs` and checked by `--check` (stale or missing files, version drift against `package.json`, referenced files, no `disable-model-invocation` in any Codex output).

## Codex

- **Automatic:** the installer runs `lib/codex-plugin-install.js` when `codex` is on PATH (honours `AOS_PLUGIN_MIGRATION=off|check` and `--dry-run`; never fails the install; also runs on Quick Update). It adds the marketplace from the installed package directory (version-matched, works offline; for an `npx` run the package root is a throw-away `_npx` cache, so the GitHub source `hybridlabor-api/aos` is used instead and a stale local source pointing into `_npx` is re-pointed). A plugin you disabled (`codex plugin list` shows `enabled: false`) stays disabled: one line, no `plugin add`. The marketplace clone from GitHub gets a 300 s timeout (default 120 s). runs `codex plugin add bdb-aos@bdb-aos`, and on a version change re-points or upgrades the marketplace and adds again. Codex has no `plugin upgrade`; `plugin add` is idempotent and installs the marketplace's current version. What it installed is recorded in `~/.agents/.bdb-codex-plugin.json`, and `aos-uninstall` removes only that (`codex plugin remove bdb-aos@bdb-aos`, then the marketplace if the installer added it).
- **Manual load:** `codex plugin marketplace add <path-to-this-repo>` (it reads `.agents/plugins/marketplace.json`) or `codex plugin marketplace add hybridlabor-api/aos` (GitHub, needs read access), then `codex plugin add bdb-aos@bdb-aos`. Check with `codex plugin list` (`installed, enabled`). The plugin lands in `~/.codex/plugins/cache/bdb-aos/bdb-aos/<version>/`.
- **Verify without a model call:** `codex debug prompt-input hi` lists the model-visible skills, including all 14 `bdb-aos:<cmd>` entries. Restart running Codex sessions after install.
- **Hooks:** the plugin ships none; AOS hooks stay in `~/.codex/config.toml` / `hooks.json` written by the installer.
- **Invoke:** `$bdb-aos:<cmd>`, for example `$bdb-aos:setup`. Codex has no `/` command for plugin skills.
- **How it is built:** each command becomes a wrapper skill in `plugins/bdb-aos-codex/skills/<cmd>/SKILL.md`. The plugin ships only these wrappers; the 200+ AOS skills reach Codex through the installer's `~/.agents/skills` copies, and a wrapper tells the model which one to run.
- **Bodies:** `bodies.codex` is optional; without it the Claude body is used with `/bdb-aos:<cmd>` rewritten to `$bdb-aos:<cmd>`.

### Which skill roots and manifests Codex reads (measured, codex 0.154.0, temp HOME, `codex debug prompt-input`)

| Layout (plugin installed, 261 loose skills) | Entries | Descriptions | `bdb-aos:` prefixed |
|---|---|---|---|
| `~/.codex/skills` only | 280 | all present (cut to about 20 characters by Codex's budget) | 15 (14 wrappers + the `bdb-aos` skill) |
| `~/.agents/skills` only | 280 | same as above | 15 |
| both roots | 366 | 352 empty, list cut off | 16 |
| both roots + `~/.codex-plugin/plugin.json` | 320 | n/a | all 320, every skill renamed, including OpenAI's |
| `~/.agents/skills` + `~/.codex-plugin/plugin.json` | 280 | n/a | all 280 renamed |

- Codex loads `~/.codex/skills` **and** `~/.agents/skills`, so a skill present in both is listed twice and the doubled list blows the prompt budget.
- A `plugin.json` in `~/.codex-plugin/` (HOME) makes Codex treat the whole HOME as that plugin and prefix every skill with `bdb-aos:`. The installer used to copy the repo's `.codex-plugin/` there. The plugin source stays in the package (`.codex-plugin/`, `plugins/bdb-aos-codex/`), which Codex reads through the marketplace; it must not exist in HOME.
- **What the installer does now:** writes AOS skills only to `~/.agents/skills` (the root other harnesses and the AOS CLI already share), never to `~/.codex/skills`, and no longer copies `.codex-plugin` into HOME. On upgrade it moves AOS-written copies in `~/.codex/skills` (manifest hash still matches; backup in `~/.agents/backups/plugin-migration-codex-skills-<stamp>`, all-or-nothing, an edited file stops the removal and is reported) and an AOS-written `~/.codex-plugin` (manifest or package-byte match; backup in `~/.agents/backups/codex-plugin-dir-<id>`) out of the way. `~/.codex/skills/.system` and files AOS did not write are never touched. Picking Codex explicitly in the installer targets `~/.agents/skills` too.
- Check: `codex debug prompt-input hi` should list about 280 entries, all with descriptions, the 14 `bdb-aos:<cmd>` wrappers and no renamed foreign skill.

## Antigravity (agy)

Measured with agy 1.2.14 in a sandbox HOME:

- `agy plugin install <target>` accepts a local directory (or `plugin@marketplace` for a registered marketplace). A GitHub `owner/repo` is rejected ("install target must be a directory").
- It copies the directory (symlinks resolved, so the copy is real files) to `~/.gemini/config/plugins/bdb-aos` and records `plugins.bdb-aos.enabled` in `~/.gemini/config/config.json`. `agy plugin list` prints the imported plugin names as JSON; installing again overwrites in place.
- agy ignores the manifest's `skills` array and counts only the first level under `skills/`. Installing `plugins/bdb-aos` (nested `skills/<category>/<name>`) therefore yields 9 skills, not 261.
- Commands are exposed as `/bdb-aos:<cmd>` ("14 commands converted to skills"). Hooks and MCP servers are not part of the plugin; the AOS installer configures those separately.

**What the installer does:** `lib/agy-plugin-install.js` runs near the end of the skills step, only when `agy` is on PATH, on a full install and on Quick Update. It stages a flat plugin directory (`skills/<name>` for all 261 skills, `commands/`, `agy-commands/`, `agents/`, `plugin.json`) in a temp directory, runs `agy plugin install <stage>`, deletes the temp directory, leaves the plugin alone when you disabled it (one line, no `agy plugin enable`), and records it in `~/.agents/.bdb-agy-plugin.json`. A rerun does nothing when the installed version matches `plugin.json`, and updates when it differs. The loose copies in `~/.gemini/config/skills` are never touched. Any failure prints a warning with the manual commands and never stops the AOS install. `AOS_PLUGIN_MIGRATION=off` skips it, `check` and `--dry-run` only report.

**Manual install** (also from a git checkout): `node <aos-package>/lib/agy-plugin-install.js` (add `--dry-run` to preview), then `agy plugin enable bdb-aos` if needed. `aos-uninstall` runs `agy plugin uninstall bdb-aos` only when the record file exists.

- **Invoke:** `/bdb-aos:<cmd>`, for example `/bdb-aos:setup`.
- **Bodies:** commands reuse `commands/<cmd>.md`. A command with `bodies.agy` is written to `agy-commands/<cmd>.md` and wired instead.
- **Tests:** `node --test tests/agy-plugin-install.test.js` (fake runner); `AOS_E2E_CLI=1` adds a sandbox run against the real agy CLI.

## agy hooks (`hooks.json`)

agy's own hooks doc (embedded in the binary) defines the format: each **top-level key of `hooks.json` is a named hook** holding `PreToolUse`/`PostToolUse` (grouped: `matcher` + `hooks`) and `PreInvocation`/`PostInvocation`/`Stop` (flat handler lists). The installer writes six named hooks to `~/.gemini/config/hooks.json` (and `antigravity-cli/hooks.json` when present): `aos-go-gate` (pre-tool, blocking), `aos-conventional-commits`, `aos-env-protection`, `aos-trail-relay` (pre-tool + stop, fails open), `aos-graph-gate` (stop), `aos-context` (pre-invocation). Older AOS versions put everything under one name, `hooks`; the installer strips its handlers from it, keeps foreign ones, and removes it when empty.

Measured with agy 1.2.14 (sandbox HOME, `agy -p x --log-file <f>` with no login, so no model call):
- The log line `hooks_manager.go:53] loaded N named hooks from M hooks.json file(s)` counts top-level keys. The old lump gave `1 named hooks`, which is what Yola's Windows log showed; the new layout gives `6`. The `skipping component ... "command_assessor" is empty` lines belong to agy's own built-in assessor hook (`command_assessor_hook_external.go` in the binary), not to AOS.
- On its first start agy migrates `antigravity-cli/hooks.json` over `config/hooks.json` and replaces the former with a symlink. The installer writes through such a link instead of replacing it.
- Not measured: agy actually firing a hook and honouring `deny`, and the exact tool names agy matches for file edits (the `aos-env-protection` matcher lists the known names). Both need a model turn. The written `go-gate` command is exercised by the test suite the way agy runs it (`sh -c`, cwd = the hooks.json folder, camelCase payload on stdin) and answers `deny`/`allow` in agy's contract. cwd is taken from agy's doc, not measured.
- Check on your machine: `agy -p x --log-file /tmp/agy.log` (login prompt appears, nothing is sent), then `grep hooks_manager /tmp/agy.log`.

## CLI runner, Windows and test switches

- `lib/cli-spawn.js` runs `claude`, `codex` and `agy`: no shell string, argv array on POSIX; on Windows the command is resolved through PATH/PATHEXT and npm `.cmd`/`.bat` shims run through `cmd.exe /d /s /c` with every argument escaped (spaces, `&`, quotes, `%`). `onPath()` and the spawn use the same resolver, so a detected CLI is also runnable.
- `AOS_PLUGIN_CLI=off` never runs the claude CLI; `AOS_PLUGIN_CLI=on` is a **test switch** that forces the claude CLI path on a redirected HOME (by default only the account's real home runs it, and the installer prints one line when it skips). `CLAUDE_CONFIG_DIR` is honoured for `settings.json` and plugin detection.
- Claude `marketplace add` clones the repository (about 250 MB) and gets 300 s, announced before it starts; `claude plugin update` is followed by a second `plugin list`, so "already at the latest" is logged as such, not as `updated (a -> b)`.
