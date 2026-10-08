# R8: Domain-Adaptable Startcycle — Analysis (Step 1)

Claim markers: **[V file:line]** = verified; **[G]** = guess/unverified. Source: Tim's R8 brief
(`~/.aos/recovery-plan/aos-routing-and-daily-tools.md:25-26`).

## 1. What exists

### 1.1 The three startcycle variants — what each hard-codes

| | `startcycle` | `startcycle-graph` | `startcycle-graph-user` |
|---|---|---|---|
| Deterministic? | Invoker runs steps by hand **[V SKILL.md:139]** | Yes, dispatcher script **[V graph.md:159-170]** | Invoker-driven, throwaway **[V SKILL.md:130-143]** |
| Node roster | 5 steps, roles inline **[V SKILL.md:57-126]** | 7 fixed ids: architect, techlead, ui_ux, engineering, media_eventtech, reviewer, shipping **[V nodes.json:6-146; tests/swarm-wiring.test.js:62 pins this exact order]** | 2–4 nodes, ad-hoc per run **[V SKILL.md:18-31]** |
| Streaming assumption | Streams named 3a frontend / 3b backend / 3c media with artifact names `01/02/0*.md` **[V SKILL.md:30-35, 80-84]** | `needsMedia` filter keeps `media_eventtech` optional **[V dispatch.mjs:1017-1019, 875-916]** | None **[V]** |
| Artifact names | `00_execution_plan.md`, `01_frontend_spec.md`, `02_backend_schema.md`, `03_media_pipeline.md`, `04_release_report.md`, `review_findings.md` **[V SKILL.md:61-126; dispatch.mjs:887,1092,1212]** | Same, plus `00_architecture.{json,html}` and `state.d/` fragments **[V dispatch.mjs:888-892, 505]** | none **[V]** |
| Gate (Shipping) | lint, typecheck, tests, a11y, SEO **[V SKILL.md:125]** | `GATE_KEYS = ['lint','typecheck','tests','a11y','seo','security']` **[V dispatch.mjs:1201, 1209-1215]**; schema closes the gate object `additionalProperties:false` **[V state.schema.json:56-68]** | no gate **[V SKILL.md:136-140]** |
| Reviewer artifact contract | 01/02/03 md + plan only **[V SKILL.md:111]** | `01_frontend_spec.md, 02_backend_schema.md, (03_media_pipeline.md)` enumerated in the prompt **[V dispatch.mjs:1091-1094]** — the only place artifact names are wired, after the registry is loaded | worker output direct **[V SKILL.md:136-137]** |

Registry schema (`.agents/nodes.json`): top-level `version`, `description`, `common` (skill allowlist), `nodes` map; per node: `label, agentType, personaFile, model, role, artifactKey, writes, optional, skills[], instructions` **[V nodes.json:1-25]**. The dispatcher derives everything from it and escalates if a required id is missing **[V dispatch.mjs:46-59, 1017-1023]**; persona file/model/skills validated by schema at load **[V dispatch.mjs:714-718]**.

Edge table: Architect→TechLead→(parallel builds)→Reviewer→Shipping, repair loops bounded by `max_iterations=3` and a no-progress guard on repeated blocking finding ids **[V graph.md:136-148; dispatch.mjs:1141-1191]**. GoGate (`go-gate.mjs`) still guards the final push **[V graph.md:174-176]**.

### 1.2 Domain material that already exists

- **Domain godmode skills**: `godmode-hardware-pcb` (owns board/enclosure; peers with engineering/eventtech, **[V skills/basic/godmode-hardware-pcb/SKILL.md:16-118]**), `godmode-eventtech` **[V skills/basic/…/SKILL.md:2]**, `godmode-media-creation` **[V SKILL.md:2]**, `godmode-3d-creation` **[V SKILL.md:2]**, `copywriting` **[V skills/global_config/copywriting/SKILL.md:2]**.
- **Domain playbooks** in `skills/playbooks/pb-*/SKILL.md` with per-domain skill bundles, e.g. `pb-pcb-to-case` (ERC/DRC gates via `run_erc`/`run_drc`, **[V:13,36]**), `pb-show-build` (MA3/Resolume/TD lanes, **[V:14,36]**), `pb-image-to-3d` (poly-budget gate, **[V:13,38]**), `pb-landing-page` (`copywriting` skill listed, **[V:13,35]**), `pb-social-pack`/`pb-newsletter` (claim-tagging fact-check, **[V:35,38]** / **[V:35]**).
- **Media/event agent persona**: `.claude/agents/godmode-media-eventtech.md` (TouchDesigner/Unreal/DaVinci/DMX/Resolume MCPs, **[V:2-11]**), mirrored under `agents/`, `.codex/agents/`, `.opencode/agents/` **[V grep]**.
- **NOT FOUND**: subagent files named `pcb-design-assistant`, `video-motion-assistant`, `live-media-operator`, `event-manager-assistant` — verified absent in this repo and in `~/.agents`, `~/.config` **[V rg, no hits]**. Tim's brief lists them as domain subagents to exist; they are a naming gap, not an analysis blocker. **[G: brief may refer to skills/agents by intended names]**

## 2. What is missing — the software-only assumptions, with locations

1. **Gate keys are software-only** and closed by schema: `lint/typecheck/tests/a11y/seo/security` **[V dispatch.mjs:1201, 1214-1215; state.schema.json:56-68]** — no ERC/DRC (KiCad), no validator/export checks, no fact-check/tone gate (copy) can be expressed today.
2. **Build-node selection is a single boolean**: only `media_eventtech` is optional, decided by Architect's `needsMedia` boolean **[V dispatch.mjs:875-916, 1017-1019]** — a pure-KiCad goal would still mandate `ui_ux` and `engineering`.
3. **Artifact names enumerated in two hardcoded places**: Shipping/Reviewer prompts and the `artifacts` schema keys `frontend/backend/media` **[V dispatch.mjs:1092-1094; state.schema.json:25-33]**; `findings.node` even pins only the three build ids **[V state.schema.json:45-49]**.
4. **Registry has no per-domain hint**: `role` is only plan/approve/build/review/gate **[V nodes.json:6-146]**; skills lists are software-heavy for the build nodes (react/db/typescript in ui_ux/engineering **[V nodes.json:52-63, 75-85]**).
5. **The linear skill names streams and gates in prose** **[V SKILL.md:80-86, 125]** — would need a pointer to a domain profile rather than an inline table.
6. **`pb-pcb-to-case` proves a domain pipeline ("gate" = ERC/DRC zero-error) already runs by hand** **[V pb-pcb-to-case/SKILL.md:36]**, but only as a single-repo playbook, not as a startcycle profile.

## 3. Design proposal — domain profiles (additive, backwards compatible)

`.agents/profiles/<domain>.json` — a sibling of `nodes.json`, same registry shape, never parsed when absent. A profile is only sugar around the same registry:

```json
{
  "version": 1, "domain": "kicad",
  "nodes": { "architect": null, "techlead": null,
    "build": { "replace": ["ui_ux","engineering","media_eventtech"],
               "add": [ { "id":"pcb", "role":"build",
                          "agentType":"godmode-hardware-pcb",
                          "skills":["godmode-hardware-pcb","pcb-constraint-definition"],
                          "artifactKey":"pcb",
                          "writes":"production_artifacts/state.d/pcb.json",
                          "instructions":"Schematic/layout per the plan (KiCad). Write production_artifacts/01_pcb_design.md." } ] },
    "reviewer": null, "shipping": { "skills": ["godmode-shipping"] } },
  "gates": { "erc":"KiCad ERC via run_erc", "drc":"DRC via run_drc",
             "constraints":"stackup/netclass check per pcb-constraint-definition" },
  "artifacts": { "pcb":"production_artifacts/01_pcb_design.md" }
}
```

Per domain (sketch; node/persona per domain; gates replace lint/typecheck/tests):
- `kicad`: build nodes → `pcb` (godmode-hardware-pcb) ± `firmware` (godmode-engineering). Gates: ERC, DRC, constraint/stackup check.
- `touchdesigner`: build → `media` (godmode-media-eventtech). Gates: node-error scan (`get_node_errors`, TouchDesigner MCP), performance budget (fps/CPU budget check).
- `creator` (3D/media creation): build → `creator` (godmode-media-creation / godmode-3d-creation + Blender etc.). Gates: render/preview check (`get_scene_info`, face-count ≤ budget, gens/start frame sanity, ffprobe on exports).
- `copywriter`: build → `copy` (copywriting + brand-voice). Gates: brief/tone check (brief honoured, documented voice), fact check (every claim tagged `[F<n>]` against `facts.md` — reuse the pb-social-pack and pb-newsletter patterns **[V pb-social-pack/SKILL.md:38; pb-newsletter/SKILL.md:35]**).

**Selection rule (routing)**, mirroring `--skill=<name>` validation **[V graph.md:38-57]**:
1. explicit `/startcycle-graph --profile=kicad <goal>` — the strongest signal;
2. otherwise the Architect's plan gate (TechnicalLead approval of the capability map **[V graph.md:96]**) emits a `profile` decision from the goal text (all four domains have published keyword-ready triggers in their existing `SKILL.md` descriptions **[V ask-tim/SKILL.md:292,306-320]** and pb-* frontmatter), no regex in the dispatcher;
3. default profile = the current software pipeline (same 7 nodes, same gate keys) — backwards compatible **[V nodes.json:1-4 states the registry itself is meant to grow this way]**.
A missing profile name escalates the same way as a missing `--skill` name **[V graph.md:50-54]**.
The dispatcher changes are exactly 2 things: the load step also loads a profile (a haiku agent reads it, as it does nodes.json **[V dispatch.mjs:46-53]**), and the Shipping/Reviewer prompts derive gate names and artifact names from it.

## 4. Build list for step 2 (smallest set)

| File | Effort | Risk |
|---|---|---|
| `.agents/profiles/_schema.json` + a validator script `scripts/validate-profile.mjs` | S | low: gates/artifact keys are the only adjectives that can break the schema enum |
| `.agents/profiles/{kicad,touchdesigner,creator,copywriter}.json` (4 files) | S | per-domain real skill names must exist — all do in-tree **[V §1.2]** |
| `.claude/workflows/startcycle-dispatch.mjs`: profile loading (one sibling `load-registry` agent call), derive `BUILD_NODES`/artifact names/`GATE_KEYS` from it when present | M | highest-risk file — gate-fix loop and reviewer prompt are the main touchpoints **[V dispatch.mjs:1091-1094,1201,1214]** |
| `.agents/state.schema.json`: open `gate` and `findings.node` + `artifacts` keys via profile-defined enums (or a merge-at-load) | M | must not break `graph-gate.mjs`'s gate predicate **[V state.schema.json:45-68]** |
| `AGENTS.md` routing line + `skills/basic/startcycle*/SKILL.md` and `.agents/graph.md`: "domain profiles" section + skill-description triggers ("touchdesigner,KiCad,copywriting…") | S | only prose |
| `tests/swarm-wiring.test.js` sibling: pin profile default graph, plus a `profile-files.test.mjs` | S | must not weaken the existing exact-order pin **[V swarm-wiring.test.js:61-62]** |

**Must NOT change**: the default 7-node software pipeline (same ids, order, models **[V nodes.json:5-146]**), `go-gate.mjs`, `graph-gate.mjs`, the existing `swarm-wiring.test.js` line-62 order pin, the artifact mm files for the default domain.

## 5. Do-not-claim-yet

README, README videos, `brag`/`pb-launch-video`/`pb-social-pack` may mention domain startcycles **only after step 2 is merged** — this matches the R8 brief's "Not claimed anywhere until it exists" and the plan row `r8-claims` **[V recovery-plan/production_artifacts/00_execution_plan.md:167-174]**.
