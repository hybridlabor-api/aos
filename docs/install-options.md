# Install options

Flags for `npx @hybridlabor-api/aos` (and `aos update`). Defaults give today's install.

## Profiles

`--profile=minimal|standard|full` (or `--profile minimal`), or `AOS_PROFILE`. The flag wins.
A flag on the command line is saved in `~/.aos/v5-settings.json`, so `aos update` keeps it.
`AOS_PROFILE` applies to that run only and is never saved. Only a real install or update saves
anything: `--help`, `--version`, `--dry-run`, `aos status` and uninstall never write the file.

Change it in `aos`, Settings, Profile (choose `standard` to reset). Uninstall moves the saved
options (profile, `--no-hooks`, disabled packages) to `~/.aos/v5-settings.json.removed-<timestamp>`;
nothing is deleted.

`aos update` and `aos repair` skip every package the profile excludes, the same as a package
disabled in Settings.

| Profile | What you get |
|---|---|
| `standard` (default) | Today's install: skills, agents, rules, all hooks, MCPs, unified memory (memB, deja, OpenWiki), Token Saver, the MCP gateway, the AOS Hub service and, when Claude Code is found, the Claude Code mods (fleet, sessions, alert). |
| `minimal` | Skills, agents and harness rules. No context-injection hooks, no unified memory (memB, deja, OpenWiki), Token Saver, Codenotch, optional modules, gateway, hub service or Claude Code mods. |
| `full` | `standard` plus every optional module when run with `-y` (same as `--modules=all`). |

An explicit `--modules=` still wins over the profile.

A corrupt or oddly shaped `~/.aos/v5-settings.json` never stops status, update, repair or
uninstall: unknown profile names, a `disabled` that is not a list of known package ids and a
`noHooks` that is not true/false are ignored with one warning, and the rest is used.

## Skill set

`--skill-set=all|core`, saved in `~/.aos/v5-settings.json` like `--profile` (a flag on the command line is saved;
`aos update` keeps it). Default `all`: every shipped skill is installed, as before.

`core` installs only the skills named in `lib/core-skills.json`. The rest stay inside the npm package and install
offline on demand: `aos store list --source=aos`, `aos store install <name>`. The list is the proposal from
`docs/skill-audit-5.4.md`; it is not final until the owner approves it.

When an install or update runs with `core`, installed copies of moved skills are removed from the global skill dirs:
only folders the installer wrote (install manifest), edited or foreign files are copied to
`~/.agents/backups/skill-set-core-<timestamp>/` first, and skills you installed yourself with `aos store install`
are left alone. The run prints which skills moved and how to install them. Switch back with `--skill-set=all`.

## Hooks

- `--no-hooks` skips only the context-injection hooks: `memb-inject`, `rules-inject`,
  `trail-relay`, `trail-autostart`. Applies to Claude Code, Antigravity and Codex entries.
  It is a switch: `--no-hooks=false` or `--no-hooks=0` is an error.
- **The gate and safety hooks are always installed and never removed by any profile or flag:**
  `go-gate`, `go-token`, `go-grant`, `graph-gate`, `conventional-commits`, `env-file-protection`.
  (Claude Code gets all six. Antigravity wires go-gate, graph-gate, conventional-commits and
  env-file-protection; Codex wires the same four. `memb-session-save` and `trail-autostart` are Claude-only by design: the first reads the Claude transcript format, the second reacts to the Agent/Task tool.)
- `gate-profile.mjs` is not a hook entry but `go-gate.mjs` imports it, so it is copied next to
  `go-gate.mjs` in every hook dir (Claude, Antigravity, Codex; `HOOK_IMPORTS` in `lib/v5/profile.js`)
  and into `~/.aos/bin`. It is installed with the gate hooks and is not affected by `--no-hooks`
  or any profile. The `aos-gate` CLI (`status`, `profile strict|work|off [--for 4h]`) is the
  `aos-gate` entry in `package.json` `bin`; the installer writes no `~/.local/bin` launcher for
  it. See `docs/gate-profile.md`.
- A later install with `--no-hooks` removes already wired context entries from those configs.
  It also rewrites hook entries of yours whose command only names a bdb script (the match is on
  the script name inside the command).
- Claude event lists that only held context hooks (`Notification`, `PostToolUse`, `SubagentStop`)
  stay as empty arrays under `--no-hooks`; that is valid and harmless.
- **The OpenCode plugin (`bdb-aos.js`) is not affected by `--no-hooks` or `minimal`:** it still
  injects memB and the rules and autostarts the trail.
- `--hooks-only` installs or refreshes the hooks and their settings entries, then exits. It runs
  before the intro, the telemetry card and the update check. Combine it with `--no-hooks` to
  refresh the gates only. With `--profile` or `--without`, or with `aos status|update|repair`, it
  is an error.
- One list of hook script names (`lib/v5/profile.js`: `ALWAYS_HOOKS`, `CONTEXT_HOOKS`,
  `OTHER_HOOKS`) feeds the Claude, Antigravity and Codex merges and the uninstaller.

## Excluding things

- `--without=id,id` (or `--without id,id`) adds ids to the v5 `disabled` list (saved; `aos update`
  and `aos repair` skip them).
  Ids are the registry ids: `memb, synapse, openwiki, remote, ao, creator, hardware, rustauri,
  styleseed, installer, deja, token-saver, codenotch, gateway, hub, fleet, sessions, alert`, plus
  the bundle `memory` (= `memb,deja,openwiki`). An unknown id is an error;
  `kernel` cannot be excluded. A fresh install honours the ids it would install: OpenWiki, Token Saver,
  Codenotch, the optional modules (memb, synapse, remote, ao, creator, hardware, installer), `gateway`,
  `hub` and the Claude Code mods `fleet`, `sessions` and `alert`. `deja` comes with `memb`, so for it
  the list only changes update and repair.
- **Unified memory** (memB, deja, OpenWiki, plus Codebase Memory MCP in coding mode) is on by
  default in the standard profile and with `-y`; an interactive install asks in a "Unified memory"
  step (default on, "Skip" is saved like `--without=memory`). `--without=memory` or
  `--profile=minimal` turn it off; then no harness gets `memb_mcp`, `deja` or `memb-inject`.
  Details: [unified-memory.md](unified-memory.md).
- The Claude Code mods are enabled only when Claude Code is found (and at least 2.1.287). An
  interactive install offers them, all ticked; an unticked mod is added to the `disabled` list. With
  `-y` all three are enabled. `AOS_NO_FLEET=1` and an `enabledPlugins` entry set to `false` still win.
- On Linux and Windows the gateway and the hub service are installed, but harnesses switch to the
  gateway only after its verify is green; until then they stay direct.
- `AOS_DISABLED_MCPS=a,b` keeps those shipped MCP server names out of the harness MCP configs the
  installer writes (`installMcpsForTarget` and the universal sync that reuses its result). It does
  not touch the memB sync, OpenWiki or the gateway, is not saved, and unknown names are ignored with
  one warning. Entries already in a config stay.

## Dry run, status, reset

- `--dry-run` writes nothing, including the settings file.
- `aos status` prints the profile. Repair: `aos repair`. Uninstall: `aos`, Uninstall.

## Not built on purpose

Custom data home, token env vars, capability selection and per-hook-ID disable. Add them
when a real use needs them.
