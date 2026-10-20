---
name: bdb-ui-library
category: design-ui-ux
description: >-
  Component and motion-icon lookup for UI work. In BDB projects routes to the BDB motion library first. Use when building UI, motion icons or loaders.
---

# bdb-ui-library

BDB component and motion-icon library. In BDB projects it is the first source for UI building blocks, before anything is built from scratch. Outside BDB projects the same lookup order applies, using the original sources listed in the bdb-ui-library repository docs.

## Lookup order (strict)

1. **Own items:** read `registry.json` (items) and `llms.txt` (install, item table, conventions) from the library repo or the installed package (`@hybridlabor-api/ui-motion-library`; in the BDB workspace: `~/dev/bdb-dev/bdb-ui-library/`). If an `@bdb` item fits, install it, do not rebuild it. Install: `npx shadcn@latest add @bdb/{name}` (registry in the consumer's `components.json`; template: `templates/components.json`).
2. **Reference registries with a verified endpoint**, in `components.json` order, only for items whose endpoint was verified (see the source list in the bdb-ui-library repository docs). Install via registry. Currently `@magicui` (`marquee` verified) and `@watermelon`. Skip `@aceternity` (401) and `@cultui` (404) until an endpoint is verified.
3. **Other entries in the source list** (`@spaceui`, `@componentry`, Skiper UI, 21st.dev, React Aria, Tremor, Hairline, Kojima; listed in the bdb-ui-library repository docs): documentation and inspiration links only. Never install from them without a verified endpoint, never copy code.
4. **Only then build.** Follow the library conventions (DTCG tokens, reduced motion, a11y) so the result can be added as an item later. Use the project's own tokens; never impose BDB colours or look on a project.

## Install paths

- shadcn registry: `npx shadcn@latest add @bdb/knob` (namespace `@bdb`)
- npm: `npm install @hybridlabor-api/ui-motion-library`
- Agent-native: read the item JSON directly, e.g. `registry/knob.json` in the library repo

## Conventions

New items must meet the intake checklist (repo README): DTCG-tokens-only styling, dark/light via `tokens.css`, `prefers-reduced-motion` guard, a11y primitives (Base UI/Radix), evidence screenshot (`scripts/evidence.mjs`), `scripts/registry-validate.mjs` exit 0.

Style references: observe yes, copy code no; always write code fresh. Componentry is MIT (reference). Space UI (`@spaceui`) has no verified licence or endpoint (see the bdb-ui-library repository docs). `ui-experiments` is NO-REDISTRIBUTION (strict).

## Paths (BDB workspace)

- Library: `~/dev/bdb-dev/bdb-ui-library/`
- Registry index: `registry.json`
- Conventions/checklist: `README.md`
