# Anti-Slop Directive & Craftsmanship Gate

This authoritative reference details all forbidden patterns, AI clichés, and layout defects prohibited in frontend designs under `godmode-ui-ux`.

---

## 🧭 Brand Discovery Precedence Rules (STRICT HIERARCHY)
- **Brand Defined in `DESIGN.md`:** Color bans (Lila/Purple ban) and font bans (Inter ban) are **SUSPENDED**. Project-specific CI colors and typography take absolute precedence.
- **No Brand Defined:** ALL bans below (including color and font defaults) are **ACTIVE**.
- **Structural Anti-Slop:** Component, layout, mobile ergonomic, and copywriting anti-slop rules are **ALWAYS ACTIVE** regardless of brand.

---

## 1. Visual & CSS Tells

- [ ] **NO Neon or Outer Glows:** Never use default high-radius outer `box-shadow` halos. Use 1px inner borders (`border-white/10`) or subtle, background-tinted diffuse shadows.
- [ ] **NO Pure Black:** Never use `#000000`. Use Off-Black, Zinc-950, or Charcoal (`oklch(0.20 0.01 285)`).
- [ ] **NO Oversaturated Accents:** Desaturate accents to blend cleanly with neutrals (saturation < 80%).
- [ ] **NO AI Purple-Blue Default Mesh (Lila Ban):** *(Suspended when brand is defined)* Generic purple/blue SaaS gradient backgrounds are strictly BANNED as defaults. Use neutral bases (Zinc/Slate) with high-contrast singular accents.
- [ ] **NO Gradient Text for Body or Subheadings:** Text-fill gradients are banned for standard copy; reserve subtle shifts for hero accent words only.
- [ ] **NO Custom Mouse Cursors:** Custom cursor overlays break accessibility, lag on touch devices, and degrade performance.
- [ ] **NO Flat Design Without Depth:** Flat design requires visual hierarchy. Use multi-layered diffuse shadows or distinct tonal contrast.
- [ ] **NO Arbitrary Z-Index Spam:** Do not spam `z-50` or `z-10`. Use z-index exclusively for systemic layer contexts (navbars, modals, toasts, tooltips).

---

## 2. Typography Tells

- [ ] **NO Inter Font Default:** *(Suspended when brand is defined)* Inter as an unthinking default is BANNED. Select distinct typefaces: `Geist`, `Outfit`, `Cabinet Grotesk`, or `Satoshi`.
- [ ] **NO System Font Laziness:** Avoid unstyled system fonts (Arial, Roboto, standard system-ui) without explicit design intent.
- [ ] **NO Serif Fonts on B2B Dashboards:** Serif fonts are BANNED for dense data dashboards. Use high-performance Sans + Mono pairings (`Geist` + `Geist Mono` or `Satoshi` + `JetBrains Mono`).
- [ ] **NO Oversized H1s:** Primary headings must establish hierarchy with weight, tracking (`tracking-tighter`), and contrast, rather than overwhelming scale.

---

## 3. Layout & Mobile Ergonomics (R-03 / Craftsmanship)

- [ ] **NO Default Sidebar/Header Dashboards:** Do not build cookie-cutter sidebar layouts if the feature is better served as a command palette, focused panel, or single-column flow.
- [ ] **NO Centered Hero Sections (when Variance > 4):** Centered Hero/H1 sections are BANNED when `DESIGN_VARIANCE > 4`. Use asymmetric splits (60/40), left-aligned type with right-aligned visual assets, or disciplined whitespace.
- [ ] **NO 3-Column Equal Card Layouts:** The generic "3 equal cards horizontally" feature row is BANNED. Use bento grids, 2-column zig-zag, or asymmetric horizontal flows.
- [ ] **NO Arbitrary Border-Radius Mixing:** Adhere strictly to the mathematical token scale (`sm: 6px`, `md: 12px`, `lg: 16px`, `xl: 24px`, `2xl: 40px`, `full: 9999px`).
- [ ] **NO Card Overuse in High Density:** For `VISUAL_DENSITY > 7`, generic card wrappers are BANNED. Group content via structural dividers (`divide-y`, `border-t`) or pure whitespace.
- [ ] **NO Viewport Instability (`h-screen`):** NEVER use `h-screen` for full-height sections. ALWAYS use `min-h-[100dvh]` to prevent viewport jumping on mobile browsers (iOS Safari).
- [ ] **NO Sub-44px Touch Targets:** On touch devices, every button, link, and interactive icon must have a minimum interactive hit area of `44x44px` (`min-h-[44px] min-w-[44px]`).
- [ ] **NO Fragile Flex-Math:** NEVER use fragile percentage math (`w-[calc(33%-1rem)]`). ALWAYS use CSS Grid (`grid grid-cols-1 md:grid-cols-3 gap-6`).

---

## 4. Copywriting & Content Integrity (R-02 / No AI Fluff)

- [ ] **NO AI Copywriting Clichés:** The following buzzwords are strictly BANNED:
  *"Elevate", "Seamless", "Unleash", "Next-Gen", "Tailored", "Empower", "Revolutionize", "Frictionless", "Supercharge", "Game-changer".*
  Write plain, clear, concrete, human language.
- [ ] **NO Generic Placeholder Personas:** "John Doe", "Jane Doe", "Sarah Chan", and "Jack Su" are BANNED. Use realistic, domain-specific names.
- [ ] **NO Cliché Startup Names:** "Acme", "Nexus", "SmartFlow", "TechCorp". Use authentic, contextual brand naming.
- [ ] **NO Fake Statistics:** "99.9% customer satisfaction", "Loved by 10,000+ teams" without real context or evidence are BANNED.

---

## 5. UI Completeness & Accessibility (R-25, R-27, R-32)

- [ ] **Full UI State Handling:** Every data component must explicitly implement:
  1. **Loading State:** Skeleton loader (not generic spinning wheels).
  2. **Empty State:** Helpful zero-data message with a clear call-to-action.
  3. **Error State:** Human-readable error message with recovery/retry option.
  4. **Success State:** Clear feedback upon action completion.
- [ ] **Contrast Compliance:** Text must satisfy WCAG AA contrast (minimum `4.5:1` for normal body text, `3:1` for large text).
- [ ] **Keyboard Accessibility:** Every interactive element must display visible, accessible focus indicators (`focus-visible:ring-2 focus-visible:ring-offset-2`).
