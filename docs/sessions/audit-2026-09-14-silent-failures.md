# Audit 2026-09-13/14 — the "reports success, does nothing" family

Every defect below was found in one session, and they are all the same shape:
**a component reports a state it is not in.** Not crashes, not exceptions — a
clean run, a green check, and nothing actually delivered. That is why they
survived so many releases: the installer's own output said it worked.

Read this before adding a check anywhere in this repo. The question that
catches this family is not "does the check pass" but **"does the check measure
the thing, or something the tool itself produced?"**

Numbers here are measurements taken on one machine on 2026-09-13/14; they are
evidence for the defect, not invariants.

---

## Fixed and tested

| # | Defect | Why it was invisible |
|---|---|---|
| 1 | `runQuickUpdate()` delivered no harness files — hooks, dispatcher workflows, compiled subagents, `GEMINI.md` | Quick Update is what an existing install is offered. Everything `injectHarnessRules()` does was fresh-install-only, so machines kept first-install agent definitions forever. Fixed once for hooks in 4.4.1; the rest recurred one layer up |
| 2 | `memb-inject.mjs` imported `node:sqlite` at top level, outside its own `try` | The file documents itself as fail-open. A top-level import that throws escapes the `try`, so a Node without unflagged `node:sqlite` got a hook error on every prompt |
| 3 | The same hook read `project_id` from `$.metadata.project_id` | memB stores it at the payload top level. The lookup matched nothing, ever — the injected block rendered as `- None` and nobody read it as a bug |
| 4 | `resolveFileConflict()` skipped files whose content it did not recognise | Only ever called for paths the payload owns, so "unknown content" almost always meant *our own older file*. Bootstrap adoption catches only byte-identical files, so anything changed in between froze permanently. 50 files on one machine, the oldest untouched since July |
| 5 | `detectPlatforms()` tested for config directories | `syncSkillsToGlobalHarnesses()` and `universalHarnessSync()` create those directories. The detector read back evidence the installer had planted: 7 harnesses reported, 5 installed |
| 6 | `tar -xzf` unpacked module updates over the installed tree | A merge, not a replacement. Files the new version dropped stayed forever while `package.json` reported the module current |
| 7 | Seven call sites ignored `downloadOrUpdateModule()`'s `false` | A failed download fell through into venv setup and daemon registration, and the run still ended in a success banner |
| 8 | A failed `npm view` was swallowed | Every module read "up to date" indefinitely on an offline or proxied machine, indistinguishable from a real answer |
| 9 | The Agent Workspace printed its WebUI URL unconditionally | Directly under a warning that the port had not answered, and on Linux where no daemon is registered at all |
| 10 | `--dry-run` created a venv | The global `fs.*` dry-run patch does not cover child processes; `uv venv` ran for real |
| 11 | A second run overwrote the first `.bak` | Backups were not timestamped, so the recovery copy was destroyed by the act of recovering |
| 12 | AO's LaunchAgent ran the binary with no subcommand | Bare `ao` prints help and exits; with `KeepAlive` launchd restarted it until throttled. On every machine that installed AO through AOS the daemon never ran — it only looked installed |
| 13 | AO pointed at `@hybridlabor-api/bdb-os-agent-workspace` | That repository is archived and its last npm release predates the archiving, so installing it hands out the build with the CDC loop defect |
| 14 | There was no uninstall | "Remove and reinstall cleanly" was not possible, which also makes a genuine fresh-install test impossible |
| 15 | The OpenWiki daemon discovered nothing | `get_projects()` seeded a list with one entry and read it back unchanged forever. 31 wikis existed, 3 were refreshed, the oldest untouched since 23 July |
| 16 | No repository had a `.openwikiignore` | OpenWiki's `load()` falls back to `parse("")` — with no file it loads **zero** rules and indexes `.venv`, build output and its own `.openwiki/` recursively. Measured on one repo: 33 of 145 graph nodes were junk, 0 false positives after applying the template |

`tests/installer-e2e.sh` covers 18 of these against a throwaway `$HOME`. It is
deliberately outside `npm test` — real network, minutes to run — and belongs
before a release. The unit tests cover the logic; this covers whether the
installer does anything at all.

---

## Found, not yet fixed

**Operational data in the public package.** `mcps/bdb-remoteos-mcp/queue.db`
ships in the tarball: 134 real approval rows. `.npmignore` excludes it but has
no effect — `package.json`'s `files` lists `"mcps/"` wholesale, and npm then
does not consult `.npmignore` for that path. The exclusion has to be a negation
inside `files` itself. Eleven `.pyc` files leak the same way.

**~46 MB that has never worked.** `tdmcp`, `touchdesigner-mcp` and `unreal_mcp`
declare `main` as `dist/index.js`; `dist/` is in no tarball. It exists only if
`npm run build` succeeds at install time, and that result is discarded — so the
MCP config is written pointing at files that were never produced.

**A smoke test that is theatre.** Four of the six Python MCP prewarm entries
call `uv -m mcp_server --help` without the required `run` subcommand. They fail
before `uv` reaches the script, `stdio` is `ignore`, and the result is
discarded.

**Hardcoded versions.** `bdb-os-remote` serves `1.0.0` from
`src/server/sse-server.js:94,189` while its manifest says 2.0.1; memB serves
`1.0.0` from `src/backend/server.py:36` against a manifest of 2.3.2.

**AO is macOS-arm64 only on npm.** The package ships one prebuilt binary. The
upstream project publishes every platform through GitHub Releases
(`darwin-arm64`, `darwin-x64`, `linux-x64` as AppImage/deb/rpm, `win32-x64.exe`)
and the fork's own `build-artifacts.yml` already produces them — only the path
into the package is missing. Separately, `bin/ao.js`'s `findBinary()` returns
the first path that *exists* without checking it can execute, so on Windows the
shim dies with an exec-format error instead of printing the hint it means to.

**12 of 187 skills are filler.** Three identical "Red Flags" lines appear in
eleven skills, one identical sentence in ten. `synapse-integration-skill` is
23 % unique content and 72 % identical to `bdb-dev-os-skill`. `bdbsaas-ops` is
16 lines, marked retired, and carries no commands.

---

## What a check has to do here

1. **Measure the thing, not a proxy.** A port that answers is not the right
   process; a directory that exists is not an installed application; a
   `package.json` version is not what the running service reports.
2. **Never read back your own writes as evidence.** If the installer creates
   the path, the path proves nothing.
3. **Distinguish "checked, fine" from "could not check."** An offline
   registry must not read as up to date.
4. **A discarded return value is a swallowed failure.** `installStep()` only
   catches throws; a function that signals failure by returning `false` needs
   its result read.
5. **Every code path, not just the fresh one.** Quick Update, `--project-harness`,
   `-y`, `--dry-run` and the interactive path each need the step, or the step
   does not exist for the people on that path.
