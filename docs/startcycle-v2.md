# Startcycle Family v2 (WP1 + WP2 + WP3)

This document describes the Startcycle Family v2 architecture implemented in AOS.
Startcycle v2 introduces custom role registries, team configurations, and dynamic workstream schemas while preserving 100% byte-identical backward compatibility for default runs.

---

## What Exists in Version 1 (WP1, WP2 & WP3)

### 1. Role Registry Engine
- **Module:** `lib/roles/role-registry.mjs`
- **Schema:** `.agents/role.schema.json`
- **Tiers & Precedence:**
  1. Project Local: `<workspace>/.aos/roles/*.json`
  2. User Global: `~/.aos/roles/*.json`
  3. Shipped Defaults: Derived from `<workspace>/.agents/nodes.json` (the 7 canonical nodes: `architect`, `techlead`, `ui_ux`, `engineering`, `media_eventtech`, `reviewer`, `shipping`).
- **Purity & Isolation:** The `home` directory is always passed explicitly as a parameter; `process.env.HOME` is never read inside the engine.
- **Validation:**
  - Unknown fields are strictly rejected (`additionalProperties: false`).
  - IDs must match `^[a-z0-9_]+$`.
  - Roles must be one of: `plan`, `approve`, `build`, `review`, `gate`, `specialist`.
  - Model tiers must be one of: `flash_lo`, `flash`, `pro`.
  - Skills must exist under `skills/` (or are recorded as `unresolvedSkills` with role ID).
  - Playbooks must exist under `skills/playbooks/` (or recorded as unresolved).
  - Playbook entries can be strings or `{ "id": "...", "phase": "before" | "during" | "after" }` (default: `during`).
  - Error collection: Bad user or project JSON files collect clean error objects without throwing.

### 2. Team Engine & Playbook Derivation
- **Module:** `lib/roles/team.mjs`
- **Schema:** `.agents/team.schema.json`
- **Team Configuration:** `{ id, label, roles: string[], playbooks?: string[], gates?: string[], effort: 'S' | 'M' | 'L' }`.
- **Effort Mapping:**
  - `S` = 3 repair rounds (default)
  - `M` = 4 repair rounds
  - `L` = 5 repair rounds
- **Shipped Default Team:** The `default` team contains the 7 canonical node IDs with effort `S`.
- **Derivation via `teamFromPlaybook(playbookPath, options)`:**
  - Parses playbook frontmatter `requires: { skills, agents, mcps, tools }` (e.g. `pb-tauri-e2e`).
  - Agents matching registered role IDs become team roles (unmatched reported in `missingRoles`).
  - Playbook skills attached to team context and MCP dependencies surfaced for verification.

### 3. State Schema Contract
- **Schema:** `.agents/state.schema.json`
- **Documentation:** `.agents/graph.md`
- **Extensions:**
  - Optional `team`: `{ id, label, roles, playbooks, gates, effort }`.
  - Optional `execution_manifest`: `{ createdBy: "architect", effort: "S"|"M"|"L", workstreams: [...] }`.
  - Workstream definition (`$defs.workstream`): `{ id, agentType, role?, skills, playbooks?, artifactKey, gates?, iteration? }`.
  - Min workstreams: 1, Max workstreams: 6 (default target: 4).
  - 100% Backward Compatible: Legacy state files lacking `team` or `execution_manifest` validate without warnings.

### 4. CLI Tool (`aos-team`)
- **Executable:** `bin/aos-team.mjs`
- **Registered In:** `package.json` (`"bin"`), `lib/uninstall-records.js` (`LAUNCHERS`), and `installer.js`.
- **Subcommands:**
  - `aos-team list [--json]`: Read-only enumeration of all available teams across tiers.
  - `aos-team show <id> [--json]`: Read-only inspection of a specific team.
  - `aos-team new <id> [--from-playbook <name>] [--json]`: Creates `.aos/teams/<id>.json` in the working directory; refuses to overwrite existing files.

---

## Formats & JSON Examples

### Role Definition Example: `tauri_expert`
Stored at `.aos/roles/tauri_expert.json` or `~/.aos/roles/tauri_expert.json`:

```json
{
  "id": "tauri_expert",
  "label": "Tauri v2 Desktop Engineer",
  "role": "build",
  "persona": "Senior Rust & Tauri desktop engineer specializing in secure IPC and cross-platform native packaging.",
  "skills": [
    "godmode-engineering",
    "webapp-testing",
    "systematic-debugging"
  ],
  "playbooks": [
    {
      "id": "pb-tauri-e2e",
      "phase": "during"
    }
  ],
  "tools": [
    "cargo",
    "tauri-driver",
    "chrome-devtools"
  ],
  "gates": [
    "ipc_latency",
    "binary_security"
  ],
  "model_tier": "flash"
}
```

### Team Definition Example: `desktop-app`
Stored at `.aos/teams/desktop-app.json` or `~/.aos/teams/desktop-app.json`:

```json
{
  "id": "desktop-app",
  "label": "Tauri Desktop Application Team",
  "roles": [
    "architect",
    "techlead",
    "tauri_expert",
    "reviewer",
    "shipping"
  ],
  "playbooks": [
    "pb-tauri-e2e"
  ],
  "gates": [
    "ipc_latency",
    "binary_security"
  ],
  "effort": "M"
}
```

### 5. Dynamic Workstreams Engine & Dispatcher (WP3)
- **Modules:** `lib/roles/workstream.mjs`, `.claude/workflows/startcycle-dispatch.mjs`
- **Flag:** `--workstreams` (default: OFF).
  - Without `--workstreams`: 100% byte-identical backward compatibility with the legacy 7-node flow.
  - With `--workstreams`: dynamic workstream resolution driven by Architect-authored `execution_manifest`.
- **Workstream Rules & Constraints:**
  - Target: 1 to 4 workstreams (hard cap: 6, enforced by schema & validator).
  - Stream IDs: regex `^[a-z0-9_]+$` with strict uniqueness.
  - Required non-empty `skills` array with existence verified against installed skills.
  - Playbooks verified against indexed playbooks with valid phases (`before`, `during`, `after`).
  - Ad-hoc roles supported when composed of verified installed skills.
- **TechLead Validation Gate:**
  - Fast-fail validation gate verifying role, skill, and playbook existence before build dispatch.
  - Rejects back to Architect with specific error messages if any component is missing or invalid.
- **Build Fan-Out & Barrier State Merging:**
  - `BUILD_NODES` dynamically assembled via `resolveBuildPlan` / `buildNodesFromManifest`.
  - Parallel isolation: each workstream writes exclusively to `production_artifacts/state.d/<ws_id>.json`.
  - Barrier folding: existing `mergeStateD()` folds all fragments into `production_artifacts/state.json` deterministically.
  - Dispatcher mediation: agents never invoke each other; dispatcher controls all edges and loops.
- **Per-Stream Quality Gates:**
  - `deriveWorkstreamGates` aggregates custom gates across workstreams (e.g. `ipc_latency`, `binary_security`) or falls back to standard gates (`lint`, `typecheck`, `tests`, `a11y`, `seo`, `security`).

---

## What is NOT Built Yet (Future Work Packages)

The following components are defined in the architectural plan (`/Users/timrennings/.aos/briefs/plan-startcycle-v2.md`) and are intentionally out of scope for WP1, WP2 & WP3:

1. **Loop Orchestrator & Quota Guard (WP5):**
   - Autonomous multi-round review loops driven by `effortRounds`.
   - Stop predicates (clean findings + passed gates vs. iteration ceiling).
   - No-progress guard detecting identical blocking finding IDs.
   - Quota limit detection (`stay-within-limits` / `ccusage`).

2. **Sibling Skills Alignment (WP4):**
   - Integration of custom role resolution into `/startcycle` (linear mode).
   - Integration into `/startcycle-graph-user` (lightweight fan-out).
   - Dynamic team preview generation in `/teamwork-preview`.

