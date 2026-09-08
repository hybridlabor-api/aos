# Review Findings — ECC Port (Auxiliary Agents + Plan Canvas)

**Reviewer:** adversarial pass against `production_artifacts/00_execution_plan.md`
**Method:** every check re-run independently. Build's self-report was not used as evidence for any pass.
**Verdict:** **PASS WITH ONE BLOCKING FINDING (F-01).** The port is substantively correct.

---

## Verdict summary

| | Count |
|---|---|
| `contract_misread` (blocking) | 0 |
| `actionable_bug` (blocking) | 1 — F-01 |
| `trade_off` (advisory) | 5 — F-02 … F-06 |
| `noise` (discarded) | 2 — recorded in §Discarded so they are not re-raised |

The 6 rebrand edits land **together and self-consistently** (TechLead's D1 coupling
holds). A byte-level diff of all 13 ported files against upstream shows **nothing
changed beyond the sanctioned edit set**. `.agents/graph.md` and
`.agents/nodes.json` are genuinely untouched. V1–V6 all reproduce.

F-01 is a one-block string fix, not a design defect.

---

## Independent verification matrix

Every row below was executed by the reviewer, not read from the build report.

| # | Check | Result |
|---|---|---|
| V1 | `node skills/global_config/plan-canvas/scripts/plan-canvas.js --help` | **exit 0**, usage printed, no `MODULE_NOT_FOUND` / `SyntaxError` |
| V2 | `node -e "require(…)"` × 6 (`server`, `markdown`, `sdk`, `sessions`, `ui`, `loopback-guard`) | **6/6 OK** — the `../loopback-guard` edge resolves |
| V3 | Relocation: `cp -R` to `$SCRATCH/vfy/a/b/c/plan-canvas`, then `--help` | **exit 0**, `diff` vs V1 output **identical**. Also re-run with `cwd=/` → exit 0. `grep -rn "require('\.\./\.\./"` → **no hits**. §B2 severing verified. |
| V4 | YAML-parse frontmatter of all 13 `.claude/agents/*.md` (ruby `YAML.safe_load`) | **13/13 parse**, all 6 new yield non-empty `name` + `description` |
| V4b | All 13 referenced `skills:` names resolved against real `skills/**` dirs | **13/13 real. Zero hallucinated.** (`github-repo` lives at `skills/github-repo/`, depth 1 — real, just not depth 2.) |
| V5 | `npm pack --dry-run --json` | `…/lib/plan-canvas/server.js` **IN**, `.claude/agents/silent-failure-hunter.md` **IN**, `THIRD_PARTY_NOTICES.md` **IN**; 13 agent files in pack |
| V6 | `git status --porcelain .agents/` + `git diff HEAD -- .agents/` | **both empty.** Registry byte-identical. No new agent name appears anywhere under `.agents/`. |
| §6 grep | `grep -rn "4517\|ECC_PLAN_CANVAS\|'ecc-plan-canvas'" skills/global_config/plan-canvas/` | **rc=1, empty** (plan's exact quoted-form pattern) |
| Extra | **Upstream diff** — all 7 JS files + 6 agent files + SKILL.md fetched from `affaan-m/ECC@main` and diffed | **No unauthorized change in any file.** See §Upstream diff audit. |
| Extra | **Live end-to-end smoke** (isolated `AOS_PLAN_CANVAS_STATE_DIR`) | `open --no-open` → `{"status":"open","url":"http://127.0.0.1:4519/…"}`; `lsof` confirms **bound 127.0.0.1:4519**; `curl /health` → `{"ok":true,"app":"aos-plan-canvas","version":"1.0.0"}`; status lists the session; `stop` → port released; **no stray process, `~/.claude/aos-plan-canvas` not polluted** |
| Extra | `installer.js:938` `syncSkillEntry` | Confirmed: leaf skill (has `SKILL.md`) → `copyDirRecursiveSync(fullPath, target/<dirName>)`. **Recursive** — the `scripts/` tree travels. §0.4 / §B2 assumptions hold. |
| Extra | Port 4519 collision | Free at review time; **no other 4519 reference anywhere in the repo** |
| Extra | `bin` entry viability | `plan-canvas.js` has `#!/usr/bin/env node` and mode `-rwxr-xr-x` |
| Extra | Tests / CI enumerating agents | None. `package.json.scripts` is empty; no suite asserts an agent count. Adding 6 files breaks nothing. |

### The D1 coupling (rows 2 + 5), verified as a pair

Both halves land, and they land in the same commit-state:

- `server.js:30` — `const DEFAULT_PORT = 4519;`
- `server.js:546` — `sendJson(res, 200, { ok: true, app: 'aos-plan-canvas', version })`
- `plan-canvas.js:164` — `return res.body && res.body.app === 'aos-plan-canvas' ? res.body : null;`
- `server.js:64` / `:69` / `sessions.js:22` / `ui.js:25` — env prefix `AOS_PLAN_CANVAS_*`
- `sessions.js:24` — `path.join(os.homedir(), '.claude', 'aos-plan-canvas')`
- `plan-canvas.js:40` — `const VERSION = '1.0.0';` == `SKILL.md` `metadata.version: "1.0.0"`

The live `/health` response proves the pair at runtime, not just on paper: a server
started from the vendored code answers on **4519** with app id **`aos-plan-canvas`**,
and the CLI's own health check accepted it. The EADDRINUSE/`null`-health failure mode
the plan warned about cannot occur.

### Upstream diff audit

Fetched `affaan-m/ECC@main` and diffed all 13 ported files. The complete change set is:

- 7 JS files: `* Source: affaan-m/ECC — MIT, see THIRD_PARTY_NOTICES.md` added to the existing header block. Nothing else.
- `plan-canvas.js`: `VERSION` require → literal; env prefix ×2; health app id; 3 guidance strings.
- `server.js`: `DEFAULT_PORT`; env prefix ×2; health app id.
- `sessions.js` / `ui.js`: env prefix only.
- `loopback-guard.js`, `markdown.js`, `sdk.js`: **source pointer only** — otherwise byte-identical.
- 6 agents: frontmatter only (source-pointer YAML comment, description re-quoted, `skills:` added, key order normalised) + the 3 house body lines + the description repeated as the opening body line. **Bodies, including the Prompt Defense Baseline, byte-identical.**
- `SKILL.md`: matches §B4's substitution list item for item.

No drive-by edits. §7.4 (scope) is respected.

### Attribution audit (`THIRD_PARTY_NOTICES.md`)

- Upstream URL `https://github.com/affaan-m/ECC` — **correct** (`gh api` confirms the repo is public, MIT, default branch `main`).
- `Copyright (c) 2026 Affaan Mustafa` — **matches upstream `LICENSE` exactly**.
- MIT body — **byte-identical to upstream `LICENSE`** (diffed, trailing-whitespace-normalised; only difference was my own over-capture of the closing code fence).
- File manifest — all 14 rows correct; no file listed that was not ported, none ported that is not listed.
- Change description — accurate, and **more complete than Build's own self-report**: lines 86–90 correctly disclose the three surviving `ecc-plan-canvas` browser identifiers that Build's summary called "empty" (see F-05).
- No overclaim (does not assert the tests/hooks/command wrapper were ported — explicitly says they were not) and no underclaim.
- `"THIRD_PARTY_NOTICES.md"` added to `package.json.files`; `npm pack --dry-run` confirms it ships. §1.3's legal consequence is closed.

---

## F-01 — `actionable_bug` — BLOCKING

**`--help` usage block names an invocation that works from nowhere.**

`skills/global_config/plan-canvas/scripts/plan-canvas.js:56-76` (`usage()`) prints
eight lines of the form:

```
  node scripts/plan-canvas.js open <file>          Open (or resume) a review session
```

Plan §6 states as a V1 pass condition: *"confirm by inspection while running V1: the
printed usage names `aos-plan-canvas` (not `ecc-`)."* Only the negative half holds.
Plan §B3 row 3 names **"help/usage/guidance strings"** as a rebrand surface;
Build rebranded the three `next_step` guidance strings (`:244`, `:292`, `:326`) but
not the usage block.

Why it is a real defect and not just a spec technicality: upstream's `scripts/` was at
the ECC repo root, so `node scripts/plan-canvas.js` resolved from an ECC checkout. In
AOS the file is at `skills/global_config/plan-canvas/scripts/plan-canvas.js`, so the
printed path resolves **from neither the repo root nor an installed
`~/.claude/skills/plan-canvas/`** — and the supported entry point is now the
`aos-plan-canvas` bin. Every user who runs `aos-plan-canvas --help` is handed eight
non-working commands.

Note this is *not* a missed token replacement: upstream's `usage()` contained no
`ecc-plan-canvas` string to swap (confirmed by upstream diff — the only change in
that block was the `Environment:` line). §B3 row 3 had nothing to match here, which
is exactly why it slipped. §6's inspection clause is the check that should have
caught it, and it was reported as passing.

**Fix:** replace `node scripts/plan-canvas.js` with `aos-plan-canvas` in the 8 usage
lines. One contiguous block, no logic touched, no test impact.

**Waivable as `wont_fix`** if the dispatcher prefers maximal upstream verbatim-ness
over a correct `--help` — but then §6's inspection clause should be struck from the
plan rather than reported as passed.

---

## F-02 — `trade_off` — advisory

**Five stale `ECC` prose comments survive, not one. Build disclosed one.**

| Site | Text |
|---|---|
| `scripts/plan-canvas.js:175` | `// mismatch after an ECC update restarts the server` *(disclosed by Build)* |
| `scripts/lib/loopback-guard.js:4` | `* Host/Origin gating for ECC's loopback HTTP servers` |
| `scripts/lib/plan-canvas/ui.js:7` | `* Visual language mirrors the ECC web dashboard (scripts/dashboard-web.js)` |
| `scripts/lib/plan-canvas/ui.js:30` | `// the ECC canvas. Kept import-only so a CDN failure degrades gracefully.` |
| `scripts/lib/plan-canvas/ui.js:534` | `// ECC-styled document template for rendered markdown plan artifacts.` |

Plus the deliberate, documented `SKILL.md:77` blockquote about the un-vendored
stop-hook (Build's judgement call #1 — correct, and correctly recorded in
`THIRD_PARTY_NOTICES.md`).

**Classification: `trade_off`, explicitly NOT `contract_misread`.** The prompt asked
this to be decided, so the reasoning is stated in full:

Plan §6 says *"The only surviving `ECC` string should be the provenance comment in
`ui.js` and the attribution pointers."* Read alone, that reads as violated five times
over. But §6 is the **verification** section, and that sentence is a *prediction about
the residue of the grep it just specified* — a grep that passes. §B3 is the
**normative** section, and it (a) enumerates the exact tokens to replace, none of
which is prose `ECC`, and (b) explicitly forbids a blanket case-insensitive
`ecc`/`ECC` replacement, naming the `ui.js` provenance comment as the reason. Where a
normative spec and a verification-section prediction conflict, the normative spec
governs. Architect simply did not know that `loopback-guard.js` and `ui.js` carry
three further ECC prose mentions — the prediction was wrong about upstream, not the
build wrong about the contract.

`ui.js:7` and `ui.js:534` are additionally *provenance-adjacent* (they attribute the
visual language to ECC's dashboard) and arguably belong in the keep-list on the same
grounds as `#2702`.

**The actual gap is disclosure, not code:** Build flagged 1 of 5 to the dispatcher.
Make one scope call covering all five, not a call on one of them.

**Recommendation:** leave all five. They are honest provenance in a vendored tree, and
§B3's "don't blanket-replace" instinct was right. If any are touched, `plan-canvas.js:175`
is the only one that is *misleading* rather than merely historical ("an ECC update"
will never bump this fork's `VERSION`) — reword that one alone to "a Plan Canvas update".

---

## F-03 — `trade_off` — advisory

**Three stale `.claude/plans` references, not one. Build disclosed one.**

- `scripts/plan-canvas.js:8` — ` *   node scripts/plan-canvas.js open .claude/plans/feature.plan.md`
- `scripts/plan-canvas.js:9` — ` *   node scripts/plan-canvas.js await .claude/plans/feature.plan.md`
- `scripts/lib/plan-canvas/markdown.js:5` — ` * Renders .claude/plans/*.plan.md artifacts to HTML body content.` *(disclosed by Build)*

**Classification: `trade_off`.** §B4's artifact-path substitution is scoped by its own
opening sentence to `SKILL.md` (*"Port ECC's 196-line `skills/plan-canvas/SKILL.md`
with these substitutions"*). §B1 vendors the JS verbatim; §B2 authorises exactly one
source edit; §B3 authorises exactly five token classes. Leaving header-comment prose
alone is contract-conformant. Same disclosure gap as F-02: 1 of 3 flagged.

Note `plan-canvas.js:8-9` sit inside the same comment block as F-01's problem and
share its fix if F-01 is repaired — worth batching.

---

## F-04 — `trade_off` — advisory

**`opensource-pipeline` skill does not exist in AOS, but is named in two agents' `description:` frontmatter.**

`.claude/agents/opensource-forker.md:4` and `:9`, `.claude/agents/opensource-sanitizer.md:4`
and `:9` all reference *"the opensource-pipeline skill"*. `find skills -type d -name "*opensource*"`
returns nothing — no such skill in AOS's 166.

The **body** occurrences (`:9`) are correct to leave: §A2 says *"Do not rewrite the
bodies."* The **frontmatter `description:`** occurrences (`:4`) sit in a field Build
did edit (re-quoted for house style), and `description` is what the harness surfaces
when matching a subagent.

This is flagged because it is **inconsistent with Build's own disclosed judgement
call #2**, which swapped two nonexistent-in-AOS skill names (`frontend-design-direction`,
`artifact-design`) for real ones inside `SKILL.md`'s prose. The same reasoning applied
here would have caught this. §A2's "keep `description`" instruction is the defensible
counter-argument, which is why this is advisory rather than blocking — but the
dispatcher should pick **one** policy for dangling skill references and apply it to
both deliverables.

**Recommendation:** leave as-is (it is upstream's honest text describing an upstream
pipeline these two agents came from), and instead add one clause to
`THIRD_PARTY_NOTICES.md` §1 noting that the pair references an ECC-side
`opensource-pipeline` skill that was not ported. Cheapest honest resolution.

---

## F-05 — `trade_off` — advisory

**Build's reported stale-string sweep is worded as "empty"; the bare token `ecc-plan-canvas` appears 3×.**

- `scripts/lib/plan-canvas/ui.js:205` — `const QKEY = 'ecc-plan-canvas:queue:' + key;`
- `scripts/lib/plan-canvas/ui.js:214` — `const themeKey = 'ecc-plan-canvas:theme';`
- `scripts/lib/plan-canvas/sdk.js:28` — `host.setAttribute('data-ecc-plan-canvas', 'ui');`

**No code defect.** All three are browser-side identifiers explicitly carved out by
§B3's closing paragraph, and `THIRD_PARTY_NOTICES.md:86-90` documents all three
accurately. The plan's *quoted-form* grep (`'ecc-plan-canvas'`) genuinely returns
nothing — none of the three matches it (`'ecc-plan-canvas:queue:'`, `'ecc-plan-canvas:theme'`,
`'data-ecc-plan-canvas'` all fail the closing-quote anchor). The two localStorage keys
also cannot collide with ECC: `localStorage` is origin-scoped and the ports now differ.

Recorded only so the dispatcher does not treat "sweep was empty" as covering the bare
token. The notices file is the accurate record; the build summary's wording is not.

---

## F-06 — `trade_off` — advisory

**`SKILL.md` gained an `## Environment` table not enumerated in §B4.**

`skills/global_config/plan-canvas/SKILL.md:207-222` adds a 4-row env-var table and a
`metadata.version` ↔ `VERSION` sync note. §B4 lists specific substitutions; this is
additive documentation beyond them.

Content is **accurate** (all four var names, the `4519` default, and the
`~/.claude/aos-plan-canvas` default verified against `server.js:64,69`, `sessions.js:22,24`,
`ui.js:25`). It also documents the §B2 version-pairing rule at the place a maintainer
will look. Net positive; keep. Flagged only because additive scope in a port should be
visible rather than silent.

(The `## Relationship to /startcycle` section at `:128-134` is **not** a finding — §B4's
gate-framing bullet requires exactly that.)

---

## Discarded as noise

Recorded so a repair round does not re-raise them:

1. **`THIRD_PARTY_NOTICES.md:33-34` says upstream `description` is "preserved verbatim"**, while the agents' descriptions were re-quoted from bare scalars to double-quoted scalars. That is a YAML *representation* change; the string value is byte-identical, and §A2 mandates the double-quoted house form. Not an inaccuracy in any meaningful sense.
2. **Exec bit on the installer-copied `plan-canvas.js`.** `copyDirRecursiveSync` → `copyFileSync` preserves mode, npm sets the bit for `bin` entries regardless, and the plan never made this a requirement. Out of scope.

---

## What was checked and found clean (no finding raised)

Stated explicitly so a later cycle does not re-litigate them:

- §A3 / §7.2 hard constraint — `.agents/graph.md` and `.agents/nodes.json` verified untouched by the reviewer's own `git status --porcelain .agents/` and `git diff HEAD -- .agents/`, both empty. Neither file appears in `git status` at all. The 6 new names appear nowhere under `.agents/`.
- All 13 `skills:` entries across the 6 new agents resolve to real skill directories. **Zero hallucinations.**
- §B2 severing is real, not cosmetic — proven by an actual relocation to arbitrary depth, twice, with byte-identical output.
- §B5 `bin` entry, shebang, and exec bit all present.
- §B6 allowlist — verified by execution (`npm pack --dry-run --json`), not assumption.
- §B7 startcycle hook — lands inside the step-2 (TechLead) section at `skills/basic/startcycle/SKILL.md:69`, single blockquote, contains the literal word "optional" twice, ASCII pipeline diagram not in the diff, no other step's text changed. Correct file (repo source of truth, not installer output).
- §7.1 — no `npm publish`/`npm version`/`git push` in the working tree state; `npm pack --dry-run` only.
- License compliance closed end to end: notice exists, is accurate, and **actually ships**.

---

## Recommended disposition

1. Fix **F-01** (8 usage lines) — or waive as `wont_fix` with §6's inspection clause struck.
2. Make **one** dispatcher scope call on F-02 + F-03 covering all eight stale strings, not the two Build happened to surface. Recommended: leave all, except optionally reword `plan-canvas.js:175`.
3. F-04: recommended resolution is a one-clause note in `THIRD_PARTY_NOTICES.md`, not an edit to the agents.
4. F-05, F-06: no action.

Nothing here blocks Shipping's automated gate on a technical basis — there is no test
suite, no lint, and no CI job that any of these findings would fail.
