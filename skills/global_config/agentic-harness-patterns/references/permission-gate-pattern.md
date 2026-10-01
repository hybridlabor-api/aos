# Permission Gate Pattern

## Problem

Without a single permission gate, every tool invocation either silently proceeds (creating security risks) or blindly blocks (creating friction). The core difficulty is that permission decisions depend on context that varies across execution environments: interactive sessions need a human in the loop, headless agents must auto-decide, and swarm workers must delegate to a coordinator. Scattering these checks inside individual tools produces duplicated logic, inconsistent behavior when abort signals arrive mid-check, and no clean way to record audit decisions across all paths.

These problems emerge in any agent runtime that supports tool use — they are not specific to a single implementation.

## Golden Rules

### Every tool invocation passes through one gate

Route every tool call through a single permission checkpoint before execution begins. The gate evaluates rules and returns exactly one of three behaviors: allow, deny, or ask. No tool should perform its own authorization bypass; the gate is the sole authority. This makes auditing trivial — every decision flows through one chokepoint — and prevents individual tools from silently skipping checks.

### Three behaviors, no more

The permission vocabulary is exactly three words. "Allow" means the tool runs immediately. "Deny" means the tool is refused and the agent receives a rejection reason. "Ask" means the runtime cannot decide alone and must consult an external authority — a human, a coordinator, or an escalation hook. Carrying a discriminated reason on each behavior enables downstream logging and display without re-parsing the decision.

### Layered rules evaluate in strict priority order

Rule evaluation follows a fixed priority chain. Explicit deny rules fire first — they are the fastest and most restrictive. Explicit ask rules fire next. Then tool-specific content checks run (for tools that need logic beyond the general system, such as path-based access control). After tool-specific checks, bypass-immune safety checks fire. Only after all of these does the system consult mode-level overrides (like "auto-approve everything") or broad allow rules. The default, if nothing matches, is ask. This ordering guarantees that safety-critical constraints are never silently overridden by a permissive mode.

### Some "ask" results are bypass-immune

Certain conditions must always surface as "ask" regardless of how permissive the runtime mode is. Tools that inherently require a human present, content-level rules that explicitly demand confirmation, and safety checks for protected paths (such as version-control internals or agent configuration directories) all produce ask results that skip the auto-approve shortcut entirely. Without this immunity, a misconfigured bypass mode could silently mutate protected state.

### Rule evaluation is separated from UX dispatch

The decision about what to do (allow, deny, or ask) lives in a dedicated rule evaluator, separate from the UX dispatch layer. The decision about how to present an "ask" result — show a dialog, send a message to a coordinator, forward to a swarm leader — lives in environment-specific handlers. The evaluator itself may carry state (denial tracking, mode transforms) as side effects of evaluation, but the key invariant is that adding a new execution environment requires only a new handler and one dispatch branch, not changes to the rule logic.

### Resolution is race-safe through atomic claim

When multiple concurrent paths can resolve an "ask" — user input, background hooks, and an automated classifier all racing — the first to finish must win cleanly. An atomic claim mechanism marks the permission as resolved before any asynchronous work proceeds, preventing a second async winner from calling the resolver after the first has already committed. Without this, two paths can both believe they won, producing duplicate or contradictory resolutions.

### The permission context is a frozen service object

Bundle all stateful operations — abort-signal checking, queue management, audit logging, and rule persistence — into a single context object, then freeze it. Handlers receive this object as their only interface to permission state. Freezing prevents accidental mutation across handler boundaries, while consolidating operations onto the object prevents handlers from duplicating wiring code. This is not a mutable options bag that callers can patch; it is a sealed service contract.

### Rule sources are ordered and composable

Permission rules come from multiple origins: user-level settings, project-level settings, local overrides, feature flags, policy directives, CLI arguments, command-level scopes, and session-level grants. Each source contributes its own deny, ask, and allow lists independently. At evaluation time, all sources are merged and the strict priority chain applies across the combined set. Persistence targets the appropriate source — "remember for this project" writes to project settings, "remember for this session" writes to session state — so that rules compose without overwriting each other.

## When To Use

- Your agent runtime executes tools that can modify files, run commands, or access external services.
- You need consistent permission enforcement across interactive, headless, and multi-agent environments.
- You need an audit trail showing who authorized each tool invocation and why.
- Your tools have heterogeneous risk profiles — some are safe to auto-approve, others must always require confirmation.
- You support multiple configuration scopes (user, project, session) that need to compose without conflict.
- You need to add new execution environments without rewriting your permission logic.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Single gate for all tools | One audit chokepoint, consistent enforcement | Every tool call pays the gate's latency |
| Three-behavior vocabulary | Simple mental model, exhaustive case handling | "Ask" is a broad bucket — different environments handle it differently |
| Strict priority ordering | Deny always wins, safety checks cannot be bypassed | Rule authors must understand the evaluation order to predict outcomes |
| Bypass-immune ask results | Protected paths stay protected regardless of mode | Some tools feel slower than expected even in auto-approve mode |
| Separated evaluation and dispatch | New environments need only a new handler | Two layers to understand instead of one |
| Atomic claim for resolution | No duplicate or contradictory resolutions | Slightly more complex handler authoring |
| Frozen context object | Handlers cannot corrupt shared state | No ad-hoc extensions at call sites — all operations must be defined upfront |
| Multi-source rule composition | Fine-grained scoping (user, project, session) | Merge logic is more complex; debugging "which source won?" requires tracing |

## Implementation Patterns

- Define a permission decision type with exactly three behaviors: allow, deny, and ask. Attach a discriminated reason to each so that logging and display messages never need to re-derive the cause.
- Implement tool-specific permission checks only when a tool needs logic beyond the general rule system (path-based access control, quota enforcement, etc.). The default should delegate entirely to the rule-based system. Return deny only for clear violations; return ask for uncertain cases.
- Mark any tool that cannot function without a human present as requiring user interaction. The gate always surfaces these as ask regardless of bypass mode.
- Tag safety-critical ask results with a distinct reason type. The gate treats these as bypass-immune and skips any auto-approve shortcut.
- Build the permission context as a sealed service object that bundles abort checking, queue operations, audit logging, and rule persistence. Freeze it at creation time.
- Use an atomic claim guard on any promise that can be resolved by multiple concurrent paths. Claim before any asynchronous work inside an async callback.
- Register remote or swarm callbacks before sending the outbound request to eliminate the race where a responder answers before the callback exists.
- Log every decision — accept, reject, source, whether it was persisted durably — at the point of resolution, not at individual call sites. Centralizing this on the context object prevents missed logging when new resolution paths are added.
- Persist permission updates through both in-memory state and durable storage in a single operation. Return whether any update was durable so the audit log can distinguish ephemeral from permanent grants.
- Re-read runtime mode at the mode-check step, not at function entry. If the mode changes between rule evaluation and the mode shortcut, a cached value will apply stale permissions.
- When converting ask to deny in a "don't ask" mode, perform the conversion after the inner rule chain completes. This ensures bypass-immune checks always produce ask first, which is then converted to deny at the outer layer. Merging these steps risks suppressing bypass-immune paths.

## Gotchas

**Do not cache runtime mode across the entire evaluation.** The mode-check step must re-read the current mode at evaluation time. If you snapshot the mode at function entry, a mode switch that occurs between rule evaluation and the bypass shortcut will be invisible, and you will apply stale permissions.

**Do not run hooks inside the rule evaluator.** Hook execution belongs in environment-specific handlers. If you move it into the evaluator, headless agents that never reach a handler will silently skip hooks. Headless environments need a separate hook execution path precisely because they do not go through the interactive handler.

**Allow results from rules still need input normalization.** Even when the gate resolves early via a bypass shortcut or a broad allow rule, the tool's input may need scrubbing. Content-specific allow rules (such as prefix-match rules for shell commands) can return a normalized input that differs from the raw invocation. Always apply input normalization before passing through to execution.

**Do not merge the inner rule chain with the outer mode conversion.** The inner chain produces bypass-immune ask results. The outer layer converts ask to deny in restrictive modes. If you flatten these into one function, bypass-immune results may not trigger correctly because the deny conversion can intercept them before they are tagged as immune.

**Add a grace period before honoring interaction signals in the interactive handler.** Without a short delay (on the order of a few hundred milliseconds), incidental keystrokes — such as the Enter that submitted the original prompt — can cancel a running classifier before it has time to auto-approve. The grace period absorbs input that arrived before the permission dialog was actually visible.

**Freezing the context object is not a substitute for atomic claim.** Freezing prevents external mutation of the context fields but does nothing for async race conditions on the resolution promise. Both mechanisms are required: freeze for encapsulation, atomic claim for resolution safety.

**Register callbacks before sending outbound requests in distributed environments.** In swarm or coordinator topologies, the responder may reply before the local handler has registered its callback. Registering first eliminates this window.

## Claude Code Evidence

Claude Code's permission system is a production implementation of these principles, handling tool authorization across interactive terminals, headless CI agents, and multi-agent swarm topologies.

**Single gate, three behaviors.** Every tool invocation in Claude Code passes through one top-level permission function before execution. The function returns allow, deny, or ask, each carrying a discriminated reason that drives both the audit log and the user-facing explanation message. No tool bypasses this gate.

**Strict layered evaluation.** The rule evaluator follows a fixed sequence: explicit deny rules, explicit ask rules, tool-specific content checks, bypass-immune safety checks (for paths like `.git/` and `.claude/`), mode-level shortcuts, broad allow rules, and a default fallback to ask. The ordering is deliberate — safety checks fire before mode shortcuts, so even full bypass mode cannot silently approve writes to protected directories.

**Bypass-immune safety checks.** Three categories of ask results skip the auto-approve shortcut entirely: tools that declare they require user interaction, content-level ask rules that explicitly demand confirmation, and a safety check for protected paths. This design was motivated by the observation that a single misconfigured "approve everything" flag could otherwise allow silent mutation of version-control state or agent configuration files.

**Frozen permission context.** The context object is frozen at creation time. All handler operations — queue push and remove, permission persistence, abort-signal checking, audit logging — are methods on this sealed object. This prevents handlers in different execution environments from accidentally patching each other's state, which was a recurring source of bugs during early development of the multi-handler architecture.

**Atomic claim for resolution races.** The interactive handler races three concurrent paths: user input from the confirmation dialog, background permission hooks, and an automated classifier. A claim mechanism atomically marks the permission as resolved before any of these paths proceeds with asynchronous work. The design was introduced after observing that without it, both the classifier and the user could "win" the race, producing duplicate resolution callbacks.

**Three-way handler dispatch.** After rule evaluation, the system dispatches ask results to one of three handlers based on execution environment: a coordinator handler that runs hooks and classifiers sequentially before showing a dialog, a swarm-worker handler that forwards the decision to a leader via mailbox, or a default interactive handler that pushes a confirmation dialog and races user input against automated checks. Adding a new execution environment requires only a new handler and one dispatch branch — the rule evaluator does not change.

**Composable multi-source rules.** Permission rules come from eight distinct sources spanning user settings, project settings, local overrides, feature flags, policy directives, CLI arguments, command-level scopes, and session grants. Each source contributes independent deny, ask, and allow lists. When a user says "always allow this tool for this project," the grant is persisted to the project-settings source, leaving user-level and session-level rules untouched. This composability allows teams to ship restrictive project-level defaults that individual developers can relax in their user settings without conflicting.
