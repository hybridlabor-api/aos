# AOS 4.16 → 5.1: notes for agents (any harness)

Purpose: let an agent that is not Claude Code (Codex, agy, OpenCode, a GLM worker) continue the work. Facts here come from the 5.0 release work of October 2026. Per-release detail for 4.x lives in the GitHub releases and `CHANGELOG.md`; the release audit notes (`aos-4.19.1-release-list.md`, `release-notes-gaps.md`) were kept under `~/.aos/briefs/` on the maintainer's Mac.

## Versions and channels
- 4.19.0 was `latest` until 2026-10-13. 5.0.0-beta.1/.2 were published under the `beta` dist-tag (release-please prerelease). 5.0.0 (stable, `latest`) and 5.0.1 followed on 2026-10-13. 5.0.2 is prepared (branch `fix/502-all`). 5.1 is the next minor (milestone "5.1"; issue #141 pipeline workstreams).
- Release flow: conventional commits on a branch → PR → maintainer merges on GitHub → release-please opens `chore(main): release X` → maintainer merges → `.github/workflows/release-please.yml` runs `npm publish` (prerelease versions use their own dist-tag, stable goes to `latest`). `release-please-config.json` no longer has `prerelease`. An agent must not merge or publish; the go-gate and the Claude auto-mode classifier block it.
- Module repos: memB (2.4.1), bdb-dev-creator-extension (publishes whenever `package.json` differs from npm), bdb-os-remote (release-please; its workflow now publishes whenever `package.json` is ahead of npm), synapse, hardware-pcb, tool-installer, heimdall-token-saver.

## What 5.0 changed (architecture)
- `aos` CLI (v5 menu in `lib/v5/*`): install/update/repair/verify/uninstall per package (`kernel`, `memb`, `openwiki`, `deja`, `gateway`, `hub`, mods `fleet|sessions|alert`, …). `aos package verify <id>`, `aos status`, `aos doctor` (bin/aos-doctor.mjs).
- Default install adds the MCP gateway (1mcp, `aos-gateway`, ports 7790/7791), the AOS Hub (`aos-hub`, port 7900) and the Claude Code mods. memb_mcp and deja stay direct in harness configs; other MCP servers can be adopted behind the gateway (`aos-gateway direct` reverses it).
- Unified memory = memB MCP + venv + `memb-inject` hook + deja + OpenWiki + Codebase Memory. `aos package verify memb` is the check.
- Uninstall is manifest based (`aos-uninstall`, `lib/uninstall-records.js`): only recorded AOS files go; user data (`~/.MemBDB`, `~/.openwiki`, `~/.memb`, `~/.config/deja`) is kept; foreign hooks/rules/commands survive.
- One backup per config file per run (`lib/backup-once.js`).

## Harness support (what the installer writes; CLI only unless noted)
- Claude Code: plugin `bdb-aos@bdb-marketplace` (`claude plugin marketplace add` + install), hooks in `~/.claude/settings.json`, MCP in `~/.claude.json`, mods via `enabledPlugins` (needs Claude Code ≥ 2.1.287 in PATH).
- Codex: hooks in `~/.codex/config.toml` between `# AOS:HOOKS:START/END`, plugin `codex plugin add bdb-aos@bdb-aos`, MCP `[mcp_servers.*]`, **rules file `~/.codex/rules/aos-gate.rules`** (the enforced gate layer, see below).
- Antigravity (agy): `~/.gemini/config/hooks.json` (PreToolUse go-gate etc., PreInvocation context + a2a inbox), plugin via `agy plugin install <flat dir>` (agy counts only first-level `skills/<name>`), MCP in `~/.gemini/config/mcp_config.json` when platform 1 is the target. mcsc is deliberately not registered for agy.
- OpenCode: plugin `~/.config/opencode/plugins/bdb-aos.js` (gate in `tool.execute.before`, memB, trail, a2a), commands `/bdb-aos-<cmd>`, MCP in `opencode.jsonc`.
- Cursor, Windsurf, Roo/Cline: MCP servers only, no hooks. Desktop apps (Claude Code tab, Codex Desktop, Antigravity IDE, OpenCode Desktop): not verified. Claude Desktop chat app: MCP in `claude_desktop_config.json` only.
- 5.0.2: the installer writes only for harnesses that `detectPlatforms()` finds (app bundle or binary; config dirs are not evidence) or that the user names with `--platforms=` (values: 1 Antigravity, 2 Claude Code, 3 Cursor, 5 Codex, 6 Windsurf, 7 VS Code/Roo/Cline, 8 Aider); nothing detected → Claude Code only.

## The go-gate (all harnesses)
- Guarded commands (git push, gh merge/release, npm publish/version, recursive rm, unscoped commands) need a literal `GO` from the human as the last message. Implementation: `.claude/hooks/go-gate.mjs` (copied per harness), classification in `GUARDED_PATTERNS` (`bin/guarded-patterns.json` is generated: `node bin/go-check.mjs --write-patterns bin/guarded-patterns.json`).
- Hook output per harness: Claude exit 2 + stderr; agy `{decision:"deny"}`; Codex `hookSpecificOutput` JSON + stderr + exit 2. **Codex `exec` ignores hook denials (approval never / bypassPermissions)**, verified; therefore the rules file. Rules are prefix rules: `git -C x push` and Windows delete verbs are not covered.
- Debug: `AOS_GATE_DEBUG=/abs/path` appends masked raw hook stdin and decisions. Gate logs per session: `~/.aos/gate/<session>.log`.

## Windows specifics
No admin rights assumed: gateway and hub autostart from Startup-folder VBS files. `.cmd` shims go through `lib/cli-spawn.js`. Process stop matches the full per-profile path and the current owner. JSON reads strip a BOM. See the memB/handoff entries for the 5.0.1 cross-profile bug.

## Test and release infrastructure
- Unit/integration tests: `npm test`; installer tests only inside Docker (`node:24-bookworm`), e.g. `docker run --rm -v <src>:/src:ro -e AOS_TEST_SANDBOX=container node:24-bookworm sh -c 'cp -r /src /tmp/a && cd /tmp/a && npm ci --ignore-scripts && HOME=/tmp/h node --test tests/<file>'`. Export a worktree with `git archive` (a copied worktree has a `.git` file pointing to the host).
- Acceptance matrix over the packed tarball or a registry spec: 46 rows (install from a non-home cwd, hooks, rules file, launchers, status, verify kernel/memb, gateway, hub health, a2a, uninstall dry run and real). Linux containers have no systemd user session, so the gateway service and `aos status` rows fail there by design.
- Windows acceptance runs on a separate machine through a Claude session with computer use; the maintainer gives GO there.

## Open work (5.0.2 / 5.1)
See `~/.aos/briefs/handoff-aos-orchestrator-2026-10-13.md` and GitHub issues #150–#156, #141. 5.1: desktop-app coverage and tests, hooks for Cursor/Roo/Windsurf where possible, an openwiki MCP entry, Codex plugin MCP path, doctor checks (deja, openwiki, memb_mcp per harness), A2A package-root outside the npx cache, a guided install modelled on ECC (inventory + one confirmation, profiles).
