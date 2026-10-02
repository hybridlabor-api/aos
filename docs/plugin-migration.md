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
- **Not verifiable yet.** The installer registers the plugin, keeps every copy and prints "restart Claude Code, then run the installer again to retire the loose copies". The retirement happens on a later run once the evidence exists. Until then the installer keeps writing `~/.claude/skills` as before.
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
- Until Claude Code shows the plugin as installed, both copies exist; skills may then appear twice after the plugin loads and before the next installer run retires the copies.
- `aos-doctor` accepts the plugin evidence as Claude having the skills.

Backups survive uninstall (the state keeps its backup index and `~/.agents/backups/plugin-migration-*` is scanned), so `--restore-plugin-backup` also works afterwards. Restored files are recorded in the install manifest, and the restore deregisters the plugin so skills are not loaded twice; the restore also sets `bdb-aos@bdb-marketplace` to `false` in `settings.json` (the opt-out), so the next installer run does not register the plugin or retire the restored files. Set it back to `true` to migrate again.
