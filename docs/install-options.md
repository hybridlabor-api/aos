# Install options

Flags for `npx @hybridlabor-api/aos` (and `aos update`). Defaults give today's install.

## Profiles

`--profile=minimal|standard|full`, or `AOS_PROFILE`. The flag wins. The choice is saved in
`~/.aos/v5-settings.json`, so `aos update` keeps it. Change it in `aos`, Settings, Profile.

| Profile | What you get |
|---|---|
| `standard` (default) | Today's install: skills, agents, rules, all hooks, MCPs, OpenWiki, Token Saver, fleet. |
| `minimal` | Skills, agents and harness rules. No context-injection hooks, no OpenWiki, Token Saver, Codenotch, optional modules, gateway or fleet. |
| `full` | `standard` plus every optional module when run with `-y` (same as `--modules=all`). |

An explicit `--modules=` still wins over the profile.

## Hooks

- `--no-hooks` skips only the context-injection hooks: `memb-inject`, `rules-inject`,
  `trail-relay`, `trail-autostart`. Applies to Claude Code, Antigravity and Codex entries.
- **The gate and safety hooks are always installed and never removed by any profile or flag:**
  `go-gate`, `go-token`, `go-grant`, `graph-gate`, `conventional-commits`, `env-file-protection`.
- A later install with `--no-hooks` removes already wired context entries from those configs.
- The OpenCode plugin (`bdb-aos.js`) is not affected by `--no-hooks`.
- `--hooks-only` installs or refreshes the hooks and their settings entries, then exits.
  Combine with `--no-hooks` to refresh the gates only.

## Excluding things

- `--without=id,id` adds ids to the v5 `disabled` list (saved; `aos update` skips them).
  Ids are the registry ids: `memb, synapse, openwiki, remote, ao, creator, hardware, installer,
  deja, token-saver, codenotch, gateway, fleet`. An unknown id is an error; `kernel` cannot be excluded.
  A fresh install skips the excluded OpenWiki, Token Saver, Codenotch and optional modules.
- `AOS_DISABLED_MCPS=a,b` keeps those shipped MCP server names out of every harness config the
  installer writes. Unknown names are ignored with one warning. Entries already in a config stay.

## Dry run, status, reset

- `--dry-run` writes nothing, including the settings file.
- `aos status` prints the profile. Repair: `aos repair`. Uninstall: `aos`, Uninstall.

## Not built on purpose

Custom data home, token env vars, capability selection and per-hook-ID disable. Add them
when a real use needs them.
