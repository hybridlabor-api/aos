# agy (Antigravity CLI) coverage of the bdb-aos plugin

Scope: read-only review of the files below; no shell, no agy run, so nothing here is measured on a live agy.
Sources: `lib/agy-plugin-install.js` (L1-136), `tests/agy-plugin-install.test.js`, `plugin.json` (agy manifest, L1-298),
`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.claude/settings.json`, `agy-commands/loop.md`.

| Surface | Claude Code | agy | Status |
|---|---|---|---|
| Skills | `.claude-plugin/plugin.json:21-282` lists nested paths | `stagePlugin` flattens to `skills/<name>` (agy-plugin-install.js:48-59), then `agy plugin install <stage>` (L103) | verified by code + unit test (test L158-165); count on real agy only via E2E (test L167-183, skipped unless AOS_E2E_CLI=1) = unverified |
| Subagents | `.claude/agents/*.md` (13 per plugin.json:4) | copied as flat `agents/<file>.md` into the plugin stage (L47) | covered by the installer, not the plugin: `compileAgyAgents` (installer.js:4136) writes `~/.gemini/config/agents/<slug>/agent.md` (layout confirmed in the agy binary changelog, tests/v5-agents.test.js). The flat `agents/<file>.md` in the plugin stage is separate; whether agy loads `agents/` inside a plugin is unverified |
| Commands | `.claude-plugin/plugin.json:283-298` (`commands/*.md`, incl. `commands/loop.md`) | `plugin.json:282-297` same list, but loop -> `agy-commands/loop.md`; both dirs linked (L44-46); message claims `/bdb-aos:<cmd>` (L105) | verified in code; namespacing on real agy unverified. `agy-commands/loop.md:5` states loop is unverified on agy |
| Hooks (go-gate etc.) | `.claude/settings.json:2-167` PreToolUse go-gate.mjs, conventional-commits.mjs, env-file-protection.mjs; Stop graph-gate.mjs; UserPromptSubmit go-token/go-grant | none: stagePlugin copies no hooks; agy `plugin.json` has no hooks key | not in the plugin by design; the installer wires them: `mergeAntigravityHooks` (installer.js) writes go-gate, graph-gate, conventional-commits and env-file-protection for agy (tests/v5-install-options*.test.js assert the per-harness list; go-token and go-grant are Claude-only). Not run on a live agy |
| MCP | installer-managed, not in plugin (`plugin.json:4` "MCP servers are installed by the AOS installer") | `installMcpsForTarget` writes `~/.gemini/config/mcp_config.json` and `~/.gemini/antigravity-cli/mcp_config.json` (installer.js:3282, 3506-3507); picks and retired entries apply | covered by the installer; not run on a live agy |
| Enable state | n/a | respects `enabled:false` in `~/.gemini/config/config.json` (L87-92); `agy plugin enable` only printed as manual hint (L35) | verified by test L85-92 |
| Uninstall | n/a | state file `~/.agents/.bdb-agy-plugin.json` then `agy plugin uninstall bdb-aos` (L123-133) | verified by test L139-156 |

## Gaps
1. Subagents, hooks and MCP for agy come from the installer, not from the plugin (see the table). The remaining open point is the flat `agents/<name>.md` inside the plugin stage: measure on a live agy whether it is loaded at all, then drop or fix `stagePlugin` L47. Part of the live test (V12).
2. Live agy run: nothing here is measured on a real agy (E2E only with AOS_E2E_CLI=1). Part of V12.
4. `stagePlugin` throws if `.claude/agents` is absent (L47), which `run` turns into a failed install (L116-117); the whole plugin install then fails for a missing optional dir. Small, not fixed (current package always has the dir).
5. Manifest drift: `plugin.json` (agy) and `.claude-plugin/plugin.json` both carry a 261-entry skills array that agy ignores (L7-9); they must be kept in sync by hand, loop.md differs by design.

## Changes made
None to code or tests; no clear small bug found.
