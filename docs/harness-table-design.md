# Declarative harness table (design only)

Design only, no code changed (2026-10-10, F7 W5).
## Current state (read-only)

- `lib/gateway/harness.js`: `SUPPORTED` (l.9) is a fixed set of 4 kinds; `classify()` (l.14) maps file to kind by basename/dir; `entryFor()` (l.30) has one branch per kind.
- Path list is `harnessMcpFiles()` in `lib/mcp-secrets.js:366` (not installer.js). Consumers: `installer.js:6832`, `lib/uninstall-records.js:406`, `lib/hub/routes-store.mjs:40`, `lib/hub/catalog.mjs`.
- `installer.js:4118`: Codex TOML writer, branched on the `.toml` suffix. No TOML writer exists in `harness.js` (`docs/mcp-gateway.md:41`).
- `installer.js:4653-4677`: rules sync writes only `CLAUDE.md` (global block). There is no per-harness rules injection there.

## Table: `lib/harnesses.json`

Paths use tokens (`$HOME`, `$CODEX_HOME`, `$CLAUDE_CONFIG_DIR`, `$APPDATA`, `$CWD`). The caller resolves them. The table never reads env.

Entry templates use `{url}`, `{headers}`, `{command}`, `{args}`, `{env}`. `headers` is `{"X-AOS-Token": "{token}"}`. 
Row fields: `id`, `name`, `mcp.global[]`, `mcp.workspace[]` (each `{path, format, root}`), `entry.remote`, `entry.stdio`, `rules {file, write}` (`write` default `"never"`), `skills` (dir or null), `hooks` (`yes`|`no`|`unverified`), `verified {status, source, date}`. 
Example rows:

```json
[
 {"id":"claude","name":"Claude Code",
  "mcp":{"global":[{"path":"$CLAUDE_CONFIG_DIR/.claude.json","fallback":"$HOME/.claude.json","format":"json","root":"mcpServers"}],
         "workspace":[{"path":"$CWD/.mcp.json","format":"json","root":"mcpServers"}]},
  "entry":{"remote":{"type":"http","url":"{url}","headers":"{headers}"},"stdio":{"command":"{command}","args":"{args}","env":"{env}"}},
  "rules":{"file":"CLAUDE.md","write":"never"},"skills":"$HOME/.claude/skills","hooks":"yes",
  "verified":{"status":"partial","source":"lib/gateway/harness.js entryFor; workspace path not in repo, source TBD","date":null}},
 {"id":"antigravity","name":"Antigravity (agy)",
  "mcp":{"global":[{"path":"$HOME/.gemini/config/mcp_config.json","format":"json","root":"mcpServers"},
                   {"path":"$HOME/.gemini/antigravity-cli/mcp_config.json","format":"json","root":"mcpServers"}],
         "workspace":[{"path":"$CWD/.agents/mcp_config.json","format":"json","root":"mcpServers"}]},
  "entry":{"remote":{"serverUrl":"{url}","headers":"{headers}"},"stdio":{"command":"{command}","args":"{args}","env":"{env}"}},
  "rules":{"file":null,"write":"never"},"skills":null,"hooks":"unverified",
  "verified":{"status":"partial","source":"https://antigravity.google/docs/mcp (via docs/mcp-gateway.md:42)","date":null}},
 {"id":"codex","name":"Codex",
  "mcp":{"global":[{"path":"$CODEX_HOME/config.toml","fallback":"$HOME/.codex/config.toml","format":"toml","root":"mcp_servers"}],
         "workspace":[]},
  "entry":{"remote":{"url":"{url}","http_headers":"{headers}"},"stdio":{"command":"{command}","args":"{args}","env":"{env}"}},
  "rules":{"file":"AGENTS.md","write":"never"},"skills":null,"hooks":"unverified",
  "verified":{"status":"partial","source":"https://learn.chatgpt.com/docs/extend/mcp?surface=cli (via docs/mcp-gateway.md:41)","date":null}}
]
```

Notes: Antigravity has two candidate global paths in code; the table lists both and marks the live one only after a check. `verified.status`: `full` | `partial` | `none`. Only `full` rows may be written.
## How the code reads the table

1. Load and validate once: unique ids, known tokens, `format` in `json|jsonc|toml|yaml`.
2. `paths(row, scope, resolve)` expands tokens through a caller-injected resolver; `harnessMcpFiles()` becomes a loop over rows with the same signature.
3. `classify(file)` becomes a lookup of resolved paths; unmatched files stay `other`.
4. `entryFor(kind, token)` becomes `renderEntry(row, remote|stdio, {url, token})`: substitute placeholders, then JSON-encode.
5. `enable()` keeps its flow (load, merge, backup, atomic write); `SUPPORTED` becomes `row.verified.status === "full"`.
6. `disable()` and `adopt()` use the row's `root` instead of `mapKey(kind)`.
7. One writer per format; the TOML writer moves from `installer.js:4118` into the shared module, so gateway and installer use the same code.
8. Rules sync (`installer.js:4653`) reads `row.rules`, but writes only when `--project-harness <id>` names that row and `write` is not `never`. Default: no writes beyond the existing CLAUDE.md block.
9. Adding a harness is a row, not a branch. Rows with `verified.status !== "full"` appear in doctor output and are never written.

## Stays hard-coded

- Token generation and validation (`TOKEN_RE`), the `GATEWAY_URL` constant.
- Backups (`backupName`, `safeBackup`), atomic writes (`writeAtomic`: realpath, mode kept), refusal to rewrite unparseable files.
- Inline-secret refusal (`inlineSecrets`) and the user-owned `aos` conflict rule. Both apply to every row.

## Adding an unknown harness

1. Add one row with `verified.status: "none"`, then run doctor to show resolved paths.
2. Add one fixture-based smoke test (generic, data-driven): enable and disable against a temp HOME set inline in the test command, assert the rendered entry and the backup.
3. Set `status: "full"` only with a source URL and a passing smoke test.

## Migration plan

1. Write `lib/harnesses.json` with the 4 current kinds plus Codex/agy/Windsurf rows at `none`. Snapshot test: resolved path set equals the current `defaultHarnessMcpFiles` output.
2. Route `classify`/`entryFor` through the table behind the same exports; existing harness tests must pass unchanged.
3. Rebuild `harnessMcpFiles` on the table, keeping its signature; check the four call sites.
4. Move the TOML writer out of `installer.js:4118`; set Codex to `full` only after its smoke test passes.
5. Add `--project-harness` to the rules sync; default behaviour unchanged.

## Risks

1. **Path drift.** Antigravity has two candidate config paths. Writing to an unused file fails silently.
2. **Shape drift.** Vendor keys (`url`, `serverUrl`, `http_headers`) change over time. A `full` row then writes a wrong shape. Mitigation: dated source per row, re-verify each release.
3. **Table over-trust.** Data-driven writes reach files a human never checked. The inline-secret and user-owned guards must run for every row, and the table does not cover hooks or gate logic, which still need code.
