# Bootstrap Sequence Pattern

## Problem

Without a disciplined bootstrap sequence, security-critical initialization steps execute out of order: TLS certificates load after the first network connection has already completed its handshake, proxy agents are not configured before the first outbound TCP connection, and trust-gated subsystems — telemetry, full environment variable sets — activate before the user has granted permission. Concurrent callers that trigger initialization simultaneously cause expensive subsystems to double-initialize, wasting hundreds of kilobytes of module loading and creating subtle state corruption. Meanwhile, trivial commands that need no subsystems at all still pay the cost of loading the entire module graph.

These problems emerge in any agent runtime with ordered dependencies between configuration, networking, trust, and observability — they are not specific to a single implementation.

## Golden Rules

### Initialize by dependency order, with trust as the critical inflection point

Initialization must follow the dependency graph: no subsystem should activate before the subsystems it depends on. The two universal ordering constraints are: (1) configuration parsing must complete before any subsystem reads config values, and (2) trust establishment — the point where the user grants or withholds consent — must complete before activating subsystems that depend on consent (telemetry, secret environment variables, analytics). Between config and trust, the ordering depends on your runtime's specific dependency graph. Transport setup (TLS, proxy, certificates) typically comes early because most subsystems depend on correct network state. Observability typically comes last because it depends on config, transport, and trust. The exact layer count and sequence will vary by runtime — the principle is that you must identify and respect the dependency edges, not that every runtime has exactly the same layers.

### Memoize the top-level init to collapse concurrent callers

Wrap the entire initialization function in a memoization boundary so that all concurrent callers share a single in-flight promise. Without this, two callers invoking init simultaneously will each execute the full sequence, potentially double-configuring global HTTP agents, double-loading telemetry modules, or racing on state that the first caller has not finished writing. The memoization boundary is at the outermost async function, not at individual sub-steps.

### Split environment variables across the trust boundary

Environment variables fall into two categories: those with no security implications (editor preferences, locale, display settings) and those that carry secrets or alter trust posture (API keys, proxy credentials, auth tokens). Apply the safe set before the trust dialog so that early subsystems can read harmless configuration. Apply the full set only after the user has granted trust. Reversing this order means env-injected credentials are active before consent is obtained.

### Dispatch trivial commands before loading anything

Commands that require zero subsystem state — version queries, schema dumps, diagnostic flags — should be dispatched from the entry point before any dynamic imports or initialization runs. This keeps their latency at the floor of process startup and prevents the module graph from loading hundreds of kilobytes of code that will never execute.

### Register cleanup during init, not at usage sites

Every cleanup handler — graceful shutdown, transport teardown, child-process reaping, session cleanup — must be registered during initialization, not scattered across usage sites. Registering at init guarantees that cleanup runs unconditionally on exit, regardless of which code path was taken. Cleanup handlers registered at usage sites are silently skipped when an unexpected exit path bypasses that site.

## When To Use

- Your agent runtime has security-critical ordering between TLS, proxy, and network subsystems.
- You support multiple entry modes (CLI, server, SDK, headless) that must share the same initialization path.
- You need a trust boundary that separates pre-consent and post-consent configuration.
- Expensive subsystems (telemetry, tracing, observability) should load only when permitted and needed.
- Trivial commands should respond instantly without paying the cost of full initialization.
- Multiple callers or code paths may trigger initialization concurrently.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Dependency-ordered sequential init | Security-critical steps cannot execute out of order | Slower cold start than parallel init; each layer blocks on its dependencies |
| Memoized top-level init | Concurrent callers share one promise; no double-init | Memoize caches rejections in some libraries, blocking retry on transient errors |
| Trust-split environment variables | Secrets are never active before user consent | Two separate application passes to maintain; easy to put a variable in the wrong set |
| Fast-path dispatch for trivial commands | Sub-millisecond response for version/help/diagnostics | Each fast path is a special case that must be maintained outside the normal init flow |
| Lazy dynamic imports for heavy modules | Hundreds of kilobytes deferred until actually needed | Import latency shifts to first use; harder to reason about load order |
| Parallel fire-and-forget for non-critical work | Background caches populate without blocking the critical path | Failures are silent; callers must tolerate cache misses gracefully |
| Build-time feature-flag gating | Dead code for disabled modes is eliminated from the shipped artifact | Feature checks must appear inline at call sites; wrapping in helpers defeats the bundler |
| Transport as a narrow interface | Wire protocol versions are swappable without touching callers | Behavioral differences between protocol versions can hide behind the same interface |

## Implementation Patterns

- Parse and validate all configuration files as the very first step. Surface parse errors as user-visible diagnostics before any network contact occurs.
- Apply TLS certificate configuration immediately after config validation and before instantiating any HTTP client or agent. Many runtimes cache the TLS certificate store at process boot; certificates applied after the first handshake may have no effect on connections that reuse the cached pool.
- Configure mutual TLS before proxy agents, and proxy agents before any outbound connection including preconnect or warm-up calls. The dependency chain is: certificates, then mTLS, then agents, then connections.
- Apply the safe subset of environment variables (no secrets, no auth tokens) before the trust dialog. Defer the full set until after trust is established.
- Wrap the entire top-level async initialization function in a memoization boundary. Concurrent callers must receive the same promise, not trigger parallel execution of the same sequence.
- Fire non-critical background work (repository detection, IDE detection, cache population, analytics preamble) after the transport layer is configured but before blocking on trust. These tasks should not be awaited in the critical path.
- Gate telemetry initialization behind trust establishment. Use a separate boolean guard distinct from the init memoization so that telemetry can be retried independently if the first attempt fails.
- When the runtime supports managed remote settings, wait for those settings to load before finalizing telemetry configuration, so that organization-configured endpoints are honored.
- Use dynamic imports for heavy dependency trees (telemetry, tracing, protocol buffers, gRPC) so that their module weight is deferred until the subsystem is actually initialized.
- At the entry point, check for trivial commands (version, help, schema dump) and dispatch them immediately with zero dynamic imports — do not load the full module graph for commands that will never use it.
- Support multiple entry modes (interactive CLI, server/daemon, SDK embedding, headless) through the same initialization path, branching only at the mode-dispatch layer above init. For headless modes, skip interactive dialogs and write errors to stderr with a non-zero exit code.
- Use build-time feature flags for mode-specific branches. The flag check must appear inline at the call site so the bundler can perform dead-code elimination; wrapping it in a helper function defeats this optimization.
- Define transport as a narrow interface — write, batch-write, connect, close, state-report — so that different wire protocol versions are interchangeable behind a single surface.
- Register all cleanup handlers (graceful shutdown, transport teardown, child-process cleanup, session finalization) during initialization, not at individual usage sites.

## Gotchas

**Memoization hides retry failures.** Some memoize implementations cache the first returned promise, including rejected ones. If a transient config error causes init to reject, every subsequent caller receives the cached rejection forever. Either use a memoize variant that clears on rejection, or implement a manual once-guard that resets its flag on error.

**Trust boundary leakage through environment variables.** Applying the full environment variable set before the trust dialog means env-injected API keys or proxy credentials are active before the user consents. This is a security violation, not just an ordering preference. Always apply the safe pass first and the full pass only after explicit trust grant.

**TLS certificate store caching defeats late application.** On many runtimes, the TLS certificate store is read once at process boot. Applying custom CA certificates after even one TLS handshake has completed may have no effect on connections that reuse the cached certificate pool. CA certificate configuration must be the very first network-adjacent step, before any connection — including preconnect warm-ups.

**Telemetry double-init across async boundaries.** When multiple code paths can trigger telemetry initialization (eager synchronous init for non-interactive sessions, deferred async init after remote settings load), the guard flag must be set before the async initializer resolves, not after. Setting it after the resolution leaves a window where a second caller can slip through and double-initialize.

**Feature flags must be inline for dead-code elimination.** Build-time feature flags only enable dead-code elimination when the flag check appears directly at the call site. Extracting the check into a helper function, even a trivially inlined one, defeats the bundler's static analysis and ships the gated code in all builds.

**Transport protocol version differences hide behind the interface.** When a transport interface abstracts multiple wire protocol versions, behavioral differences (such as one version supporting dropped-batch counts and another always returning zero) are invisible to callers. Callers that depend on version-specific behavior must not rely on the abstracted interface for those checks.

**Global state modules must be leaves in the import graph.** Any module that holds global singleton state must import only pure leaf modules with no transitive dependencies on the rest of the system. Adding a non-leaf import to a global state module creates circular-dependency risks that cascade across the entire bootstrap graph.

**Headless modes must not block on interactive dialogs.** When the runtime detects a non-interactive session (no TTY, piped input, CI environment), initialization must skip any interactive trust dialog or prompt. Blocking on user input in a headless context hangs the process indefinitely.

## Claude Code Evidence

Claude Code's bootstrap sequence is a production implementation of these principles, supporting seven distinct entry modes through a single ordered initialization path.

**Four-layer ordering with explicit dependency comments.** The initialization function enforces strict ordering: config parsing first, then safe environment variable application, then TLS CA certificate configuration, then graceful-shutdown registration, then mTLS configuration, then global HTTP agent setup, then API preconnection. Each step includes a comment explaining why it must precede the next. The TLS step carries a specific note about the runtime caching its certificate store at boot, making late application ineffective.

**Memoized init collapsing concurrent callers.** The top-level initialization function is wrapped in a single memoization boundary, ensuring that regardless of how many code paths trigger init simultaneously, the sequence executes exactly once and all callers share the same promise.

**Trust-split environment variables.** Environment variable application is split into two distinct passes. The "safe" pass runs before any trust check, applying only variables with no security implications. The "full" pass runs only after the trust dialog completes, applying variables that may carry API keys, proxy credentials, or other sensitive configuration.

**Fast-path dispatch for trivial commands.** The CLI entry point checks for version flags, schema dumps, and diagnostic commands before loading any modules. These paths respond with zero dynamic imports and exit immediately, keeping their latency at the floor of process startup.

**Lazy loading of heavy subsystems.** Telemetry initialization uses dynamic imports to defer approximately 400KB of observability and protocol-buffer modules until telemetry is actually needed. A further layer of lazy loading defers approximately 700KB of gRPC transport modules until tracing instrumentation is activated. This two-tier lazy loading keeps the critical path fast for sessions that never activate tracing.

**Parallel fire-and-forget for background caches.** After the transport layer is configured but before blocking on trust, the bootstrap fires off non-critical background tasks — IDE detection, repository detection, OAuth cache population, analytics preamble — as unawaited promises. These populate shared caches that later synchronous callers read, without blocking the critical initialization path.

**Multi-mode entry through a single init path.** Seven entry modes — interactive REPL, server/daemon, SDK embedding, bridge/remote-control, background sessions, template runner, and self-hosted runner — all flow through the same memoized initialization function. Mode-specific behavior branches above the init call, not within it. Feature-gated modes use build-time flags with inline checks so that unused modes are eliminated from the shipped artifact.

**Transport abstraction for swappable wire protocols.** The bridge transport is defined as a narrow interface with write, batch-write, connect, close, and state-reporting methods. Two protocol versions — one using WebSocket plus POST, the other using server-sent events for reads and a separate write channel — are interchangeable behind this surface. The interface documents where behavioral differences exist between versions.
