# Brand Discovery Framework & DESIGN.md Template

The Brand Discovery phase is **Step 0 (Mandatory)** before initiating any frontend design or coding work in the BDB ecosystem.

Never assume brand colors, typography, or visual direction. Always ask the customer or inspect the workspace for existing design system files.

---

## 1. The 5 Discovery Questions

When initiating a frontend project, present these 5 questions to the customer:

1. **Brand Assets**: "Do you have existing brand assets? (Logo, CI guidelines, styleguide, screenshots)"
2. **Brand Colors**: "What are your brand colors? (Hex, OKLCH, RGB, or general description)"
3. **Typography**: "Do you use specific corporate or product fonts?"
4. **Visual References**: "Are there any websites, apps, or design products whose look and feel you admire?"
5. **Aesthetic Direction**: "Should the interface feel minimalist, playful, luxurious, brutalist, technical, or industrial?"

---

## 2. Anti-Slop Adaptation Logic

The system dynamically adapts anti-slop rules depending on whether brand parameters are defined:

| Discovery Status | Color Bans (Lila Ban, default gradients) | Font Bans (Inter ban, etc.) | Pattern Anti-Slop (No emojis, no card overuse, min-h-[100dvh], etc.) |
| :--- | :--- | :--- | :--- |
| **Brand Defined** | **SUSPENDED** (Honor customer colors) | **SUSPENDED** (Honor customer fonts) | **ALWAYS ACTIVE** |
| **No Brand Defined** | **ACTIVE** (Use `design-tokens.json`) | **ACTIVE** (Geist/Satoshi default) | **ALWAYS ACTIVE** |

---

## 3. Project DESIGN.md Template

Save this file as `DESIGN.md` in the project root after discovery completion.

```markdown
# Project Design System (DESIGN.md)

## 1. Brand Identity & Vision
- **Brand Name**: [Name]
- **Aesthetic Stance**: [e.g., Luxury Minimal, Technical Cockpit, Editorial Brutalism]
- **Target Emotion**: [e.g., High precision, calm efficiency, premium luxury]
- **Differentiation Anchor**: [Single memorable signature element]

## 2. Color System (OKLCH Perceptual Scale)
- **Primary**: oklch(...)
- **Primary Accent**: oklch(...)
- **Secondary Neutral**: oklch(...)
- **Surface (Background)**: oklch(...)
- **Surface Elevated**: oklch(...)
- **Text Primary**: oklch(...)
- **Text Muted**: oklch(...)

## 3. Typography Stack
- **Display / Headings**: [Font Name], system-ui, sans-serif
- **Body Text**: [Font Name], system-ui, sans-serif
- **Monospace / Technical**: [Font Name], monospace
- **Scale Ratio**: 1.25 (Major Third)
- **Line Heights**: Headings (1.1), Body (1.5), Microcopy (1.75)

## 4. Layout & Spacing Configuration
- **Base Grid**: 8pt grid (4, 8, 12, 16, 24, 32, 48, 64, 96)
- **Design Variance (1-10)**: [e.g., 7]
- **Motion Intensity (1-10)**: [e.g., 6]
- **Visual Density (1-10)**: [e.g., 4]

## 5. Motion & Physics Profile
- **Primary Spring Preset**: default ({ stiffness: 100, damping: 20 })
- **Perpetual Motion**: Isolated Client Components only
- **Page Transitions**: Shared Element LayoutId + Spring Physics

## 6. Brand Constraints & Active Rules
- **Suspended Bans**: [List any suspended bans due to explicit brand definition]
- **Enforced Rules**:
  - No emoji icons (Phosphor / Radix SVG only)
  - No default sidebar/header dashboards
  - min-h-[100dvh] viewport stability
  - WCAG 2.1 AA contrast compliance
```
