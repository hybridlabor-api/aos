# Agent & Skill Architecture Audit

**Target:** `bdb-dev-optimized-agent-skills` @ `39c7462` (v3.12.0), work continuing on branch `feat/agent-skills-v3.13`
**Date:** 2026-08-27 (original audit) · updated 2026-08-27 (Phase −1 reference deep-dive)
**Type:** Read-only structural audit. Findings below informed Phase 0 (dedup + domain tagging, already applied on the branch — see commit `e4036aa`). No further changes applied by this document.
**Scope:** Skill layer (`SKILL.md`), instruction layer (`CLAUDE.md`, `agent.md`, `GEMINI.md`, `CODEX.md`), agent layer (`.agents/agents.md`, `.roomodes`, `.cursor/rules`), workflow layer (`startcycle`), distribution layer (`installer.js`).

**Count correction:** the original pass below cites 334 SKILL.md / "270 files, 160 unique" — that included vendored third-party MCP repos under `mcps/`. The correct pre-dedup count for this repo's own skills was **257 SKILL.md / 160 unique names**. Post-Phase-0 the tree holds **161 SKILL.md**, each tagged with a `category:` domain (`media-eventtech`, `saas-ops`, `design-ui-ux`, `bdb-core`, `engineering-method`, `library`). Findings below that reference the old counts are left as originally written (they were directionally correct); treat the counts here as current.

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

*Updated after Phase −1 full-text read of `docs/skill-anatomy.md`, `CONTRIBUTING.md`, `AGENTS.md`, and 6 real SKILL.md files. Verbatim quotes below are from that source, not paraphrase.*

B3's exact anatomy (source: `skill-anatomy.md`, framed as *"a recommended pattern, not a rigid template — only frontmatter is strictly required"*):

`Overview → When to Use → Core Process → Techniques → Common Rationalizations (table) → Red Flags → Verification (checkboxes)`

Six writing principles stated verbatim: **Process over knowledge** ("Skills are workflows, not reference docs. Steps, not facts."), **Specific over general**, **Evidence over assumption** ("Every verification checkbox requires proof."), **Anti-rationalization** ("Every skip-worthy step needs a counter-argument in the rationalizations table."), **Progressive disclosure**, **Token-conscious** ("If removing it wouldn't change agent behavior, remove it."). Hard limit: keep `SKILL.md` under 500 lines.

### F-10 — Missing the enforcement half of the anatomy *(P1)*
The repo has the descriptive half (`When to Use` 99/134) and almost none of the enforcement half (Rationalizations 2, Red Flags 3, Verification 7). The godmode-* skills are the closest in spirit but state principles rather than executable process with checkpoints.

**Concrete template for Phase 3**, lifted directly from B3's real skills (not invented):

| Section | Format | Real example (from `test-driven-development`, `code-review-and-quality`) |
|---|---|---|
| Rationalizations | `\| Rationalization \| Reality \|` table | *"I'll write tests after the code works"* → *"You won't. And tests written after the fact test implementation, not behavior."* / *"It's just a version bump"* → *"A bump is a behavior change you didn't write. Read the changelog; semver doesn't guarantee no breakage."* |
| Red Flags | bullet list, observable during review | *"'LGTM' without evidence of actual review"* / *"More than 100 lines of code written without running tests"* |
| Verification | checkbox list, each requiring evidence | `- [ ] The full suite passes, run with the repository's own test command` / `- [ ] Bug fixes include a reproduction test that failed before the fix` |

The **Verification** line is the one that matters most for this repo: the anatomy's own definition is *"the exit criteria... every checkbox should be verifiable with evidence (test output, build result, screenshot, etc.)"* — this is the same requirement as B1's F-02, stated independently by a second source.

**New sub-finding — eval enforcement (not previously known):** B3's `CONTRIBUTING.md` requires every skill to ship `evals/cases/<name>.json` with **≥3 positive triggers, ≥2 negative triggers, ≥1 behavioral eval**, checked in CI across three tiers: structural (frontmatter/naming), trigger/routing (TF-IDF description-similarity check that **errors at ≥75% similarity** between two skills' descriptions — a direct, automatable check for description quality that this repo has no equivalent of), and behavioral (headless `claude -p` run against fixtures). This is the concrete shape for the "Phase 3.5 — skill tests" step in the implementation plan; it is not aspirational, it is CI-enforced in the reference repo.

### F-11 — No SDLC phase taxonomy *(P2)*
B3 groups skills into Define / Plan / Build / Verify / Review / Ship. This repo *has* that taxonomy — it is written in `skills/global_config/agent-pipeline/SKILL.md` as the 6-stage BDB pipeline — but it is not reflected in the directory layout or in frontmatter (partially remedied by Phase 0's `category:` domain tagging, which is an orthogonal axis — domain, not lifecycle phase — so this finding still stands).

Cross-check against B2 (Prompt Library, confirmed in Phase −1): Anthropic's own taxonomy is **5 phases** — `discover / design / build / ship / operate` — not 6. The two schemes are close but not identical: B2 has no separate "Review" phase (folded into `build/Review` as a category, not a phase) and adds `operate` (Debug/Incident/Data/Automate — post-ship work) which the BDB 6-stage pipeline has no equivalent for. Recommendation for Phase 4/5: keep the BDB 6-stage pipeline as the primary taxonomy (it maps cleanly to the 5 agents) but note `operate` as a real gap — none of the 6 stages own post-ship incident/debug work, which is exactly the domain of `godmode-eventtech`'s live-show failure modes (§6 addendum below).

### F-12 — Command mirroring is one-directional *(P2)*
B3 ships `.claude/commands/`, `.gemini/commands/` and `commands/` side by side so the same 8 commands exist natively in all three harnesses. This repo ships slash commands only as *documented conventions* inside skill bodies (`/spec`, `/plan`, `/build`, `/test`, `/review`, `/ship`, `/startcycle`) with no command files in any harness directory.

**Confirmed in Phase −1** (previously assumed, now verified byte-for-byte): `.gemini/commands/build.toml` and `commands/build.toml` are **identical**; `.claude/commands/build.md` carries the same numbered steps and the same git-safety rules (baseline `git status --porcelain` check, never `git add -A` blindly, one commit per task) word-for-word, differing only in syntax (Markdown+YAML vs. TOML) and in one convention: Claude's version prefixes skill references with the plugin namespace (`agent-skills:test-driven-development`), the other two use bare names. One filename diverges on purpose — `.claude/commands/plan.md` vs. `commands/planning.toml` — likely to dodge a reserved name in the non-Claude tooling. **Conclusion for Phase 2:** command files should be generated from one canonical source per command, with per-harness syntax adaptation and namespace prefixing as the only allowed variation — exactly the pattern `installer.js` already uses for the Antigravity agent JSON.

### F-17 — Persona-calls-persona is a platform-enforced anti-pattern *(P0 — corrects §6.2)*

**This is the most consequential Phase −1 finding and changes the Phase 4 graph design.**

B3's `references/orchestration-patterns.md` and `docs/agents.md` state a hard rule, quoted verbatim: *"the user (or a slash command) is the orchestrator. Personas do not invoke other personas."* Four anti-patterns are explicitly named and rejected: router persona, persona-calls-persona, paraphrasing sequential orchestrator, deep persona trees. Critically, this is not a style preference — B3 cites it as a **platform constraint**: *"subagents cannot spawn other subagents"* (Anthropic's own Claude Code documentation).

The graph design proposed in §6.2 below — `Architect → TechLead → {UI_UX ∥ Engineering ∥ Media} → Reviewer → Shipping` — was written as if each node could hand off directly to the next, which reads as (and risks being implemented as) agents invoking agents. That is the rejected pattern. §6.2 is corrected below: the **dispatcher stays the main session or a slash command**, never a persona; nodes are leaves that read state, do work, write state, and return — the *routing decision* (which edge fires next) is evaluated by the dispatcher after each return, not delegated into the graph itself.

Secondary finding from the same source: B3 ships a `doubt-driven-development` skill that operationalizes exactly the "Reviewer" node from §6.2 as a concrete process, not a principle. Its core discipline, worth adopting verbatim for our Reviewer node: pass the reviewer **ARTIFACT + CONTRACT only, never the CLAIM or the implementer's reasoning** (biases toward agreement otherwise), use an explicitly adversarial prompt (*"Find what is wrong... Do NOT validate. Do NOT summarize."*), and classify every finding against a fixed precedence order (contract misread → valid+actionable → valid trade-off → noise) with a named failure mode to watch for: **"doubt theater"** — 2+ review cycles producing zero actionable findings means the reviewer is validating, not doubting, and the loop should stop and escalate rather than continue.

---

## 4. Findings vs. Prompt Library (B2)

*Updated after Phase −1 full extraction of the page's raw data (52 prompt objects, complete, verified un-truncated).*

Confirmed schema: `{ id, sdlc, cat, roles, prompt, slots?, needs?, paste?, startN?, src, nextHref? }`, joined at render time with a separate `text` dictionary (`title`, `teaches`, `next`) keyed by the same `id`. 52 entries total: `discover` 7, `design` 6, `build` 22 (42% — the largest phase), `ship` 5, `operate` 12.

### F-13 — No slot-templated prompt assets *(P2)*
B2 entries are structured records with named slots, a phase, target roles, and a link to the next step. The repo contains no equivalent asset. `bdbrainstorm` and `grill-me` produce free-form markdown; `startcycle` consumes it by convention, not by contract. This is the direct upstream cause of F-16: without a typed hand-off record there is nothing for a graph edge to route on.

**Confirmed schema details worth adopting for our own slot-templated assets** (e.g. `bdbrainstorm` → `startcycle` hand-off, or any future `/spec`-style prompt library entry):
- Placeholders are `{word}` (single token, no defaults inline); `slots` is a separate object of the *same keys*, holding example fill-ins — never raw numbers, always strings (`n: '20'`, not `20`), and the UI shows them as editable placeholder text, not literal substitutions.
- `needs` is a **small closed enum** (`tracker`, `gh`, `browser`, `db`) resolved through a separate label dictionary — a clean way to flag "this prompt needs an external tool/connector" without repeating boilerplate prose in every entry.
- `paste` is a **separate** closed enum (`mockup`, `design`, `screenshot`, `plan`, `error`, `csv`) — distinct from `slots`: it signals "the user must attach/paste a blob before sending" rather than "fill in this typed field." Worth keeping as two separate concepts if `bdbrainstorm` output ever becomes schema'd.
- `nextHref` is **not** "read this next" — it is *"graduate this one-off prompt into a durable Claude Code feature"* (a skill, `/goal`, CLAUDE.md/memory, an MCP connector, or a built-in command). E.g. `review-your-changes-before` (a manual review prompt) points to `/en/commands` with the CTA *"Run `/code-review` for the same check in one command."* Direct implication for this repo: `/bdbrainstorm` and `/grill-me` output should point forward to `/startcycle` the same way — "graduate this brainstorm into the pipeline" — which is closer to what already happens, but the *mechanism* (a `nextHref`-style pointer plus a stated CTA) is more explicit than the current prose convention.

### F-14 — No role dimension *(P3, correction: not directly reusable)*
B2 tags prompts by role — confirmed values: `pm, design, marketing, docs, security, ops, data` (7 roles, ~48% of prompts have none i.e. apply to everyone). **Correction from Phase −1:** these are **human job functions**, not AI-agent-routing targets — a `pm`-tagged prompt is one a product manager would run, not one routed to a "PM agent." This repo's 5 agents (`Godmode_UI_UX`, `_Engineering`, …) are a different axis entirely (which AI persona executes) and B2's `roles` field is not the right vocabulary to reuse for that. The underlying gap stands — skills are not tagged by which agent should own them — but the fix is a repo-specific field (e.g. `agent:` or reuse of Phase 0's `category:` domain tag, which already does most of this job), not an import of B2's `roles` enum.

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

### 6.2 Proposed target contract *(revised per F-17 — see correction below)*

**Correction (F-17):** the version of this section as originally written implied nodes hand off directly to each other (`Architect → TechLead → {...} → Reviewer → Shipping` read as a call chain). Per F-17, that is the platform-rejected persona-calls-persona pattern and, on Claude Code specifically, subagents cannot spawn subagents at all. The graph below keeps the same nodes and edges but makes explicit that **routing is evaluated by a single dispatcher** (the main session, or a slash command like `/startcycle` acting on the user's behalf) after each node returns — the arrows are dispatcher decisions, not node-to-node calls.

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
Markdown artifacts stay as the human-readable payload; `state.json` becomes what the dispatcher's edge-predicates evaluate.

**Nodes** — 7 instead of 5, splitting Planner into Architect + Tech Lead per B5 and adding an explicit Reviewer (B1's *adversarial review step*; per F-17, model it on B3's `doubt-driven-development` discipline — pass it ARTIFACT + CONTRACT only, never the implementer's CLAIM or reasoning, and give it an explicitly adversarial prompt):

`Architect · TechLead · {UI_UX ∥ Engineering ∥ Media} · Reviewer · Shipping` — **each invoked independently by the dispatcher**, never by one another.

**Dispatch loop (replaces the old "hand-off" framing):**
```
1. dispatcher invokes Architect        → writes state.plan
2. dispatcher reads state, invokes TechLead   → writes state.plan.approved
3. dispatcher evaluates edge: approved? → (yes) step 4 / (no) → back to 1, iteration++
4. dispatcher invokes {UI_UX, Engineering, Media} in parallel → each writes its artifact
5. dispatcher invokes Reviewer (ARTIFACT+CONTRACT only) → writes state.findings
6. dispatcher evaluates edge: findings.open > 0? → (yes) back to 4 for the owning node / (no) step 7
   — after 2 cycles with zero actionable findings: "doubt theater" flag, stop and ask the user, don't keep looping
7. dispatcher invokes Shipping (runs gates) → writes state.gate
8. dispatcher evaluates edge: all gates pass ∧ approvals contains GO? → (yes) ship / (no) back to 4, iteration++
9. iteration >= max_iterations at any point → escalate to User, do not loop further
```

**Edges** — every transition gets a predicate, evaluated by the dispatcher between steps, not by the nodes:

| After node | Predicate (dispatcher checks `state.json`) | Dispatcher's next action |
|---|---|---|
| TechLead | `plan.approved == false` | invoke Architect again (revise), `iteration++` |
| Reviewer | `findings.open > 0` | invoke the owning build node again (repair) |
| Reviewer | 2+ cycles, 0 actionable findings | stop, flag "doubt theater," ask User |
| Shipping | `gate.* any == fail` | invoke the owning build node again |
| any | `iteration >= max_iterations` | stop, escalate to **User** — do not loop |
| any | `needs_human == true` | stop, surface to **User** (in-loop feedback edge) |
| Shipping | all gates pass ∧ `approvals` contains GO | ship |

**Harness** — the loop-keeper is the piece that has no equivalent today. Two implementations, both needed:
- *Advisory:* the graph contract in `.agents/graph.md`, read by the dispatcher (main session or `/startcycle` command logic) — this is also where the F-17 constraint is written down explicitly, so a future contributor doesn't reintroduce persona-calls-persona by "optimizing" the pipeline into direct hand-offs.
- *Deterministic:* a `Stop` hook that reads `state.json` and blocks turn-end while `gate.* == fail ∧ iteration < max_iterations` — B1's exact prescription for closing a loop without human attention, using the exact hook shape B3 already ships (`PreToolUse`/`Stop` hook exits 2 to block, message goes back over stderr — see the Phase −1 addendum below). `max_iterations` prevents the runaway that hooks otherwise enable.

This is the smallest change set that turns the existing pipeline into a graph: the nodes already exist, the artifacts already exist. What is missing is **typed state, predicates evaluated by a single dispatcher (not node-to-node calls), and a loop-keeper** — and one of those three (the Stop hook) also happens to fix F-02 and F-03.

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
| F-17 | Graph design in §6.2 implied persona-calls-persona (platform-rejected, and unsupported on Claude Code); must be dispatcher-mediated | **P0** | S (design-only fix, already applied to §6.2) | High — would have made Phase 4 unbuildable on Claude Code as originally drafted |
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

## 9. Phase −1 Addendum: Concrete Building Blocks for Phase 1–4

Reusable, verbatim-sourced patterns from B3 that directly inform implementation (not new findings, just the concrete "how" for findings already listed above):

**GO-gate hook shape (feeds F-03, Phase 1).** B3's `simplify-ignore` hook is the reference implementation for a blocking `PreToolUse` hook: it exits with code 2 to block the tool call, and returns its message over **stderr**, not stdout. Our GO-gate hook should follow the same shape — `PreToolUse` matcher on `Write|Edit|Bash(git commit *|git push *|npm publish *|npm version *|rm *)`, exit 2 with `"Blocked: no GO token for this run. See CLAUDE.md §2."` on stderr when the state file has no matching approval, exit 0 otherwise.

**Session-start context injection (optional Phase 2 addition).** B3 registers a `SessionStart` hook (`session-start.sh`) that injects its meta-skill's full content into every new session via `additionalContext`, degrading gracefully (info-level log) if `jq` is missing. Equivalent for this repo: inject a short "you are working in the BDB agent-skills repo; domains are media-eventtech/saas-ops/design-ui-ux/bdb-core; the GO gate is hook-enforced" context block, rather than relying on `CLAUDE.md` prose to convey it every time.

**Eval case format (feeds Phase 3.5).** `evals/cases/<skill-name>.json` — minimum 3 positive triggers (example user prompts that should route to this skill), 2 negative triggers (should NOT route here, catches over-broad descriptions), 1 behavioral eval (a `kind: "dialogue"` case for conversational skills, or a real-fixture execution case). B3's CI also runs a **cross-skill description-collision check** — two skills whose descriptions exceed ~75% TF-IDF similarity is a CI error. Recommendation: run this collision check once across the finalized 161-skill tree before Phase 3 authoring starts, since several `library`-tier duplicates (e.g. `postgresql` / `postgres-best-practices` / `using-neon` / `neon-postgres`, flagged in the original F-08 area) are likely to fail it as currently worded.

**Reviewer-node discipline (feeds §6.2, Phase 4).** From `doubt-driven-development`: pass the reviewer ARTIFACT + CONTRACT only, never the CLAIM; adversarial prompt, explicitly forbidding validation language; fixed finding-classification precedence (contract misread → valid+actionable → valid trade-off → noise); named stop condition "doubt theater" (2+ cycles, 0 actionable findings → escalate, don't keep looping).

**Command-file generation (feeds F-12, Phase 2).** One canonical command body per command; harness-specific syntax adaptation (Markdown+YAML for Claude, TOML for Gemini/Antigravity) and namespace prefixing are the *only* permitted variation — verified byte-identical across two of three real harness targets in the reference repo, so this is a proven pattern, not a proposal.

---

## 10. Explicitly Out of Scope

- No code review of `installer.js`, `scripts/`, `mcps/`, `tools/` (structural references only).
- No content-quality review of individual skill bodies — only structural conformance was measured.
- Sibling repos `bdb-dev-optimized-agent-skills-basic` and `bdb-dev-optimized-antigravity-skills` were not audited; drift between them and this repo is unassessed.
- No changes applied. This document is the sole output.
