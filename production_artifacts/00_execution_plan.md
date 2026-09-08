# 00 — Execution Plan: ECC Port (Auxiliary Agents + Plan Canvas)

**Cycle:** new (this file replaces the previous, stale plan)
**Repo:** `/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills` (`@hybridlabor-api/aos`, v4.0.2, Apache-2.0)
**Upstream:** `https://github.com/affaan-m/ECC` — MIT, Copyright (c) 2026 Affaan Mustafa
**Deliverables:** two, independent. A = 6 auxiliary subagents. B = vendored Plan Canvas skill.

---

## 0. Findings from reading the existing architecture

These are verified facts, not assumptions. They change the shape of the port.

1. **No THIRD_PARTY_NOTICES convention exists in AOS.** Every hit for `THIRD_PARTY` / `ATTRIBUTION` / `Copyright (c)` is inside `mcps/*` — vendored upstream sub-repos that carry their own `LICENSE`. AOS itself has never vendored third-party source into its own trees. This port is the first, so the convention has to be created (see §1.3).
2. **License asymmetry is real:** AOS is Apache-2.0, ECC is MIT. MIT-into-Apache-2.0 is fine, but the MIT notice must travel with the code.
3. **`/startcycle`'s source of truth is `skills/basic/startcycle/SKILL.md`** — not `skills/global_config/`, and not `~/.claude/skills/startcycle/SKILL.md` (that directory is a real directory, installer output, not a symlink). Edit the repo file only.
4. **The installer discovers skills by `readdirSync`** over the skill bases (`installer.js` ~L979 / L3250 / L3630). A new skill folder needs **no registry entry** to be installed.
5. **`package.json.files` already contains `"skills/"` and `".claude/"`** — both deliverables' file trees are already covered. What is *not* covered is a repo-root notices file (see §1.3 / B-6).
6. **ECC's `scripts/lib/plan-canvas/server.js` requires `../loopback-guard`** — i.e. `scripts/lib/loopback-guard.js`, a **7th file that was not in the task list**. Without it the port is a guaranteed `MODULE_NOT_FOUND` on first run. It is the loopback/Host/Origin security boundary; it gets vendored verbatim, never reimplemented.
7. **`plan-canvas.js:38` does `require('../package.json').version`, and that cross-tree require must be deleted, not repointed.** The installer's `syncSkillEntry` (`installer.js:938`) copies a *leaf* skill's directory to `targetSkillDir/<dirName>`, so the installed CLI lives at `~/.claude/skills/plan-canvas/scripts/plan-canvas.js` — depth 2 below `~/.claude/skills/`, not depth 4 below a repo root. **Any** relative path to AOS's `package.json` is therefore wrong on the installed copy (four levels resolves to `~/package.json`), and it fails on *every* invocation including `--help`. `VERSION` never needs to equal AOS's real package version — see §B2.
8. **Zero runtime dependencies.** All 7 JS files import Node stdlib only (`fs`, `http`, `path`, `os`, `crypto`, `events`, `child_process`). No `package.json` `dependencies` change. Mermaid is a browser-side ESM import from jsDelivr, already override-able by env and already degrades to a styled code block on fetch failure — leave it alone.

---

## 1. Capability map

### 1.1 Module boundaries

| Module | Path | Owns | Depends on |
|---|---|---|---|
| **A. Auxiliary agents** | `.claude/agents/*.md` | 6 standalone subagent definitions | nothing (leaf; pure markdown) |
| **B1. Plan Canvas runtime** | `skills/global_config/plan-canvas/scripts/` | CLI + loopback server + session store + HTML/markdown/UI render | **Node stdlib only.** No edge to AOS root `package.json` — deliberately severed (§B2), because the skill tree is relocated by the installer and must be self-contained. |
| **B2. Plan Canvas skill doc** | `skills/global_config/plan-canvas/SKILL.md` | agent-facing workflow contract | B1 (CLI surface), `/startcycle` artifact convention |
| **B3. Bin exposure** | root `package.json` `bin` | `aos-plan-canvas` → B1 entrypoint | B1 |
| **B4. Pipeline doc hook** | `skills/basic/startcycle/SKILL.md` | one **optional** mention at the 1→2 gate | B2 (name only) |
| **C. Attribution** | root `THIRD_PARTY_NOTICES.md` + `files` entry | MIT notice for everything ported here | A, B1, B2 |

### 1.2 Dependency direction

```
Node stdlib ──▶ B1 runtime ──▶ B3 bin
                    │
                    └──▶ B2 SKILL.md ──▶ B4 startcycle mention   (doc-level, one-way)

A (agents)  ── no edges. Fully independent of B.
C (notices) ── depends on A and B existing; written last.
```

No cycles. **A and B share nothing** — they can be built in parallel by two workers, or serially in any order.

### 1.3 Attribution decision (Architect's call, as requested)

**Decision: one repo-root `THIRD_PARTY_NOTICES.md`, plus a one-line source pointer inside each ported file.**

Rejected alternatives and why:
- *Per-file license header only* — 6 agents + 7 JS files = 13 copies of the MIT text. Noise, and it drifts.
- *`.claude/agents/THIRD_PARTY_NOTICES.md` (the option named in the brief)* — covers deliverable A but leaves deliverable B, in a completely different tree, unattributed. It would force a second notices file for `skills/global_config/plan-canvas/`, i.e. two competing conventions on day one of having any convention at all.

The root file is the conventional location, covers both deliverables in one place, and is where the *next* vendored thing goes. The per-file pointer is a one-liner (`Source: affaan-m/ECC — MIT, see THIRD_PARTY_NOTICES.md`), not a license copy — it survives a file being read in isolation without duplicating legal text.

**Consequence, and it is not optional:** the root file is outside every `files` allowlist entry, so it will **not ship on npm** unless `"THIRD_PARTY_NOTICES.md"` is added to `package.json.files`. Shipping MIT code without its notice is a license violation, so this allowlist edit is part of the deliverable, not a nice-to-have. (Note the repo's documented history of `files`-allowlist bugs breaking real npm installs — this is exactly that class of bug, with legal weight attached.)

---

## 2. Build order

Two independent tracks. Within a track, order is strict.

```
Track A:  A1 ─▶ A2 ─▶ A3
Track B:  B1 ─▶ B2 ─▶ B3 ─▶ B4 ─▶ B5 ─▶ B6
Join:     C1 (needs both tracks landed) ─▶ V (verification)
```

---

## 3. Deliverable A — 6 auxiliary subagents

### A1. Fetch
```
gh api repos/affaan-m/ECC/contents/agents/<name>.md --jq '.content' | base64 -d
```
for: `silent-failure-hunter`, `security-reviewer`, `go-build-resolver`, `database-reviewer`, `opensource-forker`, `opensource-sanitizer`. (Already confirmed present upstream; 59–207 lines each.)

### A2. Adapt to house style
House frontmatter, as read from `.claude/agents/architect.md` / `reviewer.md` / `techlead.md`:

```yaml
---
name: <kebab-name>
description: "<one sentence, double-quoted, escaped inner quotes>"
model: opus | sonnet | haiku
skills: [a, b, c]        # AOS convention — ECC has no such key
---
<the description repeated as the opening body line>

**Primary skills:** a, b, c

**MCP servers used:** …

**Output artifact(s):** …
```

Adaptation rules:
- **Keep** ECC's `name`, `tools:`, and `model:` where sensible. The house 7 are all `model: opus`; these auxiliaries are `sonnet`/`haiku` upstream and should **stay** cheaper — they are narrow, mechanical reviewers, and a lazy plan does not pay Opus rates for grep-and-report. Keep upstream's choice unless it is absent.
- **Add** the AOS keys the house style has and ECC lacks: `skills:` (pick from AOS's own library — e.g. `systematic-debugging` for silent-failure-hunter, `golang-pro`/`go-concurrency-patterns` for go-build-resolver, `postgres-best-practices`/`database-design` for database-reviewer, `github-repo` for the opensource pair), and the three bold body lines (`Primary skills` / `MCP servers used` / `Output artifact(s)`). Where a field has no honest value, write `none` — do **not** invent an MCP server or an artifact path.
- **Keep** ECC's "Prompt Defense Baseline" block. It is upstream's content and harmless.
- **Do not** rewrite the bodies. This is a port, not a rewrite. Frontmatter + the three house lines is the whole adaptation surface.
- Add the one-line MIT source pointer as a YAML comment inside the frontmatter block (`# Source: affaan-m/ECC agents/<name>.md — MIT, see THIRD_PARTY_NOTICES.md`). YAML comments are valid frontmatter and survive the parse.

### A3. Registry — explicitly do NOT touch
`.agents/nodes.json` and `.agents/graph.md` stay byte-identical. These 6 are standalone subagent types living alongside the 7 pipeline nodes, not members of the graph. **Hard constraint; TechLead rejects any diff touching those two files.**

---

## 4. Deliverable B — Plan Canvas

### B1. Vendor the runtime (7 files)

Target layout — deliberately mirrors ECC's `scripts/` shape so that **every `require()` except one resolves unchanged**:

```
skills/global_config/plan-canvas/
├── SKILL.md
└── scripts/
    ├── plan-canvas.js                 ← ECC scripts/plan-canvas.js
    └── lib/
        ├── loopback-guard.js          ← ECC scripts/lib/loopback-guard.js   (the missing 7th file)
        └── plan-canvas/
            ├── markdown.js
            ├── sdk.js
            ├── server.js
            ├── sessions.js
            └── ui.js
```

`server.js`'s `require('../loopback-guard')` and `plan-canvas.js`'s `require('./lib/plan-canvas/…')` are then correct with **zero edits**. That is the point of mirroring rather than flattening.

> Note on location: the brief specifies `skills/global_config/`, and that is what this plan follows. Flagging for TechLead that `/startcycle` and its siblings live in `skills/basic/` — `global_config` is nonetheless the correct home for a general-purpose skill, and the installer treats both bases identically.

### B2. The one required source edit — sever the cross-tree `require`, don't repoint it

`plan-canvas.js:38` is the single line whose ECC-relative path does not survive the move:
```js
const VERSION = require('../package.json').version;      // ECC: scripts/ → repo root
```

**Do not deepen this to `'../../../../package.json'`.** That resolves correctly from the repo checkout and is broken everywhere else. `installer.js`'s `syncSkillEntry` (L938) copies a leaf skill — one containing `SKILL.md`, which this one does — to `targetSkillDir/<dirName>`, and `syncSkillsToGlobalHarnesses` runs that against five destinations (`~/.claude/skills/`, `~/.agents/skills/`, `~/.codex/skills/`, `~/.cursor/skills/`, `~/.roo/skills/`). The installed CLI therefore lives at `~/.claude/skills/plan-canvas/scripts/plan-canvas.js`, where four `../` levels resolve to `~/package.json` → `MODULE_NOT_FOUND` on **every** invocation, `--help` included. The skill tree gets relocated by design; a require that walks out of it is wrong by construction, at any depth.

**Fix — replace the require with a literal:**
```js
const VERSION = '1.0.0';   // vendored Plan Canvas protocol version; matches SKILL.md metadata.version.
                           // Bump when the vendored JS changes, to force a stale detached server to restart.
```

This is correct, not a workaround. Tracing all three uses:
- `plan-canvas.js:176` — `if (health && health.version === VERSION) return port;` compares the CLI against a server the CLI itself spawned from `__filename` (L179). Same file, same literal, always equal.
- `plan-canvas.js:358, :367` — writes the same value into the health response and `server.json`.
- `server.js:117` — already defaults `version = '0.0.0'` when nothing is passed.

So `VERSION` only has to be **stable and self-consistent**, never equal to `@hybridlabor-api/aos`'s version. Its one real job — restarting a stale detached server after an upgrade — is served better by a literal tied to *this vendored code* than by AOS's release version, which bumps for reasons that have nothing to do with the canvas protocol.

Keep it in sync with `metadata.version` in the skill's `SKILL.md` (§B4); that pairing is the whole versioning story for this module.

### B3. Rebrand — exact-token replacement, not a blanket sed
ECC and AOS would otherwise fight over the same loopback port, the same state dir, and the same health-identity string. Replace these **exact tokens only**:

| # | From | To | Where |
|---|---|---|---|
| 1 | `ECC_PLAN_CANVAS_PORT` / `_STATE_DIR` / `_IDLE_MS` / `_MERMAID_URL` | `AOS_PLAN_CANVAS_*` | `plan-canvas.js`, `server.js`, `sessions.js`, `ui.js` |
| 2 | `'ecc-plan-canvas'` (health `app` id) | `'aos-plan-canvas'` | `server.js:544` **and** `plan-canvas.js:161` — these two must change **together** or every health check fails |
| 3 | `ecc-plan-canvas` in help/usage/guidance strings | `aos-plan-canvas` | `plan-canvas.js` |
| 4 | state dir `path.join(os.homedir(), '.claude', 'plan-canvas')` | `…, '.claude', 'aos-plan-canvas')` | `sessions.js:22` |
| 5 | `const DEFAULT_PORT = 4517;` | `const DEFAULT_PORT = 4519;` | `server.js:28` (the fallback `resolvePort` returns at L63 whenever the env var is unset — i.e. the default path) |

**Row 5 is not cosmetic, and it is load-bearing *because of* row 2.** Renaming the env var alone leaves the hardcoded default at 4517, so a co-installed ECC and AOS still collide there by default. That collision used to be survivable: `ensureServer` (`plan-canvas.js:173-181`) health-checks the port, and on a version mismatch POSTs `/shutdown` to take the port over. But `healthCheck` (L161) only returns a body when `res.body.app` matches — so after row 2, AOS looks at ECC's live server, sees `app: 'ecc-plan-canvas'`, and returns `null`. The takeover branch is skipped entirely; AOS goes straight to spawning its own server on an occupied port → `EADDRINUSE` in the detached child → the 50×100 ms health loop at L189 never succeeds → a hard throw after ~5 s, on every single invocation. Rows 2 and 5 must land together.

4519 is chosen only for being adjacent and unclaimed; any free port works. Update the port in the `SKILL.md` prose too (§B4) — it names `127.0.0.1:4517` explicitly.

**Do not** blanket-replace `ecc`/`ECC` case-insensitively. It would corrupt the upstream provenance comment `See affaan-m/ECC#2702` in `ui.js` (which is attribution — it stays) and needlessly churn browser-internal identifiers (`window.__eccPlanCanvasSdk`, `data-ecc-plan-canvas`), which are private to the served page and cost nothing to leave alone.

### B4. `SKILL.md` — adapt to the AOS artifact convention
Port ECC's 196-line `skills/plan-canvas/SKILL.md` with these substitutions:

- **Artifact path:** every `.claude/plans/*.plan.md` / `.claude/plans/feature.plan.md` → **`production_artifacts/00_execution_plan.md`** (the `/startcycle` contract artifact). Where upstream says "the most recently modified `.claude/plans/*.plan.md`", say "the `/startcycle` plan artifact, `production_artifacts/00_execution_plan.md`".
- **CLI name:** `ecc-plan-canvas` → `aos-plan-canvas` throughout. The contract is unchanged and is the reason the command wrapper was read: `open <artifact>` (returns immediately, detached server), `await <artifact>` (long-polls, prints verdict JSON to stdout, progress to stderr), `await <artifact> --reply "<msg>"`, `pending`, `typing`, `end <artifact>`, `stop`, `server`. Verdicts: `approve` | `request-changes`; feedback kinds: `chat` | `annotation` | `verdict`.
- **Port:** upstream prose names the loopback server as `127.0.0.1:4517`. Change to `127.0.0.1:4519` to match §B3 row 5.
- **Frontmatter:** house skill style as seen in `skills/basic/startcycle/SKILL.md` — `name`, `description`, `category: bdb-core`. Keep upstream's `metadata:` block (`version: "1.0.0"`) and extend it with the origin/license (`origin: affaan-m/ECC`, `license: MIT`). **`metadata.version` must equal the `VERSION` literal from §B2** — they are one value in two places, and they get bumped together.
- **Gate framing:** where ECC says "an `approve` verdict counts as plan confirmation for `/plan`-style gates", say it satisfies the **Architect → TechLead gate (step 1→2)** of `/startcycle`.
- **Keep** the "stay listening or the human talks to an empty chair" section verbatim in substance — it is the one operational rule that makes the loop work.
- **Drop** ECC-install-specific prose (`ecc-universal` package, `$CLAUDE_PLUGIN_ROOT`) and replace with: `aos-plan-canvas` on PATH after an AOS install, or `node skills/global_config/plan-canvas/scripts/plan-canvas.js` from the repo.
- ECC's `commands/plan-canvas.md` is a thin wrapper and was read **only** for the CLI contract. **Do not port a command file** — nothing in the brief asks for one, and AOS surfaces this via the skill.

### B5. `bin` entry
Add to root `package.json`:
```json
"aos-plan-canvas": "skills/global_config/plan-canvas/scripts/plan-canvas.js"
```
Requires the file to keep its `#!/usr/bin/env node` shebang (it has one) and to be `chmod +x` — check the mode after writing.

### B6. `files` allowlist — verify by execution, do not assume
Two separate checks:
1. `"skills/"` is present and should already cover `skills/global_config/plan-canvas/**`. **Confirm, don't assume** — run `npm pack --dry-run` and grep the emitted file list for `plan-canvas/scripts/lib/plan-canvas/server.js` (the deepest nested file, i.e. the one most likely to be dropped). Same check for `.claude/agents/silent-failure-hunter.md`.
2. `THIRD_PARTY_NOTICES.md` is **not** covered by any entry — add it (§C1). Confirm with the same `npm pack --dry-run` output.

`npm pack --dry-run` is a local, non-publishing command; it is compatible with the no-publish constraint.

### B7. `/startcycle` doc hook — additive only
File: **`skills/basic/startcycle/SKILL.md`** (source of truth per §0.3). Not `~/.claude/skills/startcycle/SKILL.md` — that is installer output and is not edited by hand in this cycle.

Add to the **step 2 (TechLead)** section a short optional note, roughly:

> **Optional — Plan Canvas.** Before or alongside TechLead's gate, the plan can be reviewed in the browser: `aos-plan-canvas open production_artifacts/00_execution_plan.md`, then `aos-plan-canvas await …`. An `approve` verdict is a human confirmation of the gate. This is optional; the pipeline runs unchanged without it. See the `plan-canvas` skill.

Constraints on this edit: **the ASCII pipeline diagram is not modified** (adding a box would imply a required node), the word *optional* appears explicitly, and no other step's text changes.

---

## 5. Attribution (join step)

### C1
- Create root `THIRD_PARTY_NOTICES.md`: upstream URL, `MIT License / Copyright (c) 2026 Affaan Mustafa`, full MIT text, and a manifest of exactly which files were ported and what was changed (rebrand + path fix). Two sections: "Auxiliary agents" and "Plan Canvas".
- Add `"THIRD_PARTY_NOTICES.md"` to `package.json.files`.
- One-line source pointer in each ported file (YAML comment in the 6 agents; inside the existing header comment block in the 7 JS files — they all already have one).

---

## 6. Verification — by execution, not inspection

Build is **not** done until all six pass and their real output is pasted into the build report.

| # | Command | Pass condition |
|---|---|---|
| V1 | `node skills/global_config/plan-canvas/scripts/plan-canvas.js --help` | exit 0, usage text printed, **no `MODULE_NOT_FOUND` / `SyntaxError`**. `--help` short-circuits before any network call (`plan-canvas.js:381`), so this is a pure load test of the whole require graph *except* `server.js`. |
| V2 | `node -e "require('./skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js')"` and the same for `markdown.js`, `sdk.js`, `sessions.js`, `ui.js`, `lib/loopback-guard.js` | each exits 0. V1 alone does **not** load `server.js`'s full dependents at require time in every path — this closes that gap, and specifically proves the `../loopback-guard` edge resolves. |
| **V3** | **Relocation test — the one that catches §B2.** `cp -R skills/global_config/plan-canvas "$TMPDIR/vfy/a/b/c/plan-canvas"` then `node "$TMPDIR/vfy/a/b/c/plan-canvas/scripts/plan-canvas.js" --help` | exit 0, same usage output as V1. **V1, V2, V4 and V5 all run from the repo root — the exact layout where a stray `../…/package.json` require still resolves and the bug is invisible.** Only an arbitrary-depth copy, standing in for the installer's five destination trees, proves the skill is self-contained. Then `grep -rn "require('\.\./\.\./" skills/global_config/plan-canvas/scripts/` must return **nothing**: no vendored file may walk above its own skill directory. |
| V4 | `ls -1 .claude/agents/` then parse the frontmatter of each of the 6 new files (e.g. `node -e` with a split on `---`, or `python3 -c "import yaml,sys;yaml.safe_load(...)"`) | 13 files listed (7 existing + 6 new); all 6 frontmatter blocks parse as valid YAML and each yields a non-empty `name` and `description`. |
| V5 | `npm pack --dry-run` | file list contains `skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js`, `.claude/agents/silent-failure-hunter.md`, and `THIRD_PARTY_NOTICES.md`. |
| V6 | `git status --porcelain` | `.agents/graph.md` and `.agents/nodes.json` **do not appear**. |

Also confirm by inspection while running V1: the printed usage names `aos-plan-canvas` (not `ecc-`), and `grep -rn "4517\|ECC_PLAN_CANVAS\|'ecc-plan-canvas'" skills/global_config/plan-canvas/` returns nothing (§B3 rows 1–5 complete). The only surviving `ECC` string should be the provenance comment in `ui.js` and the attribution pointers.

Optional smoke (not required, needs a browser): `aos-plan-canvas open production_artifacts/00_execution_plan.md --no-open` then `… stop`.

---

## 7. Binding constraints (restated for TechLead's rejection criteria)

1. **No `npm publish`, no `npm version`, no `git push`.** Local implementation only. `npm pack --dry-run` is permitted (it publishes nothing).
2. **`.agents/graph.md` and `.agents/nodes.json` are untouched.** The 7-node registry stays 7 nodes. Verified by V6.
3. **Verification is by execution** (V1–V6), not by reading the code and asserting it looks right. V3 in particular must be run from a relocated copy, not the repo.
4. **Scope is exactly A and B.** Explicitly out of scope, do not touch: `README*.md` skill inventories, `skills/global_config/ask-tim/SKILL.md`, `~/.claude/skills/**` (installer output), `installer.js`, ECC's `commands/plan-canvas.md` wrapper, ECC's hooks (`scripts/hooks/plan-canvas-*.js`) and tests. No drive-by fixes.
5. **Per the global GO rule:** if a "warte auf mein GO" is in force, Build does not start without a literal `GO` from the user. This plan file is not a GO.

## 8. Known deliberate simplifications

- **Mermaid still loads from jsDelivr in the browser.** Not vendored. Upstream already degrades to a styled code block on fetch failure and exposes `AOS_PLAN_CANVAS_MERMAID_URL` for an air-gapped mirror. Vendor it only if offline diagram rendering is actually asked for.
- **No tests ported.** ECC ships `tests/scripts/plan-canvas.test.js` and friends against its own harness. V1–V3 are the runnable check that the vendored graph loads and stays relocatable; port the upstream suite only if this code starts being modified rather than merely carried.
- **No `commands/plan-canvas.md` equivalent.** The skill is the entry point.
