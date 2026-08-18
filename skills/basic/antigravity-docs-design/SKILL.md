---
name: antigravity-docs-design
description: "Authoritative design system and standalone HTML template for creating neutral, enterprise-grade developer documentation and user manuals in the official Google Antigravity / BDB OS aesthetic (3-column layout, matte dark mode, live search, bilingual DE/EN, pill action tables, and TOC scrollspy)."
category: marketing-design
risk: safe
date_added: "2026-08-18"
---

# 🌐 Google Antigravity & BDB OS Documentation Design System

This skill defines the official design rules, tokens, component patterns, and turnkey templates for building **neutral, enterprise-grade developer documentation and interactive user manuals** (identical to `antigravity.google/docs` and BDB OS Remote documentation).

---

## 🎯 Core Design Principles (Anti-Slop & Neutrality)

1. **Restrained, Professional Aesthetic:**
   - Avoid loud rainbow gradients, excessive glow effects, or toy-like cartoonish icons.
   - Use deep matte charcoal/slate surfaces (`#0f1117`, `#161922`) with subtle crisp borders (`#232733`).
   - Pure high-contrast typography (`#f0f3f6` headers, `#9aa1b2` body) with clean hierarchy.

2. **Deterministic 3-Column Architecture:**
   - **Left Navigation (260px):** Sticky category tree with version badges (`v1.1.0`) and soft pill active states.
   - **Center Content Area (Max 860px):** Breadcrumbs navigation, title lead, neutral platform tables, step-by-step numbered flows, and copyable code blocks.
   - **Right Sidebar (220px):** "On this page" dynamic Table of Contents tracking active scroll position.

3. **Zero External Dependencies:**
   - Standalone single-file HTML5 output containing all styles, vector SVGs, and lightweight vanilla JS.
   - 100% offline-capable, instant load, zero CDN failure risk.

4. **Bilingual Parity (DE / EN):**
   - Native segmented toggle (`DE` / `EN`) with instant content morphing and `localStorage` persistence.

---

## 🎨 DTCG Design Tokens

```css
:root {
  /* Layout */
  --header-height: 60px;
  --sidebar-left-width: 260px;
  --sidebar-right-width: 220px;
  --content-max-width: 860px;

  /* Dark Theme Palette (Default) */
  --bg-header: #0f1117;
  --bg-body: #0f1117;
  --bg-sidebar: #0f1117;
  --bg-surface: #161922;
  --bg-surface-elevated: #1e222d;
  --bg-card: #161922;
  --bg-table-header: #1c202a;
  
  --border-subtle: #232733;
  --border-strong: #323847;
  
  --text-primary: #f0f3f6;
  --text-secondary: #9aa1b2;
  --text-muted: #656d81;
  --text-link: #58a6ff;
  
  --accent-blue: #3b82f6;
  --accent-blue-subtle: rgba(59, 130, 246, 0.12);
  --accent-pill: #252b38;
  --accent-pill-hover: #32394a;
  
  --success: #3fb950;
  --warning: #d29922;
  --danger: #f85149;
  
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Google Sans", Inter, Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

[data-theme="light"] {
  --bg-header: #ffffff;
  --bg-body: #ffffff;
  --bg-sidebar: #f8fafc;
  --bg-surface: #f1f5f9;
  --bg-surface-elevated: #e2e8f0;
  --bg-card: #ffffff;
  --bg-table-header: #f8fafc;
  --border-subtle: #e2e8f0;
  --border-strong: #cbd5e1;
  
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  --text-link: #2563eb;
  
  --accent-blue: #2563eb;
  --accent-blue-subtle: rgba(37, 99, 235, 0.08);
  --accent-pill: #e2e8f0;
  --accent-pill-hover: #cbd5e1;
}
```

---

## 🧩 Key Component Patterns

### 1. Platform / Action Tables with Download Pills
Used for quick installation actions across operating systems:
```html
<div class="docs-table-wrapper">
  <table class="docs-table">
    <thead>
      <tr>
        <th>Platform</th>
        <th>Download & Command</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>macOS</strong></td>
        <td>
          <div class="pill-btn-group">
            <button class="pill-btn primary" onclick="copySnippet('npx installer')">Download Apple Silicon</button>
            <button class="pill-btn" onclick="copySnippet('npx installer')">Download Intel</button>
          </div>
          <div class="req-note">Requirements: macOS 12+ (Monterey or newer)</div>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

### 2. Copyable Code Blocks
```html
<div class="code-block">
  <div class="code-header">
    <span>bash</span>
    <button class="code-copy-btn" onclick="copySnippet('npx @hybridlabor-api/package')">Copy</button>
  </div>
  <div class="code-content">
    <span class="prompt-sym">$</span>npx @hybridlabor-api/package
  </div>
</div>
```

### 3. Interactive Pre-Flight Checklist
```html
<div class="checklist-box">
  <div class="checklist-title-bar">
    <span>Pre-Flight Checklist</span>
    <span id="checkProgress">0/5</span>
  </div>
  <ul class="checklist-items">
    <li class="checklist-row">
      <input type="checkbox" id="k1" onchange="calcChecks()" />
      <label for="k1">Installed Node.js >= 18</label>
    </li>
  </ul>
</div>
```

---

## 📁 Reusable Template Location

Agents can read and instantiate the full standalone HTML template directly from:
- `~/.agents/skills/antigravity-docs-design/templates/docs_template.html`
