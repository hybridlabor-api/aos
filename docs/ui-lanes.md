# AOS UI "Lanes" rules

One token file drives every AOS web UI: `lib/ui-tokens/aos-tokens.css` (AgentTrail, Hub, Store UI, Plan Canvas).
Skills that install on their own carry a byte-identical copy. `tests/ui-tokens-sync.test.mjs` fails on drift of the AgentTrail copy; `tests/ui-lanes-tokens.test.mjs` fails on drift of the AgentTrail and plan-builder copies.
Edit the source, then copy it over every copy.

## Palette

- Dark: obsidian steps `--aos-bg` `#0a0a0a` (canvas floor), `--aos-surface` `#121212` (panels, rail), `--aos-surface-2` `#1a1a1b` (cards), `--aos-surface-3` `#242426` (raised, hover).
- Light: beige paper `--aos-bg` `#f1efe4`, `--aos-surface` `#f7f5ec`, `--aos-surface-2` `#ebe8db`, `--aos-surface-3` `#dbd8c9`; ink text `#04070f`.
- Accent is green (`oklch(0.72 0.17 145)` dark, deep `oklch(0.40 0.12 145)` light) for primary actions and focus outlines. Amber `--aos-warn` is attention (needs-you). Lila `--aos-highlight` is only a highlight: the focused-card ring and the one pulse-inner glow.

## Components

`aos-tokens.css` ships the shared Lanes classes, so each UI only maps its own markup onto them:
`.aos-card` (card with a lane top edge), `.aos-row` (rail row with a lane tick), `.aos-well` (recessed stream area), `.aos-kpi` / `.aos-meta` / `.aos-mono` (tabular numbers), `.aos-dotgrid` (canvas floor), and `[data-lane="0..5"]` to set `--lane`.
Motion classes: `.aos-enter` (M1 arrival, `--i` staggers by 60 ms), `.aos-flip` (M5 status flip), `.aos-line-in` (M9 stream line), `.aos-shimmer` (M7), `.aos-pulse-inner` (M8, one element per window).
Add a motion class when its data event happens (a new id, a changed status), never on every re-render.

## Lane colour = agent identity

- Tokens `--aos-lane-0..5` plus `--aos-lane-N-soft` (14% tint for hover or selected rows). Light and dark values differ.
- Assignment: `index = hash(agentId) mod 6`, with a stable string hash (for example FNV-1a). The same agent id keeps the same lane in every UI and across sessions. Never assign by arrival order.
- Use lane colour only as an accent: 2px card top edge, rail tick, tree dot, edge line, timeline segment. Never as a large fill or text on a coloured fill.

## Status pill

- Statuses: `running`, `done`, `needs-you`, `stopped`, `failed`. Tokens `--aos-status-<s>-fg|bg|border`.
- Anatomy: rounded-full pill, 1px border, 6px dot on the left, mono label, 14% tinted background. Markup: `<span class="aos-status" data-status="running">Running</span>`.
- Meaning: running = ok hue, done = info hue, needs-you = warn hue, stopped = muted, failed = bad hue.
- Needs-you is the only status whose dot breathes. Never show status as colour alone: the label text is always present.

## Timeline and handoff

- One lane per agent, segments in the agent's lane colour. Waiting is hatched; needs-you is hatched in the needs-you hue.
- A handoff is an elbow connector from the parent lane to the child lane, drawn in the parent's lane colour, 1.5px, with a 4px corner radius.

## Elevation, radius, spacing

- `--aos-shadow-card` for cards, `--aos-shadow-focus` for the focused card (soft ring plus shadow). No blur, no gradients on surfaces.
- Spacing steps `--aos-space-1..6` (4, 8, 12, 16, 24, 32px); radii `--aos-radius`, `--aos-radius-l`, `--aos-radius-pill`.

## Motion

- Durations by purpose: `--aos-motion-instant` (feedback), `--aos-motion-fast` (hover, toggles), `--aos-motion-enter` (spawn, rows arriving), `--aos-motion-settle` (handoff, status change; the ceiling for event motion), `--aos-motion-loop` (the one breathing loop).
- Easings: `--aos-ease-out` (default), `--aos-ease-pop` (badges, slight overshoot), `--aos-ease-camera` (pan and zoom).
- Motion is data: animate only in response to an event (spawn, token, handoff, status change). If nothing happens, nothing moves.
- At most 4 always-on loops per window. Animate transform and opacity only.
- Reduced motion: under `prefers-reduced-motion: reduce` all `--aos-motion-*` durations are `0ms` and animations and transitions are disabled. Data still updates; only movement stops.

## Contrast

- Text and status labels must meet WCAG AA: 4.5:1 for body text, 3:1 for large text and UI borders, in both themes, on `--aos-surface` and `--aos-surface-2`.
- A new lane or status colour is only added with its measured light and dark ratios.

### Measured lane contrast (WCAG relative luminance, computed from the token hex values)

Lane colours are accents (edge, tick, dot), so the bar is the 3:1 UI-element minimum plus the ratios below.

| Theme | Lane | Token hex | vs `--aos-surface` | vs `--aos-surface-2` |
|---|---|---|---|---|
| Light | 0 | `#7a2fc9` | 6.25:1 (`#f7f5ec`) | 5.56:1 (`#ebe8db`) |
| Light | 1 | `#0b5cad` | 6.11:1 | 5.43:1 |
| Light | 2 | `#0a6e62` | 5.62:1 | 5.00:1 |
| Light | 3 | `#7a5200` | 6.34:1 | 5.63:1 |
| Light | 4 | `#b01e4c` | 6.13:1 | 5.45:1 |
| Light | 5 | `#3f6b0a` | 5.79:1 | 5.15:1 |
| Dark | 0 | `#c58cff` | 7.64:1 (`#121212`) | 7.10:1 (`#1a1a1b`) |
| Dark | 1 | `#6cb8ff` | 8.87:1 | 8.23:1 |
| Dark | 2 | `#4fd8c4` | 10.66:1 | 9.90:1 |
| Dark | 3 | `#e3c07a` | 10.78:1 | 10.01:1 |
| Dark | 4 | `#ff8fa8` | 8.69:1 | 8.07:1 |
| Dark | 5 | `#a9d96a` | 11.44:1 | 10.62:1 |

- Light lane 2 is 5.00:1 vs `--aos-surface-2`, the tightest value; it still clears 4.5:1.
- Accent and text: dark accent `#54bf5c` is 8.01:1 on `--aos-surface`; light accent `#095717` is 7.16:1 on `--aos-surface-2`; `--aos-faint` is 5.21:1 (dark, on `--aos-surface`).

### Measured status label contrast (label on its 14% tint over the surface)

| Status | Light fg | on tint over `--aos-surface` / `--aos-surface-2` | Dark fg | on tint over `--aos-surface` / `--aos-surface-2` |
|---|---|---|---|---|
| running | `#08592f` | 6.19:1 / 5.54:1 | `#5fe0a0` | 8.53:1 / 7.74:1 |
| done | `#0a4f94` | 6.00:1 / 5.37:1 | `#6cb8ff` | 6.97:1 / 6.34:1 |
| needs-you | `#734400` | 6.04:1 / 5.42:1 | `#e5ac4c` | 7.20:1 / 6.54:1 |
| stopped | `#484d58` | 6.25:1 / 5.61:1 | `#a4a6aa` | 6.15:1 / 5.60:1 |
| failed | `#941026` | 6.31:1 / 5.65:1 | `#ff6b7a` | 5.64:1 / 5.16:1 |

The light `--aos-ok`, `--aos-info`, `--aos-warn` and `--aos-bad` were darkened for this. The earlier values (`#0a6b3c`, `#0b5cad`, `#8a5200`, `#c0182f`) fell to 4.0–4.4:1 on the tint.

### Form field and chip borders

`--aos-border-strong` borders inputs, selects, textareas and filter chips (WCAG 1.4.11, 3:1). Dark `#77797e`: 4.54:1 on `--aos-bg`, 4.30:1 on `--aos-surface`, 3.99:1 on `--aos-surface-2`. Light `#7c7866`: 3.84:1 on `--aos-bg`, 4.06:1 on `--aos-surface`, 3.61:1 on `--aos-surface-2`. `--aos-border` and `--aos-line` stay decorative (card and row separators only).
