---
name: godmode-shipping
description: Final gatekeeper for production releases. Pre-launch checks, feature flags, rollback, Spec-Driven Development.
category: engineering-method
---

# 🚀 BDB Shipping Godmode

This skill is the final gatekeeper. No code reaches production without passing these rigorous checks. It orchestrates release management and workflow discipline for the BDB ecosystem across all supported harnesses (Cursor, Claude Code, Agy, Copilot).

## Plan first

Planning starts on the plan canvas, and the human approves it there — not in chat. Pick the template by the work:

- Shipping a version to users → `release`; a reviewer deciding on a merge (verified vs not verified) → `recap-review`.

```bash
aos-plan-canvas new <template-id> <plan-dir>             # scaffold from the choice above
aos-plan-canvas open <plan-dir> --mode bdb-plan-builder  # render and open in the browser
aos-plan-canvas await <plan-dir>/plan.mdx                # keep listening until the verdict
```

On `approve` of a `release` plan, `aos-plan-canvas trail <plan-dir>` derives the agenttrail map for the build; a `recap-review` plan is the artifact itself (no components, no map). The full loop and every template: the `plan-canvas` skill — a plain CLI, identical on every harness.

## 1. Spec-Driven Development
Writing code without a specification is guessing.
*   **The Specification Phase:** Every major feature or refactor must begin by writing a clear markdown specification file.
*   **Boundaries & Constraints:** The spec must document the exact boundaries of the feature, edge cases, data structures, and the definition of "Done". Do not proceed to code until the user approves the spec.

## 2. Pre-Launch Validation Checklist
Before any code is committed, pushed, or deployed, you must actively verify the following:
*   [ ] **Test Suite Green:** All unit and E2E tests pass.
*   [ ] **No Test Skips:** No `.skip` or `.only` test blocks remain in the codebase.
*   [ ] **Sanitized Code:** No floating `console.log` or debug statements left behind. No local absolute paths or usernames.
*   [ ] **Documentation Synced:** `.openwiki/` and `README.md` updated via `openwiki-skill`.
*   [ ] **Memory Ingested:** New architecture facts and decisions indexed into `memB` via `memb-ingest`.
*   [ ] **Accessibility Checked:** Core Web Vitals and WCAG 2.1 AA audits are clear.
*   [ ] **Security Verified:** API keys and secrets are safely managed via environment variables and never hardcoded.

## 3. Deployment & Rollout Strategy
Releasing code should be a boring event.
*   **Decouple Deploy from Release:** Pushing code to production does not mean the user sees it immediately. Use Feature Flags to merge code safely into main without exposing it to the user.
*   **Dark Launching:** Test the code in production with synthetic traffic or internal users before flipping the feature flag for the public.
*   **Staged Rollouts:** For critical features, roll out sequentially (Internal Team -> 5% of users -> 50% -> 100%).
*   **Mechanism:** When a project has a `bdb-deploy.json`, use the `bdb-deploy` skill for the actual build+rsync+restart+healthcheck step — always `--dry-run` first, never hand-construct rsync/ssh commands (see `bdb-deploy`'s own SKILL.md for why). If a project has no `bdb-deploy.json` yet and needs one, that's a decision for the user (host, SSH key, remote path) — run `bdb-deploy init` interactively, don't invent the values.

## 4. Rollback Strategies
Never launch a feature without a verified rollback plan.
*   **Auto-Rollback Triggers:** Define exactly what metrics will trigger an automatic rollback (e.g., error rate jumps by >2x, latency spikes above 500ms).
*   **Database Migrations:** Ensure any database schema changes are backward compatible, or have a strictly tested `down` migration ready.

## 5. Creator Extension & BDB MediaStorm Governance
This Godmode extends beyond standard software development. It STRICTLY governs creative-tech and show-control workflows (BDB Creator Extension).
*   **MediaStorm Deployments:** When executing `/bdbmediastorm` for TouchDesigner, Unreal Engine, or Adobe Suite workflows, you must enforce rigorous release management for `.tox` files, Unreal Blueprints, and showfiles.
*   **Show-Ready Validation:** Never push a creative-tech update to a live production environment (e.g., a running installation or live show) without a verified fallback or backup showfile. 

## Visual recap
After the gates pass, `/pr-recap` can build a Plan Builder recap page of the diff with the Verified and Not verified checks. It is informational and does not gate the release. Posting it anywhere stays a human decision.

## Universal Agent Harness Integration
This Godmode is universally compatible and governs all extensions, including the BDB Creator Engine.
*   **Cursor:** Auto-injected via `.cursor/rules/godmode-shipping.mdc`.
*   **Claude Code:** Reads principles via `CLAUDE.md`.
*   **Agy / CLI Agents:** Natively enforced via the prompt orchestrator.
*   **Execution:** You (the AI) must present the Pre-Launch Checklist to the user before confirming a task is completely finished.

## 1. Overview
This skill provides domain-specific logic and rules for its respective BDB pipeline component to ensure standardization across multi-agent workflows.

## 2. When to Use
- Use when specifically requested by the user or triggered by an orchestration agent.
- Use when the current task aligns with the skill's domain.
- Exclude when standard tool execution is sufficient.

## 3. Core Process
1. Read the provided context and ensure preconditions are met.
2. Run the required script or tool and confirm the state change.
3. Verify exit codes, file modifications, or DB counts to guarantee success before reporting completion.

## 4. Common Rationalizations
| Rationalization | Reality |
|---|---|
| "The code change was small, so I skipped updating OpenWiki docs." | Every state change must be reflected in the relevant system records. |
| "The ingest script exited without an error, so the memB index must be updated." | Silent failures happen; explicit verification of the side effect is mandatory. |
| "I'll let the /fabric proceed without a defined rollback path." | Proceeding without a rollback path corrupts the workflow integrity and safety. |
| "I trust the cached agent registry instead of rescanning after a skill change." | Caches stale out quickly; explicit rescans prevent ghost failures. |

## Going live
The release report is not a deployment. If the user wants the product live on their own accounts, point to the `golive` skill; for the BDB fleet (own backend) as a guided host, give it `references/golive-bdb-fleet.md` from this skill. Do not deploy from this skill, and never edit the vendored golive folder: its `release.json` pins every file's hash and the CLI refuses to start on any change.

## 5. Red Flags
- Bypassing the verification step after a script execution.
- Proceeding to the next pipeline stage without confirming the previous stage's side effects.
- Ignoring domain-specific constraints listed in this skill.

## 6. Verification
- [ ] Verified script exit codes are explicitly checked.
- [ ] Confirmed target files or database records reflect the expected change.
- [ ] Ensured no silent failures were ignored before reporting success.


---

## App dev Pack Skills

<!-- aos:pack-index:start -->
- **software-architecture** — Quality-focused architecture guidance (Clean Architecture, DDD). Use when designing architecture, writing or analyzing code in projects.
- **api-design-principles** — Master REST and GraphQL API design principles to build intuitive, scalable, and maintainable APIs that delight developers and stand the test of time.
- **test-driven-development** — Use when implementing any feature or bugfix, before writing implementation code
- **systematic-debugging** — Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
- **clean-code** — This skill embodies the principles of \"Clean Code\" by Robert C. Martin (Uncle Bob). Use it to transform \"code that works\" into \"code that is clean.\"
- **concise-planning** — Use when a user asks for a plan for a coding task, to generate a clear, actionable, and atomic checklist.
- **planning-with-files** — Work like Manus: Use persistent markdown files as your \"working memory on disk.\"
- **subagent-driven-development** — Dispatch a fresh subagent per task: implementation plans with independent tasks, two-stage review each: spec compliance, then quality.
- **dispatching-parallel-agents** — Dispatch one subagent per independent task slice. Use with 2+ tasks: parallel work, unrelated failures or shared state; no shared state needed.
- **using-git-worktrees** — Use for feature work needing isolation or before executing a plan: ensure an isolated worktree via native tools or git worktrees.
- **finishing-a-development-branch** — Use when implementation is complete, all tests pass, and you need to decide how to integrate the work
- **architect-review** — Master software architect specializing in modern architecture
- **bdb-security-audit** — Comprehensive security auditing, diff analysis, defensive checklists, and vulnerability testing.
- **bdbresilience** — CI/CD error recovery, distributed file-based locking, diagnostic triage and GO-gate resilience for BDB Agent OS multi-agent pipelines.
- **bdb-shipping-skill** — Pre-flight shipping decisions: problem-framing, one/two-way door classification, ADR logging, outcome loop. Complements godmode-shipping and bdbresilience.
- **webapp-testing** — To test local web applications, write native Python Playwright scripts.
- **playwright-skill** — Use when a task needs custom Playwright code: end-to-end testing, scraping a JS-rendered page, or driving a browser interactively via a universal executor.
- **github** — Use the `gh` CLI for issues, pull requests, Actions runs, and GitHub API queries.
- **github-repo** — Standards and workflows for writing, formatting, sanitizing, and publishing high-quality GitHub repositories, complementing openwiki-skill.
- **ci-pipeline** — Set up CI/CD: detect the stack, generate GitHub Actions workflows, Dockerfile and Makefile. Use when asked to set up CI or automate builds.
- **github-actions-generator** — Create, generate, or scaffold GitHub Actions workflows, action.yml, or .github/workflows CI/CD pipelines.
- **github-actions-validator** — Validate, lint, audit, fix GitHub Actions workflows (.github/workflows).
- **requesting-code-review** — Use when completing tasks, implementing major features, or before merging to verify work meets requirements
- **two-axis-code-review** — Two-axis review since a fixed point: Standards (repo standards) and Spec (matches the issue) in parallel sub-agents. Use to review a branch, PR or WIP changes.
- **simplify-code** — Review a diff for clarity and safe simplifications, then optionally apply low-risk fixes.
- **pr-recap** — Visual recap page for a PR or git range: changed-files tree, per-file notes, verified table, risks, before/after images. Local review aid, never posts.
- **typescript-pro** — Master TypeScript with advanced types, generics, and strict type safety. Handles complex type systems, decorators, and enterprise-grade patterns.
- **modern-javascript-patterns** — Modern JavaScript: ES6+, functional patterns, best practices. Clean, maintainable, performant code.
- **docker-expert** — Docker containerization. Use for optimization, security hardening, multi-stage builds, orchestration patterns, and production deployment strategies.
- **bdb-deploy** — Deploy a project to a real server via rsync over SSH. Use when the user says deploy this or push it live. Not for git push or CI pipelines.
- **golive** — Ship app from repo to production on user accounts. Auth, payments, email, DNS. Approval gates, verification evidence.
- **vercel-deployment** — Expert knowledge for deploying to Vercel with Next.js
- **cloudflare-workers-expert** — Expert in Cloudflare Workers and the Edge Computing ecosystem. Covers Wrangler, KV, D1, Durable Objects, and R2 storage.
- **agent-tool-builder** — Design tools for AI agents. Use when building agent tools: covers schema, error handling, and avoiding hallucination and silent failure.
- **agentic-harness-patterns** — Harness patterns for coding agents — memory, permissions, context engineering, delegation, skills, hooks, bootstrap.
- **llm-app-patterns** — Production-ready patterns for building LLM applications, inspired by [Dify](https://github.com/langgenius/dify) and industry best practices.
- **llm-structured-output** — Get reliable JSON, enums, and typed objects from LLMs using response_format, tool_use, and schema-constrained decoding across OpenAI, Anthropic, and Google APIs.
- **local-llm-expert** — Local LLM inference: model selection, VRAM optimization. Ollama, llama.cpp, vLLM, LM Studio, quantization.
- **rag-implementation** — RAG implementation workflow: embedding selection, vector database setup, chunking strategies and retrieval optimization.
- **prompt-engineer** — Transforms user prompts into optimized prompts using frameworks (RTF, RISEN, Chain of Thought, RODES, Chain of Density, RACE, RISE, STAR, SOAP, CLEAR, GROW)
- **crewai** — Expert in CrewAI - the leading role-based multi-agent framework used by 60% of Fortune 500 companies.
- **vercel-ai-sdk-expert** — Vercel AI SDK expertise: Core API, UI hooks (useChat, useCompletion), tool calling and streaming UI with React and Next.js.
- **gemini-api-integration** — Use when integrating Google Gemini API into projects. Covers model selection, multimodal inputs, streaming, function calling, and production best practices.
- **n8n-code-javascript** — JavaScript in n8n Code nodes. $input/$json/$node, HTTP requests, DateTime, error troubleshooting.
- **n8n-code-python** — Python in n8n Code nodes. _input/_json/_node syntax, standard library, limitations.
- **n8n-expression-syntax** — n8n expression syntax validation. {{}} syntax, $json/$node variables, expression errors, webhook data.
- **n8n-mcp-tools-expert** — n8n-mcp tools: nodes, configs, templates, workflows. Tool guidance, parameters, patterns.
- **n8n-workflow-patterns** — Proven architectural patterns for building n8n workflows.
- **agent-manager-skill** — Use when manage multiple local CLI agents via tmux sessions (start/stop/monitor/assign) with cron-friendly scheduling.
- **agent-memory-mcp** — Use when a hybrid memory system that provides persistent, searchable knowledge management for AI agents (Architecture, Patterns, Decisions).
- **subagent-setup** — Configure multi-harness subagents (Claude Code, Antigravity, OpenCode, Codex) with per-harness overrides and a single source in .aos/pipeline.json.
- **instinct-export** — Use when the user wants to share or back up learned instincts — validates the local instincts file, allowlists the six known fields, strips secrets and home-directory paths, and writes a sanitized JSON artifact the user names. Never modifies the instincts file itself.
- **instinct-import** — Use when the user brings an exported instincts JSON to merge into the local store — treats trigger and action as inert data, validates every entry against the shared format and its bounds, drops invalid ones loudly, and never overwrites an existing instinct without asking the user first.
- **instinct-status** — Use when the user wants to see what learned instincts exist, their confidence scores and how current they are — reads the local instincts file under ~/.aos/instincts/ and reports it. Read-only.
- **token-saver-config** — Configure and diagnose token-saver compression settings. Use when the user asks about adjusting compression levels, checking processor status, debugging hook issues, or reviewing savings statistics.
- **synapse-integration-skill** — Use when global skill for BDB Synapse (3D Codebase Visualizer) integration.
- **design-control-loop** — Interview the user to design an agentic control loop (sensor, controller, actuator) tailored to their codebase, then build it locally.
- **reverse-engineer-anything** — Reverse engineer native, managed, Electron, packaged, firmware or browser targets with REA. Skip for ordinary source repo analysis.
- **bdbhtmlmanueldocs** — Enterprise-grade developer docs and user manuals. HTML template, GitHub Pages hosting, neutral design system.
- **documentation** — Documentation generation workflow covering API docs, architecture docs, README files, code comments, and technical writing.
- **readme** — Write an absurdly thorough README.md as an expert technical writer. Use when creating or rewriting project README documentation.

**Install:** `aos store install --pack engineering`
<!-- aos:pack-index:end -->
