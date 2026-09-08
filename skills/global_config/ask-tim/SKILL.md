---
name: ask-tim
description: Meta-skill for discovering and routing to the right skill out of the ~154 available options. Use when a user or agent is unsure which skill fits their intent, or needs to pick between overlapping choices (e.g. build pipelines, scraping tools, UI components).
category: bdb-core
---

# `ask-tim`: The BDB Skill Routing Meta-Skill

This is a discovery and routing guide. It does not perform work itself. Use it to map a user's intent to the correct specialized skill(s).

## 🧭 Intent Index (Table of Contents)

If the user's intent matches one of these, jump to the corresponding section:

* **"I need to choose a build pipeline (startcycle vs startcycle-graph)"** ➔ [Agent Orchestration & Pipelines](#agent-orchestration--pipelines)
* **"I need multi-agent brainstorming or ideation"** ➔ [Agent Orchestration & Pipelines](#agent-orchestration--pipelines)
* **"I want to build a new UI component or page"** ➔ [Frontend, UI & Motion](#frontend-ui--motion)
* **"I want Tailwind, shadcn, or design-system UI work"** ➔ [Frontend, UI & Motion](#frontend-ui--motion)
* **"I'm optimizing React or Next.js performance"** ➔ [Frontend, UI & Motion](#frontend-ui--motion)
* **"I'm designing an API (REST/GraphQL)"** ➔ [Backend, APIs & Databases](#backend-apis--databases)
* **"I need Prisma, Drizzle, or Postgres schema help"** ➔ [Backend, APIs & Databases](#backend-apis--databases)
* **"I'm working with n8n workflows"** ➔ [Backend, APIs & Databases](#backend-apis--databases)
* **"I want to deploy to Vercel, Cloudflare, or a VPS"** ➔ [DevOps, Git & Deployment](#devops-git--deployment)
* **"I'm managing GitHub PRs, issues, or monorepos"** ➔ [DevOps, Git & Deployment](#devops-git--deployment)
* **"I want to scrape or extract data from a website"** ➔ [Web Scraping & Browser Automation](#web-scraping--browser-automation)
* **"I need to run browser automation or web testing"** ➔ [Web Scraping & Browser Automation](#web-scraping--browser-automation)
* **"I'm building an AI agent, RAG pipeline, or working with LLMs"** ➔ [AI, LLMs & Agents](#ai-llms--agents)
* **"I need an SEO, GEO, or accessibility audit"** ➔ [Content, SEO & Docs](#content-seo--docs)
* **"I need to write a README or documentation"** ➔ [Content, SEO & Docs](#content-seo--docs)
* **"I need to debug a failing test or weird bug"** ➔ [Core Programming & Debugging](#core-programming--debugging)
* **"I want to ship a feature safely to production"** ➔ [Core Programming & Debugging](#core-programming--debugging)
* **"I'm managing the BDB SaaS multi-cloud fleet"** ➔ [BDB Ecosystem & SaaS Ops](#bdb-ecosystem--saas-ops)
* **"I need Three.js, 3D, or motion work"** ➔ [Media & EventTech](#media--eventtech)
* **"I need live event tech, TouchDesigner, or Resolume help"** ➔ [Media & EventTech](#media--eventtech)

---

## 🏗️ Agent Orchestration & Pipelines

Use these skills to orchestrate complex multi-agent workflows.

* **Top Picks:** `startcycle-graph`, `bdbrainstorm`

### Overlap: The 3 Build Pipelines
Don't guess which pipeline to use. Follow these rules (source of truth: `CLAUDE.md` and `skills/basic/*/SKILL.md`):
* **`startcycle`**: Use for a straight-line, predictable run through the agents with file hand-offs and no state machine. Cheapest of the three.
* **`startcycle-graph`**: Use when you need the full dispatcher graph: durable `state.json`, a Reviewer repair loop, a quality gate, and human escalation.
* **`startcycle-graph-user`**: Use for a small throwaway fan-out (2-4 nodes) in any project without persistent artifacts.

### Overlap: Brainstorming
* **`bdbrainstorm`**: For multi-agent software engineering ideation, UI/UX design, and architecture planning. Handoffs to `/startcycle-graph`.
* **`bdbmediastorm`**: For creative-tech, live event technology, and show-control systems (TouchDesigner, Resolume, grandMA3).

*Also see:* `agent-pipeline`, `subagent-driven-development`.

---

## 🎨 Frontend, UI & Motion

Use these skills for UI development, component architecture, and design taste.

* **Top Picks:** `godmode-ui-ux`, `ui-component`, `senior-frontend`

### Overlap: The UI Cluster vs Senior Frontend
* **`ui-component` / `ui-page` / `ui-pattern`**: Use these strictly when scaffolding new pieces in the **StyleSeed Toss** design system convention (enforcing tokens, spacing, and rhythm).
* **`ui-review` / `ui-tokens`**: Use for reviewing code against StyleSeed or syncing its design tokens.
* **`senior-frontend`**: Use for general React/Next.js/Tailwind development outside of strict StyleSeed scaffolding, or for reviewing general frontend code quality.
* **`shadcn`**: Use specifically when adding or customizing shadcn/ui components.
* **`tailwind-patterns`**: Use when managing CSS-first configurations, container queries, or Tailwind CSS v4 design token architectures.

### Overlap: React & Next.js Performance
* **`react-best-practices`**: The Vercel-maintained guide for broad performance optimization and App Router data fetching.
* **`react-patterns`**: Use for core hooks, composition, and TypeScript best practices.
* **`nextjs-app-router-patterns` / `nextjs-best-practices`**: Use specifically for Next.js App Router architecture and routing.
* **`react-component-performance`**: Use for targeted diagnosis of slow React components (e.g., render bottlenecks).

*Also see:* `bdbdesignpro`, `design-spells`.

---

## 🗄️ Backend, APIs & Databases

Use these for server-side architecture, APIs, workflows, and database schema design.

* **Top Picks:** `godmode-engineering`, `api-design-principles`, `drizzle-orm-expert`

### Overlap: Database & ORM Choices
* **`database-design`**: Use for overarching schema design, indexing strategy, and general database principles.
* **`postgres-best-practices`**: Use for raw performance optimization, queries, and Supabase-specific patterns.
* **`postgresql`**: Use for raw schema design, indexing, and Postgres constraints.
* **`using-neon` / `neon-postgres`**: Use specifically when working with Neon's serverless Postgres (branching, connection pooling).
* **`prisma-expert`**: Use for Prisma ORM schema design, migrations, and relational modeling.
* **`drizzle-orm-expert`**: Use for Drizzle ORM type-safe queries and serverless integrations.

### Overlap: The n8n Cluster
* **`n8n-workflow-patterns`**: Use for architectural patterns of whole workflows.
* **`n8n-code-javascript` / `n8n-code-python`**: Use when writing custom code inside n8n Code nodes (handles `$input`/`$json` nuances for JS/Python).
* **`n8n-expression-syntax`**: Use for debugging `{{}}` expressions.
* **`n8n-mcp-tools-expert`**: Use for integrating n8n-mcp tools effectively.

*Also see:* `api-patterns`, `openapi-spec-generation`, `golang-pro`, `python-pro`.

---

## 🕷️ Web Scraping & Browser Automation

Use these skills to extract data or control browsers.

* **Top Picks:** `apify-ultimate-scraper`, `playwright-skill`

### Overlap: Scraping and Extraction
* **`apify-ultimate-scraper`**: The top-level choice. Automatically selects from 55+ Apify Actors for the task.
* **`apify-lead-generation`**: Narrow use case: scraping leads from multiple platforms.
* **`web-scraper`**: Multi-strategy data extraction (tables, prices) with pagination and CSV/JSON export.
* **`browser-automation`**: General principles for selectors, waiting, and anti-detection.
* **`playwright-skill`**: Universal executor for custom Playwright code (e2e testing, interactive scraping).
* **`go-playwright`**: Use when writing browser automation in Go.
* **`webapp-testing`**: Use when writing native Python Playwright scripts for local testing.

---

## 🚀 DevOps, Git & Deployment

Use these to ship code, manage infrastructure, and handle source control.

* **Top Picks:** `godmode-shipping`, `github`, `vercel-deployment`

* **Godmode Shipping**: `godmode-shipping` is the ultimate pre-launch gatekeeper (lint, tests, rollbacks).
* **Deployments**: `vercel-deployment` (Next.js/React), `cloudflare-workers-expert` (Edge/KV/D1), `bdb-deploy` (rsync over SSH to VPS), `docker-expert` (Containers).
* **Git/GitHub**: `git-advanced-workflows`, `git-pr-review`, `github-workflow-automation`, `github-repo`.
* **Monorepos**: `turborepo-caching`, `monorepo-management`.

---

## 🧠 AI, LLMs & Agents

Use these when building AI products or optimizing models.

* **Top Picks:** `prompt-engineer`, `llm-structured-output`, `rag-engineer`

* **Agent Dev**: `ai-agent-development`, `crewai`.
* **LLM Integration**: `gemini-api-integration`, `local-llm-expert`, `llm-app-patterns`.
* **Prompting**: `prompt-engineering-patterns`, `llm-prompt-optimizer`.
* **RAG**: `rag-implementation`.

---

## 📝 Content, SEO & Documentation

Use these for docs, markdown, and search engine optimization.

* **Top Picks:** `readme`, `seo`, `documentation`

* **Docs**: `openwiki-skill`, `readme`, `copywriting`.
* **SEO**: `seo` (broad audit), `seo-technical` (crawlability, CWV), `seo-audit` (rankings), `geo-fundamentals` (AI search), `programmatic-seo`, `schema-markup`.

---

## 🔧 Core Programming & Debugging

Use these for raw problem solving and code hygiene.

* **Top Picks:** `systematic-debugging`, `clean-code`, `test-driven-development`

* **Debugging**: `debugger` (general errors), `systematic-debugging` (structured triage before fixing).
* **Hygiene**: `simplify-code` (diff review for clarity).
* **TDD**: `tdd-workflow`.

---

## 🌀 BDB Ecosystem & SaaS Ops

Specific utilities for the BDB environment.

* **Top Picks:** `bdbsaashost`, `memb-skill`

### Overlap: SaaS Ops
* **`bdbsaas-ops`**: Retired. Do not use.
* **`bdbsaashost`**: The active skill for managing the BDB Multi-Cloud Fleet (GCP, Oracle, Incus).
* **`bdbsaastraining`**: For onboarding/training staff on the host engine.

*Also see:* `bdb-ecosystem-health`, `bdb-dev-os-skill`, `memb-ingest`, `synapse-integration-skill`.

---

## 🧊 Media & EventTech

Use these for 3D, motion, and live show control.

* **Top Picks:** `godmode-eventtech`, `godmode-3d-creation`, `godmode-media-creation`

* **Godmodes**: Determine the overarching flow (3D, Media, EventTech).
* **Implementations**: `MCP_Manage` (Unreal, Rhino, Resolve, TouchDesigner), `spline-3d-integration` (web 3D), `threejs-skills` (WebGL).

---

## 🛡️ Overlap: The Supreme Godmodes

When do you use a `godmode-*` skill versus a narrower skill?
* **`godmode-ui-ux`, `godmode-engineering`, `godmode-shipping`, `godmode-3d-creation`, `godmode-media-creation`, `godmode-eventtech`** are orchestrator/enforcer skills. They hold the "supreme rulebook" for a domain. Use them when starting a major feature or defining the overarching architecture of a task.
* Use narrower skills (e.g., `shadcn`, `drizzle-orm-expert`, `threejs-skills`) for the tactical implementation inside those domains.

---

## 🛑 Fallback Note

If none of the intents above match your task, look for the closest general library skill in the catalog. 

**Remember:** This file helps discover skills, but **`CLAUDE.md`** is the canonical source of truth for the primary Skill Routing by Domain table and the exact rules for Agent Counts (subagents vs teams vs solo). Do not rely on `ask-tim` to dictate pipeline definitions—always defer to `CLAUDE.md`.
