# Plugin registration and loose-copy migration

The installer registers the `bdb-aos` plugin for Claude Code, then removes only its own loose skill copies there. Hooks, MCP servers, `trail-autostart` and the bus stay in the installer, so disabling the plugin never disables the go-gate.

| Harness | Loose copies | Why |
|---|---|---|
| Claude Code | **removed** from `~/.claude/skills` only after registration **and** evidence that Claude Code installed the plugin | the plugin bundles the skills |
| Codex | stay (`~/.codex/skills`) | the Codex plugin bundles only the command wrapper skills; nested skill scanning is unverified |
| agy | stay (`~/.gemini/config/skills`) | skill bundling is unverified (`agy plugin validate` processed 9 skills) |
| OpenCode | stay | plugins cannot bundle skills |
| all | `~/.agents/skills` always stays as the shared store | |

## Rules

- **Registration first, evidence second.** Registration means `settings.json` holds the marketplace and `enabledPlugins` keys; that alone proves nothing about an installed plugin. Copies are removed only when Claude's plugin state shows the install: an entry for `bdb-aos@bdb-marketplace` in `~/.claude/plugins/installed_plugins.json`, or a cache directory `~/.claude/plugins/cache/bdb-marketplace/bdb-aos/<version>`. Either way the directory must resolve (realpath) under `~/.claude/plugins`, must not be cached from another (older external) marketplace, and must contain `skills/<name>/SKILL.md` for a skill the install manifest lists for `~/.claude/skills`. `installPath: "/"`, an empty `skills` dir or a path elsewhere do not count. The `installed_plugins.json` shape (`{version, plugins: {"<name>@<marketplace>": [{installPath, ...}]}}`) is verified against other plugins on a local machine; that `bdb-aos` writes the same shape and the cache layout fallback are **inferred**, not observed.
- **The CLI installs the plugin.** Measured on one machine (Claude Code CLI): writing `extraKnownMarketplaces` and `enabledPlugins` to `settings.json` does **not** make Claude Code fetch the marketplace or install the plugin, even after a restart. What works is `claude plugin marketplace add hybridlabor-api/aos` followed by `claude plugin install bdb-aos@bdb-marketplace`. So after registration the installer runs, best-effort and without a shell (120 s timeout each, only against the real home): `claude plugin marketplace list`; `marketplace add` when `bdb-marketplace` with source `hybridlabor-api/aos` is missing; `claude plugin list`; `install` when `bdb-aos@bdb-marketplace` is missing, or `update` when the listed version differs from the package version. It then re-checks the evidence above, so the loose copies are retired in the same run when the install is real. A marketplace named `bdb-marketplace` with another source is removed (`marketplace remove`) only when this migration replaced the external entry in `settings.json` and no other plugin uses it; otherwise it is left alone with a message.
- **CLI missing or failing.** If `claude` is not on PATH, a step fails or times out, the installer prints one line with the two commands (`claude plugin marketplace add hybridlabor-api/aos`, `claude plugin install bdb-aos@bdb-marketplace`), keeps the loose copies, and the AOS install continues. `AOS_PLUGIN_MIGRATION=check`, `--dry-run` and `off` never run the CLI. The CLI is also skipped when `HOME` is redirected (tests, sandboxes) or `AOS_PLUGIN_CLI=off`.
- **Ordering.** The migration runs before the install target loop. Once Claude is covered, `~/.claude/skills` is not written again, so a rerun changes nothing and creates no backup.
- **Merge, never overwrite.** Other keys survive. `settings.json` is backed up (`settings.json.<ts>.bak`) before a change; an unchanged file is not rewritten. A symlinked `settings.json` is written through to its real file and stays a link.
- **Opt-out.** `"bdb-aos@bdb-marketplace": false` in `enabledPlugins` (or `bdb-aos@<old external key>: false`): nothing is registered, nothing is removed.
- **Own copies only, safely resolved.** A file is removed when the install manifest lists it and its bytes still match the recorded hash. Keys with `..` or relative paths are rejected; each file and the root are resolved with `path.resolve` and `fs.realpathSync`, the real file must be a regular file under the real root. If `~/.claude/skills` itself is a symlink, nothing is removed. Edited files and files not in the manifest stay.
- **All or nothing.** If any listed copy is edited or unsafe, nothing is removed, Claude is not treated as covered, the installer names the skills involved and keeps updating the copies it owns. Move your edits out and run the installer again to retire them.
- **OpenWiki daemon.** `openwiki-skill/scripts/` is never retired, and the daemon is installed and run from the installer-owned `~/.agents/skills/openwiki-skill/scripts` (copied there when missing), so scheduled jobs never point into `~/.claude/skills`.
- **Malformed settings.** If `enabledPlugins` or `extraKnownMarketplaces` exists but is not a plain object, registration is refused and nothing is written.
- **One at a time.** A lock file (`~/.agents/.bdb-plugin-migration.lock`, stale after ten minutes or a dead pid) keeps two migrations apart; a file that vanishes mid-run is skipped.
- **Backup before removal.** Removed files are copied to `~/.agents/backups/plugin-migration-<timestamp>/` keeping their path relative to `$HOME`.
- **External marketplace.** An entry pointing at `hybridlabor-api/bdb-marketplace` is replaced by this repo's marketplace (`hybridlabor-api/aos`) only when no other plugin id uses it. Only `bdb-aos@<oldkey>` is renamed to `bdb-aos@bdb-marketplace`; other plugins' ids are never renamed. A foreign marketplace that also lists other plugins stays in place. If the name `bdb-marketplace` itself is that external marketplace with other plugins, or points at another source, registration is refused with a message and nothing changes. Nothing on GitHub is changed.
- **Old command files.** Command files from earlier versions that are no longer in the generated table are not touched by the migration; they are neither removed nor backed up. Only the generated `commands/` set is kept in sync by `scripts/build-plugin-manifest.mjs`.
- **State.** `~/.agents/.bdb-plugin-migration.json` records each change: `addedMarketplace`, `addedEnabled`, `replaced`, `renames`, `keptForeign`. Deregistering reverses exactly those.

## Measured vs unverified

- **Measured:** the settings-only registration does not install the plugin; the `marketplace add` + `install` sequence does, `claude plugin list` then shows version, scope user, status enabled, and `installed_plugins.json` gains the entry (one machine, macOS).
- **Unverified:** CLI behaviour on other Claude Code versions and on Windows; the exact text layout of `marketplace list` and `plugin list` (entries are matched by name plus the next few lines: source repo, `Version:`); that `marketplace remove` leaves installed plugins from other marketplaces alone; `plugin update` semantics.

## Packaging

The npm package ships `plugins/bdb-aos-codex/` (a real directory) and the root manifests (`plugin.json`, `.codex-plugin/`, `.agents/plugins/marketplace.json`, `commands/`, `agy-commands/`). `plugins/bdb-aos/` is built from symlinks and is **not** in the npm package. The Claude Code plugin directory (`.claude-plugin/` and `plugins/bdb-aos/`) is git-only: Claude installs it from the GitHub marketplace `hybridlabor-api/aos`, not from npm. `.agents/plugins` (the Codex marketplace file) is excluded from the `.agents` copies into `~/.agents` and project directories.

The root `.codex-plugin/.mcp.json` is no longer referenced: the previous manifest pointed at it through an `mcp_config` key, which real Codex plugins do not use (they use `mcpServers`). It stays unreferenced on purpose, because the installer already registers the MCP servers in Codex's config and the plugin would register them twice. The plugin therefore delivers no MCP servers.

## Opt out and preview

```bash
AOS_PLUGIN_MIGRATION=off   npx -y @hybridlabor-api/aos@latest   # skip entirely
AOS_PLUGIN_MIGRATION=check npx -y @hybridlabor-api/aos@latest   # report only
npx -y @hybridlabor-api/aos@latest --plugin-migration=off|check
```

`--dry-run` implies `check`. Default is on.

## Undo

```bash
aos-uninstall --restore-plugin-backup   # puts removed files back, never overwrites an existing file
aos-uninstall                           # also removes the plugin registration it added and restores a replaced external marketplace
```

## Known limits

- The lock guards migrations only. An installer copy running at the same moment in another process is not serialized; a file removed under it is skipped, and the next run reconciles.
- Until the plugin is installed (CLI step succeeded or you ran the two commands), both copies exist; skills may then appear twice after the plugin loads and before the next installer run retires the copies.
- `aos-doctor` accepts the plugin evidence as Claude having the skills.
- A deregister that reverses a marketplace rename keeps the content of `enabledPlugins` but may reorder its keys (cosmetic).
- Restoring a backup after an uninstall creates a new install manifest and puts the legacy `~/.claude/skills/startcycle` marker back, so AOS is detected as installed again.

Backups survive uninstall (the state keeps its backup index and `~/.agents/backups/plugin-migration-*` is scanned), so `--restore-plugin-backup` also works afterwards. Restored files are recorded in the install manifest, and the restore deregisters the plugin so skills are not loaded twice; the restore also sets `bdb-aos@bdb-marketplace` to `false` in `settings.json` (the opt-out), so the next installer run does not register the plugin or retire the restored files. Set it back to `true` to migrate again.
