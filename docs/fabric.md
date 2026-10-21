# Fabric Family v2 (WP1 + WP2 + WP3)

This document describes the Fabric Family v2 architecture implemented in AOS.
Fabric v2 introduces custom role registries, team configurations, and dynamic workstream schemas while preserving 100% byte-identical backward compatibility for default runs.

> **Naming note:** since 5.4 the family is called fabric: the master `fabric` plus the modes `fabric-graph`, `fabric-multigraph`, `fabric-teamwork`, `fabric-swarm` and `fabric-loop`. `fabric-swarm` runs N similar workers on one shared pool; `fabric-loop` is available.

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
- **Shipped Defaults:** The `default` team contains the 7 canonical node IDs with effort `S`. Bundled team presets (`web-launch`, `desktop-app`, `event`) and role definitions (`tauri_expert`, `copywriter`, `event_manager`) ship as JSON under the registry's shipped-defaults directories (`lib/roles/teams/`, `lib/roles/shipped-roles/`) and load alongside `.agents/nodes.json`. Users copy and edit a preset rather than starting from scratch.
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
- **Modules:** `lib/roles/workstream.mjs`, `.claude/workflows/fabric-dispatch.mjs`
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

### 6. Loop: the Flow Loop Template
- **Template:** `skills/global_config/loop-templates/references/flow-loop.md`
- The loop is not a dispatcher flag. It runs `/fabric-graph` in rounds via the harness loop mechanism (`/loop` on Claude Code, `opencode-loop` on OpenCode, `/goal` on Codex), using the flow-loop template as the round prompt.
- **Effort rounds:** max rounds derive from the team's effort tier — `S` = 3, `M` = 4, `L` = 5 (default 3).
- **Stop predicate (first match halts):** zero blocking findings and all quality gates pass; round limit reached; no-progress guard fires (consecutive rounds produce the exact same blocking finding IDs — escalate immediately); quota usage ≥ 95% via `stay-within-limits` (persistent wait state, not a failure); or a node requests human escalation.
- **Safety:** the loop never issues a GO, never runs or types `gogate`, and never auto-runs guarded commands (`git push`, `npm publish`, merges). A blocked guarded step stops the round with a report.

---

## What is NOT Built Yet (Future Work Packages)

The following components are defined in the architectural plan (`/Users/timrennings/.aos/briefs/plan-fabric.md`) and are intentionally out of scope for WP1, WP2 & WP3:

1. **Dedicated Dispatcher-Level Loop Orchestrator (WP5, partially shipped):**
   - The loop currently ships as the flow-loop template above, driven by the harness loop mechanism.
   - Not yet built: loop accounting inside the dispatcher itself (per-workstream `iteration` counters so one flaky lane does not starve unaffected parallel streams) and automated quota-window inspection inside the dispatcher process.

2. **Sibling Skills Alignment (WP4, shipped):**
   - The three working mode skills (`/fabric-graph`, `/fabric-multigraph`, `/fabric-teamwork`) document team and role resolution through the shared registry, including `aos-team` commands, effort rounds, playbook phases and ad-hoc role rules.

3. **End-to-End Docker Verification (WP6):**
   - Containerized execution of custom roles (`tauri_expert`, `copywriter`) across a live mock project.

