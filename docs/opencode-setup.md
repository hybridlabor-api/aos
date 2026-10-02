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

OpenCode deliberately runs a small MCP set (`memb_mcp`, `deja`, `zavora_computer_use`). AOS never copies other harnesses' MCP lists into OpenCode and never adds ComfyUI or show-control MCPs there. Media playbooks stop with "Missing MCP" on OpenCode by design.

## Optional components (off by default)

```bash
AOS_OPENCODE_OPTIONAL=ponytail,loop,rtk aos        # or: aos --opencode-optional=ponytail,loop,rtk
```

- `ponytail`: appends `@dietrichgebert/ponytail@4.10.0` to `plugin[]`
- `loop`: appends `@bybrawe/opencode-loop@0.6.2` to `plugin[]`
- `rtk`: prints `brew install rtk && rtk init -g --opencode`; AOS installs nothing

Entries are appended only when no entry for that package exists, after a timestamped `opencode.jsonc.<ts>.bak` backup. AOS never runs foreign installers (the `opencode-loop` npx installer rewrites the config) and skips `orca-opencode-status.js` (the Orca app maintains it) and `dag.jsonc` / GraphAgent (AGPL engine, different program).

## Known limits

- **`/loop-shell` and the go-gate (unverified).** `opencode-loop` can run shell commands as child processes. `tool.execute.before`, where the AOS go-gate sits, may never see them. Do not schedule `git push`, publish or other gated commands through them. The installer prints this warning whenever `opencode-loop` is in `plugin[]`.
- **Machine prompts are never human.** Every prompt the plugin sends itself (loop nudge, bus wake) is `synthetic` and carries `aos_loop` or `aos_bus` metadata, so it cannot count as a GO. A test scans the plugin source for this.
- **Double loading of `bdb-aos.js`.** OpenCode auto-loads `plugins/*.{ts,js}` and also loads paths in `plugin[]`. From the 1.18.30 binary strings: both lists are merged through one de-duplication keyed on the `file://` URL, so the same absolute path loads once (read from the binary, not observed by running OpenCode). A differently spelled second path (checkout path, symlinked config dir) would load twice, giving two gates and two loop keepers. The installer registers exactly one path, `<config>/plugins/bdb-aos.js`, and warns when `plugin[]` holds another spelling.
