# Plugin registration and loose-copy migration

The installer registers the `bdb-aos` plugin for Claude Code, then removes only its own loose skill copies there. Hooks, MCP servers, `trail-autostart` and the bus stay in the installer, so disabling the plugin never disables the go-gate.

| Harness | Loose copies | Why |
|---|---|---|
| Claude Code | **removed** from `~/.claude/skills` after verified registration (`extraKnownMarketplaces` + `enabledPlugins` in `~/.claude/settings.json`) | the plugin bundles the skills |
| Codex | stay (`~/.codex/skills`) | the Codex plugin bundles only the command wrapper skills; nested skill scanning is unverified |
| agy | stay (`~/.gemini/config/skills`) | skill bundling is unverified (`agy plugin validate` processed 9 skills) |
| OpenCode | stay | plugins cannot bundle skills |
| all | `~/.agents/skills` always stays as the shared store | |

## Rules

- **Registration first.** Claude's copies are touched only when its registration succeeded and was re-read from disk in the same run. Invalid `settings.json` or a failed write keeps every copy.
- **Merge, never overwrite.** Other keys survive. `settings.json` is backed up (`settings.json.<ts>.bak`) before a change; an unchanged file is not rewritten.
- **Own copies only.** A file is removed when the install manifest lists it and its bytes still match the recorded hash. Edited files and files not in the manifest stay. Old command files that are no longer in the table are not touched.
- **Backup before removal.** Removed files are copied to `~/.agents/backups/plugin-migration-<timestamp>/` keeping their path relative to `$HOME`.
- **External marketplace.** An entry pointing at `hybridlabor-api/bdb-marketplace` is replaced by this repo's marketplace (`hybridlabor-api/aos`) and the installer says so. Nothing on GitHub is changed.
- Once Claude is covered, the installer no longer writes skills into `~/.claude/skills`; the plugin delivers them. Restart Claude Code so it fetches the plugin.

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

State lives in `~/.agents/.bdb-plugin-migration.json`.
