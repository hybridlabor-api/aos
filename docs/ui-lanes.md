# AOS UI "Lanes" rules

One token file drives every AOS web UI: `lib/ui-tokens/aos-tokens.css` (AgentTrail, Hub, Store UI, Plan Canvas).
Skills that install on their own carry a byte-identical copy. `tests/ui-tokens-sync.test.mjs` fails on drift of the AgentTrail copy; `tests/ui-lanes-tokens.test.mjs` fails on drift of the AgentTrail and plan-builder copies.
Edit the source, then copy it over every copy.

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

| Theme | Lane | Token hex | Ratio vs reference surface |
|---|---|---|---|
| Light | 0 | `#7a2fc9` | 6.82:1 vs `#ffffff`, 5.86:1 vs `--aos-surface-2` |
| Light | 1 | `#0b5cad` | 6.67:1 vs `#ffffff`, 5.73:1 vs `--aos-surface-2` |
| Light | 2 | `#0a6e62` | 6.14:1 vs `#ffffff`, 5.27:1 vs `--aos-surface-2` |
| Light | 3 | `#7a5200` | 6.92:1 vs `#ffffff`, 5.94:1 vs `--aos-surface-2` |
| Light | 4 | `#b01e4c` | 6.70:1 vs `#ffffff`, 5.75:1 vs `--aos-surface-2` |
| Light | 5 | `#3f6b0a` | 6.33:1 vs `#ffffff`, 5.43:1 vs `--aos-surface-2` |
| Dark | 0 | `#c58cff` | 7.52:1 vs `--aos-surface` (`#141414`), 6.80:1 vs `--aos-surface-2` |
| Dark | 1 | `#6cb8ff` | 8.72:1 vs `--aos-surface`, 7.89:1 vs `--aos-surface-2` |
| Dark | 2 | `#4fd8c4` | 10.48:1 vs `--aos-surface`, 9.49:1 vs `--aos-surface-2` |
| Dark | 3 | `#e3c07a` | 10.60:1 vs `--aos-surface`, 9.60:1 vs `--aos-surface-2` |
| Dark | 4 | `#ff8fa8` | 8.55:1 vs `--aos-surface`, 7.74:1 vs `--aos-surface-2` |
| Dark | 5 | `#a9d96a` | 11.25:1 vs `--aos-surface`, 10.18:1 vs `--aos-surface-2` |

- Light lane 2 is 5.27:1 vs `--aos-surface-2`, below the 5.3:1 target set for the light lanes. It still clears 4.5:1, but it is the one value to revisit.
- Dark lane 0 is 7.52:1 vs `--aos-surface`, the tightest dark value.
- Status-pill tints (`--aos-status-*-bg`, `--aos-status-*-fg` on tint) are not yet measured.
