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
| `standard` (default) | Today's install: skills, agents, rules, all hooks, MCPs, OpenWiki, Token Saver, fleet. |
| `minimal` | Skills, agents and harness rules. No context-injection hooks, no OpenWiki, Token Saver, Codenotch, optional modules, gateway or fleet. |
| `full` | `standard` plus every optional module when run with `-y` (same as `--modules=all`). |

An explicit `--modules=` still wins over the profile.

A corrupt or oddly shaped `~/.aos/v5-settings.json` never stops status, update, repair or
uninstall: unknown profile names, a `disabled` that is not a list of known package ids and a
`noHooks` that is not true/false are ignored with one warning, and the rest is used.

## Hooks

- `--no-hooks` skips only the context-injection hooks: `memb-inject`, `rules-inject`,
  `trail-relay`, `trail-autostart`. Applies to Claude Code, Antigravity and Codex entries.
  It is a switch: `--no-hooks=false` or `--no-hooks=0` is an error.
- **The gate and safety hooks are always installed and never removed by any profile or flag:**
  `go-gate`, `go-token`, `go-grant`, `graph-gate`, `conventional-commits`, `env-file-protection`.
  (Claude Code gets all six. Antigravity wires go-gate, graph-gate, conventional-commits and
  env-file-protection; Codex wires go-gate and graph-gate.)
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
  Ids are the registry ids: `memb, synapse, openwiki, remote, ao, creator, hardware, installer,
  deja, token-saver, codenotch, gateway, fleet`. An unknown id is an error; `kernel` cannot be excluded.
  A fresh install honours the ids it would install: OpenWiki, Token Saver, Codenotch and the optional
  modules (memb, synapse, remote, ao, creator, hardware, installer). `gateway` and `fleet` are never
  installed by a fresh install, and `deja` comes with `memb`, so for those three the list only changes
  update and repair.
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
