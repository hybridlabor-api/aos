# Motion & Design Tokens

Standard timing, easing, and token architecture for animations built under `/bdbdesignpro`.
Tokens are brand-agnostic by default and bind dynamically to project-level design tokens (`DESIGN.md`).

---

## ⏱️ Timing Scale

| Token | Value | Use for |
|---|---|---|
| `--duration-fast` | `150ms` | Micro-interactions: hover, click, toggle |
| `--duration-normal` | `300ms` | State transitions: dialogs, drawers, tabs |
| `--duration-slow` | `400ms` | Upper bound for standard UI transitions |
| Scroll-driven narrative | scrubbed to viewport delta | Bind directly to scroll progress, no fixed timer |

---

## 🌊 Easing Curves

```css
:root {
  --ease-standard: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring: linear(0, 0.006, 0.025, 0.057, 0.1, 0.155, 0.22, 0.294, 0.375, 0.461,
    0.549, 0.637, 0.723, 0.803, 0.875, 0.936, 0.984, 1.018, 1.037, 1.042,
    1.035, 1.019, 0.999, 0.982, 0.971, 0.967, 0.97, 0.978, 0.989, 1);
}
```

---

## 🎨 Neutral Token Architecture (DTCG Compatible)

```css
:root {
  --surface-base: #09090b;
  --surface-elevated: #18181b;
  --surface-panel: #27272a;
  --surface-border: #3f3f46;
  
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;

  /* Accent tokens are populated by Phase 0 Brand Discovery (DESIGN.md) */
  --accent-primary: var(--brand-accent, oklch(0.65 0.22 260));
  --accent-muted: var(--brand-accent-muted, oklch(0.45 0.15 260));
  --accent-contrast: #ffffff;
}
```

---

## 🚫 Hard Prohibitions (Anti-Slop Motion Gate)
- **No arbitrary easing:** Never use `ease-in` for entering elements or uncontrolled linear motion.
- **No layout-thrashing animations:** Only animate `transform` and `opacity`. Never animate `width`, `height`, `margin`, or `top/left`.
- **No jitter / rubber-banding on scroll:** Use smooth interpolation or scrubbed triggers with proper cleanup.
- **Strict `prefers-reduced-motion` compliance:** Every animated component must provide an instant fallback:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```

---

## 📋 Interaction Thesis Reminder

Before implementing any animation, state the thesis:
1. **What does this motion communicate?** (Spatial orientation, hierarchy, feedback)
2. **Which timing tier does it belong to?** (`fast`, `normal`, `slow`, `scroll`)
3. **What is the reduced-motion fallback?**
Tokens without an interaction thesis are superficial decoration, not functional design.
