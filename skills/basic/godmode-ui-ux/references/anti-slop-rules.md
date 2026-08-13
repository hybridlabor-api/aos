# Anti-Slop Directive & AI Tells Reference

This authoritative reference details all forbidden patterns, AI clichés, and layout mistakes strictly prohibited in BDB frontend designs.

## Brand Discovery Context Rules
- **Brand Defined**: Color bans (Lila Ban, default blue/purple gradient bans) and font bans (Inter ban) are **SUSPENDED**.
- **No Brand Defined**: ALL bans below (including color and font bans) are **ACTIVE**.
- **Pattern Bans**: Layout, content, component, and interaction anti-slop rules are **ALWAYS ACTIVE** regardless of brand.

---

## 1. Visual & CSS Tells

- [ ] **NO Neon or Outer Glows**: Do not use default high-radius `box-shadow` glows or auto-glows. Use inner borders (`border-white/10`) or subtle, background-tinted diffuse shadows.
- [ ] **NO Pure Black**: Never use `#000000`. Use Off-Black, Zinc-950, or Charcoal (`oklch(0.20 0.01 285)`).
- [ ] **NO Oversaturated Accents**: Desaturate accents to blend elegantly with neutrals (saturation < 80%).
- [ ] **NO Lila / AI Purple-Blue Aesthetic (Lila Ban)**: *(Active only when no brand is defined)* The generic purple/blue SaaS gradient background aesthetic is strictly BANNED. No neon purple button glows, no default mesh backgrounds. Use neutral bases (Zinc/Slate) with high-contrast singular accents (Emerald, Electric Blue, Deep Rose).
- [ ] **NO Excessive Gradient Text**: Do not use text-fill gradients for large section headers or titles.
- [ ] **NO Custom Mouse Cursors**: Custom cursor overlays break accessibility, lag on mobile, and degrade performance.
- [ ] **NO Flat Design Without Hierarchy**: Flat design is not an excuse for missing visual hierarchy. Use multi-layered diffuse shadows tinted to background hues.
- [ ] **NO Arbitrary Z-Index Spam**: Do not spam `z-50` or `z-10`. Use z-index exclusively for systemic layer contexts (navbars, modals, toasts, tooltips).

---

## 2. Typography Tells

- [ ] **NO Inter Font Default**: *(Active only when no brand is defined)* Inter as a default font is BANNED. Force unique character using `Geist`, `Outfit`, `Cabinet Grotesk`, or `Satoshi`.
- [ ] **NO System Font Laziness**: Avoid unstyled system fonts (Arial, Roboto, standard system-ui) without explicit design intent.
- [ ] **NO Serif Fonts on Dashboards**: Serif fonts are strictly BANNED for Dashboard/B2B Software UIs. For these contexts, use exclusively high-end Sans-Serif + Mono pairings (`Geist` + `Geist Mono` or `Satoshi` + `JetBrains Mono`). Use Serif strictly for editorial or creative projects.
- [ ] **NO Oversized H1s**: The primary heading should not scream. Control hierarchy with weight, tracking (`tracking-tighter`), and color contrast, not just massive scale.

---

## 3. Layout & Structure Tells

- [ ] **NO Default Sidebar/Header Dashboards**: Do not build standard sidebar/header layouts if the feature is better served as a modal, command palette, or single-column focused view.
- [ ] **NO Centered Hero Sections (when Variance > 4)**: Centered Hero/H1 sections are strictly BANNED when `DESIGN_VARIANCE > 4`. Use split screen (50/50), left-aligned content with right-aligned asset, or asymmetric whitespace.
- [ ] **NO 3-Column Equal Card Layouts**: The generic "3 equal cards horizontally" feature row is BANNED. Use a 2-column zig-zag, asymmetric grid (e.g. 70/30), or horizontal scrolling approach instead.
- [ ] **NO Arbitrary Border-Radius Mixing**: Do not mix `rounded-md` and `rounded-2xl` randomly. Follow the mathematical token scale (`sm: 6px`, `md: 12px`, `lg: 16px`, `xl: 24px`, `2xl: 40px`, `full: 9999px`).
- [ ] **NO Card Overuse in High Density**: For `VISUAL_DENSITY > 7`, generic card containers are strictly BANNED. Use logical grouping via `border-t`, `divide-y`, or purely negative space.
- [ ] **NO Viewport Instability (`h-screen`)**: NEVER use `h-screen` for full-height hero sections. ALWAYS use `min-h-[100dvh]` to prevent layout jumping on mobile browsers (iOS Safari).
- [ ] **NO Fragile Flex-Math**: NEVER use complex flexbox percentage math (`w-[calc(33%-1rem)]`). ALWAYS use CSS Grid (`grid grid-cols-1 md:grid-cols-3 gap-6`).

---

## 4. Content, Copywriting & Data Tells (The "Jane Doe" Effect)

- [ ] **NO Generic Names**: "John Doe", "Jane Doe", "Sarah Chan", and "Jack Su" are BANNED. Use realistic, contextual names.
- [ ] **NO Startup Slop Brand Names**: "Acme", "Nexus", "SmartFlow", "TechCorp". Invent premium, contextually relevant brand names.
- [ ] **NO AI Copywriting Clichés**: Banned words: "Elevate", "Seamless", "Unleash", "Next-Gen", "Tailored", "Empower", "Revolutionize", "Frictionless". Use direct, concrete action verbs.
- [ ] **NO Fake / Predictable Numbers**: Avoid predictable demo values like `99.99%`, `50%`, or basic phone numbers (`1234567`). Use organic, messy data (`47.2%`, `+1 (312) 847-1928`).
- [ ] **NO Emoji Icons [CRITICAL]**: NEVER use emojis in code, markup, text content, or alt text. Replace all symbols with Phosphor, Radix, or Lucide SVG icons.

---

## 5. External Resources & Component Tells

- [ ] **NO Broken Unsplash Links**: Do not use raw Unsplash URLs. Use absolute, reliable placeholders (`https://picsum.photos/seed/{string}/800/600`) or SVG UI Avatars.
- [ ] **NO Uncustomized shadcn/ui**: You may use `shadcn/ui`, but NEVER in its generic default state. You MUST customize radii, colors, and shadows to match project tokens.
- [ ] **NO Missing Interactive Lifecycle States**: Every interactive component must provide:
  - **Loading State**: Skeletal loaders matching component dimensions (avoid generic circular spinners).
  - **Empty State**: Purposeful, helpful empty state indicating how to populate data.
  - **Error State**: Inline form/data error reporting with recovery paths.
  - **Tactile Feedback**: On `:active`, apply physical push simulation (`scale-[0.98]` or `-translate-y-[1px]`).
