# Motion Tokens & Physics Reference

This reference details the spring physics presets, Framer Motion patterns, and performance rules defined in BDB UI/UX Godmode.

---

## 1. Spring Physics Presets (Matching `design-tokens.json`)

Always preference physical spring dynamics over linear/fixed-duration easing for interactive elements.

```typescript
// Token spring configs (Framer Motion / React Spring)
export const MOTION_SPRINGS = {
  subtle: { type: "spring", stiffness: 300, damping: 30, mass: 1 },
  default: { type: "spring", stiffness: 100, damping: 20, mass: 1 },
  bouncy: { type: "spring", stiffness: 80, damping: 12, mass: 1 },
  heavy: { type: "spring", stiffness: 50, damping: 15, mass: 1 },
} as const;
```

---

## 2. CSS Transition Equivalents

When CSS transitions are required instead of JS physics engine:

```css
/* Smooth fluid curve mimicking subtle spring */
.transition-spring-subtle {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Bouncy overshoot curve */
.transition-spring-bouncy {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

---

## 3. Magnetic Hover (`useMotionValue` + `useTransform`)

**Performance Rule**: NEVER use React `useState` for magnetic hover or pointer tracking. Use Framer Motion's motion values outside the React render cycle.

```tsx
"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

export function MagneticButton({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Smooth springs for tracking
  const springX = useSpring(x, { stiffness: 150, damping: 15 });
  const springY = useSpring(y, { stiffness: 150, damping: 15 });

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set((e.clientX - centerX) * 0.35); // 35% pull intensity
    y.set((e.clientY - centerY) * 0.35);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      ref={ref}
      style={{ x: springX, y: springY }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="px-6 py-3 bg-zinc-900 text-white rounded-full transition-shadow hover:shadow-lg"
    >
      {children}
    </motion.button>
  );
}
```

---

## 4. Shared Element Transitions (`AnimatePresence` + `layoutId`)

Elements must expand fluidly from their origin point when expanding or switching active tabs.

```tsx
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const tabs = ["Overview", "Analytics", "Settings"];

export function TabSelector() {
  const [activeTab, setActiveTab] = useState(tabs[0]);

  return (
    <div className="flex gap-2 p-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className="relative px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
        >
          {activeTab === tab && (
            <motion.div
              layoutId="activeTabPill"
              className="absolute inset-0 bg-white dark:bg-zinc-900 rounded-lg shadow-sm"
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          )}
          <span className="relative z-10">{tab}</span>
        </button>
      ))}
    </div>
  );
}
```

---

## 5. Staggered Waterfall Reveals (`staggerChildren`)

**Requirement**: Parent and child variants must reside within the same Client Component tree.

```tsx
"use client";

import { motion } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 100, damping: 20 },
  },
};

export function StaggeredGrid({ items }: { items: { id: string; title: string }[] }) {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 md:grid-cols-3 gap-6"
    >
      {items.map((item) => (
        <motion.div
          key={item.id}
          variants={itemVariants}
          className="p-6 bg-white border border-slate-200/50 rounded-3xl shadow-sm"
        >
          <h3 className="text-lg font-semibold tracking-tight text-zinc-900">{item.title}</h3>
        </motion.div>
      ))}
    </motion.div>
  );
}
```
