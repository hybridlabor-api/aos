---
name: godmode-engineering
description: Domain-Driven Design, strict TypeScript, Clean Architecture. Backend/fullstack implementation and 5-step debugging triage.
category: engineering-method
---

# ⚙️ BDB Engineering Godmode

This skill orchestrates the core logic, domain modeling, and typing constraints of the codebase. It replaces scattershot coding with rigorous, structured engineering methodologies designed for the BDB ecosystem. As an agent, you must execute these principles rigorously across all supported harnesses (Cursor, Claude Code, Agy, Copilot).

## Plan first

Planning starts on the plan canvas, and the human approves it there — not in chat. Pick the template by the work:

- System design or reshaping → `architecture`; one defect → `bugfix`; a data or service move → `migration`; choosing between options → `research`.

```bash
aos-plan-canvas new <template-id> <plan-dir>             # scaffold from the choice above
aos-plan-canvas open <plan-dir> --mode bdb-plan-builder  # render and open in the browser
aos-plan-canvas await <plan-dir>/plan.mdx                # keep listening until the verdict
```

On `approve` of an `architecture`, `bugfix` or `migration` plan, `aos-plan-canvas trail <plan-dir>` derives the agenttrail map for the build; a `research` plan is the artifact itself (no components, no map). The full loop and every template: the `plan-canvas` skill — a plain CLI, identical on every harness.

## 1. Domain Modeling & Type Strictness
Code represents business logic. Do not write implementation details before defining the boundaries.
*   **Strict Typing:** `any` is strictly forbidden. Use `unknown` if a type is truly dynamic, and validate it at runtime (e.g., using Zod).
*   **Discriminated Unions:** Always use Discriminated Unions (tagged unions) to model state machines. Never rely on multiple optional boolean flags (e.g., `isLoading`, `isError`, `isSuccess`). Instead, use `{ status: 'loading' } | { status: 'error', error: string } | { status: 'success', data: T }`.
*   **Immutability:** State must be immutable. Use `.map()`, `.filter()`, and `.reduce()` over standard `for` loops where data transformation is required.

## 2. Codebase Architecture (Clean Architecture)
Do not couple business logic tightly to framework details (like React components or Express routes).
*   **Separation of Concerns:** Keep UI logic separate from data fetching. Use custom hooks (in React) or Controllers/Services (in backend) to abstract API calls.
*   **Dependency Injection:** Pass dependencies as arguments rather than hardcoding global imports to ensure the logic remains testable.
*   **ADR (Architecture Decision Records):** For any major architectural choice (e.g., choosing a new ORM, changing a state management pattern), document the context, decision, and consequences before proceeding.

## 3. Systematic Debugging (The 5-Step Triage)
Do not guess fixes based on a single error log line. If an error occurs, you must execute the 5-step triage:
1.  **Reproduce:** Find the exact sequence of inputs that reliably causes the error.
2.  **Localize:** Narrow down the error to a specific file or function.
3.  **Reduce:** Isolate the function. Can the bug be replicated in a minimal unit test?
4.  **Fix:** Implement the precise logic fix without breaking adjacent code.
5.  **Guard:** Write a permanent test (Unit or E2E) to prevent regressions.

## 4. Observability & Telemetry
Production code fails. You must ensure we know *why* it failed.
*   **Structured Logging:** Do not use `console.log("here")`. Use structured, level-based logging with context (e.g., `logger.error("Failed to fetch user", { userId, error: e.message })`).
*   **Error Boundaries:** Ensure the app handles unexpected errors gracefully without crashing the entire process (React Error Boundaries, Node.js global catchers).

## 5. Creator Extension & BDB MediaStorm Governance
This Godmode extends beyond standard software development. It STRICTLY governs creative-tech and show-control workflows (BDB Creator Extension).
*   **11-MCP Validation:** When the user invokes `/bdbmediastorm` for TouchDesigner, Unreal Engine, GrandMA3, or Adobe Suite workflows, you MUST validate the signal flow against hardware constraints and MCP availability.
*   **Creative-Tech Architecture:** The same principles of Clean Architecture and Modularity apply to node-based graphs (TouchDesigner), Blueprint architectures (Unreal), and DMX showfiles. Do not create monolithic, entangled creative networks.

## Universal Agent Harness Integration
This Godmode is universally compatible and governs all extensions, including the BDB Creator Engine.
*   **Cursor:** Auto-injected via `.cursor/rules/godmode-engineering.mdc`.
*   **Claude Code:** Reads principles via `CLAUDE.md`.
*   **Agy / CLI Agents:** Natively enforced via the prompt orchestrator.
*   **Execution:** You (the AI) must silently validate your planned logic against these strict engineering principles before writing code.

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
### App dev Pack Skills

- **software-architecture** — Quality-focused architecture guidance (Clean Architecture, DDD). Use when designing architecture, writing or analyzing code in projects.
- **api-design-principles** — Master REST and GraphQL API design principles to build intuitive, scalable, and maintainable APIs that delight developers and stand the test of time.
- **test-driven-development** — Use when implementing any feature or bugfix, before writing implementation code
- **systematic-debugging** — Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
- **clean-code** — This skill embodies the principles of \"Clean Code\" by Robert C. Martin (Uncle Bob). Use it to transform \"code that works\" into \"code that is clean.\"
- **concise-planning** — Use when a user asks for a plan for a coding task, to generate a clear, actionable, and atomic checklist.
- **planning-with-files** — Work like Manus: Use persistent markdown files as your \"working memory on disk.\"
- **subagent-driven-development** — >-
- **dispatching-parallel-agents** — >-
- **using-git-worktrees** — >-
- **finishing-a-development-branch** — Use when implementation is complete, all tests pass, and you need to decide how to integrate the work
- **architect-review** — Master software architect specializing in modern architecture
- **bdb-security-audit** — Comprehensive security auditing, diff analysis, defensive checklists, and vulnerability testing.
- **bdbresilience** — >-
- **bdb-shipping-skill** — Pre-flight shipping decisions: problem-framing, one/two-way door classification, ADR logging, outcome loop. Complements godmode-shipping and bdbresilience.
- **webapp-testing** — To test local web applications, write native Python Playwright scripts.
- **playwright-skill** — Use when a task needs custom Playwright code: end-to-end testing, scraping a JS-rendered page, or driving a browser interactively via a universal executor.
- **github** — Use the `gh` CLI for issues, pull requests, Actions runs, and GitHub API queries.
- **github-repo** — Standards and workflows for writing, formatting, sanitizing, and publishing high-quality GitHub repositories, complementing openwiki-skill.
- **ci-pipeline** — >-
- **github-actions-generator** — Create, generate, or scaffold GitHub Actions workflows, action.yml, or .github/workflows CI/CD pipelines.
- **github-actions-validator** — Validate, lint, audit, fix GitHub Actions workflows (.github/workflows).
- **requesting-code-review** — Use when completing tasks, implementing major features, or before merging to verify work meets requirements
- **two-axis-code-review** — Two-axis review since a fixed point: Standards (repo standards) and Spec (matches the issue) in parallel sub-agents. Use to review a branch, PR or WIP changes.
- **simplify-code** — Review a diff for clarity and safe simplifications, then optionally apply low-risk fixes.
- **pr-recap** — Visual recap page for a PR or git range: changed-files tree, per-file notes, verified table, risks, before/after images. Local review aid, never posts.
- **typescript-pro** — Master TypeScript with advanced types, generics, and strict type safety. Handles complex type systems, decorators, and enterprise-grade patterns.
- **modern-javascript-patterns** — Modern JavaScript: ES6+, functional patterns, best practices. Clean, maintainable, performant code.
- **docker-expert** — >-
- **bdb-deploy** — >-
- **golive** — Ship app from repo to production on user accounts. Auth, payments, email, DNS. Approval gates, verification evidence.
- **vercel-deployment** — Expert knowledge for deploying to Vercel with Next.js
- **cloudflare-workers-expert** — Expert in Cloudflare Workers and the Edge Computing ecosystem. Covers Wrangler, KV, D1, Durable Objects, and R2 storage.

**Install:** `aos store install --pack app-dev`


### Stacks Pack Skills

### Db

- **prisma-expert** — Prisma ORM expertise: schema design, migrations, query optimization, relations modeling and database operations across PostgreSQL, MySQL and SQLite.
- **drizzle-orm-expert** — >-
- **postgres-best-practices** — Supabase Postgres performance best practices. Use when writing, reviewing or optimizing Postgres queries, schema designs or database configurations.
- **neon-postgres** — >-
- **database-design** — Database design principles and decision-making. Schema design, indexing strategy, ORM selection, serverless databases.
- **vector-database-engineer** — Vector databases, embedding strategies and semantic search with Pinecone, Weaviate, Qdrant, Milvus, pgvector for RAG and recommendation systems.

### Python

- **python-pro** — Modern Python 3.12+ expertise: async, performance, production practices and the latest ecosystem tooling (uv, ruff, pydantic, FastAPI).

### Go

- **golang-pro** — Master Go 1.21+ with modern patterns, advanced concurrency, performance optimization, and production-ready microservices.
- **go-concurrency-patterns** — Go concurrency: goroutines, channels, sync primitives, context. Worker pools, race condition debugging.

### Rust

- **rust-pro** — Use when writing, debugging or structuring Rust: ownership and borrow-checker errors, error handling, async/tokio, cargo workflow, unsafe code, or Tauri v2 backends.
- **tauri-pilot** — Use when driving or testing a running Tauri v2 app via CLI or MCP: inspect the UI, click and fill elements, assert state, record and replay sessions, and run TOML scenarios over a local socket.

### React

- **tanstack-query-expert** — TanStack Query (React Query) expertise: data fetching, stale time, mutations, optimistic updates, Next.js SSR. Use for async state management.
- **zustand-store-ts** — Create Zustand stores following established patterns with proper TypeScript types and middleware.

### Repo

- **turborepo-caching** — Configure Turborepo with local and remote caching. Use when setting up Turborepo, optimizing build pipelines or implementing distributed caching.
- **monorepo-management** — Build efficient, scalable monorepos that enable code sharing, consistent tooling, and atomic changes across multiple packages and applications.
- **makefile-pro** — Generate, scaffold, validate and lint Makefiles and .mk files: .PHONY targets, build automation, common mistakes. Use for any Makefile work.
- **microservices-patterns** — Microservices architecture: boundaries, communication, data management, resilience patterns.

### Shell

- **bash-linux** — Bash/Linux terminal patterns. Critical commands, piping, error handling, scripting. Use when working on macOS or Linux systems.
- **posix-shell-pro** — Strict POSIX sh scripting for maximum portability across Unix-like systems; scripts that run on dash, ash, sh or bash --posix alike.
- **tmux** — Expert tmux session, window, and pane management for terminal multiplexing, persistent remote workflows, and shell scripting automation.

**Install:** `aos store install --pack stacks`


### Agents automation Pack Skills

- **agent-tool-builder** — >-
- **agentic-harness-patterns** — >-
- **llm-app-patterns** — Production-ready patterns for building LLM applications, inspired by [Dify](https://github.com/langgenius/dify) and industry best practices.
- **llm-structured-output** — >
- **local-llm-expert** — Local LLM inference: model selection, VRAM optimization. Ollama, llama.cpp, vLLM, LM Studio, quantization.
- **rag-implementation** — RAG implementation workflow: embedding selection, vector database setup, chunking strategies and retrieval optimization.
- **prompt-engineer** — Transforms user prompts into optimized prompts using frameworks (RTF, RISEN, Chain of Thought, RODES, Chain of Density, RACE, RISE, STAR, SOAP, CLEAR, GROW)
- **crewai** — >-
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

**Install:** `aos store install --pack agents-automation`
<!-- aos:pack-index:end -->
