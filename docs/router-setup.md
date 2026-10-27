# Router setup

The router (`lib/router`) is advisory (`enforce: false`). Table layers, later wins:

1. shipped `config/router.json`
2. user `~/.aos/router.json`
3. project `<project>/.aos/router.json`

Each override file uses the same schema (usually only `preferences`) and is validated by the strict loader in `lib/router/table.js`.

## Installer

- Interactive: a "Team & Router" step follows the context-profile step. Default is "keep the shipped table". Otherwise it asks for your main harness and your targets (claude, opencode-go, agy, codex, claude-glm); installed CLIs are detected and preselected.
- Non-interactive: `--router=default|claude-only|budget`, `--context=full|orchestrator|worker|small`. `budget` puts opencode-go first for builder and scout. `default` writes nothing. An existing `~/.aos/router.json` is saved as `.bak` before being replaced.

## CLI

```
aos-router show [--json]                 effective table + source layer per value
aos-router set <role> <t[,t]> [--project|--user]
aos-router limits [--json]
aos-router test <role> [--json]          what route would pick now, no network
```

`show`, `limits` and `test` are read-only. `aos-a2a list` (read-only) lists A2A peers.
