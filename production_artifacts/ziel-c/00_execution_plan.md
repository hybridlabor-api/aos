# Ziel C phase 1: delegation plugins verified locally

Branch `feat/ziel-c-phase1`. Spec: `~/.aos/recovery-plan/ziel-c-plan.md` §10a. No GitHub, no product code. Codex (V3) is out of scope.

## agy research plugin, read-only {#agy}
tech: MarcosNahuel/antigravity-plugin-cc a844ad1, local mirror branch `aos`, V1 check
by: sonnet worker
- [ ] Billing hint ported from simplybychris bb70b78 {#agy-hint}
- [ ] Read-only rule: no write tasks, no --add-dir to project {#agy-ro}
- [ ] V1 check: research answer, fixture clean, no mcsc child, agy count back to baseline {#agy-v1}

## opencode worker plugin without global config rewrite {#opencode}
tech: tasict/opencode-plugin-cc 9b62c33, local mirror branch `aos`, V2 check
by: sonnet worker
- [ ] Remove opencode-config.mjs global rewrite, per-run permissions {#oc-patch}
- [ ] V2 check: global config checksum unchanged, review + write task in fixture {#oc-v2}

## MCP footprint baseline {#baseline}
tech: V4, ps counts and RSS per harness, MCPX license
by: haiku worker
- [ ] V4 report {#v4}
