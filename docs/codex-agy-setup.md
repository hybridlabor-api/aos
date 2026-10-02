# Codex and Antigravity (agy) plugin setup

Both manifests are generated from `plugin-commands.json` by `node scripts/build-plugin-manifest.mjs` and checked by `--check` (stale or missing files, version drift against `package.json`, referenced files, no `disable-model-invocation` in any Codex output).

## Codex

- **Load:** `codex plugin marketplace add <path-to-this-repo>` (it reads `.agents/plugins/marketplace.json`), then `codex plugin add bdb-aos@bdb-aos`.
- **Invoke:** `$bdb-aos:<cmd>`, for example `$bdb-aos:setup`. Codex has no `/` command for plugin skills.
- **How it is built:** each command becomes a wrapper skill in `plugins/bdb-aos-codex/skills/<cmd>/SKILL.md`. The plugin ships only these wrappers; the 200+ AOS skills reach Codex through the installer's `~/.codex/skills` copies, and a wrapper tells the model which one to run.
- **Bodies:** `bodies.codex` is optional; without it the Claude body is used with `/bdb-aos:<cmd>` rewritten to `$bdb-aos:<cmd>`.

## Antigravity (agy)

Measured with agy 1.2.14 in a sandbox HOME:

- `agy plugin install <target>` accepts a local directory (or `plugin@marketplace` for a registered marketplace). A GitHub `owner/repo` is rejected ("install target must be a directory").
- It copies the directory (symlinks resolved, so the copy is real files) to `~/.gemini/config/plugins/bdb-aos` and records `plugins.bdb-aos.enabled` in `~/.gemini/config/config.json`. `agy plugin list` prints the imported plugin names as JSON; installing again overwrites in place.
- agy ignores the manifest's `skills` array and counts only the first level under `skills/`. Installing `plugins/bdb-aos` (nested `skills/<category>/<name>`) therefore yields 9 skills, not 261.
- Commands are exposed as `/bdb-aos:<cmd>` ("14 commands converted to skills"). Hooks and MCP servers are not part of the plugin; the AOS installer configures those separately.

**What the installer does:** `lib/agy-plugin-install.js` runs near the end of the skills step, only when `agy` is on PATH. It stages a flat plugin directory (`skills/<name>` for all 261 skills, `commands/`, `agy-commands/`, `agents/`, `plugin.json`) in a temp directory, runs `agy plugin install <stage>`, deletes the temp directory, enables the plugin if it was disabled, and records it in `~/.agents/.bdb-agy-plugin.json`. A rerun does nothing when the installed version matches `plugin.json`, and updates when it differs. The loose copies in `~/.gemini/config/skills` are never touched. Any failure prints a warning with the manual commands and never stops the AOS install. `AOS_PLUGIN_MIGRATION=off` skips it, `check` and `--dry-run` only report.

**Manual install** (also from a git checkout): `node <aos-package>/lib/agy-plugin-install.js` (add `--dry-run` to preview), then `agy plugin enable bdb-aos` if needed. `aos-uninstall` runs `agy plugin uninstall bdb-aos` only when the record file exists.

- **Invoke:** `/bdb-aos:<cmd>`, for example `/bdb-aos:setup`.
- **Bodies:** commands reuse `commands/<cmd>.md`. A command with `bodies.agy` is written to `agy-commands/<cmd>.md` and wired instead.
- **Tests:** `node --test tests/agy-plugin-install.test.js` (fake runner); `AOS_E2E_CLI=1` adds a sandbox run against the real agy CLI.
