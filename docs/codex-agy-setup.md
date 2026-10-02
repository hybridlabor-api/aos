# Codex and Antigravity (agy) plugin setup

Both manifests are generated from `plugin-commands.json` by `node scripts/build-plugin-manifest.mjs` and checked by `--check` (stale or missing files, version drift against `package.json`, referenced files, no `disable-model-invocation` in any Codex output).

## Codex

- **Load:** `codex plugin marketplace add <path-to-this-repo>` (it reads `.agents/plugins/marketplace.json`), then `codex plugin add bdb-aos@bdb-aos`.
- **Invoke:** `$bdb-aos:<cmd>`, for example `$bdb-aos:setup`. Codex has no `/` command for plugin skills.
- **How it is built:** each command becomes a wrapper skill in `plugins/bdb-aos-codex/skills/<cmd>/SKILL.md`. The plugin ships only these wrappers; the 200+ AOS skills reach Codex through the installer's `~/.codex/skills` copies, and a wrapper tells the model which one to run.
- **Bodies:** `bodies.codex` is optional; without it the Claude body is used with `/bdb-aos:<cmd>` rewritten to `$bdb-aos:<cmd>`.

## Antigravity (agy)

- **Load:** `agy plugin install` against `plugins/bdb-aos` (its `plugin.json` sits at the plugin root), or `agy plugin validate plugins/bdb-aos` to check it.
- **Invoke:** `/bdb-aos:<cmd>`, for example `/bdb-aos:setup`.
- **Bodies:** commands reuse `commands/<cmd>.md`. A command with `bodies.agy` is written to `agy-commands/<cmd>.md` and wired instead.
