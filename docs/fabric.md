# Fabric Family v2 (WP1 + WP2 + WP3)

This document describes the Fabric Family v2 architecture implemented in AOS.
Fabric v2 introduces custom role registries, team configurations, and dynamic workstream schemas while preserving 100% byte-identical backward compatibility for default runs.

> **Naming note:** since 5.4 the family is called fabric: the master `fabric` plus the modes `fabric-graph`, `fabric-multigraph`, `fabric-teamwork`, `fabric-swarm` and `fabric-loop`. `fabric-swarm` runs N similar workers on one shared pool; `fabric-loop` is available.

---

## aos-fabric: one loop for every harness (5.4.2)

`/fabric-graph` used to run only where a workflow script runtime exists, because the loop lived in
`.claude/workflows/fabric-dispatch.mjs`. Every other harness got the rules as prose and had to rebuild the loop.
`bin/aos-fabric.mjs` turns the loop into a CLI with fixed state and fixed steps. Any harness, or a plain shell,
fetches the next step, runs it with whatever executor it has and reports the result. The decisions (edges, loop
brake, escalation) live in one place: `lib/fabric/edges.mjs`. The contract stays `.agents/graph.md`.
AOS works without AO; AO is only one optional executor.

```sh
aos-fabric start --run demo --goal-file goal.md        # first step
aos-fabric drive --run demo                            # headless: next, execute, report until terminal
# or by hand, with your own executor:
aos-fabric next   --run demo                           # {kind: step|escalated|ready_to_ship|done|cancelled, step?}
aos-fabric report --run demo --step 0-architect-1 --file report.json
```

| Command | Does | Idempotent |
|---|---|---|
| `start` | Creates the run, returns the first step. `--run` defaults to a hash of the goal. | Same run and goal: returns the state, writes nothing. Same run, other goal: exit 4. |
| `next` | The open step, or how the run ended (`kind` `done`, `escalated`, `ready_to_ship`: exit 0, read `kind`, not only the code; exit 6 only for a cancelled run). Never changes the run. | The same step_id every time. |
| `report` | Hands in the report of the open step (`--file`), or records a failed step without a file (`--fail <reason>`). Returns the next step. | The same report (same digest) is a no-op, another one for an accepted step is exit 4. |
| `status` | Phase, iteration, open findings, last step, lock info. Read-only. | Yes. |
| `cancel` | Phase `cancelled`. | Already cancelled: no-op. |
| `drive` | The loop above. One JSON event per line; exit 0 at `ready_to_ship`/`done`, 6 when a human is needed. | Resumes an open step. |

Exit codes, the same for every command: `0` ok, `1` unexpected error (or `drive` found no harness), `2` invalid input
(unknown flag or schema major, broken report), `3` unknown run or step, `4` conflict, `5` lock busy (retry, at most 5
times), `6` run is terminal and takes no such command (`report` or `cancel` on a finished run, `next` on a cancelled one), `7` state corrupt (fail closed, a human reads `events.jsonl`).

### The loop

```
architect -> techlead -> human (plan canvas verdict) -> build nodes, one after another -> reviewer -> shipping -> ready_to_ship
```

- TechLead or the human reject the plan: `iteration++`, Architect again with the reasons as findings.
- Reviewer reports blocking findings with new ids: `iteration++`, only the owning build nodes run, then Reviewer again.
- Reviewer reports the same blocking ids after a repair round: `escalated` (loop brake, `last_blocking_ids`).
- Shipping reports a failing gate: `iteration++`, the nodes named by its blocking findings run, then Shipping again.
- `iteration >= max_iterations` (default 3): `escalated`. A step that fails `max_attempts` (2) times: `escalated`.
  A report with `needs_human` or status `escalate`: `escalated`.
- All gates `pass`/`skip`: `ready_to_ship`. The push is a separate step behind the go-gate; a run never grants a GO.

Build nodes run one after another, so no node and no merge step writes state: `state.d/` and the `merge_state` agent
are not needed (they stay in the legacy engine of the workflow script).

### Step and report (version 1)

`aos.fabric.step/1` (what the executor must do): `step_id` (`<iteration>-<node>-<attempt>`), `node`, `role` (agent slug),
`kind` (`plan`, `techlead`, `human`, `build`, `review`, `ship`), `brief` (a Markdown file with the full task, written by the
CLI; the Reviewer brief holds no goal and no claim of another node), `cwd`, `model_hint` (`{harness?, model?, models?}`
from `pipeline.json`, never binding), `timeout_s` (per node in `.agents/nodes.json`), `scope`, `allowed_writes`,
`expected_report`, `attempt`, `max_attempts`.

`aos.fabric.report/1` (what the executor hands back): required are `schema`, `step_id` and `status` (`ok`, `fail`,
`escalate`). Optional: `exit_code`, `findings[]` (`id`, `severity` blocking|advisory, `node`, `summary`, `status`),
`artifacts` (`plan` for Architect, the node's `artifactKey` for build nodes), `files_changed`, `needs_human`, `executor`,
`gate` (Shipping: `lint typecheck tests a11y seo security`, each `pass|fail|skip`), `optional_nodes` (Architect: optional
build nodes the plan needs). A TechLead rejection is `ok` plus blocking findings for `architect`; a human change request is
`fail` plus a blocking finding for `architect`. Another major version is exit 2; unknown fields of major 1 are ignored
but kept in the event log.

**The report is a proposal.** `report` checks it against reality: `artifacts` must exist inside the work tree (no
absolute path, no `..`, no link leaving it, only letters, digits and `. _ - / @ +`, because artifact paths reappear in later briefs and commands), Shipping must give every gate key, and `git status` is compared with the
snapshot taken when the step was issued: a path changed outside `allowed_writes` (or outside the work tree) turns the
report into a failed step. A work tree that is no git repository cannot be checked and is noted in the event.

### State

`production_artifacts/runs/<id>/` holds `events.jsonl` (append-only, the truth; each event carries the state it produced),
`state.json` (projection), `steps/<step_id>.json` and `briefs/<step_id>.md` (immutable once issued), `reports/` and
`state.lock`. Only the CLI writes them. A write is: lock (`wx`, pid and time; a lock older than 60 s whose pid is dead is
taken over), append the event, then rewrite the projection and mirror it to `production_artifacts/state.json`, which the
graph-gate hook reads. Files are written to a temp file, synced and renamed. A torn last log line is dropped on read, a
broken line in the middle is exit 7. `.agents/state.schema.json` gained the optional `attempts` and `last_blocking_ids`
and the phase `cancelled`; older state files stay valid.

### Executors

One contract for all: brief and work directory in, report file out, exit 0 on a normal end. The driver enforces
`timeout_s` (stop signal, hard kill after 10 s, report `fail` with exit code 124), and fails closed: a crash, a
missing or a broken report is a failed step. A report the executor printed as its last JSON object instead of writing is
accepted from stdout; a report file above 2 MiB is a broken report. Text of other agents (finding summaries) is put into briefs on one short line. The harness is `model_hint.harness`, else the harness this process runs in (the session variables of
`aos-gate`), else the first of `claude codex opencode agy` on PATH; none found is exit 1 and the step stays open.

| Harness | Run as | Permissions |
|---|---|---|
| claude, opencode, agy | `aos-acp <harness> --name fabric-<run>-<step> --prompt-file <brief> --allow-default scoped|deny --timeout <s>` (the GO gate applies) | `scoped` when the step may write, else `deny`. agy cannot limit write paths per tool call: for a writing step it needs `--sandbox coop|wsl2` (or `AOS_FABRIC_SANDBOX`), else the step fails with `agy-scope`. |
| codex | `codex exec --sandbox workspace-write|read-only` through `codexInvocation` (as the A2A spawn executor does) | by the same write rule |
| AO (optional) | `ao spawn --project --name --role --harness --prompt`; completion is the report file | `--executor ao`, or `auto` when `ao` is on PATH and `/health` answers within 1 s. Absent AO falls back to aos-acp and says so in the event log. Unverified against a live AO. |

The `human` step runs `aos-plan-canvas open <plan> --await` and maps the verdict (`approve` -> `ok`, comments or
request-changes -> `fail` with the feedback, ended session or timeout -> `escalate`); `AOS_PLAN_APPROVAL=auto` skips it
(CI only, prints a warning). Workers get no proxy variables and run with `AOS_A2A_SIDECAR=off`, like A2A workers.
`AOS_FABRIC_FAKE_EXECUTOR=<script.js>` with `--executor fake` runs a script instead of a harness: tests only.

### Engines of the workflow script

`.claude/workflows/fabric-dispatch.mjs` keeps its legacy engine (profiles, workstreams, archify boundary check) as the
default. `--engine=cli` in the goal, or `AOS_FABRIC_ENGINE=cli`, makes it a thin client of `aos-fabric`: `start`, then a loop of
`next`, an agent as executor and `report` (inside a workflow runtime), or `drive` (anywhere else). The client does not support
`--profile` and `--workstreams` yet and says so.

### Tests

`tests/fabric-schema`, `-store`, `-edges` (one row per edge plus the nine dispatcher scenarios), `-verify`, `-engine`,
`-cli`, `-executors`, `-drive`, `-dispatch-client` and `-smoke.test.mjs`. The smoke test drives a whole run for each of
the four harnesses with fake `claude`, `codex`, `opencode`, `agy` (and `npx`) binaries on PATH that only write a report; it
runs in the full suite and, on macOS, Linux and Windows, in the `Fabric smoke` CI job.

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

The following components are defined in the architectural plan (`~/.aos/briefs/plan-fabric.md`) and are intentionally out of scope for WP1, WP2 & WP3:

1. **Dedicated Dispatcher-Level Loop Orchestrator (WP5, partially shipped):**
   - The loop currently ships as the flow-loop template above, driven by the harness loop mechanism.
   - Not yet built: loop accounting inside the dispatcher itself (per-workstream `iteration` counters so one flaky lane does not starve unaffected parallel streams) and automated quota-window inspection inside the dispatcher process.

2. **Sibling Skills Alignment (WP4, shipped):**
   - The three working mode skills (`/fabric-graph`, `/fabric-multigraph`, `/fabric-teamwork`) document team and role resolution through the shared registry, including `aos-team` commands, effort rounds, playbook phases and ad-hoc role rules.

3. **End-to-End Docker Verification (WP6):**
   - Containerized execution of custom roles (`tauri_expert`, `copywriter`) across a live mock project.

