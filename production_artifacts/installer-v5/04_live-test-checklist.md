# AOS v5 installer: live test checklist (V12)

Sources: `01_plan.md` (plan), `lib/v5/menu.js` (menu), `lib/v5/packages.js` (packages), `bin/aos-doctor.mjs` (doctor), `bin/aos-uninstall.mjs` (uninstall).
Rule: where a source does not name a command, this list says "not covered by sources" instead of guessing one.
Mark each step: `[ ]` open, `[x]` pass, `[F]` fail (write the output into the report, section 7).

## 0 Before you start
- [ ] **Prefer a dedicated test user or container** (plan section 6 tests run in a container only). Real home = last resort.
- [ ] Copy-backup, real home only: copy `~/.claude/settings.json` and the whole `~/.aos` dir to a backup folder outside both (plain copy, delete nothing).
  Expected: both copies exist. Why: Fleet, hooks and plugin entries are written to settings.json (menu.js Harnesses step, aos-uninstall.mjs).
- [ ] Also copy `~/.agents/.bdb-install-manifest.json` (uninstall is manifest-driven, aos-uninstall.mjs header). Expected: copy exists.
- [ ] Note the starting state: `aos doctor` once, save output (aos-doctor.mjs usage line; `--json` is also accepted). Expected: report prints, exit code noted.
- [ ] Do not run `--purge` on the real home (deletes `~/.MemBDB` memory store, aos-uninstall.mjs DATA_PATHS).

## 1 Status (menu.js `status`, `runCommand`)
- [ ] Run `aos status`. Expected: one line per installed package, `✔ <name> <version>` or `✖ <name> <version> — <reason>`, last line `N updates available` (plus `, M broken` if any). No prompt.
- [ ] Check `echo $?` right after. Expected: 0 if nothing broken, 1 if any `✖`.
- [ ] On a machine without AOS, `aos status` prints "AOS is not installed here. Run `aos` to install it." and exits 1 (menu.js `runCommand`); only test this in the test user/container.
- [ ] Run `aos` (menu). Expected: entries Status, Update, Repair, Settings, Uninstall, Exit; default is Status, or `Update (N available)` when N > 0 (menu.js `menu`).
- [ ] Run `aos doctor`. Expected: sections PREREQ, AOS-CORE, HARNESSES, HOOKS, PLUGINS, DAEMONS, gateway; final line "ALL CRITICAL CHECKS PASSED" or a count of critical fails with `Fix:` hints (aos-doctor.mjs `report`).

## 2 Update, outdated case (menu.js `update`, plan section 4)
- [ ] Precondition: `aos status` shows `<local> -> <remote>` for at least one package. If none is outdated, mark N/A; no way to fake it is named in the sources (version cache is `~/.aos/cache/versions.json`, 24 h, plan section 3).
- [ ] Run `aos update`. Expected order of output: "N update(s) available", then `✔`/`✖` lines for Kernel, Harnesses, each installed package, then "Optional, not installed: ..." and "Verify: all ok" (or `Verify: M step(s) broken, log <path>`).
- [ ] Expected: the outdated package shows the new version in its `✔` line; log written under `~/.aos/logs/update-<ts>.log` (plan section 3 `run.js`, menu.js `logFileFor`).
- [ ] If the kernel itself is outdated: expected output "AOS <x> available: run `npx @hybridlabor-api/aos@latest`" and exit 1 (menu.js `stale`), not a success claim.
- [ ] Run `aos update` a second time. Expected: **0 prompts**, "Everything is current", "Verify: all ok", exit 0 (plan goal, section 1).
- [ ] After update: `aos doctor`. Expected: memB MCP venv "entry module imports OK" (aos-doctor.mjs `checkDaemonsAndModules`).

## 3 Repair: break the memB venv on a COPY only (packages.js memB `verify`/`repair`, plan section 5)
Never break the live venv. Use a test user/container, or work on a copy of the memB module dir and point nothing at it.
- [ ] Action (test user/container): make `~/.agents/memB/.venv/bin/python` missing or dangling (rename or dangling link), nothing deleted. Expected: `aos status` shows `✖ memB ... — venv python missing or not runnable` and exit 1 (packages.js `venvBroken`).
- [ ] Run `aos repair`. Expected: `✔ memB repaired`, old venv kept as `.venv.broken-<ts>` next to the new `.venv` (rename, no delete; packages.js `repair`).
- [ ] Run `aos status`. Expected: memB `✔`, exit 0.
- [ ] Run `aos doctor`. Expected: "memB MCP venv" entry import OK; the `.bak` line lists old files and never deletes them (aos-doctor.mjs `checkInstallerBaks`).
- [ ] Memb-mcp copy check: `~/.gemini/config/mcps/memb-mcp` version equals memB version after `aos update`/`repair` (packages.js `copyProblem`/`syncMcpCopy`). Expected: no "memb-mcp copy X != memB Y" in `aos status`.

## 4 Settings (menu.js `settings`)
Open via `aos` then Settings.
- [ ] **Secrets re-ask**: options include `Re-enter GITHUB_PERSONAL_ACCESS_TOKEN` (suffix `(skipped)` if you blanked it earlier); OpenWiki key only if OpenWiki is installed. Choose it, enter a value. Expected: stored, no echo of the value in the log. Do not paste the value in the report.
- [ ] Blank answer. Expected: key shows `(skipped)` next time and a later `aos update` does not ask again (plan section 3 `secrets.js`, section 6 test 5).
- [ ] Secrets file permission: `aos doctor` shows "MCP secrets file ... (mode 600)" (aos-doctor.mjs `checkMcpSecrets`); no "MCP inline secret" entries.
- [ ] **Disabled list**: choose `Disable <package>`. Expected: stored in `~/.aos/v5-settings.json` (`disabled` list, menu.js `writeSettings`); `aos update` and `aos repair` skip that package. Then `Enable <package>` removes it again.
- [ ] **Fleet opt-out**: choose `Disable bdb-aos-fleet` (or run with `AOS_NO_FLEET=1`; plan section 7a). Expected: next `aos update` does not enable the fleet plugin; settings.json `enabledPlugins` is not re-set.
- [ ] `Install bdb-aos-fleet` while opted out. Expected: asked "opted out ... Enable it anyway?" (menu.js), and a clear error if Claude Code is below the minimum version (packages.js fleet `install`).
- [ ] Gateway: in the Settings list it appears as an optional package, not installed. Expected: nothing installed unless you pick `Install` (menu.js, packages.js gateway comment "opt-in").

## 5 Harness checks
Evidence for "connects": the harness's own MCP/plugin view. The exact command or UI per harness is not covered by sources; use it and record what you saw. Doctor gives the file-level proof.
- [ ] **Claude Code**: open a new session. Expected: `memb_mcp` listed as connected in the MCP view; hooks wired (doctor "Claude settings.json wired"); plugin `bdb-aos@bdb-marketplace` enabled (doctor "Claude Code bdb-aos plugin").
- [ ] Claude fleet plugin: `bdb-aos-fleet` in `enabledPlugins` of `~/.claude/settings.json` (unless opted out in section 4) and `aos status` shows a fleet `✔` (needs Claude Code >= 2.1.287, plan 7a).
- [ ] **Codex**: Expected: `memb_mcp` connects in a new Codex session; doctor "Codex config.toml hooks" wired, "Codex bdb-aos plugin" present, no "Codex duplicate skills".
- [ ] **agy (Antigravity)**: Expected: `memb_mcp` connects; doctor "Antigravity hooks" shows `6/6 named aos-* hooks`, "Antigravity bdb-aos plugin" present, and **no** "mcsc not in agy config" failure (fork-bomb guard, aos-doctor.mjs `checkAgyMcsc`).
- [ ] **OpenCode**: Expected: `memb_mcp` connects; doctor "OpenCode MCP names" shows none over 64 characters (`checkOpencodeMcpNames`); OpenCode checks from `lib/opencode-verify.js` show no failures.
- [ ] In all four: if `memb_mcp` fails, run `aos doctor` and copy the "memB MCP venv" line (that check imports `memb` and `run` in the venv, aos-doctor.mjs).
- [ ] **Gateway off by default**: `aos doctor` gateway entries are warnings only, `Remote Gateway (:9080)` is "not listening" (warning), and no gateway service was started by install/update. Expected: no gateway running unless installed through Settings.

## 6 Uninstall (aos-uninstall.mjs)
- [ ] Dry run first: `aos-uninstall --dry-run`. Expected: counts of unchanged/edited/gone files, services, modules, "Bleibt erhalten" list, ends "[dry-run] Es wurde nichts verändert." Compare against your backup, nothing changed.
- [ ] Test user/container only: `aos-uninstall`, answer `ja` at "Fortfahren? [ja/nein]". Expected: services stopped, files removed, edited files get `.bak`, fleet entry removed, BDB hooks removed from settings.json, other settings.json content unchanged (diff against the backup copy), ends "Fertig. Neu einrichten mit: npx -y @hybridlabor-api/aos@latest".
- [ ] Data survives without `--purge`: `~/.MemBDB`, `~/.openwiki` still exist.
- [ ] After uninstall: `aos status` prints "AOS is not installed here" (legacy markers removed, aos-uninstall.mjs `LEGACY_MARKERS`). Expected: exit 1.
- [ ] Optional: `aos-uninstall --restore-plugin-backup` (restores skill copies the plugin migration removed). Expected: files restored, no overwrite.
- [ ] `--purge`: test user/container only; needs `ja` then typing `PURGE`. Expected: only the listed data paths are deleted.

## 7 What to report back
- [ ] Setup used (real home / test user / container), OS, Claude Code version.
- [ ] Per section: pass/fail per step, with the failing step's exact output (max 20 lines).
- [ ] `aos status` output before and after Update (secrets masked).
- [ ] The path of the newest `~/.aos/logs/update-<ts>.log` if any `✖` appeared.
- [ ] `aos doctor` summary line before and after, plus every `Fix:` hint it printed.
- [ ] `memb_mcp` connection result per harness (Claude, Codex, agy, OpenCode).
- [ ] Anything that asked a question during the second `aos update` (should be none).
- [ ] Verdict: ready for sonnet review, yes or no. No release without Tim's GO (plan header).
