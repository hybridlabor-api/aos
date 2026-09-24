# Aesthetic Taste Archetypes Reference

Sourced from `taste-skill` and integrated into AOS `godmode-ui-ux`.
When Phase 0 Brand Discovery indicates no pre-existing client CI, the engineer or agent selects ONE of these archetypes rather than generating generic, uninspired AI layouts.

---

## 1. Utilitarian Minimalist & Editorial
**Best for:** Dev tools, documentation, knowledge bases, modern SaaS platforms, editorial publications.

- **Palette:** High-contrast warm monochrome. Off-white/cream backgrounds in light mode (`#fcfbf9`), charcoal/zinc in dark mode (`#121214`). Accents are muted pastels or single sharp contrast tones.
- **Typography:** Extreme typographic scale contrast. Heavy grotesque or geometric display headlines paired with disciplined, readable body copy (`Geist`, `Cabinet Grotesk`, `Satoshi`).
- **Layout:** Bento grids with deliberate asymmetric whitespace. Content-first hierarchy where type and negative space structure the page instead of visual noise.
- **Details:** Hairline 1px structural dividers (`border-zinc-200 dark:border-zinc-800`), flat cards without heavy drop-shadows, zero gradient text.

---

## 2. Industrial Brutalist & Tactical Telemetry
**Best for:** Analytics dashboards, developer consoles, hardware monitors, command-and-control interfaces.

- **Palette:** Deep dark telemetry (`#090a0f`) or Swiss industrial print off-white (`#f4f4f0`). Monochromatic substrate with high-alert accenting (International Klein Blue, Signal Amber, or Crimson Red).
- **Typography:** Heavy sans-serif display headers paired with monospaced data tables (`JetBrains Mono`, `Geist Mono`). Numbers and status indicators are oversized.
- **Layout:** Strict modular grids with visible gridlines (`divide-x divide-y`). High information density, metadata timestamps, technical framing brackets `[+]`, coordinate tags.
- **Details:** Crisp borders, zero rounded pill corners (`rounded-none` or `rounded-sm`), analog precision, functional status badges.

---

## 3. High-End Tactile / Soft Luxury
**Best for:** FinTech, consumer products, luxury e-commerce, portfolio showcases, premium creative tools.

- **Palette:** Deep OLED black / dark zinc (`#09090b`), soft muted surface elevations (`#141417`, `#1c1c21`). Warm neutral highlights.
- **Typography:** Refined, elegant sans-serif or modern editorial serifs for titles (`PP Editorial New`, `Outfit`, `Plus Jakarta Sans`). Tight tracking on headings (`tracking-tight`).
- **Layout:** Generous breathing room, floating detached navigation bars with subtle backdrop blur, asymmetric card sizing (e.g. 60/40 splits).
- **Details:** Ultra-diffuse layered shadows (`box-shadow: 0 20px 40px -15px rgba(0,0,0,0.5)`), 1px subtle top-border highlights (`border-t border-white/10`), haptic feedback on interactive elements.

---

## 4. Ethereal Clean Modern
**Best for:** AI applications, productivity suites, modern collaborative workspaces.

- **Palette:** Neutral slate/zinc foundation. Single high-energy accent token defined in OKLCH (`oklch(0.65 0.22 260)`).
- **Typography:** Clean geometric Grotesk with high legibility.
- **Layout:** Fluid responsive bento grid with dynamic card hierarchy, clear primary focal point.
- **Details:** Micro-interactions on hover, refined 12px/16px rounded corners, crisp accessibility-verified contrast ratios (> 4.5:1 for body text).

---

## 🔒 Enforcement Rule
Pick **ONE** archetype per project during Phase 0 Brand Discovery. Do not mix disparate styles within the same interface.
