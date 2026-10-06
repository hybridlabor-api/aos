# AOS installer v5 — plan

Branch `feat/installer-v5` (worktree `aos-wt-v5`), contains all 4.19.1 work (secrets, gate, canvas, findings 1–8). Target npm `5.0.0`; no push to main, no release without Tim's GO.

## 1. Goal

One `aos` command that keeps the machine current without questions:
second `aos update` = 0 prompts, every installed package really works afterwards, one line of output per package.

## 2. What stays, what changes

| Stays (reused from installer.js) | Changes |
|---|---|
| First-install wizard (tier, harnesses, MCP selection) | Menu after install: **Status · Update · Repair · Settings · Uninstall** |
| Skill copy, manifest, `.bak` handling, plugin migration, rule injection | Update runs one fixed order: **Kernel → Harnesses → Packages → Optional → Verify** |
| Per-module install functions (installMemB, installSynapse, …) | Every package behind one contract: `detect · install · update · verify` |
| `lib/mcp-secrets.js`, launcher `aos-mcp-env` | One secrets store `~/.aos/secrets.env` (0600), skipped keys remembered |
| `isNewerVersion`, `checkModuleUpdate`, doctor | One version check at start for AOS + all installed packages |

No rewrite for its own sake: v5 is ~5 small files on top of installer.js.

## 3. New files (`lib/v5/`)

- **`secrets.js`** — `need(keys, {ask})`: value from `~/.aos/secrets.env`, else from legacy files read-only (`~/.openwiki/.env`, `~/.gemini/config/.env`, `~/.agents/.env`, env), else ask once. Entered values are written to `secrets.env` immediately; a blank answer adds the key to `AOS_SKIPPED_KEYS` (no placeholder value, so the MCP launcher never passes a fake token). Asked again only via **Settings**.
- **`versions.js`** — one parallel `npm view <pkg> version` per installed package (timeout 8 s, cache 24 h in `~/.aos/cache/versions.json`, offline = "unknown", never blocks). Result: "N updates available"; **Update** becomes the default menu entry when N > 0.
- **`packages.js`** — registry. Each entry `{id, npm, detect(), install(ctx), update(ctx), verify()}` wraps the existing function. `verify()` checks real function, not file presence:
  - memB: venv python runs (`python -c 'import sys'`), `import mcp` + memb entry import OK, MCP copy (`~/.gemini/config/mcps/memb-mcp`) on the same version as global memB, WebUI LaunchAgent not in error.
  - Synapse: binary runs `--version`. deja/token-saver/OpenWiki: CLI responds. Codenotch/AO: app version readable.
- **`run.js`** — runs a package step with output captured to `~/.aos/logs/update-<ts>.log`; console shows `✔ memB 2.4.0` / `✖ memB — see <log>`.
- **`menu.js`** — the 5-entry menu + `aos status|update|repair` as non-interactive subcommands (`aos update` = the menu's Update, never a full reinstall).

## 4. Update flow

1. **Kernel**: skills, plugin migration, rules (today's Quick Update steps 1–5).
2. **Harnesses**: harness configs + MCP entries, **including the memb-mcp copy** (Quick Update never refreshed it — root cause of memB 2.3.3).
3. **Packages**: for each installed package with an update → `update()`; then `verify()`; failing verify → `repair()` once (below).
4. **Optional**: no prompts. Lists not-installed packages in one line; installing them is a Settings action.
5. **Verify**: summary table, doctor checks, exit code ≠ 0 if a package stays broken.

## 5. Repair rules

- Venv broken = `bin/python` missing, dangling, or `python -c 'import sys'` fails. Repair: **rename** `.venv` → `.venv.broken-<ts>` (no delete), create a new venv, reinstall requirements. (`fs.existsSync` treats a dangling link as missing, and `venv` over the old dir kept the dead link — today's memB failure.)
- Codenotch/AO: prompt only when not installed or a newer version exists; AO dev checkout only with `AOS_AO_DEV_BUILD=1`.
- Package installers (Creator etc.): their output goes to the log; no venv re-created when requirements hash is unchanged.
- Nothing in the user's home is deleted; old `.bak`/`.broken-*` are listed by doctor with a cleanup command for Tim.

## 6. Tests (container only, `node:24-bookworm`, `AOS_TEST_SANDBOX=container`)

Fake `npm`/`uv`/`python` on PATH, temp HOME:
1. fresh install (`-y`) completes, all verify green;
2. second `aos update` with stored values → **0 prompts** (prompt function asserts not called);
3. outdated package detected → "1 update available", Update is default;
4. dangling memB venv python → repaired, `import memb_mcp` OK, MCP copy synced;
5. blank PAT → `AOS_SKIPPED_KEYS`, not asked on the next run.
Plus the full existing `npm test`. Then live test with Tim, sonnet review, opus security check, release request.

## 7. Work split (max 1 Claude + 1 OpenCode/haiku at a time)

| Step | Who |
|---|---|
| `secrets.js`, `versions.js`, `run.js`, `menu.js`, flow wiring in installer.js main | sonnet (core) |
| `packages.js` adapters per package (mechanical wrap of existing functions) | haiku / OpenCode |
| memB verify/repair + memb-mcp sync, Creator quiet output, "vlatest" version fix | haiku / OpenCode, reviewed by orchestrator |
| Scenario tests 1–5 | sonnet |
| Review / security check | sonnet / opus |

## 7a. Merged in from other sessions

- **bdb-aos-fleet** Claude plugin (branch `feat/claude-mod-fleet`): `marketplace.json` entry; registered in `enabledPlugins` in the Harnesses step unless opted out (`AOS_NO_FLEET=1` or Settings); is a package in `packages.js` (detect = plugin enabled, verify = Claude Code ≥ 2.1.287 + plugin files present); removed by Uninstall.
- **aos-gogate** CLI (read-only status via `go-grant.mjs`): shipped as a `bin` entry, part of Kernel.

## 8. Out of scope

New UI, rewriting per-module installers, Windows-specific redesign, the MCP gateway (set-06).
