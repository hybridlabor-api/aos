# Installer v5 — review of install options V28 (sonnet, read-only, at 370bef3)

No path was found where a profile or flag removes a gate hook in Claude, agy or Codex. Findings below.

## Repair (worker contract; Edit/Write only, no commit, no shell)

| ID | Fix |
|---|---|
| S1 (blocking) | lib/v5/profile.js: validate profile with `Object.hasOwn(PROFILES, x)` (also for the saved value); `--profile=constructor|toString|__proto__` = clear error, saved `{"profile":"__proto__"}` falls back to standard with one warning. Tests incl. these values. |
| S2 | `resolve`/readSettings must validate shapes: `disabled` must be an array of known string ids (else ignored with a warning), `profile` a known string, `noHooks` boolean. A corrupt or odd settings file must never brick status/update/repair/uninstall (no throw at the start of main()). Tests: null, string, array of numbers, `__proto__`, invalid JSON. |
| S3 | Persistence reset: Uninstall (bin/aos-uninstall.mjs and the v5 Uninstall entry) removes `~/.aos/v5-settings.json` profile/noHooks/disabled keys it owns (move the file to `.removed-<ts>`, never delete); an env AOS_PROFILE / flag is persisted only when given on the command line of a real install (not from an inherited env unless explicit `--save-profile`: keep it simple: env is NOT persisted). Settings → Profile can set standard again. Test. |
| S4 | applyInstallOptions must not persist anything before `--help`, `-V/--version` and `--dry-run` are handled, and not when the command is uninstall/status. Test. |
| S6 | menu.update/repair: honour the profile `exclude` list for ALL packages (not only fleet), same as `disabled`. Test. |
| R1 | One source of truth for the hook names: derive `bdbHookScripts`/`bdbScripts` (Claude, agy, Codex) from `ALWAYS_HOOKS` + `CONTEXT_HOOKS` + the few non-profile scripts in one exported list in lib/v5/profile.js (or a tiny lib/hook-names.js) and import it in installer.js and lib/uninstall-records.js and bin/aos-uninstall.mjs if they hold copies. Test: every `.claude/hooks/*.mjs` that the shipped settings template references is in exactly one of the lists. |
| R2/T1/T3 | Real tests (container-only where they run the installer, inline temp HOME): after install with `--no-hooks`, `--profile=minimal` and `--hooks-only`, the written Claude settings, agy hooks and Codex toml contain go-gate, go-token, go-grant, graph-gate, conventional-commits, env-file-protection and NO context hook; a full dry-run (not hooks-only) writes nothing. |
| P1/P2/P3 | `--hooks-only` combined with `--profile`/`--without` = clear error; `--no-hooks=false|0` = error ("flag takes no value"); accept `--profile minimal` (space form) as well as `=`; `--without` ids that a fresh install cannot honour (gateway, fleet, deja): say so in the help text and docs instead of implying more. |
| R3/R4/D1/D2/D3 | Docs only (docs/install-options.md, help text): empty event arrays are fine or filter them out; state plainly that the OpenCode plugin bdb-aos.js still injects memb/rules and trail autostart under --no-hooks/minimal; Uninstall resets the saved profile (after S3); AOS_DISABLED_MCPS is not persisted and only filters the harness MCP configs written by installMcpsForTarget (not memb sync, openwiki, gateway); `--no-hooks` also rewrites user entries that only name a bdb script. |
| S5 | `--hooks-only` runs before intro/telemetry/update check; `aos update --hooks-only` either works or errors clearly. |

Out of scope: .claude/hooks/*, lib/v5/packages.js memb parts (other worker), lib/gateway/*, lib/a2a-*.
