# MCP gateway and app picks

Source: `bin/aos-gateway.mjs`, `lib/gateway/{config,forwarder,adopt}.js`, `lib/mcp-pick.js`, `mcp_picks.json`.

## Gateway

A local token-checking forwarder on `127.0.0.1:7790` in front of `@1mcp/agent` on `127.0.0.1:7791`. The forwarder answers `/healthcheck` without a token; every other request needs the static token (`x-aos-token` or `Authorization: Bearer`), a loopback `Host`, and no browser `Origin`, otherwise it gets 401/403. The token stops browsers, not local processes. Config lives in `~/.agents/gateway/` (`token`, `mcp.json`, `adopted.json`, `upstream_template.json`, `gateway.pid`); `token` must be mode 600.

```
aos-gateway serve | start | stop | restart | status [--json] | enable | direct | adopt [--dry-run] [--json]
```

- **Service.** `aos update` registers the gateway as a background service on every platform: launchd on macOS (label `com.bdb.aos.gateway`), a systemd user unit `~/.config/systemd/user/com.bdb.aos.gateway.service` on Linux (`Restart=on-failure`, `enable --now`), and the scheduled task "AOS MCP Gateway" on Windows (`schtasks /Create ... /SC ONLOGON /F`, then `/Run`). Uninstall removes each of them. `start`/`stop`/`restart` map to launchctl, `systemctl --user` or `schtasks`; `status` prints the systemd `is-active` state on Linux.
- **UNVERIFIED on real Linux and Windows (Lenovo V12 pending).** The systemd unit and the scheduled task are covered only by fake-run tests. Harness configs switch to the gateway only when the gateway verifies as running; otherwise they stay direct and `aos-gateway enable` switches them after `aos-gateway status` is green.
- `status` exits 0 only when the gateway runs. Per-upstream health is the state of 1mcp as a whole, not per server (`upstreamsScope: global`).
- `enable` points the harness MCP files at the gateway (one `aos` entry); `direct` reverses it and restores the entries it removed.

**Presets.** Upstreams carry `tags` `['aos', <name>]` (common tag first, then the server name). Install creates one 1mcp preset per harness kind in the template's top-level `presets` object that has an exclusion list (`claude`, `agy`, `opencode`, `codex`, `roo`, `cursor`).
- Value `"all"` = every gateway server, no preset: the kind uses the plain URL. An array = server names that kind must NOT see, e.g. `"agy": ["bdb_davinci_mcp"]` (162 tools) becomes the filter `aos AND NOT bdb_davinci_mcp`, and only that kind gets `?preset=agy`. A standalone `NOT x` is rejected by 1mcp ("Invalid filter expression"), so the `aos` term always leads. Untagged upstreams are excluded by any positive filter.
- A preset that fails to create falls back to the plain URL for that kind (every upstream, no exclusions); install reports which kinds fell back.
- Without a `presets` object no preset is created and every kind uses the plain URL.
- `entryFor(kind, token, preset)` appends `?preset=<kind>` to the gateway URL, so each harness sees only its own preset's upstreams.
`isAosShaped` accepts the URL with that query string.

## Allow list

Only these shipped servers are shared through the gateway (`GATEWAY_SERVERS` in `lib/gateway/config.js`): `github`, `open_design_mcp`, `bdb_resolume_mcp`, `bdb_grandma3_mcp`, `bdb_blender_mcp`, `bdb_davinci_mcp`, `adobe_uxp_mcp`, `bdb_unreal_mcp`, `bdb_after_effects_mcp`. Everything else stays direct (`DIRECT_SERVERS`, e.g. `deja`, `memb_mcp`, `mcsc`, `openwiki`, `bdb_td_minddesigner`, the two official picks and the AE legacy entry). A shipped entry with `shared: false` also stays direct. `bdb_after_effects_mcp` needs Node >= 24; `serve` warns when it runs on an older Node.

## adopt

`aos-gateway adopt [--dry-run] [--json]` moves your other local stdio MCP servers behind the gateway: each is removed from the harness files, recorded in `~/.agents/gateway/adopted.json` (mode 600), and an `aos` entry is added; `enable`/`direct` can restore them via the migration records. Skipped: remote (`url`/http/sse) entries, disabled ones, names handled by the AOS install, invalid names (over 26 chars), entries with inline secrets in env or arguments, entries with conflicting definitions across files. Secrets are never copied into `adopted.json`. Restart afterwards: `aos-gateway restart`.

## One MCP per app

`mcp_picks.json` groups candidates per app; `applyPicks` keeps the first satisfied candidate and removes the others of that group.

| App | Preferred | Condition | Fallback |
|---|---|---|---|
| Blender | `bdb_blender_official_mcp` | Blender >= 5.1 found (macOS app bundle or Windows Program Files) | `bdb_blender_mcp` |
| Resolume | `bdb_resolume_official_mcp` | Resolume Arena's `mcp/resolume_arena_mcp_server` binary found | `bdb_resolume_mcp` |
| After Effects | `bdb_after_effects_mcp_legacy` | only with env `AOS_AE_MCP=legacy` | `bdb_after_effects_mcp` |

## Which server (overlapping pairs)

| Server | Use for | Fallback when |
| :--- | :--- | :--- |
| `bdb_td_minddesigner` (TouchDesigner, primary) | Creative generation and structured node edits (tdmcp, :9980). Direct, not gateway-shared. | Undocumented |
| `bdb_td_backup` (TouchDesigner, fallback) | Atomic node CRUD and low-level scripting (touchdesigner-mcp, :9981). | Primary unavailable; no trigger documented |
| `bdb_after_effects_mcp` (After Effects, primary) | Compositions, layers, keyframes, expressions via the Node bridge. Gateway-shared; needs Node >= 24. | Undocumented |
| `bdb_after_effects_mcp_fallback` (After Effects, fallback) | Go `ae-mcp`: layer wrappers plus Manim equation renders. Needs `go`. | Primary unavailable; no trigger documented |
| `bdb_rhino_mcp` (Rhino, primary) | Rhino 7/8 modelling and Grasshopper via the McNeel router (default v8). | Undocumented |
| `bdb_rhino_mcp_fallback` (Rhino, fallback) | GOLEM-3DMCP, 105 tools: scene, geometry, Grasshopper, viewport, Python. | Primary unavailable; no trigger documented |

Pair labels come from `README.de.md:303-309` ("Primär- und Fallback-Paare für Redundanz"). No file documents a switch condition.

## Harness support tiers for `enable` (checked 2026-10-08)

The harness table is driven by `lib/harnesses.json`; adding a harness = one row + one test.

| Harness | Config file | Remote entry shape | Status |
|---|---|---|---|
| Claude, Cursor, OpenCode | see `harnessMcpFiles` | `type http` / `url` / `type remote` | enabled (earlier work) |
| Roo | global `.../globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`, project `.roo/mcp.json` | `{type: "streamable-http", url, headers}` | **enabled**. Verified: vendor docs (https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo) and the real global file on this machine (top-level `mcpServers`, stdio entries). Remote shape from docs only. |
| Codex | `~/.codex/config.toml` | `[mcp_servers.aos]` with `url`, `http_headers` (https://learn.chatgpt.com/docs/extend/mcp?surface=cli) | **enabled**. Written string-level by `harness.js` (`enableToml`), only the `[mcp_servers.aos]` table is touched. Known gap: shipped direct `[mcp_servers.<server>]` tables are not yet removed, so Codex may list github twice until the next round. |
| Antigravity (agy) | `~/.gemini/config/mcp_config.json`, workspace `.agents/mcp_config.json` | `{serverUrl, headers}`; `url`/`httpUrl` not supported (https://antigravity.google/docs/mcp) | **enabled** (vendor-docs shape; no agy install on the test machine to confirm). Global file and `<cwd>/.agents/mcp_config.json`. Shipped upstream template lives at `~/.agents/gateway/upstream_template.json` (never `~/.agents/mcp_config.json`) so agy does not load legacy direct stdio servers when run from `$HOME`. |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `{serverUrl, headers}` (secondary guides; vendor docs moved to https://docs.devin.ai/desktop/cascade/mcp, which lists another path) | skipped: path and shape not confirmed from a vendor page or locally. |

A skipped harness is reported as `skipped: shape unverified` and never modified.
