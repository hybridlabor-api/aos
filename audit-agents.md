# Agent & Skill Architecture Audit

**Target:** `bdb-dev-optimized-agent-skills` @ `39c7462` (v3.12.0)
**Date:** 2026-08-27
**Type:** Read-only structural audit. No code review, no changes applied.
**Scope:** Skill layer (`SKILL.md`), instruction layer (`CLAUDE.md`, `agent.md`, `GEMINI.md`, `CODEX.md`), agent layer (`.agents/agents.md`, `.roomodes`, `.cursor/rules`), workflow layer (`startcycle`), distribution layer (`installer.js`).

## Reference Baselines

| # | Baseline | What it contributes |
|---|---|---|
| B1 | [Claude Code Best Practices](https://code.claude.com/docs/en/best-practices) | Context economy, verification loops, CLAUDE.md include/exclude rules, skills vs. memory split, subagents, hooks, `disable-model-invocation` |
| B2 | [Claude Code Prompt Library](https://code.claude.com/docs/en/prompt-library) | Slot-templated prompts, SDLC-phase tagging (`discover/build/…`), role tagging, `nextHref` chaining |
| B3 | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | SKILL.md anatomy (Overview / When to Use / Process / Rationalizations / Red Flags / Verification), process-over-prose, multi-harness command mirroring |
| B4 | [0xquinto/bcherny-claude](https://github.com/0xquinto/bcherny-claude) + Boris Cherny gists | Checked-in `.claude/` with `settings.json` (`defaultMode`), agents, commands; short CLAUDE.md |
| B5 | Graph-engineering pattern (user-supplied diagrams) | Nodes / Edges / State / Harness; Architect → Tech Lead → Developer with in-loop feedback edges |

---

## 1. Inventory

### 1.1 Skill trees

| Tree | Count | Purpose | Status |
|---|---|---|---|
| `skills/global_config/` | 134 SKILL.md | Primary distribution set | **Canonical** |
| `skills/global_legacy/` | 95 SKILL.md | Legacy set | **93 byte-identical to global_config**, 1 differs (`landing-page-generator`), 1 unique (`brainstorming`) |
| `skills/basic/` | 9 SKILL.md | godmode-*, startcycle, bdbmediastorm, bdbhtmlmanueldocs | Subset overlap with global_config |
| `skills/workspace_agents/` | 13 SKILL.md | firecrawl family | Duplicate of `.agents/skills/` |
| `.agents/skills/` | 13 SKILL.md | firecrawl family | Duplicate of `skills/workspace_agents/` |
| Root-level skills | 6 dirs | bdbrainstorm, bdbsaastraining, github-repo, memb-ingest, bdb-dev-os-skill, synapse-integration-skill | Not in any distribution tree |
| MCP stubs | 12 `.md` | `skills/global_config/bdb-*-mcp.md` | **Not SKILL.md format** — flat files inside the skills dir; will not load as skills in any harness |

**Total SKILL.md in repo: 334.** Effective unique skills: ~150. Redundancy factor ≈ 2.2×.

### 1.2 Instruction layer

| File | Size | Role |
|---|---|---|
| `CLAUDE.md` | 9.8 KB / 126 lines | Global rules + full `/startcycle` spec + ASCII architecture diagram |
| `GEMINI.md` | 4.0 KB | Global rules only (drift: missing "Plans are not approval" + "No inheritance" clauses present in CLAUDE.md) |
| `agent.md` | 1.5 KB | Condensed rules (tracked lowercase; `AGENT.md` resolves to the same inode on case-insensitive macOS) |
| `CODEX.md` | 1.1 KB | Marketing/install text, **no behavioural rules** |
| `.codex-plugin/system.md` | 9.5 KB | Codex system prompt |
| `.claude/CLAUDE.md` | 271 B | memB injection block, contents are `- None` ×4 |
| `.cursor/rules/*.mdc` | 5 files | Generated from `agent.md` + `startcycle.md` + `agents.md` |
| `.roomodes` | 78 lines | 7 Roo custom modes |

### 1.3 What is absent at repo level

- No `.claude/agents/` — the 5 agents in `.agents/agents.md` are never compiled into Claude Code subagents.
- No `.claude/commands/` or skills with `disable-model-invocation`.
- No `.claude/settings.json` (no `defaultMode`, no permission allowlist, no hooks).
- No hooks of any kind (`vendor/token-saver/hooks/hooks.json` is vendored third-party, not wired into this repo's own config).
- No `AGENTS.md` at repo root (the cross-harness standard consumed by OpenCode, Codex, Cursor, Antigravity). Root has `agent.md` (singular). `installer.js:438` reads `~/.agents/AGENTS.md`, which the repo never ships — **name mismatch between producer and consumer.**

---

## 2. Findings vs. Claude Code Best Practices (B1)

### F-01 — `CLAUDE.md` violates the include/exclude contract *(P0)*
B1: *"only include things that apply broadly … For domain knowledge or workflows that are only relevant sometimes, use skills instead"* and *"Bloated CLAUDE.md files cause Claude to ignore your actual instructions."*

`CLAUDE.md` is 126 lines, of which **~70 lines are the full `/startcycle` pipeline spec plus a 30-line ASCII diagram** — content that is already duplicated verbatim in `.agents/workflows/startcycle.md`, `skills/basic/startcycle/SKILL.md` and `.cursor/rules/startcycle.mdc`. It is loaded into **every** session regardless of whether a cycle is running.

Additional exclusion violations: §4 "Domain Adaptation" and §3 "Minimalist Comments" are generic advice the model already follows; B1 explicitly lists *"Self-evident practices like 'write clean code'"* as exclude-tier.

**Impact:** dilutes the one rule that actually matters (the GO gate). B1: *"If you emphasize many lines, none of them stands out."* The current file emphasises **ABSOLUTE OVERRIDE**, **STRICT**, **CRITICAL**, **MUST NOT**, **ONLY**, **EXCLUSIVELY**, **LITERALLY** in a single section.

**Target:** ≤ 30 lines. Keep: GO gate, git-snapshot rule, English-content rule, private-repo rule. Move: entire `/startcycle` block → skill (already exists), diagram → `.openwiki/architecture.md`.

### F-02 — No verification loop anywhere in the skill layer *(P0)*
B1 opens with *"Give Claude a way to verify its work"* and grades verification by how hard it gates the stop: prompt-level → `/goal` → **Stop hook** → verification subagent.

Measured across the 134 canonical skills:

| Section | Present |
|---|---|
| `## When to Use` | 99 / 134 |
| `## Verification` (or similar) | **7 / 134** |
| `## Red Flags` | **3 / 134** |
| `## Rationalizations` | **2 / 134** |
| `## Exit Criteria` | **0 / 134** |
| `## Anti-Patterns` | 14 / 134 |
| `## Checklist` | 25 / 134 |

The only verification gate in the entire system is `startcycle` §3 — a prose sentence, *"Must achieve `Status: SUCCESS (100% Green)`"*, with no mechanism that blocks anything. This is B1's named failure pattern **"the trust-then-verify gap."**

### F-03 — Zero hooks *(P0)*
B1: *"Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens."*

The GO gate is the single most important rule in this repo and it is implemented purely as advisory prose, repeated across four files with drift between them (F-06). A `PreToolUse` hook matching `Write|Edit|Bash(git commit *|git push *|npm publish *)` would make it deterministic and harness-enforced instead of model-dependent. The repo ships no `hooks.json` and no `.claude/settings.json` to register one.

### F-04 — Agents are documentation, not agents *(P0)*
`.agents/agents.md` defines 5 agents with roles, skills, MCP servers and output artifacts. `installer.js:1850–1876` compiles these into Antigravity subagent JSON (`~/.gemini/config/agents/*.json`). **Nothing compiles them for Claude Code.** B1's format is `.claude/agents/<name>.md` with `name` / `description` / `tools` / `model` frontmatter. The repo has no such directory, so in Claude Code the "multi-agent team" is a text file the main agent reads about but cannot delegate to.

Additionally the parser at `installer.js:1857` uses `block.match(/([A-Za-z0-9_]+)/)` on markdown split by `## ` — since every heading starts with an emoji (`## 🧠 Planner_Orchestrator`), this extracts the first alphanumeric run after the emoji. This happens to work today but is positional and will silently produce wrong agent names if a heading format changes.

### F-05 — Model pinning is stale *(P1)*
`.agents/agents.md` pins every agent to **Claude 3.5 Sonnet / GPT-4o / Gemini 1.5 Pro**. All three are superseded. B1's subagent frontmatter uses tier names (`model: opus`), not versioned IDs — tier names survive model releases. Same issue in `.roomodes`.

### F-06 — Instruction drift across the 8 harness entrypoints *(P1)*
The same ruleset exists in `CLAUDE.md`, `GEMINI.md`, `agent.md`, `.codex-plugin/system.md`, `.cursor/rules/000_global_rules.mdc`, and (partially) `.roomodes`. `GEMINI.md` is missing two clauses that `CLAUDE.md` has ("Plans are not approval", "No inheritance, no silent retries"). `CODEX.md` contains no rules at all. There is no single source of truth; the installer regenerates *some* targets from `agent.md` but the root `CLAUDE.md`/`GEMINI.md` are separately maintained.

### F-07 — No `disable-model-invocation`, no argument contract *(P1)*
B1: *"Use `disable-model-invocation: true` for workflows with side effects that you want to trigger manually."*

`/startcycle`, `/ship`, `/build` and `bdbsaastraining` all have side effects (git commit, git push, npm publish, cloud calls). **0 of 134** skills set `disable-model-invocation`. Only 2 skills use `$ARGUMENTS`. Frontmatter census:

| Key | Count |
|---|---|
| `name`, `description` | 134 / 134 ✅ |
| `risk` | 128 (non-standard, harness-ignored) |
| `source` | 127 (non-standard) |
| `date_added` | 119 (non-standard) |
| `tools` | 12 |
| `allowed-tools` | **2** |
| `user-invokable` | 2 (+ 1 misspelled `user-invocable`) |
| `disable-model-invocation` | **0** |
| `model` | **0** |

Three of the four most-used keys are custom metadata no harness reads, while the keys that actually change agent behaviour are near-zero.

### F-08 — Skill size vs. progressive disclosure *(P2)*
17 skills exceed 500 lines; the largest is `browser-automation/SKILL.md` at **1,116 lines**. Total 33,574 lines across the canonical tree. B1 treats context as the fundamental constraint; a 1,100-line SKILL.md loaded on trigger is a significant single-shot cost. The pattern the repo already uses correctly in `database-design/` and `systematic-debugging/` (thin SKILL.md + `references/*.md` loaded on demand) is not applied to the large ones.

### F-09 — Descriptions are not trigger-shaped *(P2)*
B1 and B3 both treat `description` as the routing signal. Only **28 / 134** descriptions contain trigger phrasing ("Use when", "Use this skill when", "Triggers on"). Outliers: `llm-structured-output` has a **1-character** description; 18 exceed 200 characters (max 370, `bdbhtmlmanueldocs`). Both extremes degrade routing — too short gives the router nothing, too long buries the trigger.

---

## 3. Findings vs. addyosmani/agent-skills (B3)

B3's anatomy is: **Overview → When to Use → Process → Rationalizations → Red Flags → Verification**, with three tenets: *process over prose*, *anti-rationalization*, *verification mandatory* ("seems right" is never acceptable).

### F-10 — Missing the enforcement half of the anatomy *(P1)*
The repo has the descriptive half (`When to Use` 99/134) and almost none of the enforcement half (Rationalizations 2, Red Flags 3, Verification 7). The godmode-* skills are the closest in spirit but state principles rather than executable process with checkpoints.

### F-11 — No SDLC phase taxonomy *(P2)*
B3 groups skills into Define / Plan / Build / Verify / Review / Ship. This repo *has* that taxonomy — it is written in `skills/global_config/agent-pipeline/SKILL.md` as the 6-stage BDB pipeline — but it is not reflected in the directory layout or in frontmatter. `category` appears in only 21 / 134 skills, `tags` in 13. Result: with 134 flat skills the router has no phase-level prior.

### F-12 — Command mirroring is one-directional *(P2)*
B3 ships `.claude/commands/`, `.gemini/commands/` and `commands/` side by side so the same 8 commands exist natively in all three harnesses. This repo ships slash commands only as *documented conventions* inside skill bodies (`/spec`, `/plan`, `/build`, `/test`, `/review`, `/ship`, `/startcycle`) with no command files in any harness directory.

---

## 4. Findings vs. Prompt Library (B2)

### F-13 — No slot-templated prompt assets *(P2)*
B2 entries are structured records: `{ id, sdlc, cat, roles, prompt, slots, src, nextHref }` — a parameterised prompt with named slots, a phase, target roles, and a link to the next step. The repo contains no equivalent asset. `bdbrainstorm` and `grill-me` produce free-form markdown; `startcycle` consumes it by convention, not by contract.

This is the direct upstream cause of F-16: without a typed hand-off record there is nothing for a graph edge to route on.

### F-14 — No role dimension *(P3)*
B2 tags prompts by role (`pm`, `design`, …). The repo's 5 agents are roles, but skills are not tagged by which agent should own them — the mapping exists only as a hand-maintained bullet list inside `.agents/agents.md`, which will drift as skills are added.

---

## 5. Findings vs. bcherny config (B4)

### F-15 — No checked-in `.claude/` runtime config *(P1)*
B4's central practice is a committed `.claude/` folder containing `settings.json` (notably `defaultMode` for auto/plan mode), `agents/`, and `commands/`, so a team inherits the working configuration by cloning. This repo's `.claude/` contains exactly one file — a memB injection stub whose payload is four `- None` lines. For a repo whose entire product *is* agent configuration, shipping no runtime configuration is the most visible gap.

Note the tension worth deciding explicitly: B4 recommends `defaultMode: "auto"` (fewer prompts), while this repo's core rule is a hard read-only gate until a literal "GO". These are opposite defaults. The resolution is not to pick one globally but to encode the gate as a `PreToolUse` hook (F-03) and *then* run auto mode — the hook enforces the gate deterministically, so auto mode becomes safe rather than contradictory.

---

## 6. Graph-Engineering Assessment (B5)

### 6.1 Current state

`/startcycle` as specified in `.agents/workflows/startcycle.md`:

```
Planner ──▶ [UI/UX ∥ Engineering ∥ Media] ──▶ Shipping ──▶ ship
   00            01      02       03              04
```

Mapped against B5's four primitives:

| Primitive | Present? | Evidence |
|---|---|---|
| **Nodes** (agents/steps do the work) | ✅ Yes | 5 agents, clearly scoped roles and outputs |
| **Edges** (route where things go next) | ❌ No | Every transition is unconditional. There is no branch, no predicate, no router. "Media Stream (If Applicable)" is the only conditional and it has no defined condition or evaluator |
| **State** (memory carried between nodes) | ⚠️ Partial | `production_artifacts/00–04.md` are free-form markdown. Untyped, no schema, no status field, no version, no reducer. Nodes re-parse prose written by another node |
| **Harness** (keeps the loop alive) | ❌ No | The pipeline is a one-shot linear pass. No retry, no repair loop, no max-iterations, no termination predicate |

**Verdict: this is a linear pipeline with file hand-off, not a graph.** The failure mode is specific and predictable: `Godmode_Shipping` runs the quality gate at §3 and finds a failure. The spec says it "must achieve SUCCESS" but defines **no edge back to Engineering or UI/UX**. The graph has no return path. In practice the orchestrator either stops or improvises.

Also missing relative to the Architect/Tech-Lead/Developer diagram (B5, image 1):
- **No Tech Lead node.** `Planner_Orchestrator` collapses Architect (system plan) and Tech Lead (execution coordination) into one node. The diagram separates them precisely because planning and coordination have different context needs and different failure modes.
- **No in-loop feedback edges.** The diagram has two edges back to the user (`In-loop feedback`) and one from Developer back to Architect (`Analyzes and responds to`). `/startcycle` is explicitly branded "zero-prompting" — it has *removed* the human edges that the reference pattern treats as load-bearing.
- **AI Document as a node, not a substrate.** In the diagram the AI Document *supports the task of* the Developer — a shared artifact both Tech Lead and Developer address. In `/startcycle` the artifacts are one-way drops; no node reads back its own output or another node's revision.

### 6.2 Proposed target contract

The concrete deliverable would be a new `.agents/graph.md` (harness-neutral, plus generated bindings) defining:

**State schema** — a single typed object persisted at `production_artifacts/state.json`, replacing free-form markdown as the transport:

```yaml
run_id: string
goal: string                    # from /bdbrainstorm
phase: define|plan|build|verify|review|ship
artifacts: { plan, frontend, backend, media, report }   # paths
findings: [{ id, severity, node, status: open|fixed }]
gate: { lint, typecheck, tests, a11y, seo }             # pass|fail|skip
iteration: int
max_iterations: int             # hard stop, harness-enforced
approvals: [{ node, token: "GO", at }]
```
Markdown artifacts stay as the human-readable payload; `state.json` becomes what edges evaluate.

**Nodes** — 7 instead of 5, splitting Planner into Architect + Tech Lead per B5 and adding an explicit Reviewer (B1's *adversarial review step*, which must be a different context than the one that wrote the code):

`Architect → TechLead → {UI_UX ∥ Engineering ∥ Media} → Reviewer → Shipping`

**Edges** — every transition gets a predicate:

| From | Predicate | To |
|---|---|---|
| TechLead | `plan.approved == false` | Architect (revise) |
| Reviewer | `findings.open > 0` | owning build node (repair loop) |
| Shipping | `gate.* any == fail` | owning build node |
| Shipping | `iteration >= max_iterations` | **User** (escalate, do not loop) |
| any | `needs_human == true` | **User** (in-loop feedback edge) |
| Shipping | all gates pass ∧ `approvals` contains GO | ship |

**Harness** — the loop-keeper is the piece that has no equivalent today. Two implementations, both needed:
- *Advisory:* the graph contract in `.agents/graph.md`, read by the orchestrator.
- *Deterministic:* a `Stop` hook that reads `state.json` and blocks turn-end while `gate.* == fail ∧ iteration < max_iterations` — B1's exact prescription for closing a loop without human attention. `max_iterations` prevents the runaway that hooks otherwise enable.

This is the smallest change set that turns the existing pipeline into a graph: the nodes already exist, the artifacts already exist. What is missing is **typed state, predicates on edges, and a loop-keeper** — and one of those three (the Stop hook) also happens to fix F-02 and F-03.

---

## 7. Cross-Harness Compatibility Matrix

Ratings: ✅ native · ⚠️ works with adapter · ❌ unsupported.

| Construct | Claude Code | Antigravity (agy) | OpenCode | Codex | Cursor | Roo | Gemini CLI |
|---|---|---|---|---|---|---|---|
| `SKILL.md` (name+description) | ✅ | ✅ | ⚠️ via AGENTS.md ref | ✅ | ⚠️ copied to `.cursor/bdb-skills` | ⚠️ `.roo/bdb-skills` | ✅ |
| `allowed-tools` frontmatter | ✅ | ⚠️ maps to `enable_*_tools` | ❌ | ⚠️ | ❌ | ❌ | ❌ |
| `disable-model-invocation` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Subagents (`.claude/agents/*.md`) | ✅ **not shipped** | ✅ JSON, shipped | ⚠️ prompt-level | ❌ | ❌ | ✅ `.roomodes` | ⚠️ |
| Hooks | ✅ **not shipped** | ⚠️ limited | ❌ | ❌ | ❌ | ❌ | ❌ |
| `settings.json` / `defaultMode` | ✅ **not shipped** | ⚠️ own schema | ⚠️ `opencode.jsonc` | ⚠️ | ❌ | ❌ | ⚠️ |
| Slash commands | ✅ (via skills) | ✅ `commands/` | ✅ | ✅ | ⚠️ rules | ⚠️ modes | ✅ `.gemini/commands/` |
| MCP servers | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `AGENTS.md` root convention | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Typed state file (`state.json`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Graph contract as markdown | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### F-16 — Installer coverage is uneven *(P1)*

| Harness | Skills | Instructions | Agents | MCP |
|---|---|---|---|---|
| Claude Code | ✅ `~/.claude/skills` | ✅ `CLAUDE.md` | ❌ | ✅ `~/.claude.json` |
| Antigravity | ✅ `~/.gemini/config/skills` | ✅ | ✅ compiled JSON | ✅ |
| Codex | ✅ `~/.codex/skills` | ✅ `system.md` | ❌ | ✅ |
| Cursor | ✅ `.cursor/bdb-skills` | ✅ `.mdc` rules | ⚠️ as a rule file | ✅ |
| Roo | ✅ `~/.roo/bdb-skills` | ✅ | ✅ `.roomodes` | ✅ |
| Windsurf / Aider | ✅ | ⚠️ | ❌ | ✅ |
| **OpenCode** | ❌ | ❌ | ❌ | ✅ MCP only (`opencode.jsonc`) |

OpenCode is detected (`installer.js:409–413`) but receives **only** MCP server config — no skills, no rules, no agents. Antigravity is the *best*-served harness (native agent compilation); Claude Code, despite being the primary target, is the one missing subagents, hooks and settings.

### Design rule for any future change

The matrix above yields one constraint: **anything that only works in Claude Code must have a markdown fallback.** Concretely — the state schema, the graph contract, the node definitions and the edge predicates belong in harness-neutral markdown/JSON under `.agents/`; the Claude-specific bindings (`.claude/agents/*.md`, `hooks.json`, `settings.json`) are *generated* from those by `installer.js`, exactly as the Antigravity JSON already is. Nothing normative should live only in a Claude-only file. Under that rule, a harness without hooks degrades to advisory enforcement rather than losing the workflow entirely.

---

## 8. Prioritized Findings

| ID | Finding | Prio | Effort | Impact |
|---|---|---|---|---|
| F-01 | `CLAUDE.md` 126 lines, `/startcycle` spec duplicated 4× | **P0** | S | High — dilutes the GO gate |
| F-02 | Verification sections in 7/134 skills; no enforced gate | **P0** | L | High — trust-then-verify gap |
| F-03 | Zero hooks; GO gate is advisory prose only | **P0** | S | High — the one rule that must be deterministic isn't |
| F-04 | No `.claude/agents/`; agents unusable as subagents in Claude Code | **P0** | M | High — the multi-agent team doesn't exist at runtime |
| F-16 | OpenCode gets MCP only; Claude Code missing 3 of 4 layers | **P1** | M | High |
| F-15 | No checked-in `.claude/settings.json` | **P1** | S | Medium |
| F-06 | Rule drift across 8 entrypoints, no single source of truth | **P1** | M | Medium |
| F-07 | Frontmatter dominated by non-standard keys; 0 `disable-model-invocation` | **P1** | M | Medium — side-effect skills are model-invocable |
| F-05 | Agent models pinned to superseded IDs | **P1** | S | Medium |
| F-10 | Missing Rationalizations / Red Flags / Verification anatomy | **P1** | L | Medium |
| — | 93 byte-identical duplicates in `global_legacy`; firecrawl tree duplicated | **P1** | S | Medium — 2.2× maintenance surface |
| — | 12 `bdb-*-mcp.md` stubs in skills dir, not SKILL.md format | **P2** | S | Low |
| F-08 | 17 skills > 500 lines, max 1,116 | **P2** | M | Medium |
| F-09 | 28/134 trigger-shaped descriptions; 1-char and 370-char outliers | **P2** | M | Medium |
| F-11 | 6-stage taxonomy documented but not encoded | **P2** | M | Medium |
| F-12 | Slash commands documented, not shipped as command files | **P2** | M | Low |
| F-13 | No slot-templated prompt assets / typed hand-off | **P2** | M | Medium — blocks graph edges |
| F-14 | Skills not tagged by owning agent | **P3** | S | Low |
| — | `AGENT.md` vs `AGENTS.md` producer/consumer mismatch (`installer.js:438`) | **P2** | XS | Medium — silent no-op today |
| — | Antigravity agent-name parser is positional/emoji-dependent (`installer.js:1857`) | **P2** | XS | Low |

### Suggested sequence

1. **F-01 + F-03 together.** Cut `CLAUDE.md` to the rules that matter *and* convert the GO gate to a `PreToolUse` hook in the same change — the gate stops depending on the prose that was diluting it.
2. **F-04 + F-16.** Generate `.claude/agents/*.md` from `.agents/agents.md` in `installer.js`, mirroring the Antigravity path that already works. Same commit fixes the `AGENTS.md` naming mismatch and adds OpenCode skill/rule sync.
3. **Deduplication.** Delete `global_legacy` (after porting `brainstorming` and reconciling `landing-page-generator`), collapse the firecrawl double-tree. Halves the surface everything after this touches.
4. **F-13 + graph contract (§6.2).** Typed `state.json` first, then edge predicates, then the Stop hook — which delivers F-02's enforced verification as a side effect.
5. **F-07/F-09/F-11 as one frontmatter migration.** Mechanical, scriptable, best done once across the deduplicated tree.

---

## 9. Explicitly Out of Scope

- No code review of `installer.js`, `scripts/`, `mcps/`, `tools/` (structural references only).
- No content-quality review of individual skill bodies — only structural conformance was measured.
- Sibling repos `bdb-dev-optimized-agent-skills-basic` and `bdb-dev-optimized-antigravity-skills` were not audited; drift between them and this repo is unassessed.
- No changes applied. This document is the sole output.
