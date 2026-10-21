# AOS UI "Lanes" rules

One token file drives every AOS web UI: `lib/ui-tokens/aos-tokens.css` (AgentTrail, Hub, Store UI, Plan Canvas).
Skills that install on their own carry a byte-identical copy; `tests/ui-tokens-sync.test.mjs` fails on drift.
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
