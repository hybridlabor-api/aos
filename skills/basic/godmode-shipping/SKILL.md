---
name: godmode-shipping
description: Final gatekeeper for production releases. Pre-launch checks, feature flags, rollback, Spec-Driven Development.
category: engineering-method
---

# 🚀 BDB Shipping Godmode

This skill is the final gatekeeper. No code reaches production without passing these rigorous checks. It orchestrates release management and workflow discipline for the BDB ecosystem across all supported harnesses (Cursor, Claude Code, Agy, Copilot).

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
| "I'll let the /startcycle proceed without a defined rollback path." | Proceeding without a rollback path corrupts the workflow integrity and safety. |
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
- **software-architecture** — "Guide for quality focused software architecture. This skill should be used when users want to write code, design architecture, analyze code, in any case that relates to software development."
- **api-design-principles** — "Master REST and GraphQL API design principles to build intuitive, scalable, and maintainable APIs that delight developers and stand the test of time."
- **test-driven-development** — "Use when implementing any feature or bugfix, before writing implementation code"
- **systematic-debugging** — "Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes"
- **clean-code** — "This skill embodies the principles of \"Clean Code\" by Robert C. Martin (Uncle Bob). Use it to transform \"code that works\" into \"code that is clean.\""
- **concise-planning** — "Use when a user asks for a plan for a coding task, to generate a clear, actionable, and atomic checklist."
- **planning-with-files** — "Work like Manus: Use persistent markdown files as your \"working memory on disk.\""
- **subagent-driven-development** — "Use when executing implementation plans with independent tasks in the current session — trigger phrases \"execute the plan\", \"independent tasks\", \"parallel tasks\", \"subagents for the plan\",\"split the plan into subagents\". Dispatches a fresh subagent per task with two-stage review after each: spec compliance first, then code quality."
- **dispatching-parallel-agents** — >-
- **using-git-worktrees** — Use when starting feature work that needs isolation from current workspace or before executing implementation plans - ensures an isolated workspace exists via native tools or git worktree fallback
- **finishing-a-development-branch** — Use when implementation is complete, all tests pass, and you need to decide how to integrate the work
- **architect-review** — "Master software architect specializing in modern architecture"
- **bdb-security-audit** — Comprehensive security auditing, diff analysis, defensive checklists, and vulnerability testing.
- **bdbresilience** — Autonomous CI/CD error recovery, distributed file-based locking, diagnostic triage, and two-phase GO gate resilience engine for BDB Agent OS multi-agent pipelines.
- **bdb-shipping-skill** — "Use before starting any significant build or before shipping: problem-framing pre-flight, one-way/two-way door classification, ADR-lite decision logging, and post-ship outcome loop. Complements godmode-shipping (technical gate) and bdbresilience (error recovery)."
- **webapp-testing** — "To test local web applications, write native Python Playwright scripts."
- **playwright-skill** — General-purpose browser automation skill. Use when a task needs custom Playwright code — end-to-end testing, scraping a JS-rendered page, or driving a browser interactively — executed via this skill's universal executor rather than a one-off script.
- **github** — "Use the `gh` CLI for issues, pull requests, Actions runs, and GitHub API queries."
- **github-repo** — github-repo
- **ci-pipeline** — >-
- **github-actions-generator** — Create, generate, or scaffold GitHub Actions workflows, action.yml, or .github/workflows CI/CD pipelines.
- **github-actions-validator** — Validate, lint, audit, fix GitHub Actions workflows (.github/workflows).
- **requesting-code-review** — Use when completing tasks, implementing major features, or before merging to verify work meets requirements
- **two-axis-code-review** — "Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to \"review since X\"."
- **simplify-code** — "Review a diff for clarity and safe simplifications, then optionally apply low-risk fixes."
- **pr-recap** — Use when a PR or git range needs a visual recap page for a reviewer, with a changed-files tree, per-file notes, a Verified vs Not verified table, risks, and optional before/after images. Local and informational; never posts to GitHub.
- **typescript-pro** — Master TypeScript with advanced types, generics, and strict type safety. Handles complex type systems, decorators, and enterprise-grade patterns.
- **modern-javascript-patterns** — "Comprehensive guide for mastering modern JavaScript (ES6+) features, functional programming patterns, and best practices for writing clean, maintainable, and performant code."
- **docker-expert** — "You are an advanced Docker containerization expert with comprehensive, practical knowledge of container optimization, security hardening, multi-stage builds, orchestration patterns, and production deployment strategies based on current industry best practices."
- **bdb-deploy** — Use when the user wants to build and deploy a project to a real server via rsync over SSH — "deploy this", "push the build live", "sync to production". Not for git push/PR workflows, and not a replacement for a real CI pipeline; this is the direct-deploy path.
- **golive** — Take an agent-written app from repo to live production on the user's OWN accounts, with providers they choose (hosting, database, auth, payments, email, domain/DNS). The human connects accounts and approves changes; supported wiring operations run through a local CLI and produce verification evidence with explicit limits. Use when the user wants to ship, deploy, go live, launch, publish, or put their app online, or asks to wire up env vars, webhooks, auth settings (signup, email confirmation, password policy), a real signup → confirmation email → login journey, password recovery, account isolation between two users, auth redirects, email DNS or a custom domain.
- **vercel-deployment** — Expert knowledge for deploying to Vercel with Next.js
- **cloudflare-workers-expert** — "Expert in Cloudflare Workers and the Edge Computing ecosystem. Covers Wrangler, KV, D1, Durable Objects, and R2 storage."

**Install:** `aos store install --pack app-dev`
<!-- aos:pack-index:end --><!-- aos:pack-index:end -->
