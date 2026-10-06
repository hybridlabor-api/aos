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
- `model` (legacy): applies to `harness` if set, otherwise to every harness.
- `tier` is ignored.

| Harness | Written to | Example value | `aos-doctor` format check |
|---|---|---|---|
| Claude Code | `model:` in `.claude/agents/<slug>.md` | `fable`, `opus`, `claude-opus-5-5` | non-empty, no whitespace |
| OpenCode | `model:` in `.opencode/agents/<slug>.md` | `provider/model`, custom providers included | `provider/model`, no whitespace |
| Codex | `model = "..."` in `~/.codex/agents/<slug>.toml` | `gpt-5.5` | non-empty, no whitespace |
| Antigravity | `"model"` in `~/.gemini/config/agents/<Name>.json` | see findings | non-empty, no whitespace |

`aos-doctor` reads the project and home `pipeline.json` (offline, no provider lists) and fails with file, role, harness and value for an unusable entry. AOS never replaces a bad override with another model.

Scope: overrides are applied when AOS compiles agent files (project install, `setup-subagents --sync`, agents the global install compiles itself). The 13 personas that ship as files in `~/.claude/agents` are copied unchanged, so a global override does not reach them; use a project `.claude/agents` file or `CLAUDE_CODE_SUBAGENT_MODEL`.

## Findings (verified 2026-10-06)

**Claude Code** (https://code.claude.com/docs/en/sub-agents)
- Frontmatter table: "`model` | No | Model to use: `sonnet`, `opus`, `haiku`, `fable`, a full model ID such as `claude-opus-5-5`, or `inherit`. When you omit it, Claude Code picks the model in the subagent model order".
- Resolution order: per-invocation `model` parameter, the definition's `model` (where `inherit` selects the main conversation's model), `CLAUDE_CODE_SUBAGENT_MODEL`, the main conversation's model. Omitting `model` therefore inherits.
- Plugin agents: "plugin subagents don't support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields"; `model` is not excluded, so a plugin agent behaves the same.

**Antigravity** (https://antigravity.google/docs/subagents/, https://github.com/google-antigravity/antigravity-cli/issues/1150)
- Custom subagent field `model`: not required; "Model tier used when invoked (inherit, flash, or pro)"; default `inherit` (parent's model). So the field is optional and omitting it inherits.
- Issue #1150: concrete ids "cause the subagent to silently fail to register (`subagent not found or not allowed to be invoked`)". Free-form antigravity overrides are passed through as asked, but only `inherit`, `flash`, `pro` are documented as accepted today.
- Unverified: the documented format is Markdown with YAML frontmatter (`~/.gemini/config/agents/<name>.md`), while the installer writes `<Name>.json`. Whether agy loads that JSON is not verified; the format was left unchanged. The previous tier table wrote `gemini-3.1-pro-high` etc. into it, which the docs say is not an accepted value.

**Codex, OpenCode**: no model is written without an override (commit e2522a4; `compileCodexAgents`, `compileOpenCodeAgents`, tests in `tests/agent-models.test.js`).

**Cursor, Kimi**: the installer writes no agent files for them. Cursor receives only `.cursor/rules/*.mdc` rule files; there is no Kimi code path in `installer.js`.
