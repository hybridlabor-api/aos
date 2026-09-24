# AOS Design Engine Refinement — Best Practices Audit Brief

**Target Branch:** `feat/design-engine-refinement`  
**Repository:** `~/dev/bdb-dev/bdb-dev-optimized-agent-skills` (remote: `hybridlabor-api/aos.git`)  
**Auditor Target:** Claude Code (`opus` or `sonnet-4-6`)  
**Discipline:** Doubt-Driven Development / Adversarial Verification

---

## 🎯 Review Objective

Audit the recent architecture update and refinement of the **AOS Design Engine** against multi-agent best practices, token economy, harness portability, and IP sanitization.

The update integrates 5 upstream vendor capabilities (`superdesign-skill`, `taste-skill`, `anti-slop`, `editable-design`, and `brag`) and completely decouples local proprietary branding from the public AOS repository.

---

## 📂 Key Files to Inspect

1. **Brand Discovery & Anti-Slop Engine:**
   - [`skills/basic/godmode-ui-ux/SKILL.md`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/basic/godmode-ui-ux/SKILL.md)
   - [`skills/basic/godmode-ui-ux/references/anti-slop-rules.md`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/basic/godmode-ui-ux/references/anti-slop-rules.md)
   - [`skills/basic/godmode-ui-ux/references/taste-archetypes.md`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/basic/godmode-ui-ux/references/taste-archetypes.md)

2. **Motion Engine & Brand Sanitization:**
   - [`skills/global_config/bdbdesignpro/references/bdb-motion-tokens.md`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/global_config/bdbdesignpro/references/bdb-motion-tokens.md)

3. **Standalone Skills:**
   - [`skills/global_config/editable-design/SKILL.md`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/global_config/editable-design/SKILL.md)
   - [`skills/global_config/brag/SKILL.md`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/global_config/brag/SKILL.md)

4. **Multi-Agent Dispatcher & Vendor Tracking:**
   - [`.agents/nodes.json`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/.agents/nodes.json)
   - [`.agents/vendor-manifest.json`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/.agents/vendor-manifest.json)

---

## 🔍 Verification Checklist

Please evaluate each of the following 5 dimensions. Classify any issues by severity:
- `CRITICAL / ARCHITECTURAL BREAK`: Breaks multi-agent execution, leaks private assets, or causes deadlock.
- `VALID & ACTIONABLE`: Defect or inconsistency that should be addressed before merging.
- `VALID TRADE-OFF`: Intentional design decision with clear trade-offs.
- `NITPICK / NOISE`: Minor stylistic observations.

### Dimension 1: Brand Discovery Hierarchy & IP Sanitization
- [ ] **Zero Leaks:** Ensure no private BDB brand colors (`#9b30c4`, `#51116F`) or local asset paths (`~/dev/assets/bdb-brand/`) remain hardcoded in `bdb-motion-tokens.md` or any skill under `skills/`.
- [ ] **CI Precedence:** Confirm that if a client or project defines its CI in `DESIGN.md`, color bans (e.g. purple gradient bans) and font bans are suspended.
- [ ] **Token Agnosticism:** Verify that default tokens are standard, neutral DTCG variables (`--surface-base`, `--accent-primary`).

### Dimension 2: Token Economy & Modular Reference Architecture
- [ ] **Lean Root Skill:** Verify that `godmode-ui-ux/SKILL.md` remains lightweight (< 200 lines) and acts as an orchestration router.
- [ ] **Lazy-Loaded References:** Ensure deep rules (taste archetypes, 38+ anti-slop rules) are stored in `references/` rather than polluting the root system prompt on every agent turn.

### Dimension 3: Dispatcher Graph & Lifecycle Integrity
- [ ] **Role Separation:** Check [`.agents/nodes.json`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/.agents/nodes.json):
  - `ui_ux` has `godmode-ui-ux`, `bdbdesignpro`, and `editable-design`.
  - `shipping` has `godmode-shipping` and `brag`.
- [ ] **Post-Shipping Isolation:** Verify that `brag` (video rendering via Hyperframes) is strictly a post-shipping hook, avoiding compute/token waste during iterative build/review loops.

### Dimension 4: Multi-Harness Portability
- [ ] **Standard Frontmatter:** Verify YAML frontmatter (`name`, `description`, `category: design-ui-ux`, `user-invocable: true`) is compatible across Claude Code, Google Antigravity, OpenCode, and Codex CLI.
- [ ] **No Monolithic Overlaps:** Verify that `bdbdesignpro` retains its dedicated focus on animation physics (GSAP, Motion.dev, Three.js) without duplicate static token maintenance.

### Dimension 5: Upstream Vendor Tracking
- [ ] **Traceability:** Check [`.agents/vendor-manifest.json`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/.agents/vendor-manifest.json) for pinned commit SHAs, upstream URLs, and clear mapping to downstream skills.

---

## ⚡ Quick-Run Review Command

To execute this audit automatically with Claude Code CLI, run:

```bash
claude -p "Review the changes in branch feat/design-engine-refinement against the instructions in REVIEW_BRIEF.md. Output an adversarial review with findings classified by precedence." --model opus
```
