# MCP secrets

AOS never writes a token into a harness MCP config. Secrets live in **one file**, `~/.aos/secrets.env`, mode `0600`:

```
GITHUB_PERSONAL_ACCESS_TOKEN=...
GEMINI_API_KEY=...
REMOTEOS_API_KEY=...
```

One `KEY=value` per line. The file is never committed, never logged, and never copied into a harness config.

## How a server gets its variables

A server that needs a secret is registered in every harness (Claude Code and Desktop, Codex, agy/Gemini, OpenCode, Cursor, Windsurf, Roo/Cline, Aider) in the same form, which holds only the variable names:

```
node ~/.agents/bin/aos-mcp-env.mjs --vars GITHUB_PERSONAL_ACCESS_TOKEN -- npx -y @modelcontextprotocol/server-github@2025.4.8
```

`aos-mcp-env` reads the secrets file, adds only the variables listed in `--vars` to the child's environment, starts the real command (stdio inherited, exit code and signals forwarded, works on Windows) and exits with it. It does not rely on any harness's `${VAR}` expansion.

- A variable already exported in the environment wins over the file.
- It ignores the file, with a message on stderr, if it is not a regular file of the current user or is readable by group/world (`chmod 600 ~/.aos/secrets.env`).
- A missing file or variable never blocks the server: it starts without it and stderr names the variable and the file.

## Ownership and migration

AOS replaces an MCP entry only when it owns it: the name is in the shipped `mcp_config.json` and the command/args are what AOS writes. A same-named entry with another command is left untouched (one warning).

On update (full install and Quick Update), every AOS-owned entry that still carries an inline secret is migrated: the config is backed up first (`<file>.<timestamp>.bak`, mode `0600`), the value moves into the secrets file only if that variable is not stored yet (a stored value is never overwritten; a differing inline value is dropped with a warning that prints neither), and the entry is rewritten in the launcher form. A second run changes nothing. `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are honoured.

Entries written by older AOS releases (unpinned `npx` packages and earlier argument shapes) count as AOS-owned too. A Codex table with content the installer cannot parse completely (for example a nested inline table in `env`) is never rewritten; it stays as it is with a warning. Backups hold the old plaintext secrets, so one line names them after a migration; delete them when you no longer need them.

Besides the known harness locations, migration, `aos-doctor` and `aos-uninstall` also look at `<cwd>/.cursor/mcp.json` and at every custom or project-local MCP config path the installer recorded in `~/.agents/.bdb-uninstall-records.json` (`mcpConfigs`). If the launcher or its lib cannot be installed, nothing is rewritten and inline values stay where they are.

Credentials typed in the installer prompts are stored the same way. The secrets file stores values as `KEY="value"` (`\\` and `\"` escaped) and reads them back unchanged.

## Checks and uninstall

- `aos-doctor` warns, naming file, server and variable (never the value), for any harness MCP config with an inline value of a secret variable (`*_TOKEN`, `*_API_KEY`, ...) or a token-looking value (`ghp_`, `github_pat_`, `AIza`, `sk-`), and for a secrets file that is not `0600`.
- `aos-uninstall` removes the launcher entries AOS owns. The secrets file stays, with a printed note: it is your data.
