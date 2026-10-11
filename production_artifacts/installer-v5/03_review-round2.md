# Installer v5 — re-review round 2 (sonnet, read-only, at b1c5542)

Installer repairs A2–A8, B12, C14, C17, T28–T30: fixed. Gate items 1, 2, 4: fixed by the orchestrator in b19d7ab (allow-list mounts, masking). Item 3 (container egress) = accepted trade-off, documented in the gate comment.

## Repair (worker contract)

| ID | Fix |
|---|---|
| R5 | lib/v5/menu.js Harnesses step: run `pk.mustList(failed, 'Harnesses')` FIRST; fleet install and syncMembMcp failures become a warning detail on that step, never ✖, never hiding harness failures. A JSONC/refused ~/.claude/settings.json → one warning line "fleet: settings.json has comments; enable bdb-aos-fleet by hand", step stays ✔. Test. |
| R7 | Uninstall: bin/aos-uninstall.mjs (or the v5 Uninstall entry before it spawns aos-uninstall) calls the fleet and gateway package `uninstall()`. Fleet uninstall sets `enabledPlugins[KEY] = false` (an explicit opt-out the next update respects) instead of deleting the key — change only if pkg-fleet's own tests allow; otherwise keep delete and make the update path skip when AOS is uninstalled. Test. |
| R8 | Settings → Install fleet when opted out or Claude Code missing/too old: show ✖ with the reason ("opted out (AOS_NO_FLEET / enabledPlugins false)" / "Claude Code ≥ 2.1.287 not found"), not ✔ "unchanged". A manual Settings install may clear an enabledPlugins=false opt-out after asking once (TTY only). Test. |
| R9 | Fleet detect: version = the plugin's own version (plugins/bdb-aos-fleet/.claude-plugin/plugin.json or package.json), not Claude Code's. Keep the Claude check in verify. `scan()` must not hide a throwing detect as "not installed": record `{installed:null, error}` and show it in Status as "detect failed: …". Test. |
| R10 | Repair and the Harnesses fleet install respect the Settings `disabled` list (same as Update). Test. |
| R11 | B11 test must exercise the real installer wiring: require installer.js (container-only like the other subprocess test, or via the exported prompt helpers) and assert a prompt helper returns its default without calling clack when AOS_NONINTERACTIVE=1. |
| R14 | A1 rest: runCodexPluginStep fails the step when installCodexPlugin returns ok:false; runPluginMigration counts per-platform "registration failed" results as failures. Test. |
| R13 | Nits: remove the dead optional require at menu.js:12; tokenSaverDetect honours CLAUDE_CONFIG_DIR; installTokenSaver returns false when the vendor dir is missing. |

Out of scope: .claude/hooks/*, lib/gateway/*, bin/aos-gateway.mjs, lib/v5/pkg-gateway.js (except calling its uninstall), plugins/bdb-aos-fleet/* (mod source; only read its manifest for R9).
Known, not changed: B11 default answers install the managed package itself (OpenWiki CLI, Codenotch "Install?" default yes) — accepted, it is the package being updated.
