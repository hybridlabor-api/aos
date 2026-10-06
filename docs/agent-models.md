# Agent models

AOS pins no model. Every harness gets agent files without a `model` and the agents inherit the session model. A model is written only when you set an override.

## Override shape

`.aos/pipeline.json` (project) or `~/.aos/pipeline.json`. Role key = agent slug with `-` as `_` (`architect`, `reviewer`, `godmode_ui_ux`). Strings are written verbatim; there is no allow-list and no tier mapping.

```json
{
  "version": 1,
  "pipeline": {
    "architect": {
      "models": {
        "claude": "fable",
        "opencode": "my-proxy/some-model",
        "codex": "gpt-5.5",
        "antigravity": "pro"
      }
    },
    "reviewer": { "harness": "claude", "model": "claude-opus-5-5" }
  }
}
```

- `models.<harness>`: preferred. Harness keys: `claude`, `opencode`, `codex`, `antigravity`.
- `model` (legacy): applies to `harness` if set, otherwise **to every harness** (a bare `"model": "opus"` is then also checked, and written, for OpenCode, Codex and Antigravity). An explicitly present `models.<harness>` wins and never falls through to `model`.
- `tier` is ignored (the doctor warns). Old `--init-default` files with `{harness, tier, model}` keep pinning their `model`; remove those lines.
- A value that is empty, contains whitespace or a newline, is not a string, or (OpenCode) is not `provider/model` is skipped with a warning when agent files are compiled: no model is written and no other model is substituted.
- Role keys must be agent slugs with `-` as `_`; a key matching no agent in `.agents/AGENTS.md` is inert and the doctor warns. `setup-subagents --set-role` still accepts the old short keys (`ui_ux`, `engineering`, `media_eventtech`, `shipping`) and writes the real slug.

### /startcycle-graph dispatcher and helper agents

`.agents/nodes.json` pins no model. The dispatcher (`.claude/workflows/startcycle-dispatch.mjs`) passes `model` to `agent()` only when `pipeline.json` has a `claude` model for the node (role = agent slug, then node id: `godmode_ui_ux` or `ui_ux`); otherwise it passes none and the agent inherits the session model.

Helper agents use these role keys (valid for `aos-doctor`): `load_registry`, `merge_state`, `archify_verify`, `validate_skills`. The `escalate` step has no key and always inherits.

**Shipped default.** `assets/pipeline.default.json` suggests `haiku` for the four helper roles and nothing else. The installer copies it to `~/.aos/pipeline.json` **only if that file does not exist** (it carries a top-level `_comment`) and never overwrites or removes it, so the file is yours to edit; delete an entry to inherit. A project `.aos/pipeline.json` replaces it whole (see below), so copy the helper entries over if you want them there.

Without filesystem access (the Claude workflow runtime) the `load-registry` agent itself cannot read its own model from the file and inherits; it returns the pipeline config and every later spawn uses it.

### Which file wins

First file wins, no merge: `.aos/pipeline.json` in the project, then `.aos/project.json`, then `~/.aos/pipeline.json`. The first one that parses and has a `pipeline` object is used whole. An unparseable file is skipped (the installer moves on to the next); `aos-doctor` reports it.

| Harness | Written to | Example value | `aos-doctor` format check |
|---|---|---|---|
| Claude Code | `model:` in `.claude/agents/<slug>.md` | `fable`, `opus`, `claude-opus-5-5` | non-empty, no whitespace |
| OpenCode | `model:` in `.opencode/agents/<slug>.md` | `provider/model`, custom providers included | `provider/model`, no whitespace |
| Codex | `model = "..."` in `~/.codex/agents/<slug>.toml` | `gpt-5.5` | non-empty, no whitespace |
| Antigravity | `model:` in the frontmatter of `~/.gemini/config/agents/<slug>/agent.md` | `inherit`, `flash`, `pro` (documented tiers) | non-empty, no whitespace |

`aos-doctor` reads the project and home `pipeline.json` (offline, no provider lists) and fails with file, role, harness and value for an unusable entry. AOS never replaces a bad override with another model.

Scope: overrides are applied when AOS compiles agent files (project install, `setup-subagents --sync`). The personas that ship as files (the 7 pipeline agents plus the auxiliary agents in `.agents/AGENTS.md`) are copied to `~/.claude/agents` by the manifest copy; right after it the installer inserts the `claude` override from `pipeline.json` and records the new hash in the install manifest, so the next update sees an unedited file, restores the shipped bytes and applies the override again. A file you edited, or one that already has a `model:` line, is left alone.

The doctor treats an antigravity value outside `inherit|flash|pro` as an error, because those are the only values the agy docs list and others silently fail to register. The compilers still pass an antigravity string through (agy may add ids).

## Findings (verified 2026-10-06)

**Claude Code** (https://code.claude.com/docs/en/sub-agents)
- Frontmatter table: "`model` | No | Model to use: `sonnet`, `opus`, `haiku`, `fable`, a full model ID such as `claude-opus-5-5`, or `inherit`. When you omit it, Claude Code picks the model in the subagent model order".
- Resolution order: per-invocation `model` parameter, the definition's `model` (where `inherit` selects the main conversation's model), `CLAUDE_CODE_SUBAGENT_MODEL`, the main conversation's model. Omitting `model` therefore inherits.
- Plugin agents: "plugin subagents don't support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields"; `model` is not excluded, so a plugin agent behaves the same.

**Antigravity** (https://antigravity.google/docs/subagents/, https://github.com/google-antigravity/antigravity-cli/issues/1150)
- Custom subagent field `model`: not required; "Model tier used when invoked (inherit, flash, or pro)"; default `inherit` (parent's model). So the field is optional and omitting it inherits.
- Issue #1150: concrete ids "cause the subagent to silently fail to register (`subagent not found or not allowed to be invoked`)". Free-form antigravity overrides are passed through as asked, but only `inherit`, `flash`, `pro` are documented as accepted today.
- The compiler writes `~/.gemini/config/agents/<slug>/agent.md` (Markdown with YAML frontmatter `subagent: true` / `inheritMcp: true`, an `# <Name>` H1 and the system prompt) and a `model:` line only for an explicit `models.antigravity` override in pipeline.json; without one the agent inherits the session model. `aos-doctor` validates the value (`inherit`, `flash`, `pro` are the documented tiers). The agy changelog lists `mainAgent`, `subagent`, `hidden`, `inheritMcp` and `commandExecutionPolicy` as frontmatter fields, the subagent docs add `model`.

**Codex, OpenCode**: no model is written without an override (commit e2522a4; `compileCodexAgents`, `compileOpenCodeAgents`, tests in `tests/agent-models.test.js`).

**Cursor, Kimi**: the installer writes no agent files for them. Cursor receives only `.cursor/rules/*.mdc` rule files; there is no Kimi code path in `installer.js`.
