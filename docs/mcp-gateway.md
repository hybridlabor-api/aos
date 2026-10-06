# MCP gateway and app picks

Source: `bin/aos-gateway.mjs`, `lib/gateway/{config,forwarder,adopt}.js`, `lib/mcp-pick.js`, `mcp_picks.json`.

## Gateway

A local token-checking forwarder on `127.0.0.1:7790` in front of `@1mcp/agent` on `127.0.0.1:7791`. The forwarder answers `/healthcheck` without a token; every other request needs the static token (`x-aos-token` or `Authorization: Bearer`), a loopback `Host`, and no browser `Origin`, otherwise it gets 401/403. The token stops browsers, not local processes. Config lives in `~/.agents/gateway/` (`token`, `mcp.json`, `adopted.json`, `gateway.pid`); `token` must be mode 600.

```
aos-gateway serve | start | stop | restart | status [--json] | enable | direct | adopt [--dry-run] [--json]
```

- `start`/`stop`/`restart` use launchd on macOS (label `com.bdb.aos.gateway`). The Windows path (`schtasks`, task "AOS MCP Gateway") is marked UNVERIFIED in the code; elsewhere use `aos-gateway serve`.
- `status` exits 0 only when the gateway runs. Per-upstream health is the state of 1mcp as a whole, not per server (`upstreamsScope: global`).
- `enable` points the harness MCP files at the gateway (one `aos` entry); `direct` reverses it and restores the entries it removed.

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
