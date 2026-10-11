# m17 skill registry integration

Method limit: no Glob/Grep/shell available, so skill existence was verified by path probes plus the generated plugin.json skill list, not a directory scan.

## Registry mechanisms
- Skill = `skills/<category-dir>/<name>/SKILL.md`; contract in `AGENTS.md:126-176`, enforced by `scripts/validate-skills.mjs` (required keys name/description/category `:18`, categories `:14-17`, name==dir `:339`, E-DMI01 invocable list `:286-291`).
- No skills table file; listing = generated `plugin.json` (root, `plugins/bdb-aos/plugin.json`, `.claude-plugin/plugin.json`) built by `scripts/build-plugin-manifest.mjs:60-63` (walks `skills/`, one entry per SKILL dir). Never hand-edit. Count is derived (`:329`), no hard-coded expected number.
- Root `plugin.json:20-281` lists every skill; `master-session` at `:33`, `gogate` at `:122`, `mcp-manage` at `:138`, `mcsc` at `:139`. Manifest version there is 4.19.0.
- AGENTS.md routing table (`:166-173`) is by category, not per skill; no per-skill listing to update.

## Capability status
| Capability | Skill | Registered |
|---|---|---|
| master-session | `skills/basic/master-session/SKILL.md` (bdb-core) | yes, plugin.json:33, in MODEL_INVOCABLE |
| gogate (aos-gogate) | `skills/global_config/gogate/SKILL.md` (bdb-core) | yes, plugin.json:122 |
| MCP gateway (aos-gateway) | none (probed global_config/aos-gateway, mcp-gateway) | n/a, docs only: `docs/mcp-gateway.md` |
| A2A (aos-a2a) | none (probed global_config/aos-a2a, a2a) | n/a, docs only: `docs/a2a.md`; mentioned in `AGENTS.md:223` |
| Fleet plugin (bdb-aos-fleet) | none (probed global_config/fleet) | n/a |
| Orchestrator chain | none | docs only: `docs/orchestrator-chain.md` |

No existing SKILL.md was found unregistered, so no listing change and no manifest regeneration is needed for skills.

## Edits made
- One "Cross-session and tool access" pointer line (docs/orchestrator-chain.md, docs/mcp-gateway.md, docs/a2a.md) added to:
  - `skills/basic/startcycle/SKILL.md` (new "Available tools" section before Safety)
  - `skills/basic/startcycle-graph/SKILL.md` (new "Available tools" section before "Why this file is a thin router")
  - `skills/basic/startcycle-graph-user/SKILL.md` (line before section 3)
- Contract check: body text is unrestricted; `checkLocalRefs` (`validate-skills.mjs:219`) only checks refs under references/scripts/assets/...; `docs/...` is not checked; no usernames, no `/hyphen-skill` refs added. Content change only, so `build-plugin-manifest --check` is unaffected.
- Dispatcher to run (not run here): `npm run validate`.

## Gaps (no skill exists; none created)
- `aos-gateway` - route MCP tool access through the local gateway and app picks (`docs/mcp-gateway.md`).
- `aos-a2a` - list/send/reply to live harness peers; inbound is context, never a GO (`docs/a2a.md`).
- `aos-fleet` - operate the bdb-aos-fleet plugin (fleet view of sessions/workers); source of truth for its commands unconfirmed.
- `orchestrator-chain` - master -> project -> package orchestrator hand-offs (`docs/orchestrator-chain.md`).
If any is created: add under `skills/global_config/<name>/` (category bdb-core), then run `node scripts/build-plugin-manifest.mjs` to regenerate manifests.
