# Plugin registration and loose-copy migration

The installer registers the `bdb-aos` plugin for Claude Code. Skills are installed separately by the AOS installer and are NOT bundled by the plugin. All harnesses keep their loose skill copies as the single source of truth. Hooks, MCP servers, `trail-autostart` and the bus stay in the installer, so disabling the plugin never disables the go-gate.

| Harness | Loose copies | Why |
|---|---|---|
| Claude Code | stay in `~/.claude/skills` | the plugin bundles only commands and agents; skills are installed separately by AOS |
| Codex | stay (`~/.codex/skills`) | the Codex plugin bundles only the command wrapper skills; skills are installed separately by AOS |
| agy | stay (`~/.gemini/config/skills`) | the agy plugin bundles only commands; skills are installed separately by AOS |
| OpenCode | stay | plugins cannot bundle skills; skills are installed separately by AOS |
| all | `~/.agents/skills` always stays as the shared store | |

## Rules

- **Registration only.** Registration means `settings.json` holds the marketplace and `enabledPlugins` keys for the `bdb-aos` plugin. No loose copies are removed; the plugin bundles only commands and agents. Skills are installed separately by the AOS installer and live permanently in each harness's loose skill directory (`~/.claude/skills`, `~/.codex/skills`, etc.) as the single source of truth. The `installed_plugins.json` shape and plugin cache are not checked.
- **The CLI installs the plugin (optional).** Writing `extraKnownMarketplaces` and `enabledPlugins` to `settings.json` does **not** make Claude Code fetch the marketplace or install the plugin, even after a restart. For best results, run `claude plugin marketplace add hybridlabor-api/aos` followed by `claude plugin install bdb-aos@bdb-marketplace`. After registration the installer may attempt these steps, best-effort and without a shell (120 s timeout each, only against the real home), to ensure the plugin is installed so users get command entry points. However, since the plugin no longer bundles skills, the CLI installation is not required for skill access—loose copies provide all skills in all harnesses. A marketplace named `bdb-marketplace` with another source is removed (`marketplace remove`) only when this migration replaced the external entry in `settings.json` and no other plugin uses it; otherwise it is left alone with a message.
- **CLI missing or failing.** If `claude` is not on PATH, a step fails or times out, the installer prints a message with the two commands (`claude plugin marketplace add hybridlabor-api/aos`, `claude plugin install bdb-aos@bdb-marketplace`) and the AOS install continues. Users can run these commands manually later to install the plugin and access command entry points. `AOS_PLUGIN_MIGRATION=check`, `--dry-run` and `off` never run the CLI. The CLI is also skipped when `HOME` is redirected (tests, sandboxes) or `AOS_PLUGIN_CLI=off`.
- **Ordering.** The migration runs before the install target loop. Since no loose copies are removed, a rerun creates no backup and changes nothing (idempotent).
- **Merge, never overwrite.** Other keys survive. `settings.json` is backed up (`settings.json.<ts>.bak`) before a change; an unchanged file is not rewritten. A symlinked `settings.json` is written through to its real file and stays a link.
- **Opt-out.** `"bdb-aos@bdb-marketplace": false` in `enabledPlugins` (or `bdb-aos@<old external key>: false`): nothing is registered, nothing is removed.
- **No removals.** Loose skill copies are never removed by the plugin migration. All harnesses keep their copies permanently.
- **Malformed settings.** If `enabledPlugins` or `extraKnownMarketplaces` exists but is not a plain object, registration is refused and nothing is written.
- **One at a time.** A lock file (`~/.agents/.bdb-plugin-migration.lock`, stale after ten minutes or a dead pid) keeps two migrations apart; a file that vanishes mid-run is skipped.
- **External marketplace.** An entry pointing at `hybridlabor-api/bdb-marketplace` is replaced by this repo's marketplace (`hybridlabor-api/aos`) only when no other plugin id uses it. Only `bdb-aos@<oldkey>` is renamed to `bdb-aos@bdb-marketplace`; other plugins' ids are never renamed. A foreign marketplace that also lists other plugins stays in place. If the name `bdb-marketplace` itself is that external marketplace with other plugins, or points at another source, registration is refused with a message and nothing changes. Nothing on GitHub is changed.
- **Old command files.** Command files from earlier versions that are no longer in the generated table are not touched by the migration; they are neither removed nor backed up. Only the generated `commands/` set is kept in sync by `scripts/build-plugin-manifest.mjs`.
- **State.** `~/.agents/.bdb-plugin-migration.json` records each change: `addedMarketplace`, `addedEnabled`, `replaced`, `renames`, `keptForeign`. Deregistering reverses exactly those.

## Measured vs unverified

- **Measured:** the settings-only registration does not install the plugin; the `marketplace add` + `install` sequence does, `claude plugin list` then shows version, scope user, status enabled, and `installed_plugins.json` gains the entry (one machine, macOS).
- **Unverified:** CLI behaviour on other Claude Code versions and on Windows; the list output format on other Claude Code versions (the parsers match `❯ <name>` headers with `Source: GitHub (owner/repo[@ref])`, `Version:` and `Status:` lines and ignore the `From claude.ai:` section; the format was captured read-only on one machine and is used as the test fixture); that `marketplace remove` leaves installed plugins from other marketplaces alone; `plugin update` semantics.

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
aos-uninstall                  # removes the plugin registration it added and restores a replaced external marketplace
```

Since no files are removed during plugin migration, there are no backups to restore. Uninstall simply reverses the registration changes.

## Known limits

- The lock guards migrations only. An installer copy running at the same moment in another process is not serialized.
- `aos-doctor` checks loose copies for skill health.
- A deregister that reverses a marketplace rename keeps the content of `enabledPlugins` but may reorder its keys (cosmetic).
