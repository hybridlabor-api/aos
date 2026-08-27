---
name: ui-component
description: "Use when generating a new UI component that follows StyleSeed Toss conventions for structure, tokens, accessibility, and ergonomics."
category: design-ui-ux
risk: safe
source: community
source_repo: bitjaru/styleseed
source_type: community
date_added: "2026-04-08"
author: bitjaru
tags: [ui, components, design-system, frontend, styleseed]
tools: [claude, cursor, codex, gemini]
---

# UI Component

## Overview

Part of [StyleSeed](https://github.com/bitjaru/styleseed), this skill generates components that respect the Toss seed's design language instead of improvising ad hoc markup and styling. It emphasizes semantic tokens, predictable typing, reusable variants, and mobile-friendly accessibility defaults.

## When to Use
- Use when you need a new UI primitive or composed component inside a StyleSeed-based project
- Use when you want a component to match the existing Toss seed conventions
- Use when a component should be reusable, typed, and design-token driven
- Use when the AI might otherwise invent spacing, colors, or interaction patterns

## How It Works

### Step 1: Read the Local Design Context

Before generating code, inspect the seed's source of truth:
- `CLAUDE.md` for conventions
- `css/theme.css` for semantic tokens
- at least one representative component from `components/ui/`

If the user already has a better local example, follow the local codebase over a generic template.

### Step 2: Choose the Correct Home

Place the output where it belongs:
- `src/components/ui/` for primitives and low-level building blocks
- `src/components/patterns/` for composed sections or multi-part patterns

Do not create a new primitive if an existing one can be extended safely.

### Step 3: Follow the Structural Rules

Use these defaults unless the host project strongly disagrees:
- function declaration instead of a `const` component
- `React.ComponentProps<>` or equivalent native prop typing
- `className` passthrough support
- `cn()` or the project's standard class merger
- `data-slot` for component identification
- CVA or equivalent only when variants are genuinely needed

### Step 4: Use Semantic Tokens Only

Do not hardcode visual values if the design system has a token for them.

Preferred examples:
- `bg-card`
- `text-foreground`
- `text-muted-foreground`
- `border-border`
- `shadow-[var(--shadow-card)]`

### Step 5: Preserve StyleSeed Typography and Spacing

- Use the scale already defined by the seed
- Prefer multiples of 6px
- Use logical spacing utilities where supported
- Keep display and heading text tight, body text readable, captions restrained

### Step 6: Bake in Accessibility

- Touch targets should be at least 44x44px for interactive elements
- Keyboard focus must be visible
- Pass through `aria-*` attributes where appropriate
- Respect reduced-motion preferences for nonessential motion

## Output

Provide:
1. The generated component
2. The target path
3. Any required imports or dependencies
4. Notes on variants, tokens, or follow-up integration work

## Best Practices

- Compose from existing primitives before inventing new ones
- Keep the component API small and predictable
- Prefer semantic layout classes over arbitrary values
- Export named components unless the host project uses another standard consistently

## Additional Resources

- [StyleSeed repository](https://github.com/bitjaru/styleseed)
- [Source skill](https://github.com/bitjaru/styleseed/blob/main/seeds/toss/.claude/skills/ui-component/SKILL.md)

## Limitations
- Use this skill only when the task clearly matches the scope described above.
- Do not treat the output as a substitute for environment-specific validation, testing, or expert review.
- Stop and ask for clarification if required inputs, permissions, safety boundaries, or success criteria are missing.


## Core Process
1. Analyze the component requirements and verify it doesn't already exist.
2. Scaffold the component using StyleSeed spacing, typography, and color tokens.
3. Implement all interactive states (hover, focus, active, disabled).
4. Test the component mobile-first to ensure touch target sizes are adequate.

## Common Rationalizations
| Rationalization | Reality |
|---|---|
| I'll just copy this component from another project. | Fails to adhere to StyleSeed Toss conventions and design tokens. |
| This component doesn't need to support mobile, it's for the dashboard. | All StyleSeed components must be built mobile-first. |
| I'll hardcode the padding because it looks better. | Violates the strict spacing discipline enforced by StyleSeed tokens. |

## Red Flags
- Component is not mobile-first.
- Spacing and typography do not use StyleSeed tokens.
- Missing interactive states (hover, focus, active).

## Verification
- [ ] Component structure matches StyleSeed Toss conventions.
- [ ] All spacing, colors, and typography use official design tokens.
- [ ] Component is responsive and tested mobile-first.
