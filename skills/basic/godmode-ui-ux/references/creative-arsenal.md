# The Creative Arsenal (High-End Inspiration & Patterns)

Do not default to generic UI. Pull from this library of advanced concepts to ensure frontend output is visually striking, memorable, and craft-led.

## Engine Selection & Integration Rules
- **Default Motion Engine**: Default to **Framer Motion** for all standard UI and Bento grid component interactions.
- **Advanced Scrolltelling & Canvas**: When appropriate, leverage **GSAP (ScrollTrigger/Parallax)** for complex scrolltelling or **ThreeJS/WebGL** for 3D/Canvas animations.
- **Isolation Rule [CRITICAL]**: NEVER mix GSAP/ThreeJS with Framer Motion in the identical component tree. Use GSAP/ThreeJS EXCLUSIVELY for isolated full-page scrolltelling or canvas backgrounds, wrapped in strict `useEffect` cleanup blocks.

---

## 1. Standard Hero Paradigm
Stop doing centered text over a dark image. Try asymmetric Hero sections:
- Text cleanly aligned to the left or right.
- Background featuring a high-quality, relevant image with a subtle stylistic fade (darkening or lightening gracefully into the background color depending on Light or Dark mode).

---

## 2. Navigation & Menus
- **Mac OS Dock Magnification**: Nav-bar at the edge; icons scale fluidly on hover.
- **Magnetic Button**: Buttons that physically pull toward the mouse cursor.
- **Gooey Menu**: Sub-items detach from the main button like a viscous liquid.
- **Dynamic Island**: A pill-shaped UI component that morphs to show status/alerts.
- **Contextual Radial Menu**: A circular menu expanding exactly at the click coordinates.
- **Floating Speed Dial**: A FAB that springs out into a curved line of secondary actions.
- **Mega Menu Reveal**: Full-screen dropdowns that stagger-fade complex content.

---

## 3. Layout & Grids
- **Bento Grid**: Asymmetric, tile-based grouping (e.g., Apple Control Center).
- **Masonry Layout**: Staggered grid without fixed row heights (e.g., Pinterest).
- **Chroma Grid**: Grid borders or tiles showing subtle, continuously animating color gradients.
- **Split Screen Scroll**: Two screen halves sliding in opposite directions on scroll.
- **Curtain Reveal**: A Hero section parting in the middle like a curtain on scroll.

---

## 4. Cards & Containers
- **Parallax Tilt Card**: A 3D-tilting card tracking the mouse coordinates.
- **Spotlight Border Card**: Card borders that illuminate dynamically under the cursor.
- **Glassmorphism Panel**: True frosted glass with inner refraction borders (`border-white/10`, `shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`).
- **Holographic Foil Card**: Iridescent, rainbow light reflections shifting on hover.
- **Tinder Swipe Stack**: A physical stack of cards the user can swipe away.
- **Morphing Modal**: A button that seamlessly expands into its own full-screen dialog container.

---

## 5. Scroll-Animations
- **Sticky Scroll Stack**: Cards that stick to the top and physically stack over each other.
- **Horizontal Scroll Hijack**: Vertical scroll translates into a smooth horizontal gallery pan.
- **Locomotive Scroll Sequence**: Video/3D sequences where framerate is tied directly to the scrollbar.
- **Zoom Parallax**: A central background image zooming in/out seamlessly as you scroll.
- **Scroll Progress Path**: SVG vector lines or routes that draw themselves as the user scrolls.
- **Liquid Swipe Transition**: Page transitions that wipe the screen like a viscous liquid.

---

## 6. Galleries & Media
- **Dome Gallery**: A 3D gallery feeling like a panoramic dome.
- **Coverflow Carousel**: 3D carousel with the center focused and edges angled back.
- **Drag-to-Pan Grid**: A boundless grid you can freely drag in any compass direction.
- **Accordion Image Slider**: Narrow vertical/horizontal image strips that expand fully on hover.
- **Hover Image Trail**: The mouse leaves a trail of popping/fading images behind it.
- **Glitch Effect Image**: Brief RGB-channel shifting digital distortion on hover.

---

## 7. Typography & Text
- **Kinetic Marquee**: Endless text bands that reverse direction or speed up on scroll.
- **Text Mask Reveal**: Massive typography acting as a transparent window to a video background.
- **Text Scramble Effect**: Matrix-style character decoding on load or hover.
- **Circular Text Path**: Text curved along a spinning circular path.
- **Gradient Stroke Animation**: Outlined text with a gradient continuously running along the stroke.
- **Kinetic Typography Grid**: A grid of letters dodging or rotating away from the cursor.

---

## 8. Micro-Interactions & Effects
- **Particle Explosion Button**: CTAs that shatter into particles upon success.
- **Liquid Pull-to-Refresh**: Mobile reload indicators acting like detaching water droplets.
- **Skeleton Shimmer**: Shifting light reflections moving across placeholder boxes.
- **Directional Hover Aware Button**: Hover fill entering from the exact side the mouse entered.
- **Ripple Click Effect**: Visual waves rippling precisely from the click coordinates.
- **Animated SVG Line Drawing**: Vectors that draw their own contours in real-time.
- **Mesh Gradient Background**: Organic, lava-lamp-like animated color blobs.
- **Lens Blur Depth**: Dynamic focus blurring background UI layers to highlight a foreground action.
