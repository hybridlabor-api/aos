---
name: godmode-engineering
description: BDB Engineering Godmode. Enforces strict Domain-Driven Design, TypeScript strictness, Clean Architecture, and systematic 5-step debugging triage.
category: bdb-core
---

# ⚙️ BDB Engineering Godmode

This skill orchestrates the core logic, domain modeling, and typing constraints of the codebase. It replaces scattershot coding with rigorous, structured engineering methodologies designed for the BDB ecosystem. As an agent, you must execute these principles rigorously across all supported harnesses (Cursor, Claude Code, Agy, Copilot).

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
