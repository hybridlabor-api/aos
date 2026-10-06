# OpenCode setup

The AOS installer copies these into `~/.config/opencode` (`%APPDATA%\opencode` on Windows):

- `plugins/bdb-aos.js` with `plugins/aos-hooks/` and `plugins/lib/` (go-gate, loop keeper, bus)
- `commands/startcycle-graph.md` and one generated `commands/bdb-aos-<cmd>.md` per AOS command, called as `/bdb-aos-<cmd>` (flat hyphen names; a colon is not valid in Windows file names)

The command files are generated from `plugin-commands.json` by `node scripts/build-plugin-manifest.mjs` and checked by `--check`. A command may carry `bodies.opencode`; without it the Claude body is used with `/bdb-aos:<cmd>` rewritten to `/bdb-aos-<cmd>`.

## Updating and your edits

- A command file you edited is kept; the shipped version lands next to it as `<file>.new`.
- A file that already existed under a shipped name but was never installed by AOS is kept the same way.
- The installer never deletes files it did not create.

## Lean MCP set

OpenCode deliberately runs a small MCP set (`memb_mcp`, `deja`, `zavora_computer_use`). The other servers from the master list are written with `"enabled": false` (not started) and `aos-doctor` warns when anything beyond the lean set is enabled. AOS never adds ComfyUI MCPs. Media playbooks stop with "Missing MCP" on OpenCode by design.

## Optional components (off by default)

```bash
AOS_OPENCODE_OPTIONAL=ponytail,loop,rtk aos        # or: aos --opencode-optional=ponytail,loop,rtk
```

- `ponytail`: appends `@dietrichgebert/ponytail@4.10.0` to `plugin[]`
- `loop`: appends `@bybrawe/opencode-loop@0.6.2` to `plugin[]`
- `rtk`: prints `brew install rtk && rtk init -g --opencode`; AOS installs nothing

Entries are appended only when no entry for that package exists, after a timestamped `opencode.jsonc.<ts>.bak` backup. AOS never runs foreign installers (the `opencode-loop` npx installer rewrites the config) and skips `orca-opencode-status.js` (the Orca app maintains it) and `dag.jsonc` / GraphAgent (AGPL engine, different program).

## Optional permission (off by default)

```bash
AOS_OPENCODE_PERMISSION=external_directory aos     # or: aos --opencode-permission=external_directory
```

Without it OpenCode asks on every access outside the working directory, including `~/.agents` skills. The opt-in sets only `permission.external_directory`, scoped to AOS paths:

```json
"permission": { "external_directory": { "~/.agents/**": "allow", "~/.config/opencode/**": "allow" } }
```

- An existing `permission.external_directory` (any form) is left untouched and a note is printed. A string `permission` (for example `"allow"`) is refused, not replaced. Unparseable config is refused.
- A timestamped `.bak` backup is made before the change; a second run changes nothing and makes no backup. Writing the config drops `//` comments, as with every other AOS config write.
- Schema evidence: the OpenCode 1.18.30 binary accepts a string or a pattern record for `external_directory`, and the permissions docs show `~` and `$HOME` expansion in patterns. Whether the `**` globs match the AOS paths on your machine was not run against a live OpenCode.
- Uninstall: AOS does not record this key, so it stays in place as your config. Remove it by hand.
- Nothing else is touched: no other `permission` key and no `mcp` entry.

## Known limits

- **`/loop-shell` and the go-gate (unverified).** `opencode-loop` can run shell commands as child processes. `tool.execute.before`, where the AOS go-gate sits, may never see them. Do not schedule `git push`, publish or other gated commands through them. The installer prints this warning whenever `opencode-loop` is in `plugin[]`.
- **Machine prompts are never human.** Every prompt the plugin sends itself (loop nudge, bus wake) is `synthetic` and carries `aos_loop` or `aos_bus` metadata, so it cannot count as a GO. A test scans the plugin source for this.
- **Double loading of `bdb-aos.js`.** OpenCode auto-loads `plugins/*.{ts,js}` and also loads paths in `plugin[]`. Verified by running OpenCode 1.18.30 with a probe plugin (init side effect counted, no model call): auto-load alone, auto-load plus the same file as an absolute path, as a `file://` URL, or as a path containing `..` each load it exactly once. A different file also named `bdb-aos.js` (checkout path, symlinked config dir) loads twice, giving two gates and two loop keepers. The installer registers exactly one path, `<config>/plugins/bdb-aos.js`, and warns when `opencode.jsonc` holds another one; `aos-doctor` also reads `opencode.json` and `config.json`, which the installer does not touch.
- **`zavora_computer_use` needs Node.js 20+ and network on first start.** It runs as `npx -y @zavora-ai/computer-use-mcp@7.4.0` (pinned); nothing is bundled or built locally.
- **Windows config directory (unverified).** The installer writes to `%APPDATA%\opencode`; `aos-doctor` looks there and in `~/.config/opencode`. Which of the two OpenCode reads on Windows was not run.

## Verifying

```bash
aos-doctor            # OpenCode plugin file, hooks, registration, commands, CLI view, MCP set; aos-acp; go-check
opencode debug config # what OpenCode resolved: plugin_origins, command, mcp, agent
opencode debug skill  # skills it found
```

Checked on OpenCode 1.18.30 against a fresh `HOME` after a full install: `plugin_origins` holds one `file://.../plugins/bdb-aos.js`, `command` holds the 14 `bdb-aos-*` commands plus `startcycle-graph`, 13 agents come from `~/.opencode/agents`, `debug skill` lists 249 unique skills, and the log shows no plugin error. Tests: `tests/opencode-verify.test.js`; with `AOS_E2E_CLI=1` it installs into a temp `HOME` and asks the real `opencode`.
