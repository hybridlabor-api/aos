# AOS Header Banner — Regeneration Prompt

Reference for regenerating `assets/header-v4.jpg` (or its successor) via
Nano Banana / Gemini image generation on a future version bump. Update the
version string in the prompt and re-run rather than re-deriving the brand
rules from scratch.

## Brand constraints (from `~/dev/assets/bdb-brand/bdbagentOS/00_MASTER_BRANDING_SPEC.md`)

- Dominant colors: Obsidian Black (`#0a0a0a` / `#141414`) and Base White (`#FFFFFF`).
- Accent: Vibrant Orchid / Lila (`#9b30c4`) and Deep Plum (`#51116F`) — sparingly (rings, glow, gradient details), never the dominant fill.
- Strict prohibitions: no mint/cyan, no rainbow/multi-hue gradients, no heartbeat lines, no heavy glassmorphism/blur, no ambient glow halos.
- No personal names, studio names, or attribution baked into the image — product-level branding only.
- Target dimensions: 1376x768 (16:9-ish wide banner, matches GitHub README width).

## Working prompt (used for v4.0.0)

> A wide banner image, 1376x768, pure black background (#0a0a0a). On the
> left: the bold white wordmark "AOS" in a large, heavy sans-serif font,
> with a smaller white subtitle "BDB AGENT OS" beneath it, and below that
> a small rounded pill/badge containing the text "CORE KERNEL · AOS · v4.0.0"
> in white on a dark badge. On the right: an abstract network/graph made of
> glossy hexagonal nodes (mix of black and white hexagons, beveled/glossy
> material) connected by thin magenta/lila (#9b30c4) lines, with a subtle
> lila glow ring around some of the outer nodes. No other colors — strictly
> black, white, and the lila accent. No text other than what's specified.
> Clean, professional, high-contrast — not glassy/blurred, not a rainbow
> gradient.

## Notes for next regeneration

- Keep the wordmark + hexagon-network composition (echoes the dispatcher-
  graph architecture) unless the product story changes.
- Only the version string in the badge needs updating for a routine bump.
- Re-verify the output against the prohibitions above before committing —
  Nano Banana can drift toward its default glow/gradient aesthetic if the
  constraints aren't repeated explicitly.
