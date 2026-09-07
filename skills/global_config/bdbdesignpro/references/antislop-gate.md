# Anti-Slop Gate

The four blocking criteria `Reviewer` checks against any `/bdbdesignpro` output, each with a mechanical check — not a vibe check. This file is the enforceable version of `SKILL.md` Phase 5; `startcycle-hook.md` references these same four criteria for the `Godmode_UI_UX` Reviewer step.

---

## 1. Zero Layout Thrashing

**Rule:** only animate `transform`, `opacity`, `filter`, `clip-path`. Never `top`, `left`, `width`, `height`, `margin`.

```bash
grep -nE "animation\s*:|transition\s*:" *.css | grep -E "\b(width|height|top|left|margin)\b"
```
Any hit is blocking.

## 2. Deterministic Cleanup

**Rule:** every animation instance is reverted/disposed on unmount.

| Engine | What to grep for |
|---|---|
| GSAP | `useGSAP` scope present, or manual `.revert()` / `mm.revert()` in a cleanup return |
| Three.js / R3F | `.geometry.dispose()` + `.material.dispose()` for any manually-constructed `THREE.Mesh` (R3F-declarative JSX disposes automatically — only check manual `new THREE.*` calls) |
| Anime.js | scope-based `createScope().add()` reverted on unmount, or explicit cleanup for any listener/observer registered |
| Motion.dev | no action needed — `AnimatePresence`/hooks clean up declaratively |

```bash
grep -rn "useGSAP\|new THREE\.\(Mesh\|Geometry\)\|createScope" src/ | wc -l
grep -rn "\.dispose()\|\.revert()" src/ | wc -l
```
If the first count is nonzero and the second is zero, that's blocking.

## 3. Reduced Motion Honored

**Rule:** `prefers-reduced-motion: reduce` has a concrete fallback for every animation, not just a mention.

```bash
grep -rc "prefers-reduced-motion\|useReducedMotion" src/**/*.{css,tsx,ts}
```
Zero hits in a file that also matches check 1's animation properties is blocking. This was the single biggest gap found in the 2026-09-05 audit — 4 of 6 former engine-reference files had zero coverage.

## 4. Duration Ceiling

**Rule:** standard UI transitions (dialogs, drawers, tabs, hover) do not exceed `--duration-slow: 400ms` (see `bdb-motion-tokens.md`). Scroll-scrubbed narrative timelines are exempt — they're bound to scroll position, not a clock.

```bash
grep -noE "duration\s*:\s*[0-9]+" src/**/* | awk -F: '$2 > 400 {print}'
```

---

## No-Progress Escalation

Per `.agents/graph.md`'s Reviewer discipline: if a repair round reports the exact same finding ID from these four checks twice, escalate to human review rather than re-invoking the build node a third time.
