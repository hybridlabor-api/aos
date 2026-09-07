# `/startcycle` Integration Hook for `/bdbdesignpro`

This document defines the architectural contract for integrating `/bdbdesignpro` into the **`/startcycle`** and **`/startcycle-graph`** autonomous build pipelines.

---

## 📍 Node Attachment: `🎨 Godmode_UI_UX` (Stream 3a)

In `/startcycle`, Step 3a (`Godmode_UI_UX`) reads `production_artifacts/00_execution_plan.md` and generates:
1. `production_artifacts/01_frontend_spec.md`
2. `frontend/src/`

When `/bdbdesignpro` is active, `Godmode_UI_UX` MUST enforce the following motion and creative-coding specification inside `01_frontend_spec.md`:

### 1. Mandatory Motion Section in `01_frontend_spec.md`
Every frontend specification must include a dedicated **Interaction & Motion Strategy**:
* **Selected Engine & Rationale:** (e.g., Motion.dev v12 for component layout transitions; GSAP for pinned landing narrative; Three.js for 3D hero).
* **Motion Tokens:** Explicit easing curves and durations defined in DTCG or Tailwind format.
* **Component Motion Primitives:** Mapping each `shadcn/ui` component to its motion behavior (e.g., Dialog with `@starting-style` or `AnimatePresence`).
* **Accessibility Fallback:** Documenting the `prefers-reduced-motion` alternative.

### 2. Not attached to `🎬 Godmode_Media_EventTech`
`godmode-media-eventtech` already carries `threejs-skills` in its own `skills:` list — that's the authoritative source for WebGL/R3F implementation detail. `/bdbdesignpro` does not duplicate it here; see [engine-routing.md](../references/engine-routing.md) if that agent ever needs the routing rationale (why Three.js over CSS 3D transforms, etc.) rather than the API itself.

---

## 📋 Reviewer (Step 4) Audit Criteria for `/bdbdesignpro`

When `Reviewer` audits the output of `Godmode_UI_UX`, it checks for these four blocking criteria:
1. **Zero Layout Thrashing:** Code does not animate `height`, `width`, `top`, or `left` directly.
2. **Deterministic Cleanup:** All GSAP timelines are scoped via `useGSAP` or reverted; WebGL geometries are disposed.
3. **Reduced Motion:** Components honor `prefers-reduced-motion` or use the `useReducedMotion` hook.
4. **No Slop:** Transitions do not exceed 400ms for standard UI interactions.
