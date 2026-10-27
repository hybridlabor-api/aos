# BDB Agent Graph — `/fabric-graph` v2

Harness-neutral contract for the autonomous build pipeline. This is the
dispatcher-mediated graph, invoked as `/fabric-graph`. It is the only full
pipeline of the fabric family. A straight-line run with plain file hand-offs
and no `state.json` is described in `skills/basic/fabric-graph/linear.md`;
this graph is what you reach for when you need the durable record, the
Reviewer repair loop, the automated gate, and a human-escalation edge.
`skills/basic/fabric/` is the master that picks a mode, and
`skills/basic/fabric-multigraph/` is a throwaway 2-4 node fan-out with
nothing persistent left behind.
See `audit-agents.md` §6 and F-17 for the analysis behind this design; this
file is the buildable spec for the graph variant only.

**Read this before touching `/fabric-graph`'s control flow.** The single rule
that matters: **nodes never call each other.** A node reads `state.json`, does
its work, writes `state.json`, and returns. The dispatcher — the main session,
or a slash command acting on the user's behalf — is the only thing that
decides which edge fires next. This is not a Claude Code platform limit (it
permits nested subagent calls up to 3 levels); it's a deliberate choice for
context fidelity, single-place auditability of routing logic, and
cross-harness portability (§7 of the audit). If you find yourself writing
"and then this agent hands off to that agent," stop — that decision belongs
in this file's edge table and in the dispatcher, not inside an agent's prompt.

## State

The full schema is `.agents/state.schema.json`, persisted at
`production_artifacts/state.json`. With `aos-fabric` that file is the mirror of a
per-run store, `production_artifacts/runs/<id>/` (`events.jsonl` is the truth,
`state.json` its projection), and only the CLI writes it. Markdown artifacts
(`production_artifacts/{00_execution_plan,01_frontend_spec,...}.md`) stay the
human-readable payload; `state.json` is what the dispatcher's edges evaluate.
Every node reads `state.json` at the start of its turn and writes it back
before returning — this is what replaces "hand-off," and it's why a node
never needs another node's reasoning: `goal` and prior artifacts are always
read from the same typed record, not re-derived from a sibling's prose.

### Team and Execution Manifest (v2 optional fields)

For custom team and dynamic workstream runs, `state.json` additively supports two optional properties:
- **`team`**: The active team configuration (`id`, `label`, `roles[]`, `playbooks[]`, `gates[]`, `effort: S|M|L`). When absent, the pipeline runs the legacy 7-node default team byte-identically.
- **`execution_manifest`**: Dynamic workstreams plan authored by Architect and approved by TechLead (`createdBy: "architect"`, `effort: S|M|L`, `workstreams: [...]`). Each workstream defines `id`, `agentType`, optional `role`, `skills[]`, `playbooks[]`, `artifactKey`, and per-stream `gates[]`. Hard-capped at 6 workstreams (default max 4).
- **`workstreams`**: Array of active workstream runtime definitions.

Existing state files without these fields continue to validate strictly against `.agents/state.schema.json`.

## Mandatory Skill Injection

`/fabric-graph --skill=<name> <goal>` (repeatable: `--skill=a --skill=b
<goal>`, quote a name containing spaces) forces a specific skill into this
run — for the case where you have your own private skill (never part of
`.agents/nodes.json`'s registry, and never touched by AOS's installer per
its foreign-file conflict policy) that you need applied regardless of what
the registry's own per-node allowlist would have reached for.

- The dispatcher script (`fabric-dispatch.mjs`) extracts every
  `--skill=` flag from the invocation text before anything else runs, then
  validates each name resolves to a real installed skill (a `SKILL.md`
  under any harness's global skills directory — `~/.claude/skills/<name>/`,
  `~/.agents/skills/`, `~/.codex/skills/`, `~/.cursor/skills/`, `~/.roo/skills/`,
  all of which the installer writes — or this project's own `skills/` tree) via
  a read-only lookup agent. **A name that doesn't resolve escalates
  immediately** — same "never silently fall back or guess" posture as a
  missing registry node id. This is a fail-fast check specifically so a
  typo doesn't silently ship a run that never used the skill you asked for.
  A flag written with an empty value (`--skill=` with nothing after it)
  escalates for the same reason: it would otherwise inject nothing *and*
  leave the literal `--skill=` glued to the goal text Architect reads.
- The validated list is persisted to `state.mandatory_skills` (set by
  Architect on the first write) and passed to every build node's prompt —
  and Architect's own — as a **hard requirement, not a suggestion**,
  layered on top of (never replacing) the registry's own per-node skill
  allowlist.
- **TechLead rejects a plan that ignores the mandate**, at the plan-approval
  gate — one extra planning round instead of a wasted build cycle. Without
  this the mandate is only caught downstream by Reviewer, i.e. after the
  build nodes have already run against a plan that never accounted for it.
- **Reviewer checks it was actually used, not just available.** An artifact
  that shows no sign of applying a mandated skill's guidance is a
  `contract_misread` finding (blocking), owned by whichever build node
  should have applied it — the same precedence class as misreading the
  plan itself, since an ignored `--skill` flag is exactly that.
- Nodes that do **not** receive the mandate, deliberately: `shipping` (runs
  mechanical gates — lint/typecheck/tests — and produces no artifact a skill
  would shape).
- The linear run (`skills/basic/fabric-graph/linear.md`, no `state.json`) and
  `/fabric-multigraph` (throwaway, nothing persistent) support the same
  `--skill=<name>` syntax — see each skill's own `SKILL.md` for how the
  orchestrator threads it through without a durable state file to carry it
  in.

## Nodes

Seven, up from the original five — `Planner_Orchestrator` is split into
**Architect** (system plan) and **TechLead** (execution coordination,
capability-map approval) per the reference diagram (B5), and an explicit
**Reviewer** is added (B1's adversarial-review step, modeled on B3's
`doubt-driven-development` discipline — see below). Node identity
and skill allowlist now come from `.agents/nodes.json` (a declarative
registry the dispatcher loads at run start via a `load-registry` step) —
this table stays the routing summary; per-node config lives in the
registry, not here or in `.agents/agents.md`.

| Node | Reads | Writes | Never |
|---|---|---|---|
| **Architect** | `goal` | `artifacts.plan`, `phase: plan` | invokes TechLead itself |
| **TechLead** | `artifacts.plan` | `phase` (`build` or back to `plan`), capability-map approval | invokes Architect or the build nodes itself |
| **UI_UX** | `artifacts.plan`, own prior `findings` | own `state.d/ui_ux.json` fragment (never `state.json` directly — see Harness; may set `needs_human: true` which the merge step propagates to the top level) | invokes Engineering/Media/Reviewer itself |
| **Engineering** | `artifacts.plan`, own prior `findings` | own `state.d/engineering.json` fragment (never `state.json` directly; may set `needs_human: true` which the merge step propagates to the top level) | invokes UI_UX/Media/Reviewer itself |
| **Media_EventTech** | `artifacts.plan`, own prior `findings` | own `state.d/media_eventtech.json` fragment (only if the goal needs it; never `state.json` directly; may set `needs_human: true` which the merge step propagates to the top level) | invokes the other build nodes itself |
| **Reviewer** | `artifacts.{frontend,backend,media}` **only** — never `goal`, never a build node's reasoning | `findings[]` | invokes a build node itself, or ever sees the original `goal`/CLAIM |
| **Shipping** | `artifacts.*`, `findings` (all must be `fixed`/`wont_fix`) | `gate.*`, `artifacts.report`, `phase: ready_to_ship` | invokes anything, or ships with an open `blocking` finding |

With `aos-fabric` no node writes `state.json` or a `state.d/` fragment: a node writes its
artifact and a report (`aos.fabric.report/1`) and the CLI folds it into the state. The
"Writes" column above describes the legacy workflow engine.

### Reviewer discipline (from B3's `doubt-driven-development`, adopted verbatim)

The Reviewer is the one node most likely to be miswired into "just read what
the implementer said and check if it sounds right" — that is the failure mode
this discipline exists to prevent:

1. Pass the Reviewer **`artifacts.*` and the plan's stated contract only** —
   never the implementer's own claim that it's done, never their reasoning.
   Passing the claim biases toward agreement.
2. The dispatcher's invocation prompt to Reviewer must be adversarial:
   *"Find what is wrong with this artifact against its contract. Assume the
   author is overconfident. Do NOT validate. Do NOT summarize."*
3. Classify every finding against a fixed precedence, first match wins:
   contract misread → valid and actionable → valid trade-off (advisory, not
   blocking) → noise (discard).
4. **No-progress guard, adapted from B3's "doubt theater" concept.** B3's
   original framing — escalate after 2 consecutive *clean* Reviewer cycles on
   the same artifact — doesn't have a reachable trigger once this contract
   became an actual runnable script (`.claude/workflows/fabric-dispatch.mjs`): a
   clean result exits the build/review loop immediately, so Reviewer is never
   asked to re-confirm an already-clean artifact twice in a row. What the
   script implements instead, in the same spirit: if a repair round reports
   the **exact same blocking finding ID(s)** Reviewer already flagged before
   the build node was re-invoked to fix them, the dispatcher escalates
   immediately rather than burning the remaining iterations on a cycle that
   isn't making progress. Same intent (don't keep trusting a loop that isn't
   working), a form this control flow can actually reach.

## Workers and scopes

Each node in `.agents/nodes.json` may declare two optional fields:

- `executor`: the harness/model class that runs it (e.g. `planner`, `builder`, `reviewer`, `gate`). Never a pinned model; models come only from `pipeline.json`.
- `scope`: what the node may touch. `read-only` (inspect, write only its own artifact/finding), `worktree-write` (edit inside its task worktree), `none` (no network, no release actions).

The dispatcher enforces both; a node never widens its own scope. Subagents and workers delete nothing; cleanup is the dispatcher's job after the human's GO. Release-class actions (publish, push to a remote, version bump, deploy) stay with the human via `state.approvals`. Scopes pair with the go-gate profile (`strict` / `work` / `off`): the profile decides how hard the hook blocks, the scope decides what a node is allowed to attempt at all.

### Task-manager role

The task-manager is the dispatcher's queue owner. It sequences work (which node or task runs next), owns the Docker/job queue so only one container-heavy task runs at a time, and never merges: merging build fragments is the `merge_state` step, merging branches is the human's decision.

## Edges

Evaluated by the dispatcher after every node returns, against `state.json` —
never inside a node's own prompt. The rows below are the contract; they are
implemented once, as the pure function `decide()` in `lib/fabric/edges.mjs`, and
`tests/fabric-edges.test.mjs` pins one case per row. Under `aos-fabric` the build
nodes run one after another, a human plan verdict (step kind `human`, plan-canvas)
sits between "TechLead approved" and the first build node, and a step that fails
`max_attempts` (2) times escalates.

| After | Predicate | Dispatcher does |
|---|---|---|
| Architect | *(always)* | invoke TechLead |
| TechLead | plan rejected (capability map not approved) | `iteration++`, invoke Architect again |
| TechLead | plan approved | invoke UI_UX, Engineering, Media_EventTech (parallel — each is an independent dispatcher call, not one node fanning out to the others) |
| any build node | *(after all three return, or the ones the goal needs)* | invoke Reviewer |
| Reviewer | any `blocking` finding open, and it's a **new** finding ID | `iteration++`, invoke the owning build node (only that one, not all three) |
| Reviewer | the **same** `blocking` finding ID(s) as the previous cycle | set `needs_human: true`, `phase: escalated` — **stop** (no-progress guard, see above) |
| Reviewer | zero blocking findings | invoke Shipping |
| Shipping | any `gate.*` is `fail` | `iteration++`, invoke whichever build node(s) Shipping's own structured output names as owning the failing check(s) — the dispatcher does not guess a lint/test-to-node mapping itself |
| Shipping | all `gate.*` are `pass`/`skip` | `phase: ready_to_ship`, stop — surface "ready to ship, needs GO" to the user. The dispatcher does not itself check `approvals` for a prior GO here (see the Harness section's noted exception); the actual push/version/publish is a separate GO-gated step, enforced by `go-gate.mjs`, which does the GO check at the point it matters. |
| any | `iteration >= max_iterations` | **stop unconditionally**, `phase: escalated`, set `needs_human: true` — do not invoke anything further automatically |
| any | a node sets `needs_human: true` itself | stop, surface to the user (in-loop feedback edge, per B5's diagram — `/fabric-graph`'s original "zero-prompting" framing had removed this; it's restored here as an edge, not a constant interruption) |

## Harness (the loop-keeper)

Three layers now, matching §7's design rule — nothing normative lives only in
a Claude-only file:

- **Advisory** (every harness): this file, read by whatever plays the
  dispatcher role — the main Claude Code session, an Antigravity subagent
  loop, or an OpenCode primary agent. The edge table above is the contract
  regardless of which harness executes it.
- **Harness-neutral dispatcher (every harness)**: `aos-fabric` (`bin/aos-fabric.mjs`,
  `docs/fabric.md`) is the runnable form of this contract that needs no workflow
  runtime: `start`, `next`, `report`, `status`, `cancel` and `drive`. The edge table,
  the loop brake and the escalation live in `lib/fabric/edges.mjs` only; a harness
  supplies the executor (or lets `drive` use `aos-acp`, `codex exec` or AO). It is the only
  writer of the state; the report an executor hands in is checked against the work tree.
- **Workflow-runtime dispatcher (legacy engine)**: `.claude/workflows/fabric-dispatch.mjs`
  is an older, runnable implementation of this contract, using Claude
  Code's Dynamic Workflows runtime (a script holds the loop and branches;
  the seven agents are leaves it calls via `agent()`/`pipeline()`, never
  calling each other). With `--engine=cli` (or `AOS_FABRIC_ENGINE=cli`) the same script is a
  thin client of `aos-fabric` instead; the legacy engine stays its default because only
  it handles `--profile` and `--workstreams`. What follows describes the legacy engine. The script's first action is a `load-registry` step
  that reads `.agents/nodes.json` for each node's `agentType` and
  `skills` allowlist (no model: a node gets one only from `pipeline.json`, role = agent slug or node id, harness `claude`; otherwise `agent()` is called without `model` and inherits the session model) — if a required node id is missing from that file, the
  script escalates rather than falling back to a hardcoded list. It's a
  translation, not a re-derivation — every edge in the table above has a
  corresponding branch in that script, with two deliberate exceptions: the
  script stops at `phase: ready_to_ship` rather
  than checking `approvals` itself for a prior `GO` and proceeding to
  `phase: done` (the row above notes this explicitly). Re-running the whole
  plan→build→review loop just to check one flag would be wasteful; the
  actual push/version/publish is a separate GO-gated step, enforced by
  `go-gate.mjs`, which does the GO check at the point it matters. Verified by
  running the script's extracted logic against 9+ scripted scenarios before
  it was committed (happy path, TechLead rejection loop, Reviewer repair
  loop, the no-progress guard, gate-failure repair, missing goal), then by an
  adversarial review pass against this file and `state.schema.json` that
  found and fixed real gaps (an unpersisted iteration counter, `needs_human`
  never actually being written, and the Reviewer note that follows). The second exception: the three build nodes typically do not write `state.json`
  directly. Because they run inside a `pipeline()` fan-out (genuinely
  parallel — each is an independent dispatcher call, not one node fanning
  out to the others per the table's own "Never" column), two of them
  writing the same file at once would race and silently drop an update.
  Each writes only its own `production_artifacts/state.d/<nodeId>.json`
  fragment instead; immediately after the `pipeline()` call returns (the
  barrier where every parallel node has finished), one dedicated
  merge step (role `merge_state`, model from `pipeline.json`, `haiku` by the shipped default) folds every fragment into `state.json` before the run
  continues — never deferred, since `graph-gate.mjs` reads `state.json` at
  turn end. The fragment-and-merge machinery exists ONLY because parallel
  writers would race. When a pass fans out to exactly ONE build node (the
  common case in a repair round, where only the node owning an open finding
  is re-invoked), there is no race, so that node writes `production_artifacts/state.json`
  directly and the dispatcher skips the merge step entirely. This is a
  deliberate token-efficiency measure, not an inconsistency, and the fragment
  path still applies whenever two or more build nodes run in the same pass.
  Sequential nodes (Architect, TechLead, Reviewer, Shipping) are
  never inside a `pipeline()` call, so they are not part of this race and
  keep writing `state.json` directly as the table above describes. Other
  harnesses without an equivalent "workflow" primitive fall back to this
  file as a manual dispatch guide followed turn-by-turn.
- **Deterministic safety net (Claude Code only, degrades to advisory
  elsewhere)**: `.claude/hooks/graph-gate.mjs`, a `Stop` hook that blocks
  turn-end while `state.json` shows a failing gate and
  `iteration < max_iterations` — see that file's own comments for the exact
  predicate. This exists independently of the workflow script above: it
  catches the case where someone continues a `/fabric-graph` run manually,
  turn by turn, outside the workflow runtime, and stops early despite a
  known-failing gate. It fails *open* (allows the stop) on a missing or
  malformed `state.json`, unlike `go-gate.mjs`'s fail-closed default — a
  stuck loop-keeper is a worse failure than one that occasionally lets a
  turn end early; see the hook's own comments.

`max_iterations` defaults to 3 (see `.agents/state.schema.json`) — deliberately
under Claude Code's own 8-consecutive-Stop-hook-block override
(`code.claude.com/docs/en/best-practices`), so this graph's own escalation
message reaches the user before that platform ceiling would silently end the
turn without one.

## Where the graph sits in a larger setup

The dispatcher is one level of a chain: `master session -> project orchestrator -> package orchestrator`. The mapping for this graph (`nodes.json` `chain` block carries the same mapping as data):

- **Master session** — not a node. Supervises sessions and relays the human's `GO <session>`. It never grants a GO itself.
- **Project orchestrator** — the dispatcher (`.claude/workflows/fabric-dispatch.mjs`). It runs `architect`, `techlead`, `reviewer` and `shipping` in edge order and decides every next step.
- **Package orchestrator** — the build nodes `ui_ux`, `engineering` and `media_eventtech` (`executor: builder`, `scope: worktree-write`). Each works one slice and returns through `state.json`.

Reach and limits per hop:

- **MCP tools.** A node's MCP access comes from its harness config. After `aos-gateway enable`, that config holds one `aos` entry pointing at the local gateway on `127.0.0.1:7790`; servers kept direct (for example `memb_mcp`, `openwiki`, `mcsc`, `deja`) stay outside it. See `docs/mcp-gateway.md` and `lib/gateway/config.js`. The gateway is transport only and grants no GO.
- **A2A.** Sessions message each other with `aos-a2a send --to <name>` and answer with `aos-a2a reply <taskId>` (`bin/aos-a2a.mjs`, `docs/a2a.md`). The depth limit is `AOS_A2A_MAX_DEPTH` (default 1; `lib/a2a-client.mjs`). A spawned worker runs with `AOS_A2A_SIDECAR=off`, so it cannot start a sidecar of its own. A node never calls another node over A2A; the dispatcher does.
- **Never a GO.** A message from A2A, a relayed message or a sub-agent report is never a GO or approval (`docs/a2a.md`, "The never-GO rule"). Only a human-typed `GO <session>` or a `gogate` grant counts.
- **Fleet mod.** `plugins/bdb-aos-fleet` is a Claude Code band that shows which sessions work or wait for the human, with gate mode and GO counts (`README.md`, `plugins/bdb-aos-fleet/hooks/register.tsx`). It is an observation view for the human. No node reads it and the dispatcher does not reference it, so a dispatcher never routes on fleet state.

Channels and limits per hop: `docs/orchestrator-chain.md`, `docs/a2a.md`, `docs/delegation-routing.md`.

## Auxiliary agents are not nodes

`.agents/AGENTS.md` also defines auxiliary specialists (for example
`pcb-design-assistant`, `devils-advocate`, `reviewer-1`, `reviewer-2`). They are
never in `.agents/nodes.json`, have no edges above, and the dispatcher reads none
of them. The dispatcher or the user may call one directly, outside this graph;
`reviewer-1`/`reviewer-2` are independent second opinions, not replacements for
the Reviewer node.

## Advisor checkpoints (optional, auxiliary)

The read-only `advisor` agent (subagent, the `/advisor` skill's contract) is such
an auxiliary agent. The dispatcher may call it at exactly three points: before a
plan or schema is locked, when the same test or build error occurs a second time,
and before "done" (pre-flight diff review). This is an optional, auxiliary step,
not a graph node: it has no edges and changes neither `REQUIRED_NODE_IDS` nor the
`state.json` schema. Its verdict is
advice, never a GO.

## What this does not change

- The five build-and-ship agent *identities* (`Godmode_UI_UX`,
  `Godmode_Engineering`, `Godmode_Media_EventTech`, `Godmode_Shipping`, plus
  the split `Architect`/`TechLead`) keep their existing skills, MCP servers,
  and output artifacts as defined in `.agents/agents.md` — this file adds
  routing, not new responsibilities.
- `production_artifacts/*.md` stays the human-readable output. `state.json`
  is additive infrastructure, not a replacement for the markdown.
- Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) were evaluated and
  deferred for this graph specifically because spawning teammates requires an
  interactive session and `/fabric-graph` needs to run headless — see F-17's
  addendum in `audit-agents.md` for the full reasoning. Revisit if `/fabric-graph`
  ever becomes interactive-only by design.

## Domain profiles (opt-in)

A **domain profile** adapts the seven-node pipeline above to a non-software
domain — hardware (KiCad), live media (TouchDesigner), 3D/media creation, or
copywriting — without touching the default graph. A profile is a declarative
sibling of `.agents/nodes.json`, stored at `.agents/profiles/<domain>.json`
(schema: `.agents/profiles/_schema.json`): it names which default build
nodes to `replace`, which domain build nodes to `add` (same registry shape
as nodes.json), which **gate keys** replace `lint/typecheck/tests/...` for
this run (KiCad: `erc`, `drc`, `constraints`), and which artifact names the
Reviewer/Shipping prompts enumerate. Four profiles ship today:
`kicad`, `touchdesigner`, `creator`, `copywriter`.

**Selection order** (first match wins, mirroring how `--skill=<name>` is
resolved):

1. **Explicit flag** — `/fabric-graph --profile=<name> <goal>` is the
   strongest signal and skips keyword matching entirely. A `--profile` name
   that does not resolve to a file in `.agents/profiles/` escalates the same
   way as a missing `--skill` name: stop, surface the error to the user,
   never silently fall back to the default pipeline.
2. **Plan-gate decision** — if no flag is given, TechLead's plan-approval step
   (the capability-map gate) emits a `profile` decision
   derived from the goal text against each profile's
   `selection.triggers` (lowercase keywords, unique across profiles — an
   ambiguous goal that hits two domains' triggers escalates rather than
   guessing). There is no regex in the dispatcher; the decision is a
   judgment call recorded like any other plan-gate decision.
3. **Default** — no profile selected means the current software pipeline,
   unchanged: the same seven nodes, the same gate keys, the same artifact
   names. Every existing behavior is the "no profile" branch.

Every skill name, agent type, and persona file a profile references is
validated against this repo by `node scripts/validate-profile.mjs`
(`npm run validate:profiles`); `tests/profile-files.test.mjs` pins the four
profiles and asserts the default registry is untouched.

**Status, stated honestly:** the explicit `--profile=<name>` flag is wired.
`.claude/workflows/fabric-dispatch.mjs` loads the profile after
`.agents/nodes.json`, derives `BUILD_NODES`, the Reviewer prompt's artifact
enumeration and the Shipping `GATE_KEYS` from it, and escalates on an
unknown, malformed or invalid profile; `state.schema.json` accepts
profile-defined gate and artifact keys. Not built yet: keyword selection from
the goal text (the plan-gate `profile` decision) and a successful-run test of
a profile end to end. Without `--profile` the default pipeline runs unchanged.

