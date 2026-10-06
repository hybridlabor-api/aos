# AOS 4.18.2: release bundle report

Branch `release/4.18.2` (local only), based on `fix/plugin-all` (d08e7d0, which already holds the mcsc hotfix 7082b20 + d08e7d0 and F1–F3). `package.json` is still 4.18.1; no version bump, push, PR or publish has happened.

## Verification

- Full `npm test` in a Linux container (`node:24-bookworm`, `AOS_TEST_SANDBOX=container`, repo copied in, fresh git repo): exit 0, after the last merge (1d1fb35).
- The container run found a real bug that macOS hid: the installer read `.agents/agents.md` while the file is `.agents/AGENTS.md`, so agent compilation was silently skipped on case-sensitive filesystems (fixed in 4009c4f).

## Contents by task

| Task | Commits | What |
|---|---|---|
| aos-05 mcsc hotfix | 7082b20, d08e7d0 (base) | mcsc gates every startup CLI call (fork bomb fix) |
| aos-06 opus review | 1b01254, 6f42383, 8fcc1b1, 0884089 | F4 marker-independent Codex removal/merge; doctor Codex hooks check after Codex rewrites; `[features] hooks` no duplicate key; MCP sub-tables follow their parent; user `deja` table kept on uninstall; cross-harness test no longer leaks into a real `CLAUDE_CONFIG_DIR` |
| aos-06 harness agents | e2522a4, 195052e | Codex agents in Codex format (name/description/developer_instructions/sandbox_mode), no fixed model; OpenCode agents inherit the model; doctor checks agy named hooks and bdb-aos plugin registration per harness |
| aos-07 / aos-16 / aos-17 | d6c9641 | OpenWiki `.env` + `OPENWIKI_MODEL_ID`, model id check, auth hint, banner; Synapse binary detection and message; `-y` with `--modules`; uv lookup; user MCP tables inside the AOS Codex block kept; mcsc never written to agy configs, AOS-owned entry removed, doctor warns |
| aos-14 | e01ec81, 701ac7b | foreign `agent-orchestrator` skill removed and retired on existing installs |
| aos-18 / aos-20 | 375fa3b, c5cde74 | computer-use via `npx @zavora-ai/computer-use-mcp@7.4.0`; every npx MCP pinned; guard test |
| ACP pin | 7585e32 | claude-agent-acp 0.86.0, codex-acp 2.1.1 |
| Safety rules | 5705490 | managed "Destructive Actions" block in every instruction template the installer writes, upserted on existing installs |
| go-gate (aos-02, aos-11, aos-22, aos-22b) | 687b27e … 7d34331 | recursive deletes in any language; unconditional HARD block for home, `/` and top-level home dirs; fail closed (bounded reads, 16 KB cap, 150 ms budget); heredoc/quoted-text false positives fixed; `until/while/if` loops; feature-branch pushes proven from git config, same-command state changes and env taint fail closed; aliases guarded. Details: `production_artifacts/gogate-delete/REPORT.md` |
| pb-03 (c6) | – | nothing to port; superseded by this branch |

## Known limits (documented)

- The go-gate is a tripwire, not a boundary: indirections (eval, awk system, source, piped stdin, npm run, make) are not covered, and a GO can be forged by an agent that writes its own transcript or `~/.aos` token/grant files. Real protection needs a separate OS user or a sandbox (aos-01).
- computer-use 7.4.0 tool names are unverified; the skill tells agents to check `tools/list`.
- agy agent JSON still pins Gemini models (format unverifiable).
- `~/.gemini/antigravity-cli/mcp_config.json` as a second agy config path is a guess.
- Several installer tests still spawn the installer without a sandbox guard (aos-01).
