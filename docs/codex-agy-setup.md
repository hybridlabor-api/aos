# Codex and Antigravity (agy) plugin setup

Both manifests are generated from `plugin-commands.json` by `node scripts/build-plugin-manifest.mjs` and checked by `--check` (stale or missing files, version drift against `package.json`, referenced files, no `disable-model-invocation` in any Codex output).

## Codex

- **Automatic:** the installer runs `lib/codex-plugin-install.js` when `codex` is on PATH (honours `AOS_PLUGIN_MIGRATION=off|check` and `--dry-run`; never fails the install; leaves `~/.codex/skills` alone). It adds the marketplace from the installed package directory (version-matched, works offline), runs `codex plugin add bdb-aos@bdb-aos`, and on a version change re-points or upgrades the marketplace and adds again. Codex has no `plugin upgrade`; `plugin add` is idempotent and installs the marketplace's current version. What it installed is recorded in `~/.agents/.bdb-codex-plugin.json`, and `aos-uninstall` removes only that (`codex plugin remove bdb-aos@bdb-aos`, then the marketplace if the installer added it).
- **Manual load:** `codex plugin marketplace add <path-to-this-repo>` (it reads `.agents/plugins/marketplace.json`) or `codex plugin marketplace add hybridlabor-api/aos` (GitHub, needs read access), then `codex plugin add bdb-aos@bdb-aos`. Check with `codex plugin list` (`installed, enabled`). The plugin lands in `~/.codex/plugins/cache/bdb-aos/bdb-aos/<version>/`.
- **Verify without a model call:** `codex debug prompt-input hi` lists the model-visible skills, including all 14 `bdb-aos:<cmd>` entries. Restart running Codex sessions after install.
- **Hooks:** the plugin ships none; AOS hooks stay in `~/.codex/config.toml` / `hooks.json` written by the installer.
- **Invoke:** `$bdb-aos:<cmd>`, for example `$bdb-aos:setup`. Codex has no `/` command for plugin skills.
- **How it is built:** each command becomes a wrapper skill in `plugins/bdb-aos-codex/skills/<cmd>/SKILL.md`. The plugin ships only these wrappers; the 200+ AOS skills reach Codex through the installer's `~/.codex/skills` copies, and a wrapper tells the model which one to run.
- **Bodies:** `bodies.codex` is optional; without it the Claude body is used with `/bdb-aos:<cmd>` rewritten to `$bdb-aos:<cmd>`.

## Antigravity (agy)

- **Load:** `agy plugin install` against `plugins/bdb-aos` (its `plugin.json` sits at the plugin root), or `agy plugin validate plugins/bdb-aos` to check it.
- **Invoke:** `/bdb-aos:<cmd>`, for example `/bdb-aos:setup`.
- **Bodies:** commands reuse `commands/<cmd>.md`. A command with `bodies.agy` is written to `agy-commands/<cmd>.md` and wired instead.
