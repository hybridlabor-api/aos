---
name: godmode-ui-ux
description: "Design lead for frontend: brand discovery, Anti-Slop, DTCG tokens, fluid motion, data-driven design."
category: design-ui-ux
---

# UI/UX Godmode

This skill is the single source of truth for all design decisions. It replaces: design-taste-frontend, frontend-design.

**Routing:** Component lookup order: the project's own design system and sources file first (its components, tokens, `DESIGN.md`); the BDB library (`@bdb` registry; version-pinned unpkg entry `https://unpkg.com/@hybridlabor-api/ui-motion-library@0.1.0/publish/registry/{name}.json` in `components.json`) only when the project opts in; then the verified registries listed in the UI library's `docs/sources.md` (link-only entries are documentation links, never code sources).

## -1. Design Source Discovery (MANDATORY FIRST STEP)

Look for the project's own design source first: design-tokens.json, tokens.css, the tailwind theme, brand.md or DESIGN.md. Use it if found. If none exists, ask the user; otherwise start from the neutral defaults in design-tokens.json.

## 0. Brand Discovery (MANDATORY FIRST STEP)

Before ANY design work, gather project context. Never assume colors, fonts, or visual direction.

### Discovery Checklist:
1. Ask: "Do you have existing brand assets? (Logo, CI guideline, Styleguide, screenshots)"
2. Ask: "What are your brand colors? (Hex, oklch, or description)"
3. Ask: "Do you use specific fonts?"
4. Ask: "Any websites/apps whose look you admire?"
5. Ask: "Should it feel minimalist, playful, luxurious, or technical?"

### Output: Project DESIGN.md
Generate a project-specific DESIGN.md containing:
- Primary/Secondary/Accent colors (oklch)
- Font stack
- Spacing preference
- Motion intensity (1-10)
- Visual density (1-10)
- Design variance (1-10)
- Brand constraints and things to avoid

### Anti-Slop Context Logic:
- IF brand colors defined → Color bans (Lila Ban, etc.) = SUSPENDED
- IF brand fonts defined → Font bans (Inter Ban, etc.) = SUSPENDED  
- Pattern-level Anti-Slop (no generic dashboards, no emojis, no card overuse) = ALWAYS ACTIVE
- IF no brand defined → Select ONE aesthetic archetype from `references/taste-archetypes.md` (Utilitarian Minimalist, Industrial Brutalist, High-End Tactile, Ethereal Modern) + all Anti-Slop bans ACTIVE

## 1. Anti-Slop Directive

These pattern rules are ALWAYS active regardless of brand:
- No default sidebar/header dashboard layouts unless explicitly requested
- No emoji icons — use Phosphor, Radix, or Lucide SVG only
- No arbitrary border-radius mixing (follow token scale)
- No flat design without hierarchy — use multi-layered diffuse shadows
- No centered hero sections when design variance > 4
- No 3-column equal card grids
- No generic names ("John Doe", "Acme") in mockups
- No filler words ("Elevate", "Seamless", "Next-Gen")
- No broken Unsplash links — use picsum.photos or SVG avatars

Color/Font bans (ONLY when no brand is defined):
- No AI Purple/Blue gradient aesthetic as default
- No Inter font — use Geist, Outfit, Cabinet Grotesk, or Satoshi
- No oversaturated accent colors (saturation < 80%)

Full ban reference: → references/anti-slop-rules.md

## 2. Design Tokens (Machine-Readable)

All design values MUST come from design-tokens.json (DTCG format).
- Color: oklch() for perceptual uniformity
- Spacing: 8pt grid (4, 8, 12, 16, 24, 32, 48, 64, 96)
- Typography: Modular scale (Major Third 1.25)
- Motion: Spring physics presets (subtle, default, bouncy)
- Radius: Nested mathematical scale (6, 12, 16, 24, 40)

Never guess spacing values. Never use arbitrary hex colors.

## 3. Motion & Physics

- Use spring physics (stiffness/damping/mass), not fixed-duration ease-in-out
- Animations must be interruptible (reverse from current state, don't snap)
- Elements expand from origin point (Shared Element Transitions)
- Use useMotionValue/useTransform for continuous tracking (NOT useState)
- Perpetual animations must be React.memo'd in isolated Client Components
- Stagger children for list/grid reveals
- Never animate top/left/width/height — only transform + opacity
- Grain/noise filters on fixed pointer-events-none layers only

Spring presets: → design-tokens.json > motion
Creative arsenal: → references/creative-arsenal.md
Bento paradigm: → references/bento-paradigm.md

## 4. Enterprise Density & Accessibility

- WCAG 2.1 AA: contrast ratio ≥ 4.5:1 for normal text
- Keyboard: all interactive elements reachable via Tab, executable via Enter/Space
- Focus: visible focus-visible:ring-2 ring-offset-2 states
- High-density B2B: tabular-nums, right-aligned numbers, compact padding
- Touch targets: minimum 44x44px
- prefers-reduced-motion: disable perpetual animations
- min-h-[100dvh] instead of h-screen (iOS Safari fix)

## 5. Verification Gate (Mandatory before Code Output)

Silently validate ALL code against this before presenting to user:

### Brand
- [ ] Brand Discovery completed or user declined?
- [ ] Colors from DESIGN.md or design-tokens.json defaults?
- [ ] No hardcoded hex values outside token system?

### Anti-Slop
- [ ] No forbidden pattern from §1?
- [ ] No emoji icons?

### Motion
- [ ] Springs for interactive elements?
- [ ] Perpetual animations in isolated Client Components?

### Accessibility
- [ ] Contrast ≥ 4.5:1?
- [ ] Keyboard navigable?
- [ ] Focus states visible?
- [ ] prefers-reduced-motion respected?

### States
- [ ] Loading (skeleton, not spinner)?
- [ ] Empty (friendly + next action)?
- [ ] Error (recovery path)?

## 6. Harness Integration

- Cursor: injected via .cursor/rules/godmode-ui-ux.mdc
- Claude Code: reads via CLAUDE.md
- Antigravity: natively enforced
- MediaStorm: extends to TouchDesigner/Unreal operator panels via /bdbmediastorm


## Overview
Master orchestration skill for UI/UX design, enforcing high-agency design taste and system consistency.

## When to Use
- Triggered when acting as the primary design authority on a frontend project.
- Exclude when performing pure backend or DevOps tasks.

## Core Process
1. Analyze the requested UI against project `DESIGN.md` and Anti-Slop guidelines.
2. Ensure all spacing and colors utilize DTCG design tokens.
3. Implement explicit loading, error, and empty states.
4. Apply fluid motion physics for interactions.

## Common Rationalizations
| Rationalization | Reality |
|---|---|
| I'll just add this one CSS override to make it fit. | Violates design tokens and creates inconsistent UI; use the designated token. |
| We don't need a loading state here, it's fast. | Network latency varies; missing feedback states cause perceived unresponsiveness. |
| I'll skip the dark mode check since the primary brand is light. | Incomplete dark mode breaks the app for users relying on system preferences. |

## Red Flags
- Hardcoded hex colors or arbitrary pixel values in new components.
- Absence of loading/error states in newly implemented features.
- Ignoring motion physics and using linear CSS transitions.

## Verification
- [ ] All spacing and colors use DTCG design tokens.
- [ ] Loading and error states are explicitly handled.
- [ ] Motion transitions follow the fluid motion physics guidelines.


---

## Web design Pack Skills

<!-- aos:pack-index:start -->
- **bdbdesignpro** — "Use when choosing an animation engine, defining motion tokens, adding scroll effects or micro-interactions, or auditing motion for accessibility and performance. Covers engine selection (GSAP, Motion.dev, Anime.js, React-Spring, Three.js, CSS Native), DTCG motion tokens, and the anti-slop/a11y quality gate."
- **bdb-ui-library** — Use when building UI, components, motion icons, loaders, or visual design. In BDB projects, routes to the BDB component and motion-icon library (npm @hybridlabor-api/ui-motion-library, shadcn namespace @bdb) as the first source before third-party registries or building from scratch. Outside BDB projects, the same lookup order applies with the original sources listed in the bdb-ui-library repository docs.
- **editable-design** — Create and render fixed-canvas editable visual designs, including posters, marketing graphics, covers, menus, banners, and social cards. Default outputs include fixed and editable HTML, PNG, a mouse editor with scan and exploded layer views, and an evidence-backed Design Replay. Do not use for websites, slide decks, videos, or standalone logo systems. Always use this skill when the project contains `poster.json`.
- **bdb-visual-edit** — Use when `aos-plan-canvas await` returns an item with route "visual-edit", or the human points at an element in a running local dev app and wants the source edited. Finds the source with a deterministic search, posts a diff plan in the canvas, and edits one file only after a yes given in the canvas. Not for remote or production sites.
- **senior-frontend** — "Use when building React components, optimizing Next.js performance, implementing accessibility, or reviewing frontend code quality for modern web applications."
- **shadcn** — "Use when adding, customizing, or troubleshooting shadcn/ui components to build modern, accessible design systems."
- **tailwind-patterns** — "Use when styling components with Tailwind CSS v4, managing CSS-first configurations, writing container queries, or implementing design token architecture."
- **react-best-practices** — "Comprehensive performance optimization guide for React and Next.js applications, maintained by Vercel. Use when writing new React components or Next.js pages, implementing data fetching (client or server-side), or reviewing code for performance issues."
- **nextjs-best-practices** — "Next.js App Router principles. Server Components, data fetching, routing patterns."
- **landing-page-generator** — "Generates high-converting Next.js/React landing pages with Tailwind CSS. Uses PAS, AIDA, and BAB frameworks for optimized copy/components (Heroes, Features, Pricing). Focuses on Core Web Vitals/SEO."
- **web-artifacts-builder** — "To build powerful frontend claude.ai artifacts, follow these steps:"
- **web-performance-optimization** — "Optimize website and web application performance including loading speed, Core Web Vitals, bundle size, caching strategies, and runtime performance"
- **wcag-audit-patterns** — "Comprehensive guide to auditing web content against WCAG 2.2 guidelines with actionable remediation strategies."
- **ux-persuasion-engineer** — "Behavioral UX specialist applying choice architecture, friction audits, and commitment design to guide users toward intended actions without coercion. Use when optimizing conversion flows, onboarding, or checkout UX."
- **seo** — "Run a broad SEO audit across technical SEO, on-page SEO, schema, sitemaps, content quality, AI search readiness, and GEO. Use as the umbrella skill when the user asks for a full SEO analysis or strategy."
- **seo-audit** — Diagnose and audit SEO issues affecting crawlability, indexation, rankings, and organic performance.
- **schema-markup** — Design, validate, and optimize schema.org structured data for eligibility, correctness, and measurable SEO impact.
- **geo-fundamentals** — "Generative Engine Optimization for AI search engines (ChatGPT, Claude, Perplexity)."
- **programmatic-seo** — Design and evaluate programmatic SEO strategies for creating SEO-driven pages at scale using templates and structured data.
- **copywriting** — Write rigorous, conversion-focused marketing copy for landing pages and emails. Enforces brief confirmation and strict no-fabrication rules.

**Install:** `aos store install --pack web-design`
<!-- aos:pack-index:end --><!-- aos:pack-index:end -->
