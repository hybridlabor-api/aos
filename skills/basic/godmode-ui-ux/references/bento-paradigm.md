# Bento 2.0 Motion-Engine Paradigm

When generating SaaS dashboards, feature grids, or complex data interfaces, adhere strictly to this "Bento 2.0" architecture and perpetual motion philosophy ("Vercel-core meets Dribbble-clean").

---

## 1. Core Design Philosophy

- **Aesthetic**: High-end, minimal, clean, and functional.
- **Palette**: Page background in `#f9fafb`. Cards are pure white (`#ffffff`) with a 1px subtle border of `border-slate-200/50`.
- **Surfaces**: Use `rounded-[2.5rem]` for all major containers. Apply a "diffusion shadow" (`shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)]`) to create depth without visual clutter.
- **Typography**: Strict `Geist`, `Satoshi`, or `Cabinet Grotesk` font stack. Use subtle tracking (`tracking-tight`) for headers.
- **External Labels**: Titles and descriptions must be placed **outside and below** the cards to maintain a clean, gallery-style presentation.
- **Pixel-Perfection**: Use generous `p-8` or `p-10` padding inside cards.

---

## 2. Animation Engine Specs (Perpetual Motion)

All cards must contain **Perpetual Micro-Interactions** using these Framer Motion principles:
- **Spring Physics**: No linear easing. Use `type: "spring", stiffness: 100, damping: 20` for a premium, tactile feel.
- **Layout Transitions**: Heavily utilize `layout` and `layoutId` props for smooth re-ordering, resizing, and shared element state transitions.
- **Infinite Loops**: Every card must have an "Active State" that loops infinitely (Pulse, Typewriter, Float, Carousel) to ensure the interface feels alive.
- **Performance Isolation [CRITICAL]**: Any perpetual motion or infinite loop MUST be memoized (`React.memo`) and completely isolated in its own microscopic Client Component (`'use client'`). Never trigger re-renders in the parent layout.
- **AnimatePresence**: Wrap dynamic lists in `<AnimatePresence>` and optimize for 60fps.

---

## 3. The 5 Card Archetypes & Micro-Animation Specs

Implement these specific micro-animations when constructing Bento grids (e.g. Row 1: 3 columns | Row 2: 2 columns split 70/30):

### 1. The Intelligent List
- **Concept**: A vertical stack of items with an infinite auto-sorting loop.
- **Animation**: Items swap positions continuously using `layoutId`, simulating an AI agent prioritizing tasks in real-time.

### 2. The Command Input
- **Concept**: A search/AI prompt bar with a multi-step Typewriter Effect.
- **Animation**: Cycles through complex prompts including a blinking cursor and a "processing" state with a shimmering loading gradient.

### 3. The Live Status
- **Concept**: A scheduling/monitoring interface with breathing status indicators.
- **Animation**: Features a pop-up notification badge that emerges with an "Overshoot" spring effect (`stiffness: 120, damping: 10`), holds for 3 seconds, and gracefully vanishes.

### 4. The Wide Data Stream
- **Concept**: A horizontal stream of data cards or live metrics.
- **Animation**: Seamless infinite carousel loop (using `x: ["0%", "-100%"]`) with an effortless, steady velocity.

### 5. The Contextual UI (Focus Mode)
- **Concept**: A document/code view with active focus highlights.
- **Animation**: Animates a staggered text highlight across a block of content, followed by a "Float-in" of a contextual action toolbar featuring micro-icons.
