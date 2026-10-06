# Harness capabilities

What each harness can do inside AOS: delegation channels, inbound A2A, gate hooks. Rows state what the code in this repo does, not what a harness could do in theory. A2A details: `docs/a2a.md`.

| Capability | Claude Code | OpenCode | Codex | agy |
|---|---|---|---|---|
| Delegation out (`aos-acp`) | yes | yes | yes | via shell commands (`aos-acp` adapters, no ACP client of its own) |
| A2A inbound | UserPromptSubmit drain + Stop nudge (`.claude/hooks/a2a-inbox.mjs`) | plugin inject as synthetic prompt (`.opencode/plugins/bdb-aos.js`) | `codex queue` / `codex exec resume` (`lib/a2a-codex.mjs`) | pull only, inbox MCP `a2a_inbox_pull` (`bin/a2a-inbox-mcp.mjs`); a running interactive session cannot be pushed into |
| A2A reply | `aos-a2a reply` via pre-approved Bash rules | reply file written by the plugin from the assistant message | answer to the queued/resumed prompt, as the reply file | `a2a_reply` tool, or `aos-a2a reply` |
| A2A sidecar mode | `--mode live` | `--mode live` | `--mode live` (executor in `lib/a2a-codex.mjs`) | `--mode live` (resume executor in `lib/a2a-agy.mjs`) |
| GO gate hook | yes (`.claude/hooks/go-gate.mjs`) | yes (plugin, shared hooks) | yes (smoke-tested, `docs/codex-gate-smoke.md`) | gate-only hooks (`PreToolUse`/`PreInvocation`/`Stop`) |
| Never-GO on A2A inbound | yes (prefix + never-GO line) | yes | yes | yes |

Notes:

- **A2A inbound is never a GO.** Every injected A2A message carries the never-GO line and satisfies no token; see `docs/a2a.md` and `docs/delegation-routing.md`.
- **A2A delegation depth:** a session that itself received an A2A message cannot delegate further unless `AOS_A2A_MAX_DEPTH` is raised; the sidecar can be switched off per environment with `AOS_A2A_SIDECAR=off`.
- **agy inbound is pull-based.** The inbox MCP server is read/write only; it never spawns agy or any harness.
- **Spawn mode for A2A roles is reserved in profiles but not implemented**; only `live` executors exist.

## Subagent files, MCP and fleet

| Item | What the code does |
|---|---|
| OpenCode agents | `compileOpenCodeAgents` writes `<slug>.md` (`mode: subagent`) to `~/.config/opencode/agents/` globally; the project form is `.opencode/agents/<slug>.md` |
| agy agents | `compileAgyAgents` writes `<slug>/agent.md` (`subagent: true`, `inheritMcp: true`) under `~/.gemini/config/agents/`; old `<name>.json` files are no longer written and left alone |
| MCP gateway | `aos-gateway` shares an allow list of shipped servers behind one local endpoint and can `adopt` your own stdio servers: `docs/mcp-gateway.md` |
| One MCP per app | Blender, Resolume and After Effects each keep one candidate (`mcp_picks.json`; AE legacy only with `AOS_AE_MCP=legacy`): `docs/mcp-gateway.md` |
| Fleet view | `plugins/bdb-aos-fleet` ("which Claude sessions are working, which need you, and the active projects"); the installer only registers it in Claude Code `settings.json` (needs Claude Code >= 2.1.287, opt out with `AOS_NO_FLEET=1`) |
| GO helper | `aos-gogate status [--session <id>]`, `preset <name>`, `presets` are read-only: they print status or the text you type yourself and never record a grant |
| Orchestrator chain | master session -> project orchestrator -> package orchestrator: `docs/orchestrator-chain.md` |
