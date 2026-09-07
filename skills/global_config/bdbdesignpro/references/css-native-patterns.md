# Modern CSS Native Animation Patterns

Patterns for **CSS Native Animation** — achieving fluid transitions, entry/exit animations, and scroll-driven effects with **0 KB JavaScript overhead** running directly on the browser compositor thread.

---

## 🚀 1. `@starting-style` (Zero-JS Entry Animations)

Allows animating discrete properties like `display: none` to `display: block` or native `<dialog>` and Popover elements without requiring JavaScript animation libraries.

```css
/* Dialog / Popover / Accordion Animation */
.modal-dialog {
  opacity: 1;
  transform: scale(1) translateY(0);
  transition: opacity 250ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 250ms cubic-bezier(0.16, 1, 0.3, 1),
              display 250ms allow-discrete,
              overlay 250ms allow-discrete;
}

/* State before entry into DOM */
@starting-style {
  .modal-dialog[open] {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }
}

/* Exit state when closed */
.modal-dialog:not([open]) {
  opacity: 0;
  transform: scale(0.95) translateY(10px);
}
```

---

## 📜 2. CSS Scroll-Driven Animations (`animation-timeline`)

Modern browsers support linking CSS keyframe animations directly to the scrollbar without any scroll event listeners.

```css
/* Progress Bar tied to document scroll */
@keyframes growProgress {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

.scroll-progress-bar {
  transform-origin: 0% 50%;
  animation: growProgress auto linear;
  animation-timeline: scroll(root block);
}

/* Reveal elements as they enter the viewport */
@keyframes revealCard {
  from {
    opacity: 0;
    transform: translateY(40px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.reveal-on-scroll {
  animation: revealCard auto linear both;
  animation-timeline: view();
  animation-range: entry 15% cover 35%;
}
```

---

## 🔀 3. View Transitions API

For seamless morphing between page navigations or state changes.

```typescript
export function switchThemeOrView(updateCallback: () => void) {
  if (!document.startViewTransition) {
    updateCallback();
    return;
  }

  document.startViewTransition(() => {
    updateCallback();
  });
}
```

```css
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 250ms;
  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## ♿ Reduced Motion (mandatory — see `antislop-gate.md`)

Every pattern above must have a zero-motion fallback. `@media` blocks compose safely, so wrap the animating rule, not the whole component:

```css
@media (prefers-reduced-motion: reduce) {
  .scroll-progress-bar,
  .reveal-on-scroll {
    animation: none;
  }
  .modal-dialog {
    transition: opacity 1ms; /* keep display/overlay logic, drop motion */
  }
}
```

For the View Transitions snippet, check the media query in JS before calling `startViewTransition` — the CSS block above only silences the keyframes, not the API call itself:

```typescript
export function switchThemeOrView(updateCallback: () => void) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce) {
    updateCallback();
    return;
  }
  document.startViewTransition(() => updateCallback());
}
```

## 🛡️ When to Use CSS Native
* Default to CSS Native for standard dropdowns, hover states, accordions, and dialog entries.
* Escalate to a heavier engine (see `engine-routing.md`) only when complex timeline orchestration, gesture velocity, or sub-pixel scroll pinning is required — that decision and its owning skill are documented there, not here.
