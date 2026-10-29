# Triage of stale branches

| Branch | Commit | Status | Reason |
|---|---|---|---|
| `feat/aos-plugin` | AOS CLI target | already on main | `installer.js` registers target 10. |
| `feat/aos-plugin` | /aos and /aos-status commands | already on main | Exists in `packages/aos-cli/extensions/aos.ts`. |
| `feat/aos-plugin` | plugin manifest from a generated manifest | already on main | `scripts/build-plugin-manifest.mjs` generates it. |
| `feat/aos-plugin` | spec-strict skill loading | already on main | `E-NAME01` check is in `validate-skills.mjs`. |
| `feat/aos-plugin` | no-provider message | already on main | Implemented via `checkProvider` in `aos.ts`. |
| `feat/deja-session-hook` | deja wip at session start via memb-inject | already on main | `dejaWip` injected inside `memb-inject.mjs`. |
| `feat/deja-session-hook` | plan-canvas wide tables | already on main | `ui.js` uses `.doc` with full width track. |
| `feat/deja-session-hook` | release-please patch-only | already on main | `"versioning": "always-bump-patch"` in release config. |
| `feat/54-cleanup-watch` | cleanup-watch build processes | dropped | Out of scope. |

No code changes are needed since all in-scope features are already ported in main.
