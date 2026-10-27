# Skill audit for 5.4 (256 shipped skills)

Status: recommendation for the owner. Nothing is moved by this document. The mechanism (`skillSet`, default `all`) and the local `aos` store source ship separately; `lib/core-skills.json` holds the list below and is inert until `--skill-set=core` is set.

## Result

| Class | Skills | Description chars | Tokens (chars/4) |
|---|---:|---:|---:|
| keep-core | 74 | 18600 | 4650 |
| move-to-store | 153 | 30030 | 7508 |
| merge-or-delete | 29 | 4170 | 1043 |
| total | 256 | 52800 | 13200 |

- **Recommended core set:** 74 skills (`keep-core`). Core mode installs only these; the other 182 stay in the npm package and install offline with `aos store install <name>`.
- **Listing saving:** 34200 description chars / 4 = **8550 tokens** removed from the 13200-token description total (65%).
- Estimate including per-entry overhead (name, path and framing; about 13.3 tokens per skill, derived from the ~16.6k listing figure, unverified): about 10967 of ~16.6k tokens.
- `merge-or-delete` skills are also left out of the core set. Merging or deleting them is a separate content change for the owner; until then they are simply store-installable like `move-to-store`.

## Method

- Reference scan: whole-word match of each skill name in `agents/`, `.claude/` (hooks, agents), `.agents/` (graph.md, nodes.json, profiles, workflows), `commands/`, `lib/`, `bin/`, `plugins/`, `AGENTS.md`/`CLAUDE.md`/`RULES.md`, other skills' SKILL.md. Plugin manifests (`plugin.json`, `plugin-commands.json`, `skills.sh.json`) list every skill and are ignored as evidence.
- Strong evidence for `keep-core`: named in `.agents/nodes.json` (common or per node), in the routing block (`lib/routing-rules.js`), in a hook, or backing a slash command in `commands/`.
- Generic names (`github`, `documentation`, `readme`) match many files by word only; those hits were not counted.
- Overlap and niche judgements are mine; each has a one-line reason. Description chars are the frontmatter `description` length, the same quantity the validator budgets.

## Open points for the owner

- **nodes.json media node:** `bdbmediastorm`, `godmode-eventtech`, `godmode-media-creation`, `godmode-3d-creation`, `mcp-manage`, `threejs-skills`, `spline-3d-integration` are listed for the optional `media_eventtech` node but marked `move-to-store`. Moving them requires the dispatcher to tolerate a missing skill (unverified) or the media profile to install them.
- **Playbooks:** `/playbooks` lists only installed `pb-*` skills (it runs `list-playbooks.mjs` over the skill dirs; not changed here). With 32 playbooks moved, the list shrinks until it also reads the store index.
- **Agent personas** that name a moved skill (go-reviewer to golang-pro, database-reviewer to database-design, event-manager-assistant to pb-*, and so on) keep working but the named skill is not loaded until installed.
- **Claude Code plugin delivery:** when the plugin covers Claude, the loose copies are not written (`installTargetSkills`, `viaPlugin`), and the plugin manifest lists all skills. Whether core mode shrinks the Claude listing in that case is unverified.
- **Trim candidates inside the core set** (pipeline-listed, but language/framework detail): `drizzle-orm-expert`, `postgres-best-practices`, `typescript-pro`, `python-pro`, `tailwind-patterns`, `shadcn`, `react-best-practices`, `landing-page-generator`. Trimming them needs the matching `nodes.json` skill lists edited.
- **Per-category split (kept / moved / merge-or-delete):**
  - bdb-core: 32 / 26 / 0
  - business-ops: 0 / 2 / 0
  - design-ui-ux: 7 / 8 / 2
  - engineering-hardware: 0 / 2 / 0
  - engineering-method: 26 / 32 / 4
  - library: 9 / 53 / 23
  - media-eventtech: 0 / 27 / 0
  - saas-ops: 0 / 3 / 0

## Table

Refs: where the name is referenced (graph = graph.md/nodes.json/profiles, hook, agent, rules, cmd = command files). Chars = description length.

| Skill | Group | Category | Chars | Refs | Class | Reason |
|---|---|---|---:|---|---|---|
| agent-pipeline | global_config | bdb-core | 307 | graph+agent | keep-core | techlead node skill (nodes.json) |
| agenttrail | global_config | bdb-core | 465 | graph+hook+agent+rules | keep-core | listed in nodes.json "common" for every graph node |
| ao-orchestrator | basic | bdb-core | 225 | cmd | keep-core | backs /orchestrator command; AGENTS.md routing |
| aos-a2a | global_config | bdb-core | 276 | graph+hook+rules | keep-core | backs /setup /init /store commands and a2a/gateway hooks |
| aos-gateway | global_config | bdb-core | 267 | graph | keep-core | backs /setup /init /store commands and a2a/gateway hooks |
| aos-project-init | global_config | bdb-core | 290 | cmd | keep-core | backs /setup /init /store commands and a2a/gateway hooks |
| aos-setup | global_config | bdb-core | 303 | hook+cmd | keep-core | backs /setup /init /store commands and a2a/gateway hooks |
| aos-store | global_config | bdb-core | 148 | cmd | keep-core | backs /setup /init /store commands and a2a/gateway hooks |
| api-design-principles | global_config | library | 149 | graph+agent | keep-core | engineering node skill (nodes.json), also named by engineering/reviewer agents |
| archify | global_config | engineering-method | 652 | graph+agent | keep-core | listed in nodes.json "common" for every graph node |
| architect-review | global_config | engineering-method | 61 | graph+agent | keep-core | reviewer node skill; systematic-debugging named by 31 agents |
| ask-tim | global_config | bdb-core | 240 | - | keep-core | router for overlapping skills; AGENTS.md routing |
| bdb-aos | (root) | bdb-core | 315 | hook+cmd | keep-core | plugin entry/router skill; named by 25 command and hook files |
| bdb-security-audit | global_config | engineering-method | 96 | graph+agent | keep-core | shipping node skill (nodes.json) and named by shipping/reviewer/opensource agents |
| bdb-shipping-skill | basic | engineering-method | 263 | cmd | keep-core | backs /shipping command; pre-ship framing |
| bdb-ui-library | global_config | design-ui-ux | 407 | - | keep-core | UI work routes here first (skill description + shipped rule) |
| bdbdesignpro | global_config | design-ui-ux | 308 | graph+agent | keep-core | ui_ux node skill (nodes.json); first candidates to trim if the owner wants a smaller core |
| bdbrainstorm | (root) | bdb-core | 444 | graph+hook+agent+rules+cmd | keep-core | brainstorm entry; named by architect/devils-advocate/spec agents and /brainstorm |
| bdbresilience | global_config | bdb-core | 163 | graph | keep-core | engineering node skill (nodes.json), also named by engineering/reviewer agents |
| clean-code | global_config | engineering-method | 154 | graph+agent | keep-core | shipping node skill (nodes.json) and named by shipping/reviewer/opensource agents |
| clear-context | global_config | bdb-core | 233 | - | keep-core | universal session-hygiene skill for every harness |
| codebase-memory | (root) | bdb-core | 302 | - | keep-core | default code-research route; referenced by hook-adjacent config |
| concise-planning | global_config | engineering-method | 105 | graph+agent+cmd | keep-core | architect node skill (nodes.json) |
| deja-memory | global_config | bdb-core | 199 | - | keep-core | unified memory (memB/deja) is a default package; hooks inject it |
| dispatching-parallel-agents | global_config | engineering-method | 351 | - | keep-core | universal workflow skill used by build/ship flows, not domain specific |
| drizzle-orm-expert | global_config | library | 180 | graph+agent | keep-core | engineering node skill (nodes.json), also named by engineering/reviewer agents |
| editable-design | global_config | design-ui-ux | 416 | graph | keep-core | ui_ux node skill (nodes.json); first candidates to trim if the owner wants a smaller core |
| finishing-a-development-branch | global_config | engineering-method | 101 | - | keep-core | universal workflow skill used by build/ship flows, not domain specific |
| github-repo | (root) | engineering-method | 139 | graph+agent | keep-core | shipping node skill (nodes.json) and named by shipping/reviewer/opensource agents |
| godmode-engineering | basic | engineering-method | 210 | graph+agent | keep-core | pipeline persona skill; same-named agent and node in graph.md |
| godmode-shipping | basic | engineering-method | 201 | graph+agent+cmd | keep-core | pipeline persona skill; same-named agent and node in graph.md |
| godmode-ui-ux | basic | design-ui-ux | 184 | graph+agent | keep-core | pipeline persona skill; same-named agent and node in graph.md |
| gogate | global_config | bdb-core | 379 | graph+hook+rules+cmd | keep-core | go-gate hooks and /gogate flow (4 hook files) |
| grill-me | global_config | engineering-method | 289 | graph+hook+agent+rules+cmd | keep-core | brainstorm entry; named by architect/devils-advocate/spec agents and /brainstorm |
| landing-page-generator | global_config | library | 198 | graph+agent | keep-core | ui_ux node skill (nodes.json); first candidates to trim if the owner wants a smaller core |
| loop-templates | global_config | bdb-core | 300 | cmd | keep-core | backs the /loop command |
| master-session | basic | bdb-core | 280 | hook+cmd | keep-core | /mastersession command, go-gate hook |
| mcsc | global_config | bdb-core | 394 | graph | keep-core | routing/graph reference; delegation MCP |
| memb-ingest | (root) | bdb-core | 146 | graph+hook+cmd | keep-core | unified memory (memB/deja) is a default package; hooks inject it |
| memb-skill | global_config | bdb-core | 161 | cmd | keep-core | unified memory (memB/deja) is a default package; hooks inject it |
| openwiki-skill | global_config | bdb-core | 190 | graph+hook+agent | keep-core | OpenWiki is a default package; named by architect and spec agents, hook |
| orchestrator-chain | global_config | bdb-core | 282 | graph | keep-core | graph.md hop contract |
| pb-bug-fix | playbooks | engineering-method | 343 | - | keep-core | general-purpose playbook (stack-agnostic starter set) |
| pb-handover | playbooks | bdb-core | 274 | - | keep-core | general-purpose playbook (stack-agnostic starter set) |
| pb-project-new | playbooks | bdb-core | 284 | - | keep-core | general-purpose playbook (stack-agnostic starter set) |
| pb-ship | playbooks | engineering-method | 283 | cmd | keep-core | general-purpose playbook (stack-agnostic starter set) |
| plan-arbiter | global_config | bdb-core | 366 | graph | keep-core | architect node skill (nodes.json) |
| plan-canvas | global_config | bdb-core | 579 | graph+hook+agent+rules+cmd | keep-core | listed in nodes.json "common" for every graph node |
| planning-with-files | global_config | engineering-method | 82 | graph+agent | keep-core | architect node skill (nodes.json) |
| postgres-best-practices | global_config | library | 183 | graph+agent | keep-core | engineering node skill (nodes.json), also named by engineering/reviewer agents |
| prototype | global_config | engineering-method | 436 | hook+agent+rules | keep-core | named in the routing block (web design flow) |
| python-pro | global_config | library | 199 | graph+agent | keep-core | engineering node skill (nodes.json), also named by engineering/reviewer agents |
| quick-recap | global_config | bdb-core | 166 | graph | keep-core | listed in nodes.json "common" for every graph node |
| react-best-practices | global_config | library | 252 | graph+agent | keep-core | ui_ux node skill (nodes.json); first candidates to trim if the owner wants a smaller core |
| read-the-damn-docs | global_config | engineering-method | 421 | graph | keep-core | listed in nodes.json "common" for every graph node |
| senior-frontend | global_config | design-ui-ux | 159 | graph+agent+rules | keep-core | ui_ux node skill (nodes.json); first candidates to trim if the owner wants a smaller core |
| seo | global_config | library | 203 | graph+agent | keep-core | shipping node skill (nodes.json) and named by shipping/reviewer/opensource agents |
| seo-audit | global_config | library | 100 | graph+agent | keep-core | shipping node skill (nodes.json) and named by shipping/reviewer/opensource agents |
| shadcn | global_config | design-ui-ux | 113 | graph+agent+rules | keep-core | ui_ux node skill (nodes.json); first candidates to trim if the owner wants a smaller core |
| software-architecture | global_config | engineering-method | 190 | graph+agent+rules | keep-core | engineering node skill (nodes.json), also named by engineering/reviewer agents |
| fabric | basic | bdb-core | 471 | graph+hook+rules+cmd | keep-core | pipeline entry point; named in routing block, hooks, commands |
| fabric-graph | basic | bdb-core | 510 | graph+hook+agent+rules+cmd | keep-core | pipeline entry point; named in routing block, hooks, commands |
| fabric-multigraph | basic | bdb-core | 527 | graph+hook+rules | keep-core | pipeline entry point; named in routing block, hooks, commands |
| stay-within-limits | global_config | bdb-core | 187 | graph | keep-core | listed in nodes.json "common" for every graph node |
| subagent-driven-development | global_config | engineering-method | 343 | graph+agent | keep-core | techlead node skill (nodes.json) |
| systematic-debugging | global_config | engineering-method | 91 | graph+agent+rules | keep-core | reviewer node skill; systematic-debugging named by 31 agents |
| tailwind-patterns | global_config | design-ui-ux | 154 | graph+agent+rules | keep-core | ui_ux node skill (nodes.json); first candidates to trim if the owner wants a smaller core |
| test-driven-development | global_config | engineering-method | 79 | graph+agent+rules | keep-core | engineering node skill (nodes.json), also named by engineering/reviewer agents |
| typescript-pro | global_config | library | 145 | graph+agent+rules | keep-core | engineering node skill (nodes.json), also named by engineering/reviewer agents |
| using-git-worktrees | global_config | engineering-method | 196 | - | keep-core | universal workflow skill used by build/ship flows, not domain specific |
| verification-before-completion | global_config | engineering-method | 225 | graph | keep-core | listed in nodes.json "common" for every graph node |
| wcag-audit-patterns | global_config | engineering-method | 111 | graph+agent | keep-core | shipping node skill (nodes.json) and named by shipping/reviewer/opensource agents |
| webapp-testing | global_config | engineering-method | 71 | graph+agent | keep-core | shipping node skill (nodes.json) and named by shipping/reviewer/opensource agents |
| writing-plans | global_config | engineering-method | 84 | agent+cmd | keep-core | named by spec-prd-creator and /plan flow |
| ai-agent-development | global_config | library | 149 | - | merge-or-delete | generic AI-dev overlap with agent-tool-builder / llm-app-patterns; vague trigger |
| ai-product | global_config | library | 126 | - | merge-or-delete | generic AI-dev overlap with agent-tool-builder / llm-app-patterns; vague trigger |
| api-patterns | global_config | library | 119 | - | merge-or-delete | overlaps api-design-principles |
| brainstorming | global_config | library | 171 | agent | merge-or-delete | overlaps bdbrainstorm; spec-prd-creator agent should point at bdbrainstorm |
| debugger | global_config | library | 118 | agent | merge-or-delete | overlaps systematic-debugging (same trigger: broken/failing/slow); fold into it |
| diagnosing-bugs | global_config | engineering-method | 156 | - | merge-or-delete | overlaps systematic-debugging (same trigger: broken/failing/slow); fold into it |
| frontend-dev-guidelines | global_config | design-ui-ux | 188 | - | merge-or-delete | overlaps senior-frontend and godmode-ui-ux |
| gemini-api-dev | global_config | library | 93 | - | merge-or-delete | overlaps gemini-api-integration |
| github-actions-templates | global_config | library | 100 | - | merge-or-delete | overlaps github-actions-generator |
| github-workflow-automation | global_config | library | 159 | - | merge-or-delete | overlaps github-actions-generator |
| go-playwright | global_config | library | 93 | - | merge-or-delete | overlaps playwright-skill (language variant) |
| grilling | global_config | engineering-method | 152 | agent | merge-or-delete | overlaps grill-me (same trigger phrases); devils-advocate agent should point at grill-me |
| linear-claude-skill | global_config | library | 41 | - | merge-or-delete | 41-char description, single-vendor wrapper, no references; delete or move to the store as an ECC item |
| llm-application-dev-ai-assistant | global_config | library | 200 | - | merge-or-delete | generic AI-dev overlap with agent-tool-builder / llm-app-patterns; vague trigger |
| llm-prompt-optimizer | global_config | library | 153 | - | merge-or-delete | overlaps prompt-engineer |
| nextjs-app-router-patterns | global_config | library | 123 | - | merge-or-delete | overlaps nextjs-best-practices |
| os-scripting | global_config | library | 165 | - | merge-or-delete | overlaps bash-linux and posix-shell-pro |
| postgresql | global_config | library | 138 | - | merge-or-delete | overlaps postgres-best-practices |
| prompt-engineering-patterns | global_config | engineering-method | 108 | - | merge-or-delete | overlaps prompt-engineer |
| python-patterns | global_config | library | 149 | agent | merge-or-delete | overlaps python-pro; agents python-reviewer/mle-reviewer should point at python-pro |
| python-performance-optimization | global_config | library | 197 | - | merge-or-delete | overlaps python-pro; agents python-reviewer/mle-reviewer should point at python-pro |
| rag-engineer | global_config | library | 172 | - | merge-or-delete | overlaps rag-implementation |
| react-component-performance | global_config | library | 70 | - | merge-or-delete | overlaps react-best-practices |
| react-patterns | global_config | library | 97 | - | merge-or-delete | overlaps react-best-practices |
| seo-technical | global_config | library | 202 | - | merge-or-delete | overlaps seo |
| tdd | global_config | engineering-method | 149 | - | merge-or-delete | overlaps test-driven-development (its own text calls it a complement); fold the seam rules into it |
| ui-ux-pro-max | global_config | design-ui-ux | 179 | - | merge-or-delete | overlaps godmode-ui-ux (same design-lead role) |
| using-neon | global_config | library | 249 | - | merge-or-delete | overlaps neon-postgres |
| web-scraper | global_config | library | 154 | - | merge-or-delete | overlaps apify-ultimate-scraper and browser-automation |
| agent-manager-skill | global_config | bdb-core | 118 | - | move-to-store | tool/config guide for a single optional component |
| agent-memory-mcp | global_config | bdb-core | 140 | - | move-to-store | tool/config guide for a single optional component |
| agent-tool-builder | global_config | engineering-method | 260 | - | move-to-store | LLM-app dev; domain skill for a minority of projects |
| agentic-harness-patterns | global_config | engineering-method | 116 | - | move-to-store | LLM-app dev; domain skill for a minority of projects |
| apify-lead-generation | global_config | library | 56 | - | move-to-store | scraping-vendor skill; needs an external account |
| apify-ultimate-scraper | global_config | library | 132 | - | move-to-store | scraping-vendor skill; needs an external account |
| bash-linux | global_config | library | 127 | agent | move-to-store | build/ops detail, only opensource agents name bash-linux |
| bdb-adobe-suite-mcp | global_config | media-eventtech | 183 | - | move-to-store | media-app MCP guide; installer already treats these as basic-tier optional (getTierExcludeSkills) |
| bdb-after-effects-mcp | global_config | media-eventtech | 151 | - | move-to-store | media-app MCP guide; installer already treats these as basic-tier optional (getTierExcludeSkills) |
| bdb-blender-mcp | global_config | media-eventtech | 110 | - | move-to-store | media-app MCP guide; installer already treats these as basic-tier optional (getTierExcludeSkills) |
| bdb-computer-use-mcp | global_config | engineering-method | 114 | - | move-to-store | tool/config guide for a single optional component |
| bdb-davinci-mcp | global_config | media-eventtech | 132 | - | move-to-store | media-app MCP guide; installer already treats these as basic-tier optional (getTierExcludeSkills) |
| bdb-deploy | global_config | bdb-core | 260 | - | move-to-store | provider-specific deploy skill; user-account dependent |
| bdb-eventagency-skill | basic | media-eventtech | 233 | agent | move-to-store | media/hardware pack; named only by niche agents (video-motion, event-manager, pcb) |
| bdb-grandma3-mcp | global_config | media-eventtech | 105 | - | move-to-store | media-app MCP guide; installer already treats these as basic-tier optional (getTierExcludeSkills) |
| bdb-memb-mcp | global_config | bdb-core | 239 | - | move-to-store | tool/config guide for a single optional component |
| bdb-resolume-mcp | global_config | media-eventtech | 141 | - | move-to-store | media-app MCP guide; installer already treats these as basic-tier optional (getTierExcludeSkills) |
| bdb-rhino-mcp | global_config | media-eventtech | 124 | - | move-to-store | media-app MCP guide; installer already treats these as basic-tier optional (getTierExcludeSkills) |
| bdb-touchdesigner-mcp | global_config | media-eventtech | 158 | - | move-to-store | media-app MCP guide; installer already treats these as basic-tier optional (getTierExcludeSkills) |
| bdb-unreal-mcp | global_config | media-eventtech | 95 | - | move-to-store | media-app MCP guide; installer already treats these as basic-tier optional (getTierExcludeSkills) |
| bdb-updater | global_config | bdb-core | 99 | - | move-to-store | tool/config guide for a single optional component |
| bdb-vectorworks-mcp | global_config | media-eventtech | 107 | - | move-to-store | media-app MCP guide; installer already treats these as basic-tier optional (getTierExcludeSkills) |
| bdb-visual-edit | global_config | design-ui-ux | 336 | - | move-to-store | design extra beyond the ui_ux node skills |
| bdbhtmlmanueldocs | basic | bdb-core | 250 | - | move-to-store | single-purpose or documented-only; one AGENTS.md mention at most |
| bdbmediastorm | basic | media-eventtech | 136 | graph+agent+rules+cmd | move-to-store | media/eventtech pack; in nodes.json only for the optional media_eventtech node. Needs the node to tolerate a missing skill or auto-install it |
| brag | global_config | media-eventtech | 220 | graph+agent | move-to-store | media/hardware pack; named only by niche agents (video-motion, event-manager, pcb) |
| browser-automation | global_config | library | 223 | - | move-to-store | single-purpose tool skill, no pipeline reference |
| ci-pipeline | global_config | engineering-method | 319 | - | move-to-store | git/CI helper; the harness and reviewer agents cover the default flow |
| cloudflare-workers-expert | global_config | library | 120 | - | move-to-store | provider-specific deploy skill; user-account dependent |
| copywriting | global_config | library | 140 | graph | move-to-store | marketing/SEO domain; copywriting only via the optional copywriter profile |
| crewai | global_config | library | 101 | - | move-to-store | LLM-app dev; domain skill for a minority of projects |
| database-design | global_config | library | 118 | agent | move-to-store | database/vendor specifics; database-reviewer is the only agent reference |
| deep-research | global_config | library | 109 | - | move-to-store | general research/terminal helper; harness-native deep-research exists, no pipeline reference |
| design-control-loop | global_config | bdb-core | 214 | - | move-to-store | design extra beyond the ui_ux node skills |
| design-spells | global_config | design-ui-ux | 147 | - | move-to-store | design extra beyond the ui_ux node skills |
| docker-expert | global_config | library | 260 | - | move-to-store | provider-specific deploy skill; user-account dependent |
| documentation | global_config | library | 123 | graph+hook+agent+rules | move-to-store | docs/product helper, generic names hit many files only by word match |
| domain-modeling | global_config | engineering-method | 150 | agent | move-to-store | issue-tracker/domain workflow family; opt-in methodology |
| executing-plans | global_config | engineering-method | 104 | - | move-to-store | issue-tracker/domain workflow family; opt-in methodology |
| factory | global_config | engineering-method | 222 | - | move-to-store | experimental Factory family (docs/factory.md); needs per-project config, opt-in; move as one bundle |
| factory-babysit-pr | global_config | engineering-method | 228 | - | move-to-store | experimental Factory family (docs/factory.md); needs per-project config, opt-in; move as one bundle |
| factory-collect | global_config | engineering-method | 215 | - | move-to-store | experimental Factory family (docs/factory.md); needs per-project config, opt-in; move as one bundle |
| factory-human-digest | global_config | bdb-core | 205 | - | move-to-store | experimental Factory family (docs/factory.md); needs per-project config, opt-in; move as one bundle |
| factory-lookback | global_config | engineering-method | 210 | - | move-to-store | experimental Factory family (docs/factory.md); needs per-project config, opt-in; move as one bundle |
| factory-recover | global_config | engineering-method | 199 | - | move-to-store | experimental Factory family (docs/factory.md); needs per-project config, opt-in; move as one bundle |
| factory-review-prs | global_config | engineering-method | 144 | - | move-to-store | experimental Factory family (docs/factory.md); needs per-project config, opt-in; move as one bundle |
| factory-ship | global_config | engineering-method | 147 | - | move-to-store | experimental Factory family (docs/factory.md); needs per-project config, opt-in; move as one bundle |
| factory-watchdog | global_config | engineering-method | 196 | - | move-to-store | experimental Factory family (docs/factory.md); needs per-project config, opt-in; move as one bundle |
| firecrawl | workspace_agents | library | 709 | - | move-to-store | scraping-vendor skill; needs an external account |
| firecrawl-sdk | workspace_agents | library | 188 | - | move-to-store | scraping-vendor skill; needs an external account |
| gemini-api-integration | global_config | library | 156 | - | move-to-store | LLM-app dev; domain skill for a minority of projects |
| geo-fundamentals | global_config | library | 83 | - | move-to-store | marketing/SEO domain; copywriting only via the optional copywriter profile |
| git-advanced-workflows | global_config | library | 130 | - | move-to-store | git/CI helper; the harness and reviewer agents cover the default flow |
| git-pr-review | global_config | library | 93 | - | move-to-store | git/CI helper; the harness and reviewer agents cover the default flow |
| github | global_config | library | 81 | graph+hook+agent+rules+cmd | move-to-store | git/CI helper; the harness and reviewer agents cover the default flow |
| github-actions-generator | global_config | engineering-method | 105 | - | move-to-store | git/CI helper; the harness and reviewer agents cover the default flow |
| github-actions-validator | global_config | engineering-method | 72 | - | move-to-store | git/CI helper; the harness and reviewer agents cover the default flow |
| go-concurrency-patterns | global_config | library | 181 | agent | move-to-store | Go; named only by go-reviewer/go-build-resolver |
| godmode-3d-creation | basic | media-eventtech | 130 | graph+agent | move-to-store | media/eventtech pack; in nodes.json only for the optional media_eventtech node. Needs the node to tolerate a missing skill or auto-install it |
| godmode-eventtech | basic | media-eventtech | 230 | graph+agent+rules | move-to-store | media/eventtech pack; in nodes.json only for the optional media_eventtech node. Needs the node to tolerate a missing skill or auto-install it |
| godmode-hardware-pcb | basic | engineering-hardware | 197 | graph+agent+rules | move-to-store | media/hardware pack; named only by niche agents (video-motion, event-manager, pcb) |
| godmode-media-creation | basic | media-eventtech | 162 | graph+agent | move-to-store | media/eventtech pack; in nodes.json only for the optional media_eventtech node. Needs the node to tolerate a missing skill or auto-install it |
| golang-pro | global_config | library | 121 | agent | move-to-store | Go; named only by go-reviewer/go-build-resolver |
| golive | global_config | saas-ops | 669 | - | move-to-store | provider-specific deploy skill; user-account dependent |
| grill-with-docs | global_config | engineering-method | 192 | - | move-to-store | issue-tracker/domain workflow family; opt-in methodology |
| instinct-export | basic | bdb-core | 268 | - | move-to-store | instincts feature pack; self-contained, no pipeline reference |
| instinct-import | basic | bdb-core | 288 | - | move-to-store | instincts feature pack; self-contained, no pipeline reference |
| instinct-status | basic | bdb-core | 193 | - | move-to-store | instincts feature pack; self-contained, no pipeline reference |
| live-preview-canvas | global_config | design-ui-ux | 148 | - | move-to-store | design extra beyond the ui_ux node skills |
| llm-app-patterns | global_config | library | 140 | - | move-to-store | LLM-app dev; domain skill for a minority of projects |
| llm-structured-output | global_config | library | 161 | - | move-to-store | LLM-app dev; domain skill for a minority of projects |
| local-llm-expert | global_config | library | 196 | - | move-to-store | LLM-app dev; domain skill for a minority of projects |
| makefile-pro | global_config | engineering-method | 140 | - | move-to-store | build/ops detail, only opensource agents name bash-linux |
| mcp-manage | global_config | media-eventtech | 149 | graph+agent+rules | move-to-store | media/eventtech pack; in nodes.json only for the optional media_eventtech node. Needs the node to tolerate a missing skill or auto-install it |
| microservices-patterns | global_config | library | 176 | - | move-to-store | build/ops detail, only opensource agents name bash-linux |
| modern-javascript-patterns | global_config | library | 174 | - | move-to-store | JS/React library detail, no pipeline reference |
| monorepo-management | global_config | library | 143 | - | move-to-store | build/ops detail, only opensource agents name bash-linux |
| n8n-code-javascript | global_config | library | 251 | - | move-to-store | n8n pack, single-tool niche |
| n8n-code-python | global_config | library | 192 | - | move-to-store | n8n pack, single-tool niche |
| n8n-expression-syntax | global_config | library | 217 | - | move-to-store | n8n pack, single-tool niche |
| n8n-mcp-tools-expert | global_config | library | 252 | - | move-to-store | n8n pack, single-tool niche |
| n8n-workflow-patterns | global_config | library | 57 | - | move-to-store | n8n pack, single-tool niche |
| neon-postgres | global_config | library | 107 | - | move-to-store | database/vendor specifics; database-reviewer is the only agent reference |
| nextjs-best-practices | global_config | library | 82 | - | move-to-store | JS/React library detail, no pipeline reference |
| obsidian-markdown | global_config | library | 262 | - | move-to-store | single-purpose tool skill, no pipeline reference |
| openapi-spec-generation | global_config | library | 195 | - | move-to-store | single-purpose tool skill, no pipeline reference |
| pb-ci-fix | playbooks | engineering-method | 289 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-clip-from-moodboard | playbooks | media-eventtech | 321 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-content-studio | playbooks | media-eventtech | 253 | agent | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-crew-call-sheet | playbooks | media-eventtech | 245 | agent | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-deploy-saas | playbooks | saas-ops | 268 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-docs-site | playbooks | design-ui-ux | 272 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-event-tracker | playbooks | media-eventtech | 256 | agent | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-focus-chunks | playbooks | bdb-core | 250 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-harness-work | playbooks | bdb-core | 353 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-health-weekly | playbooks | saas-ops | 297 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-idea-to-launch | playbooks | engineering-method | 296 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-image-to-3d | playbooks | media-eventtech | 280 | graph | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-inbox-zero | playbooks | bdb-core | 211 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-invoice-check | playbooks | business-ops | 238 | agent+rules | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-landing-page | playbooks | design-ui-ux | 258 | graph | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-launch-video | playbooks | media-eventtech | 267 | graph+agent | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-machine-setup | playbooks | bdb-core | 312 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-master | playbooks | bdb-core | 259 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-meeting-actions | playbooks | bdb-core | 273 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-newsletter | playbooks | design-ui-ux | 256 | graph | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-offer | playbooks | business-ops | 188 | agent+rules | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-open-source | playbooks | engineering-method | 337 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-pcb-to-case | playbooks | engineering-hardware | 266 | graph | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-redesign-app | playbooks | design-ui-ux | 342 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-release-aos | playbooks | bdb-core | 296 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-security-sweep | playbooks | engineering-method | 330 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-show-build | playbooks | media-eventtech | 356 | graph+agent | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-social-pack | playbooks | media-eventtech | 320 | graph | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-tauri-e2e | playbooks | engineering-method | 223 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-todo | playbooks | bdb-core | 214 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-week-plan | playbooks | bdb-core | 284 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| pb-worktrees-land | playbooks | bdb-core | 292 | - | move-to-store | playbook outside the stack-agnostic starter set; listed by /playbooks only when installed |
| playwright-skill | global_config | library | 249 | - | move-to-store | single-purpose tool skill, no pipeline reference |
| posix-shell-pro | global_config | library | 183 | - | move-to-store | build/ops detail, only opensource agents name bash-linux |
| pr-recap | global_config | engineering-method | 234 | - | move-to-store | git/CI helper; the harness and reviewer agents cover the default flow |
| prisma-expert | global_config | library | 183 | - | move-to-store | database/vendor specifics; database-reviewer is the only agent reference |
| product-manager-toolkit | global_config | library | 89 | - | move-to-store | docs/product helper, generic names hit many files only by word match |
| programmatic-seo | global_config | library | 123 | - | move-to-store | marketing/SEO domain; copywriting only via the optional copywriter profile |
| prompt-engineer | global_config | engineering-method | 156 | - | move-to-store | LLM-app dev; domain skill for a minority of projects |
| rag-implementation | global_config | library | 162 | agent | move-to-store | LLM-app dev; domain skill for a minority of projects |
| readme | global_config | library | 194 | - | move-to-store | docs/product helper, generic names hit many files only by word match |
| remotion | global_config | library | 115 | agent | move-to-store | media/hardware pack; named only by niche agents (video-motion, event-manager, pcb) |
| requesting-code-review | global_config | engineering-method | 107 | - | move-to-store | git/CI helper; the harness and reviewer agents cover the default flow |
| reverse-engineer-anything | global_config | engineering-method | 249 | - | move-to-store | issue-tracker/domain workflow family; opt-in methodology |
| schema-markup | global_config | library | 114 | - | move-to-store | marketing/SEO domain; copywriting only via the optional copywriter profile |
| simplify-code | global_config | engineering-method | 89 | - | move-to-store | git/CI helper; the harness and reviewer agents cover the default flow |
| skill-create | basic | bdb-core | 290 | - | move-to-store | single-purpose or documented-only; one AGENTS.md mention at most |
| spline-3d-integration | global_config | media-eventtech | 124 | graph+agent | move-to-store | media/eventtech pack; in nodes.json only for the optional media_eventtech node. Needs the node to tolerate a missing skill or auto-install it |
| subagent-setup | global_config | bdb-core | 204 | - | move-to-store | tool/config guide for a single optional component |
| synapse-integration-skill | (root) | bdb-core | 75 | - | move-to-store | tool/config guide for a single optional component |
| tanstack-query-expert | global_config | library | 192 | - | move-to-store | JS/React library detail, no pipeline reference |
| fabric-teamwork | basic | bdb-core | 238 | - | move-to-store | single-purpose or documented-only; one AGENTS.md mention at most |
| threejs-skills | global_config | media-eventtech | 191 | graph+agent+rules | move-to-store | media/eventtech pack; in nodes.json only for the optional media_eventtech node. Needs the node to tolerate a missing skill or auto-install it |
| tmux | global_config | library | 136 | hook | move-to-store | general research/terminal helper; harness-native deep-research exists, no pipeline reference |
| to-spec | global_config | engineering-method | 149 | - | move-to-store | issue-tracker/domain workflow family; opt-in methodology |
| token-saver-config | global_config | bdb-core | 92 | - | move-to-store | tool/config guide for a single optional component |
| triage | global_config | engineering-method | 119 | - | move-to-store | issue-tracker/domain workflow family; opt-in methodology |
| turborepo-caching | global_config | library | 176 | - | move-to-store | build/ops detail, only opensource agents name bash-linux |
| two-axis-code-review | global_config | engineering-method | 419 | - | move-to-store | git/CI helper; the harness and reviewer agents cover the default flow |
| ux-persuasion-engineer | global_config | design-ui-ux | 216 | - | move-to-store | design extra beyond the ui_ux node skills |
| vector-database-engineer | global_config | library | 200 | - | move-to-store | database/vendor specifics; database-reviewer is the only agent reference |
| vercel-ai-sdk-expert | global_config | library | 173 | - | move-to-store | provider-specific deploy skill; user-account dependent |
| vercel-deployment | global_config | library | 53 | - | move-to-store | provider-specific deploy skill; user-account dependent |
| wayfinder | global_config | engineering-method | 197 | - | move-to-store | issue-tracker/domain workflow family; opt-in methodology |
| web-artifacts-builder | global_config | library | 67 | - | move-to-store | single-purpose tool skill, no pipeline reference |
| web-performance-optimization | global_config | library | 147 | - | move-to-store | single-purpose tool skill, no pipeline reference |
| zustand-store-ts | global_config | library | 97 | - | move-to-store | JS/React library detail, no pipeline reference |
