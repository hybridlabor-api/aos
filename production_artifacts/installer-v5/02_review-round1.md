# Installer v5 — review round 1 (sonnet, read-only, diff 92c24fa..e2253ab)

Verdict: not ready. Repair split below. IDs = reviewer finding numbers.

## Installer repair (worker, this file is its contract)

| ID | Fix |
|---|---|
| A1 | `quickUpdateHarnesses` / `quickUpdateKernel`: any `installStep` result `{ok:false}` (and runPluginMigration / runAgyPluginStep failures) must make the v5 step fail (throw or return a failure the menu turns into ✖ and exit ≠ 0). Test: a failing harness step → ✖ + non-zero exit. |
| A2 | Every adapter's install/update wraps its installer call in `must(...)` (like memB/Synapse); menu treats a thrown/false install as ✖ (Update and Settings → Install). Test: installer returns false → ✖. |
| A3 | memB WebUI check: `launchctl list <label>` prints plist-style text, not JSON. Parse `"LastExitStatus" = N;` with a regex; non-zero → verify failure detail. Use the injectable `c.launchctl` in a test with real-format sample output. |
| A4 | memB `repair()`: also reinstall requirements (reuse `reconcileMembVenv` or venvTools.install) when `import mcp` / memb-mcp `import run` fails in a runnable venv. |
| A5 | Generic repair: packages without `repair` get one retry via `update()` when verify fails, then verify again. |
| A6 | token-saver `detect()`: real detection (CLI on PATH or `~/.token-saver/src/cli.py`, or the plugin enabled in `~/.claude/settings.json`), so update/verify/repair reach it. |
| A7 | Packages whose local version is unreadable are reported as "version unknown" in Status (not silently skipped). Codenotch: version check via the existing GitHub-release logic in installer.js if it exposes one; otherwise leave verify-only and say so in Status. Gateway: leave as is (opt-in, pinned). |
| A8 | Kernel: when versions.js says the kernel (AOS itself) is outdated, do not claim success — print "AOS <remote> available: run `npx @hybridlabor-api/aos@latest`" and do not write the old version as current. No auto re-exec. |
| B11 | Installs/updates run inside `step()` must never prompt: pass an explicit non-interactive flag (env `AOS_NONINTERACTIVE=1` checked by `askConfirm`/prompt helpers, or set the existing `isAutoYes` path) for the duration of `step()`. Settings may ask its own questions BEFORE calling the step. |
| B12 | Settings → Install OpenWiki without a key: ask for the key via secrets.need first; if still none, report "skipped: no key" as ✖/warning, not ✔. |
| C14 | Fix the wrong comment in secrets.js:34. `secrets.read()` must respect `readSecretsFile().state === 'refused'`: report "secrets file refused (permissions/owner)" instead of re-asking. |
| C17 | Ollama provider: do not ask for an API key. |
| T28–T30 | Replace the source-regex 'vlatest' test with a behavioural one (call downloadOrUpdateModule with an injected npm pack/tar or test the extracted helper). 'remote verify' test: fake `remote` binary on PATH, assert `--version` is passed. 'deja detect' test: PATH-isolated so it passes on a machine with deja. Add tests for A1, A2, A3 (real launchctl text), B11 (prompt helper not called inside step). |

Out of scope for this worker: go-gate (orchestrator), lib/gateway + bin/aos-gateway.mjs (Package Orchestrator: findings 19, 20, 21), fleet (separate merge).

## Gate (orchestrator, Tim's rule-16 approval covers tightening)
- 23: `roMount` rejects sources `/`, any ancestor of a docker socket path (`/var/run`, `/run`, `/var`), the home dir and its ancestors, and home dotdirs; table tests.
- 24: image token containing `$` → not read-only.
- 26: deny log redacts `KEY=<12+ chars>` values and `://user:pass@`.

## Gateway (Package Orchestrator)
- 20: orphaned 1mcp on 7791 after SIGKILL → serve loops; detect own orphan (pid file) and stop it, or pick it up.
- 21: plist pins `process.execPath`; nvm/fnm paths break on upgrade → resolve a stable node path or note it in doctor.
- 19: `enable()` writes migration records before a failed write → stale records; write the record only after a successful write (or roll it back).
