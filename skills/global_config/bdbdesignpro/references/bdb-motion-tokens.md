# BDB Motion Tokens

Brand-locked timing, easing, and color tokens for any animation built under `/bdbdesignpro`. Values are sourced from `~/dev/assets/bdb-brand/bdbagentOS/00_MASTER_BRANDING_SPEC.md` — if that spec changes, update here, not the other way around.

---

## ⏱️ Timing Scale

| Token | Value | Use for |
|---|---|---|
| `--duration-fast` | `150ms` | Micro-interactions: hover, click, toggle |
| `--duration-normal` | `300ms` | State transitions: dialogs, drawers, tabs |
| `--duration-slow` | `400ms` | Upper bound for any standard UI transition — see `antislop-gate.md` |
| Scroll-driven narrative | scrubbed to viewport delta, no fixed duration | Bind directly to scroll progress, not a timer |

## 🌊 Easing

```css
--ease-standard: cubic-bezier(0.16, 1, 0.3, 1);
--ease-spring: linear(0, 0.006, 0.025, 0.057, 0.1, 0.155, 0.22, 0.294, 0.375, 0.461,
  0.549, 0.637, 0.723, 0.803, 0.875, 0.936, 0.984, 1.018, 1.037, 1.042,
  1.035, 1.019, 0.999, 0.982, 0.971, 0.967, 0.97, 0.978, 0.989, 1);
```

## 🎨 Brand-Locked Palette (do not substitute)

```css
:root {
  --bdb-white: #FFFFFF;       /* primary fill, plates, typography */
  --bdb-obsidian: #0a0a0a;    /* dark UI background */
  --bdb-elevated: #141414;    /* elevated card surface */
  --bdb-panel: #1e1e1e;       /* structural body panel */
  --bdb-panel-alt: #2a2a2a;
  --bdb-accent: #9b30c4;      /* Vibrant Orchid — the ONLY accent color */
  --bdb-accent-shadow: #51116F; /* Deep Plum — accent depth/shadow only */
  --bdb-pill-interior: #180524; /* the one permitted purple-tinted surface */
}
```

### Hard prohibitions (from the master spec — enforce, do not soften)
- **No mint/cyan** highlight color, anywhere
- **No neon rainbow gradients** or per-module rainbow theming
- **No heartbeat lines**, no ambient glow/aura halos
- **No heavy blur / glassmorphism**
- Accent (`#9b30c4` / `#51116F`) may appear on rings, pills, borders, or a single highlight stroke — **never as the largest shape's fill.** The largest shapes render in black or white.

**Lint check before shipping any BDB-branded motion work:**
```bash
grep -inE "#?(06b6d4|22d3ee|2dd4bf|00ffff|cyan|mint)" path/to/file.css path/to/file.html
```
A hit is a blocking finding, not a style note — this is the exact defect found in `bdb-overview/index.html` (`--accent-cyan: #06b6d4`, zero occurrences of `#9b30c4`) during the 2026-09-05 audit.

---

## Interaction Thesis reminder

Before applying any token above, state the thesis per `SKILL.md` Phase 2: what does this motion communicate, which duration tier it falls in, and what the reduced-motion fallback is. Tokens without a thesis are decoration, not design.
