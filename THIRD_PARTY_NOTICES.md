# Third-Party Notices

`@hybridlabor-api/aos` is licensed under Apache-2.0. It additionally bundles
third-party source code that carries its own license. That code, and the
license it ships under, is listed here.

Each vendored file also carries a one-line pointer back to this document, so
provenance survives the file being read in isolation.

---

## affaan-m/ECC

- **Upstream:** <https://github.com/affaan-m/ECC>
- **License:** MIT
- **Copyright:** Copyright (c) 2026 Affaan Mustafa

Two independent deliverables were ported from this project.

### 1. Auxiliary agents

Ported from ECC `agents/<name>.md` to `.claude/agents/<name>.md`:

| File | Upstream source |
|---|---|
| `.claude/agents/silent-failure-hunter.md` | `agents/silent-failure-hunter.md` |
| `.claude/agents/security-reviewer.md` | `agents/security-reviewer.md` |
| `.claude/agents/go-build-resolver.md` | `agents/go-build-resolver.md` |
| `.claude/agents/database-reviewer.md` | `agents/database-reviewer.md` |
| `.claude/agents/opensource-forker.md` | `agents/opensource-forker.md` |
| `.claude/agents/opensource-sanitizer.md` | `agents/opensource-sanitizer.md` |

**Changes made:** frontmatter only. Upstream `name`, `description`, `model`
and `tools` are preserved verbatim; the AOS-convention `skills:` key and the
three house body lines (`Primary skills` / `MCP servers used` /
`Output artifact(s)`) were added, along with a source-pointer YAML comment.
The agent bodies — including ECC's "Prompt Defense Baseline" block — are
unmodified.

These 6 agents are standalone subagent types. They are deliberately **not**
registered in `.agents/nodes.json` or `.agents/graph.md`; the AOS pipeline
graph remains 7 nodes.

Note that `opensource-forker` and `opensource-sanitizer` describe themselves in
their `description:` frontmatter as the first and second stage of an
`opensource-pipeline` skill. That is an upstream ECC concept with **no AOS
equivalent** — no such skill exists in this repo's `skills/` tree. The
descriptions are left verbatim as ported; the two agents work fine invoked
directly, in that order. Do not go looking for `opensource-pipeline` here.

### 2. Plan Canvas

Ported to `skills/global_config/plan-canvas/`:

| File | Upstream source |
|---|---|
| `skills/global_config/plan-canvas/SKILL.md` | `skills/plan-canvas/SKILL.md` |
| `skills/global_config/plan-canvas/scripts/plan-canvas.js` | `scripts/plan-canvas.js` |
| `skills/global_config/plan-canvas/scripts/lib/loopback-guard.js` | `scripts/lib/loopback-guard.js` |
| `skills/global_config/plan-canvas/scripts/lib/plan-canvas/markdown.js` | `scripts/lib/plan-canvas/markdown.js` |
| `skills/global_config/plan-canvas/scripts/lib/plan-canvas/sdk.js` | `scripts/lib/plan-canvas/sdk.js` |
| `skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js` | `scripts/lib/plan-canvas/server.js` |
| `skills/global_config/plan-canvas/scripts/lib/plan-canvas/sessions.js` | `scripts/lib/plan-canvas/sessions.js` |
| `skills/global_config/plan-canvas/scripts/lib/plan-canvas/ui.js` | `scripts/lib/plan-canvas/ui.js` |

The directory layout mirrors ECC's `scripts/` shape so every relative
`require()` resolves unchanged. Changes made:

- **`plan-canvas.js`** — `const VERSION = require('../package.json').version`
  replaced with the literal `const VERSION = '1.0.0'`. The skill tree is
  relocated by the installer, so a require walking above the skill directory
  is wrong at any depth. `VERSION` only has to be stable and self-consistent.
  It is kept in sync with `metadata.version` in the skill's `SKILL.md`.
- **Rebrand**, exact-token only, so a co-installed ECC and AOS do not collide
  over the same port, state directory, or health identity:
  - env prefix `ECC_PLAN_CANVAS_*` → `AOS_PLAN_CANVAS_*`
    (`plan-canvas.js`, `server.js`, `sessions.js`, `ui.js`)
  - health app id `'ecc-plan-canvas'` → `'aos-plan-canvas'`
    (`server.js`, `plan-canvas.js`)
  - CLI name in guidance strings `ecc-plan-canvas` → `aos-plan-canvas`
    (`plan-canvas.js`)
  - `DEFAULT_PORT` `4517` → `4519` (`server.js`)
  - state dir `~/.claude/plan-canvas` → `~/.claude/aos-plan-canvas`
    (`sessions.js`)
- **`SKILL.md`** — plan-artifact references rewritten from ECC's
  `.claude/plans/*.plan.md` to AOS's `production_artifacts/00_execution_plan.md`,
  port `4517` → `4519`, ECC-install prose replaced with AOS install prose, and
  two upstream claims corrected for this repo: the `stop:plan-canvas-pending`
  hook is not vendored, and the referenced `frontend-design-direction` /
  `artifact-design` skills do not exist in AOS (replaced with `godmode-ui-ux` /
  `ui-component`).

Upstream provenance comments inside the vendored sources — including the
`affaan-m/ECC#2702` reference in `ui.js` — are left intact, as are
browser-internal identifiers private to the served page
(`window.__eccPlanCanvasSdk`, `data-ecc-plan-canvas`, and the
`ecc-plan-canvas:queue:` / `ecc-plan-canvas:theme` localStorage keys).

No ECC tests, hooks (`scripts/hooks/plan-canvas-*.js`), or the
`commands/plan-canvas.md` wrapper were ported.

### License text

```
MIT License

Copyright (c) 2026 Affaan Mustafa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## mattpocock/skills

<https://github.com/mattpocock/skills> — MIT.

The grilling family and the domain-modeling discipline it composes with:

| In AOS | Upstream |
|---|---|
| `skills/global_config/grilling/` | `skills/productivity/grilling/` |
| `skills/global_config/grill-me/` | `skills/productivity/grill-me/` |
| `skills/global_config/grill-with-docs/` | `skills/engineering/grill-with-docs/` |
| `skills/global_config/domain-modeling/` | `skills/engineering/domain-modeling/` (incl. `ADR-FORMAT.md`, `CONTEXT-FORMAT.md`) |
| `skills/global_config/triage/` | `skills/engineering/triage/` |
| `skills/global_config/prototype/` | `skills/engineering/prototype/` |

`grilling`'s interview protocol and `domain-modeling` are carried over
essentially verbatim; `grill-me` and `grill-with-docs` are rewritten to name AOS's
own pipelines in their hand-off sections, but keep upstream's composition — both
are thin wrappers that invoke the primitive rather than restating it. Upstream's
`agents/openai.yaml` under `domain-modeling` is harness-specific to that project
and was not carried over.

`skills/global_config/ask-tim/` is derived from upstream's `ask-matt` router. It
is not a copy: the flow it maps is AOS's own, since most of the skills on
upstream's main flow have no AOS equivalent.

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Other vendored skills

Skills in `skills/` that were derived from an external project record that
project in their own `source:` frontmatter. Every upstream named there is
listed below. Licences were verified against each repository's own `LICENSE`
file via the GitHub API on 2026-09-12; where a copyright line is quoted, it is
quoted verbatim from that file.

| Upstream | Licence | Copyright | Skills in AOS |
|---|---|---|---|
| [bitjaru/styleseed](https://github.com/bitjaru/styleseed) | MIT | Copyright (c) 2026 StyleSeed Contributors | `ui-component`, `ui-page`, `ui-pattern`, `ui-review`, `ui-tokens`, `ux-audit`, `ux-feedback`, `ux-flow` |
| [firecrawl/skills](https://github.com/firecrawl/skills) | ISC | Copyright (c) Firecrawl | `firecrawl-build-scrape`, `firecrawl-build-search`, `firecrawl-build-interact`, `firecrawl-build-onboarding` |
| [Dimillian/Skills](https://github.com/Dimillian/Skills) | MIT | Copyright (c) 2026 Thomas Ricouard | `github`, `react-component-performance`, `simplify-code` |
| [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 (per-skill `LICENSE.txt`; the repo has no root licence) | Copyright 2026 Anthropic, PBC. | `webapp-testing`, `web-artifacts-builder` |
| [AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo) | MIT | Copyright (c) 2026 agricidaniel | `seo`, `seo-technical` |
| [neondatabase/agent-skills](https://github.com/neondatabase/agent-skills) | Apache-2.0 | template placeholder upstream; holder is Neon | `using-neon` |
| [sanjay3290/ai-skills](https://github.com/sanjay3290/ai-skills) | Apache-2.0 | see upstream `LICENSE` | `deep-research`, `google-sheets-automation` |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | MIT | Copyright (c) 2023 shadcn | `shadcn` |
| [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) | MIT | Copyright (c) 2026 Steph Ango | `obsidian-markdown` |
| [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) | MIT | Copyright (c) 2025 Alireza Rezvani | `senior-frontend`, `landing-page-generator` |
| [playwright-community/playwright-go](https://github.com/playwright-community/playwright-go) | MIT | Copyright (c) 2020 Max Schmitt | `go-playwright` |
| [wrsmith108/linear-claude-skill](https://github.com/wrsmith108/linear-claude-skill) | MIT | see upstream `LICENSE` | `linear-claude-skill` |
| [langchain-ai/openwiki](https://github.com/langchain-ai/openwiki) | MIT | see upstream `LICENSE` | `openwiki-skill` |

`webapp-testing` and `web-artifacts-builder` each ship upstream's own
`LICENSE.txt` verbatim, as Apache-2.0 §4 requires. Note that `anthropics/skills`
licenses its document skills (`docx`, `pdf`, `pptx`, `xlsx`) as
**source-available, not open source** — neither skill vendored here comes from
that set, and nothing from it may be vendored under this notice.

Three further skills carry an in-tree provenance marker rather than a public
upstream repository, recorded here so the claim is not lost:

| Skill | Evidence in this repo |
|---|---|
| `react-best-practices` | `metadata.json` → `"organization": "Vercel Engineering"` |
| `postgres-best-practices` | `metadata.json` → `"organization": "Supabase"` |
| `playwright-skill` | `package.json` → `"author": "lackeyjb"`, `"license": "MIT"` |

### Unresolved provenance

These upstreams could not be cleared. They are recorded rather than hidden, and
each needs a decision before the affected skills can be considered safely
redistributable.

| Upstream | Problem | Skills affected |
|---|---|---|
| `vibeforge1111/vibeship-spawner-skills` | Repository has **no `LICENSE` file**. Its README states "Apache 2.0", but a README statement is not a licence grant — absent a licence file the default is all rights reserved. | `agent-tool-builder`, `ai-product`, `browser-automation`, `crewai`, `neon-postgres`, `rag-engineer`, `vercel-deployment` |
| `jackjin1997/ClawForge` | No `LICENSE` file; README claims MIT. | `clean-code` |
| `CloudAI-X/threejs-skills` | No `LICENSE` file; README claims MIT. | `threejs-skills` |
| `Shpigford/skills` | Repository returns **404** — deleted, renamed, or made private. Provenance cannot be verified at all. | `readme` |

## Note on `mcps/`

Sub-repositories vendored under `mcps/` carry their own `LICENSE` files in
their own directories and are not restated here.
