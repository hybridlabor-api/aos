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

## agy hooks (`hooks.json`)

agy's own hooks doc (embedded in the binary) defines the format: each **top-level key of `hooks.json` is a named hook** holding `PreToolUse`/`PostToolUse` (grouped: `matcher` + `hooks`) and `PreInvocation`/`PostInvocation`/`Stop` (flat handler lists). The installer writes six named hooks to `~/.gemini/config/hooks.json` (and `antigravity-cli/hooks.json` when present): `aos-go-gate` (pre-tool, blocking), `aos-conventional-commits`, `aos-env-protection`, `aos-trail-relay` (pre-tool + stop, fails open), `aos-graph-gate` (stop), `aos-context` (pre-invocation). Older AOS versions put everything under one name, `hooks`; the installer strips its handlers from it, keeps foreign ones, and removes it when empty.

Measured with agy 1.2.14 (sandbox HOME, `agy -p x --log-file <f>` with no login, so no model call):
- The log line `hooks_manager.go:53] loaded N named hooks from M hooks.json file(s)` counts top-level keys. The old lump gave `1 named hooks`, which is what Yola's Windows log showed; the new layout gives `6`. The `skipping component ... "command_assessor" is empty` lines belong to agy's own built-in assessor hook (`command_assessor_hook_external.go` in the binary), not to AOS.
- On its first start agy migrates `antigravity-cli/hooks.json` over `config/hooks.json` and replaces the former with a symlink. The installer writes through such a link instead of replacing it.
- Not measured: agy actually firing a hook and honouring `deny`, and the exact tool names agy matches for file edits (the `aos-env-protection` matcher lists the known names). Both need a model turn. The written `go-gate` command is exercised by the test suite the way agy runs it (`sh -c`, cwd = the hooks.json folder, camelCase payload on stdin) and answers `deny`/`allow` in agy's contract. cwd is taken from agy's doc, not measured.
- Check on your machine: `agy -p x --log-file /tmp/agy.log` (login prompt appears, nothing is sent), then `grep hooks_manager /tmp/agy.log`.
