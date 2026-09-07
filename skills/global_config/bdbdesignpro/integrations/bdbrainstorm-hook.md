# `/bdbrainstorm` Integration Hook for `/bdbdesignpro`

This document defines how `/bdbdesignpro` integrates into **`/bdbrainstorm`** as the authoritative Creative Direction & Motion specialist during ideation.

---

## 📍 Pillar 5 Enhancement: The Creative Direction & Interaction Thesis Interview

In `/bdbrainstorm`, Pillar 5 currently enforces `godmode-ui-ux` guidelines. With `/bdbdesignpro`, Pillar 5 is upgraded to run a structured **Interaction Thesis Interview** before the brainstorm concludes.

### 1. The 3-Question Creative Direction Interview
During the interactive grilling phase, the agent presents three focused design queries:

1. **Aesthetic & Kinetic Tone:**
   * *A)* **High-Velocity Product UI:** Snappy, instantaneous, weighted micro-interactions (Motion.dev / CSS Native, 150–250ms).
   * *B)* **Narrative Editorial / Storytelling:** Cinematic scroll-driven reveals, pinned viewports, scrubbed typography (GSAP 3 + ScrollTrigger).
   * *C)* **Tactile Physics:** Natural spring momentum, draggable elements, bouncy reactive gestures (React-Spring).
   * *D)* **Spatial / Experiential 3D:** Interactive canvas, particle fields, WebGL models (Three.js / R3F).

2. **Target Device Budget & Boundaries:**
   * Mobile-first responsive touch zones vs. Desktop multi-pane high-density.
   * Frame budget: 60fps mobile / 120fps ProMotion target.

3. **Design System & Token Baseline:**
   * DTCG design token format, color themes (dark/light), typography scale, and standard corner radii.

---

## 📦 Output Artifact from Brainstorm Hand-off

When `/bdbrainstorm` completes and hands off to `/startcycle`, the generated system plan (`00_execution_plan.md`) will contain a dedicated block:

```markdown
### 🎨 Creative & Motion Stack Decision (via /bdbdesignpro)
- **Primary Interaction Engine:** [GSAP | Motion.dev | Anime.js | React-Spring | Three.js | CSS Native]
- **Interaction Thesis:** [Summary of motion purpose and user feedback model]
- **Core Timing Budget:** [Micro: 150ms | State: 300ms | Easing: cubic-bezier(...)]
- **a11y Fallback:** [prefers-reduced-motion definition]
```

This ensures the `Architect` and `TechLead` in `/startcycle` incorporate the motion engine into dependencies and build orders from day one.
