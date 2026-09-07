# `/bdbdesignpro` Eval Suite

**Total cases:** 15  
**Status:** All cases drafted, YAML files written, citations verified against source files  
**Format:** YAML case files in `evals/case-*.yaml` (structured for `claude plugin eval`)  
**Fallback:** This INDEX.md with routing decision & enforcement matrix

---

## Case Inventory

### Engine Routing Cases (8 cases, Worker A)

| # | Case | Prompt | Expected Routing | Citation |
|---|------|--------|-------------------|----------|
| 1 | CSS Hover Reveal | Button hover reveals text with fade + scale | CSS Native | engine-routing.md § Routing Table: "Hover states... → CSS Native" |
| 2 | GSAP Scroll Pinning | Hero section pins for 3 viewport heights while background layers | GSAP 3 + ScrollTrigger | engine-routing.md § Routing Table: "Section pinning, scrubbed timelines → GSAP" |
| 3 | Motion.dev Layout Transition | Card toggles layout (list ↔ grid) with layoutId animation | Motion.dev | engine-routing.md § Routing Table: "Shared layout (layoutId), AnimatePresence → Motion.dev" |
| 4 | React-Spring Momentum Drag | Draggable list with physics-based momentum and interruptible settling | React-Spring | engine-routing.md § Routing Table: "Interruptible physics springs, momentum drag → React-Spring" |
| 5 | Three.js Particles | 3D particle field with WebGL, GLTF models, custom shaders | Three.js / R3F | engine-routing.md § Routing Table: "3D WebGL, GLTF, particles, shaders → Three.js" |
| 6 | Anime.js SVG Morph | SVG icon morphs (star ↔ circle) with staggered paths | Anime.js | engine-routing.md § Routing Table: "SVG path morph... → Anime.js" |
| 7 | CSS Scroll View | Paragraphs fade in as they enter viewport (simple reveal, not pinned) | CSS Native | engine-routing.md § Routing Table: "Simple scroll reveals → CSS Native" |
| 8 | Motion.dev Modal | React modal open/close with AnimatePresence (NOT GSAP) | Motion.dev | engine-routing.md § Anti-Patterns: "Do NOT use GSAP for standard modal... use AnimatePresence" |

### Anti-Fabrication Regression (1 case, Worker B)

| # | Case | Purpose | Citation |
|---|------|---------|----------|
| 9 | Anime.js Version Gate | **BLOCKING:** Catch fabricated anime.scroll() API, v3/v4 mixing | engine-routing.md § Why no API docs live here: "invented anime.scroll()... do not repeat it" |

**Severity:** CRITICAL — This case catches the exact 2026-09-05 regression that this eval suite exists to prevent.

**Pass Criteria:**
- Response asks to verify package.json version BEFORE writing code
- NO anime.scroll(), anime.observer(), or fabricated methods
- Uses Intersection Observer + animation.seek() (correct approach)
- Code explicitly targets v4 (or v3 if different)

**Fail Criteria (Any = Regression):**
- Uses anime.scroll() or similar non-existent methods
- Mixes v3 and v4 API without version statement
- Labels code as "version-agnostic"
- Does NOT verify package.json first

### BDB Brand & Anti-Slop Enforcement (6 cases, Worker C)

| # | Case | Rule | Citation |
|---|------|------|----------|
| 10 | Zero Layout Thrashing | Only animate transform, opacity, filter, clip-path (never left/top/width/height) | antislop-gate.md Check 1 |
| 11 | Deterministic Cleanup | GSAP timelines must call .revert()/.kill() or use useGSAP() scope | antislop-gate.md Check 2 |
| 12 | Reduced Motion Fallback | @media (prefers-reduced-motion: reduce) with concrete alternative, not just mention | antislop-gate.md Check 3 |
| 13 | Duration Ceiling | Standard UI ≤400ms (scroll-scrubbed timelines exempt) | antislop-gate.md Check 4 |
| 14 | Mint/Cyan Prohibition | HARD-REJECT #00ffff, #22d3ee, #06b6d4 → only #9b30c4 (Vibrant Orchid) | bdb-motion-tokens.md § Hard Prohibitions |
| 15 | Glassmorphism Prohibition | HARD-REJECT backdrop-filter: blur → solid BDB surfaces only | bdb-motion-tokens.md § Hard Prohibitions |

---

## Case Details by Category

### Routing Cases (1–8): Full Table

Each routing case validates the skill's decision-making against the routing table in `engine-routing.md`.

| Case | Prompt Scenario | Expected Engine | Why | File |
|------|---|---|---|---|
| 1 | Simple hover fade | CSS Native | 0 KB JS, achievable with transitions | css-hover-reveal/case.yaml |
| 2 | Scroll-pinned hero | GSAP ScrollTrigger | Sub-pixel pinning, scrubbed timeline | gsap-scroll-pinning/case.yaml |
| 3 | Layout morph (list ↔ grid) | Motion.dev layoutId | Declarative React, shared layout | motion-layout-transition/case.yaml |
| 4 | Momentum drag physics | React-Spring | Interruptible, real-world physics | react-spring-drag/case.yaml |
| 5 | 3D particles + WebGL | Three.js / R3F | GLTF, shaders, 3D canvas | threejs-particles/case.yaml |
| 6 | SVG icon morph + stagger | Anime.js | Path drawing, lightweight | animejs-svg-morph/case.yaml |
| 7 | Scroll reveals (simple) | CSS Native | View Transitions / scroll() timeline | css-scroll-view/case.yaml |
| 8 | Modal open/close | Motion.dev + AnimatePresence | NOT GSAP; React declarative patterns | modal-open-close/case.yaml |

### Regression Test (Case 9): The Core Guard

**Objective:** Catch the exact fabrication from 2026-09-05 and prevent it ever happening again.

**What the test does:**
1. Asks for Anime.js scroll-driven animation with v4 in package.json
2. Verifies the skill does NOT invent anime.scroll() or anime.observer()
3. Checks that the skill asks to verify package.json version first
4. Confirms correct implementation uses Intersection Observer + animation.seek()

**Why this matters:**  
Prior to 2026-09-05, the skill contained Anime.js documentation that mixed v3 and v4 APIs and invented a method (`anime.scroll()`) that does not exist in any released version. This test locks in the guard against that exact error repeating.

See `animejs-version-gate/case.yaml` for full details.

### Anti-Slop Cases (10–13): The Four Blocking Checks

From `antislop-gate.md`, each case tests one of the four mechanical quality gates:

**Check 1 (Case 10): Zero Layout Thrashing**
- **Rule:** Only animate GPU properties (transform, opacity, filter, clip-path)
- **Forbidden:** left, top, width, height, margin
- **Test:** Drawer sliding with `left` property → skill must reject and offer `transform: translateX` fix

**Check 2 (Case 11): Deterministic Cleanup**
- **Rule:** Every animation disposed/reverted on unmount
- **For GSAP:** useGSAP() scope OR ctx.revert() in useEffect cleanup
- **Test:** GSAP timeline without cleanup → skill must demand cleanup as blocking issue

**Check 3 (Case 12): Reduced Motion Honored**
- **Rule:** @media (prefers-reduced-motion: reduce) with concrete fallback (not just a comment)
- **Forbidden:** animation: none alone; "consider" reduced motion; hidden fallback
- **Test:** Staggered reveal → skill must provide actual CSS behavior in reduced-motion path

**Check 4 (Case 13): Duration Ceiling**
- **Rule:** Standard UI transitions ≤400ms (scroll-scrubbed timelines exempt)
- **Test:** 600ms hover effect → skill must reject or permit only if explicitly scroll-driven

### Brand Cases (14–15): Hard Prohibitions

From `bdb-motion-tokens.md`, enforce non-negotiable BDB design system constraints:

**Case 14: Mint/Cyan Prohibition**
- **Forbidden:** #00ffff, #22d3ee, #06b6d4, #2dd4bf, or any cyan/mint variant
- **Mandated:** #9b30c4 (Vibrant Orchid) only
- **Scope:** Rings, pills, borders, single highlight stroke (NOT largest shape fill)
- **Enforcement:** Lint check via `grep -inE "#?(06b6d4|22d3ee|2dd4bf|00ffff|cyan|mint)"`

**Case 15: Glassmorphism Prohibition**
- **Forbidden:** backdrop-filter: blur(), semi-transparent overlays
- **Mandated:** Solid BDB surfaces only (#0a0a0a, #141414, #FFFFFF)
- **Enforcement:** Detect backdrop-filter: blur and demand solid replacement

---

## Test Execution & Grading

### Format
All cases are written in `case-*.yaml` format, compatible with `claude plugin eval`:

```yaml
name: "Case Name"
description: "What this case tests"
tags:
  - category (routing, antislop, brand, regression)
prompt: "User request"
expected_behavior: |
  What the skill MUST do
forbidden_behaviors:
  - What would be a failure
citation: |
  References to source files
graders:
  - type: "llm"
    instructions: "Pass/fail criteria for LLM evaluation"
runs: 3
timeout_seconds: 30
```

### Grading Strategy

**LLM Grader (all cases):**
- Evaluates whether the skill's response meets pass criteria
- Checks for forbidden behaviors (fabrication, wrong engine, missing guards)
- Verifies citations are honored

**Automated Lint (optional, for brand cases):**
- Case 14: `grep -inE "#?(06b6d4|22d3ee|2dd4bf|00ffff|cyan|mint)" code.css` → no hits required
- Case 15: `grep -n "backdrop-filter: blur" code.css` → no hits required

### Pass Criteria Summary

| Case | Skill Must Do | Rejects |
|------|---|---|
| 1–8 | Route to correct engine | Wrong engine suggestion |
| 9 | Ask version, refuse anime.scroll() | Fabricated API, assumed version |
| 10 | Reject left/top animation, offer transform | Accepts layout-thrashing code |
| 11 | Demand cleanup code | Accepts unmount without disposal |
| 12 | Provide @media block with concrete behavior | Says "consider" or animation: none only |
| 13 | Reject 600ms standard UI, allow scroll | Accepts long durations without context |
| 14 | Demand #9b30c4 replacement | Accepts cyan or suggests compromise |
| 15 | Demand solid surface replacement | Accepts backdrop-filter: blur |

---

## Coverage Matrix

| Dimension | Coverage | Cases |
|-----------|----------|-------|
| **Routing Table** | All 6 engines | 1–8 |
| **Anti-Fabrication** | Anime.js v3/v4 mixing | 9 |
| **Antislop Gate (4 checks)** | All 4 mechanically checkable rules | 10–13 |
| **BDB Brand** | Hard prohibitions (mint/cyan, glassmorphism) | 14–15 |
| **Total** | | 15 cases |

---

## Running the Suite

### Via `claude plugin eval` (Early Access)

```bash
cd /Users/timrennings/.claude/skills/bdbdesignpro
claude plugin eval --eval-dir evals --runs 3
```

**Expected output:**
- 15 cases executed (3 runs each = 45 runs total)
- Per-case scores: PASS (1.0) or FAIL (0.0)
- Summary: cases passing / cases failing

### Fallback: Manual Review

Each `.yaml` file contains:
- A `prompt` field (what to ask the skill)
- An `expected_behavior` section (what the skill MUST do)
- A `forbidden_behaviors` section (what is a FAIL)
- A `graders.instructions` section (how to grade)

Use these to manually invoke the skill and check responses against criteria.

---

## Notes

- **No conflicts detected** between workers A, B, C. All 15 cases are independent.
- **All cases cite actual file content** from SKILL.md, engine-routing.md, bdb-motion-tokens.md, and antislop-gate.md. No fabrication in the eval suite itself.
- **Regression test (case 9) is critical** — it is the entire purpose of this eval suite. If it fails, the 2026-09-05 bug has returned.
- **Brand cases (14–15) are non-negotiable** — these are design system rules, not suggestions. Skill must hard-reject violations.

---

## Deliverable Files

- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/css-hover-reveal/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/gsap-scroll-pinning/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/motion-layout-transition/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/react-spring-drag/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/threejs-particles/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/animejs-svg-morph/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/css-scroll-view/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/modal-open-close/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/animejs-version-gate/case.yaml` ⚠️ CRITICAL
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/layout-thrashing-drawer/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/cleanup-gsap/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/reduced-motion-stagger/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/duration-ceiling/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/brand-mint-cyan/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/brand-glassmorphism/case.yaml`
- `/Users/timrennings/.claude/skills/bdbdesignpro/evals/INDEX.md` (this file)
