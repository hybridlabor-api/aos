---
name: agentic-harness-patterns
description: >-
  Harness patterns for coding agents — memory, permissions, context
  engineering, delegation, skills, hooks, bootstrap.
when_to_use: >-
  Triggers on: harness engineering, tool safety, permission pipeline,
  agent memory, memory persistence, delegation pattern, context budget,
  bootstrap sequence, skill runtime, hook lifecycle, tool orchestration,
  agent harness, context engineering.
category: engineering-method
metadata:
  version: "1.0.0"
  origin: keli-wen/agentic-harness-patterns-skill
  license: MIT
---

<!-- Source: keli-wen/agentic-harness-patterns-skill skills/agentic-harness-patterns/SKILL.md — MIT, see THIRD_PARTY_NOTICES.md -->

# Agentic Harness Patterns

Production AI coding agents are not just an LLM calling tools in a loop. The **harness** — memory, skills, safety, context control, delegation, and extensibility — is what separates a demo from a production system.

**For:** Engineers building or extending coding-agent runtimes, custom agents, or advanced multi-agent workflows.
**Not for:** Prompt engineering, model selection, generic software architecture, or LLM API basics.

All principles are distilled from production runtime decisions. Claude Code is used as grounding evidence, not as the only possible implementation.

## Choose Your Problem

| If you want to... | Read |
|---|---|
| Make the agent remember and improve over time | [Memory](#1-memory) |
| Package reusable workflows and expertise | [Skills](#2-skills) |
| Let the agent use tools powerfully but not dangerously | [Tools and Safety](#3-tools-and-safety) |
| Give the agent the right context at the right cost | [Context Engineering](#4-context-engineering) |
| Split work across multiple agents without losing control | [Multi-agent Coordination](#5-multi-agent-coordination) |
| Extend behavior with hooks, background tasks, or startup logic | [Lifecycle and Extensibility](#6-lifecycle-and-extensibility) |

**Before you start building:** Read the [Gotchas](#gotchas) — these are the non-obvious failure modes that cost the most time.

---

## 1. Memory

**User problem:** "My agent forgets corrections and project rules between sessions."

**Golden rule:** Separate what the agent *knows* (instruction memory) from what the agent *learns* (auto-memory) from what the agent *extracts* (session memory). Each layer has different persistence, trust, and review needs.

**When to use:** Any agent that operates across multiple sessions or needs to accumulate project-specific knowledge over time.

**How it works:**

- **Instruction memory** is curated, hierarchical configuration injected into system context in priority order (org-wide → user → project → local; local wins). This is where project conventions, coding standards, and behavioral rules live. It is human-authored and stable.
- **Auto-memory** is agent-written persistent knowledge with a type taxonomy (user / feedback / project / reference) and a capped index. Saving is two-step: write a topic file, then update the index. The cap prevents unbounded growth — without cleanup, recent entries silently disappear.
- **Session extraction** runs as a background agent at session end. It directly writes to auto-memory — topic file then index — following the same two-step save invariant. A mutual-exclusion guard ensures that if the main agent already wrote memory during the turn, the extractor skips entirely. This is the autonomous learning loop.
- **Review and promotion** audits across all memory layers and proposes cross-layer moves (auto-memory → project conventions, personal instructions, or team memory). It never applies changes autonomously — proposals require explicit user approval.

**Start here:** Define your memory layers (instruction, auto, extraction). Implement the two-step save invariant (topic file, then index). Add background extraction only after the core write path is stable.

> **In Claude Code:** Use `/remember` to audit and promote auto-memory entries across layers.

**Tradeoffs:**

- More memory layers = richer recall but higher maintenance burden. Without periodic pruning, index caps cause silent data loss.
- Session extraction adds latency at session end but dramatically improves cross-session learning.

**Go deeper:** [references/memory-persistence-pattern.md](references/memory-persistence-pattern.md)

---

## 2. Skills

**User problem:** "I want my agent to reuse workflows and domain knowledge without re-explaining them every time."

**Golden rule:** Skills are lazy-loaded instruction sets, not eagerly injected prompts. Discovery must be cheap (metadata only); the full body loads only on activation.

**When to use:** Any agent that needs reusable, composable workflows activating on matching user intent.

**How it works:**

- **Discovery** is budget-constrained: the agent sees a compact listing of all available skills (name, description, and when-to-use hint concatenated per entry), each hard-capped at a fixed character limit, with the total capped at roughly 1% of the context window. Front-load your trigger language — tails get truncated.
- **Loading** is lazy: only metadata enters the always-on context. The full skill body loads only when the skill activates, keeping idle token cost near zero.
- **Execution** can be inline (shared context) or isolated (forked sub-agent with its own token budget). Isolation prevents a heavy skill from exhausting the parent's context.
- **Sources** can be bundled, user-installed, or dynamically loaded from plugins. Deduplication by canonical path prevents the same skill from appearing twice across overlapping source directories.

**Start here:** Choose a metadata format (frontmatter recommended). Implement two-phase discovery: cheap listing at startup, lazy body loading on invocation. Set a per-entry character cap before your catalog grows.

**Tradeoffs:**

- Lazy loading saves tokens but adds one round-trip of latency on first activation.
- Forked execution provides isolation but loses access to the parent's accumulated context.

**Go deeper:** [references/skill-runtime-pattern.md](references/skill-runtime-pattern.md)

---

## 3. Tools and Safety

**User problem:** "I want my agent to use tools powerfully, but not dangerously."

**Golden rule:** Default to fail-closed. Tools are serial and gated unless explicitly marked safe for concurrency and approved by the permission pipeline.

**When to use:** Any agent runtime that needs tool registration, concurrency control, or permission gating.

**How it works:**

- **Registration** uses fail-closed defaults: tools are non-concurrent and non-read-only unless the developer opts in. This prevents accidental parallel execution of state-mutating operations.
- **Concurrency classification** is per-call, not per-tool: the same tool can be safe for some inputs and unsafe for others. The runtime partitions a batch of tool calls into consecutive groups — safe calls run in parallel, any unsafe call starts a serial segment.
- **Permission pipeline** evaluates rules from multiple sources in strict priority order spanning settings files (user, project, local, flag, and policy), CLI arguments, command-scoped rules, and session grants. The evaluator is stateful — it tracks denials, transforms modes, and updates state as a side effect.
- **Handler dispatch** varies by execution environment: interactive (human prompt), automated (coordinator), or async (swarm agent). The same permission rules feed different approval surfaces.

**Start here:** Route every tool call through one permission gate. Default to fail-closed (deny/ask). Add bypass-immune rules for protected paths before shipping any auto-approve mode.

> **In Claude Code:** Use `/update-config` to configure permission rules and hooks.

**Tradeoffs:**

- Fail-closed defaults mean new tools are safe out of the box, but developers must actively opt into concurrency — forgetting to flag a read-only tool as concurrent-safe silently degrades throughput.
- Multi-source permission layering is powerful but hard to debug when rules from different sources conflict.

**Go deeper:** [references/tool-registry-pattern.md](references/tool-registry-pattern.md) | [references/permission-gate-pattern.md](references/permission-gate-pattern.md)

---

## 4. Context Engineering

**User problem:** "My agent either sees too much, too little, or the wrong thing."

**Golden rule:** Treat context as a budget, not a dump. Every token in the window should earn its place through one of four operations: select, write, compress, or isolate.

**When to use:** Any agent whose performance degrades in long sessions, whose delegated work pollutes the parent context, or whose startup is slow due to eager context loading.

**How it works:**

- **Select** — Load context just-in-time, not all-at-once. Use progressive disclosure with three tiers: metadata (always present, cheap), instructions (loaded on activation), resources (loaded on demand). Memoize expensive context builders and invalidate only at known mutation points — not reactively.
- **Write** — Context is not read-only. The agent writes back to persistent storage: auto-memory entries, background extraction outputs, task state, permission rules. The write-back loop is what turns a stateless agent into a learning system.
- **Compress** — Long sessions exhaust the window. Reactive compaction summarizes older turns mid-session, preserving recent context while reclaiming budget. Mark snapshot data as snapshots so the model knows to re-fetch for current state.
- **Isolate** — Delegated work must not pollute the parent's context. Coordinator workers start with zero context inheritance (only the explicit prompt). Fork children inherit full context but are single-level (no recursive forks). Filesystem-level isolation (worktrees) gives an agent its own working copy.

**Start here:** Audit your current context cost per turn. Apply hard caps to every variable-length block. Add truncation recovery pointers (tell the model which tool to call for full output) before enabling any compression.

**Tradeoffs:**

- Aggressive caching reduces latency but creates staleness risk — every mutation point must explicitly clear the cache, or the model operates on stale data for the remainder of the session.
- Progressive disclosure saves tokens but means the model can't reason about a skill's full capabilities until it's activated.

**Go deeper:** [references/context-engineering-pattern.md](references/context-engineering-pattern.md) (index) | [select](references/context-engineering/select-pattern.md) | [compress](references/context-engineering/compress-pattern.md) | [isolate](references/context-engineering/isolate-pattern.md)

---

## 5. Multi-agent Coordination

**User problem:** "I want parallelism, specialization, and coordination without chaos."

**Golden rule:** The coordinator must synthesize, not delegate understanding. "Based on your findings, fix it" is an anti-pattern — the coordinator should digest worker results into precise specs before dispatching implementation.

**When to use:** When a task is too large for a single agent, when you need parallel exploration, or when you want persistent specialized teammates.

**How it works:**

Three delegation patterns serve different task shapes:

| Pattern | Context sharing | Best for |
|---------|----------------|----------|
| **Coordinator** | None — workers start fresh | Complex multi-phase tasks (research → synthesize → implement → verify) |
| **Fork** | Full — child inherits parent history | Quick parallel splits sharing loaded context |
| **Swarm** | Peer-to-peer via shared task list | Long-running independent workstreams |

Key constraints:

- Fork is single-level only — recursive forks would multiply context cost exponentially.
- Swarm teammates cannot spawn other teammates — the roster is flat to prevent uncontrolled growth.
- Results arrive asynchronously; fire-and-forget registration returns an ID immediately so the parent can continue working.

**Start here:** Pick one delegation pattern and implement it fully before mixing patterns. Write every sub-agent prompt as a self-contained document. Add a synthesis step between research and implementation workers — this is where the orchestrator adds value.

**Implementation checklist for the coordinator pattern:**

1. Define phased workflow: research → synthesize → implement → verify
2. Write self-contained prompts for each worker (no "based on your findings")
3. Filter each worker's tool set to only what it needs
4. Decide continue-vs-spawn policy: continue if context overlaps, spawn fresh for verification

**Tradeoffs:**

- Coordinator mode is safest but slowest — each phase waits for the previous one.
- Fork is fastest but limited to one level and shares the parent's full context cost.
- Swarm is most flexible but hardest to coordinate — peers communicate only through a shared task list.

**Go deeper:** [references/agent-orchestration-pattern.md](references/agent-orchestration-pattern.md)

---

## 6. Lifecycle and Extensibility

**User problem:** "I need hooks, background tasks, and a clean startup sequence."

**Golden rule:** Extensibility is an injection point, not an inheritance hierarchy. Hooks attach side effects at lifecycle moments; tasks track async work with strict state machines; bootstrap layers initialization sequentially with memoized stages.

**When to use:** When you need to extend agent behavior without modifying core code, track long-running background work, or structure initialization across multiple entry modes.

**How it works:**

- **Hooks** extend behavior by attaching side effects at defined lifecycle moments (pre/post tool execution, prompt submission, agent start/end). Trust is all-or-nothing: if the workspace is untrusted, all hooks skip — not just suspicious ones. Session-scoped hooks are ephemeral and cleaned on session end.
- **Long-running work** is tracked via typed state machines. Each work unit gets a typed, prefixed ID, a strict lifecycle (running → completed / failed / killed), and disk-backed output. Eviction is two-phase: disk output cleaned eagerly at terminal state, in-memory records cleaned lazily after the parent has been notified.
- **Bootstrap** structures initialization as dependency-ordered, memoized stages. The trust boundary — the point where the user grants consent — is the critical inflection: security-sensitive subsystems (telemetry, secret environment variables) must not activate before trust is established. Multiple entry modes (CLI, server, SDK) share the same bootstrap path with different entrypoints.

**Start here:** Route all hooks through a single dispatch point. Implement the trust gate before adding any external hook type. Register cleanup handlers during init, not at usage sites.

> **In Claude Code:** Use `/update-config` to configure hooks (pre/post tool execution, prompt submission).

**Tradeoffs:**

- All-or-nothing hook trust is simple but coarse — one untrusted hook disables the entire extension system.
- Disk-backed task output keeps memory constant but adds I/O latency proportional to concurrent work units.

**Go deeper:** [references/hook-lifecycle-pattern.md](references/hook-lifecycle-pattern.md) | [references/task-decomposition-pattern.md](references/task-decomposition-pattern.md) | [references/bootstrap-sequence-pattern.md](references/bootstrap-sequence-pattern.md)

---

## Gotchas

Non-obvious principles that will cause bugs if you violate them:

1. **Concurrency classification is per-call, not per-tool.** A tool may be safe for some inputs and unsafe for others. Don't assume a tool's concurrency behavior is static — the runtime decides per invocation.

2. **Permission evaluation has side effects.** The permission checker tracks denials, transforms modes, and updates state. Don't treat it as a pure lookup function.

3. **Most async work skips the "pending" state.** In practice, work units register directly as "running." Don't build UIs that assume every work unit starts pending.

4. **Fork children must not fork.** The recursive guard preserves a single-level invariant. The fork tool stays in the child's tool pool (for prompt cache sharing) but is blocked at call time.

5. **Context builders are memoized but manually invalidated.** Add a context source without adding a corresponding invalidation point, and the model sees stale data for the entire session.

6. **Memory indexes have hard caps.** Entries beyond the cap are silently truncated. Without periodic cleanup, recent entries become invisible.

7. **Skill listing budgets are tight.** Descriptions are concatenated and capped per entry. Front-load the most distinctive trigger language — the tail gets cut.

8. **Hook trust is all-or-nothing.** If the workspace is untrusted, the entire hook system is disabled, not just individual suspicious hooks.

9. **The default permission for tools is "allow."** Tools that don't implement custom permission logic delegate entirely to the rule-based system. Override only when you need tool-specific gates (path ACLs, quotas, etc.).

10. **Eviction requires notification.** A terminal work unit is only GC-eligible after the parent has received the completion signal. Evicting before notification creates a race where the parent can never read the result.

---

## When NOT to Use This Skill

This skill is about the **harness** around an agent, not:
- Prompt engineering or system prompt design
- Model selection or fine-tuning
- Generic software architecture (MVC, microservices)
- Chat UIs or conversational interfaces
- LLM API integration basics

If your question is about the model itself rather than the system around it, this skill does not apply.
