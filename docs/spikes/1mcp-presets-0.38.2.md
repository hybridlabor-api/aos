# 1mcp @1mcp/agent@0.38.2: per-upstream tags and presets

Method: `npm view` (registry `readme` field is empty), tarball extracted to
scratchpad `1mcp-spike/x/package` and read only, never executed. Shell grep was
blocked by the go-gate, so files were read directly.

## Findings

- **Per-upstream `tags`: yes.** Each `mcpServers` entry takes `tags` (array of non-empty strings): `build/commands/shared/configParsingUtils.js:118-127`. Matched via `serverConfig.tags` in `build/domains/preset/parsers/tagQueryEvaluator.js:173,226`.
- **`?preset=` URL parameter: yes (generation and parsing).** `build/utils/ui/urlGenerator.js:21,59` sets it, `:149-150` parses it. Priority is preset > `tag-filter` > `tags` (`:53`). Also available: `?tag-filter=` (`:32`), deprecated `?tags=` (`:43`).
- **Server-side enforcement on the HTTP endpoint: not confirmed.** The request handler was not located. README.md:25,158,167 claims presets filter the served surface.
- **`1mcp preset create`: yes.** `build/commands/preset/index.js:27-34`. Examples at `:84-86`. Comma means OR; `AND`, `NOT` and parentheses are supported (`:126-129`).
- Preset storage: `<config-dir>/presets.json` (`build/domains/preset/manager/presetManager.js:31`).

## Exact syntax

mcp.json upstream entry:
```json
"github": {"type": "stdio", "command": "...", "tags": ["dev", "web"]}
```
Preset (run against the gateway's config dir):
`1mcp preset create aos-dev --filter "web AND NOT experimental"`
Client URL: `http://127.0.0.1:7790/mcp?preset=aos-dev`

## Minimal wiring (repo, not applied)

- `lib/gateway/config.js` `buildUpstreams` (gateway loop, ~line 75-82): add `...(cfg.tags ? { tags: cfg.tags } : {})`. Take it from `cfg`, the resolved template; `wrapServer` output `w` does not carry it. `writeGatewayConfig` (line 129) passes the object through unchanged.
- `lib/gateway/harness.js` `entryFor` (line 30-36): take a `preset` argument and set `url` to `GATEWAY_URL + '?preset=' + preset` for the per-client entry.
- `lib/gateway/harness.js` `isAosShaped` (line 28): currently `e.url === GATEWAY_URL`. Without a change, `enable()` (line 111) and `disable()` (line 166) stop recognising the entry as AOS-owned. Compare origin and path instead of the full URL.
- Operator step: create the preset in the gateway's config dir before clients connect. Server behaviour for an unknown preset is unverified; the client-side `generateUrl` throws (`urlGenerator.js:56-57`).
