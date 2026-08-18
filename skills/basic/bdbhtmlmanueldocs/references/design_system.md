# Google Antigravity & BDB OS Documentation Design Guide

## 1. Visual Hierarchy & Spacing Rhythm
- **Page Header**: Fixed `60px` height with backdrop-filter or solid `#0f1117` matte background.
- **Sidebars**:
  - Left navigation: `260px` width, sticky, vertical scroll with custom slim scrollbar.
  - Right TOC: `220px` width, sticky, subtle `1px solid var(--border-subtle)` left border.
- **Main Container**: Maximum `860px` text width for optimal reading line length (65-80 characters per line).
- **Vertical Rhythm**:
  - `h1.page-title`: `2.35rem`, line-height `1.2`, margin-bottom `0.75rem`.
  - `.page-lead`: `1.1rem`, line-height `1.55`, margin-bottom `2.5rem`.
  - `section.doc-section`: margin-bottom `3.5rem`, scroll-margin-top `75px`.
  - `h2.section-heading`: `1.45rem`, border-bottom `1px solid var(--border-subtle)`, padding-bottom `0.4rem`.

## 2. Table & Action Button Conventions
- Use `.docs-table-wrapper` with `overflow: hidden` and `border-radius: 8px`.
- Table header row uses `--bg-table-header` (`#1c202a`) with bold `0.85rem` uppercase/mixed-case title.
- For platform downloads or action triggers, use `.pill-btn-group` containing `.pill-btn` buttons.
- Primary actions receive the `.primary` class (`--accent-blue`).

## 3. Code Block Standards
- Code blocks must always have a header `.code-header` specifying language/runtime on the left and a `.code-copy-btn` on the right.
- The prompt symbol `$` is marked with `.prompt-sym` and is `user-select: none`.

## 4. Responsive Breakpoints
- `@media (max-width: 1200px)`: Hide right "On this page" TOC.
- `@media (max-width: 860px)`: Collapse left navigation into mobile menu drawer; search input width reduced to `200px`.
- Print style (`@media print`): Hides sidebars, headers, search bars, and copy buttons; sets clean white background for PDF compilation.
