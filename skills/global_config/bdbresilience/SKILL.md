---
name: bdbresilience
description: Autonomous CI/CD error recovery, distributed file-based locking, diagnostic triage, and two-phase GO gate resilience engine for BDB Agent OS multi-agent pipelines.
category: bdb-core
triggers:
  - error recovery
  - transient error
  - rate limit 429
  - exponential backoff
  - distributed lock
  - lockfile
  - concurrency control
  - state race
  - ci/cd triage
  - log parser
  - flaky test
  - self-healing
  - verification gate
  - go gate
  - two-phase gate
capabilities:
  - monitoring
  - security
  - context-management
  - testing
  - automation
disable-model-invocation: false
user-invocable: true
---

# 🛡️ BDB Resilience & Concurrency Engine (`/bdbresilience`)

The `/bdbresilience` master skill suite provides deterministic runtime fault tolerance, concurrency coordination, diagnostic log triage, and pre-tool deployment gating for autonomous multi-agent pipelines operating across the BDB Agent OS ecosystem.

---

## 1. Core Tenets

1. **Fail Deterministically, Recover Gracefully**: Never swallow errors silently or crash abruptly. Intercept all tool, network, and runtime faults through a 4-tier taxonomy (`transient`, `tool_level_fault`, `auth_credential`, `unrecoverable`). Execute structured recovery before attempting escalation.
2. **Zero-Race Concurrency**: Shared mutable state—including `production_artifacts/state.json`, git branches, and worktrees—must never suffer lost updates or dirty reads. Enforce mutual exclusion through atomic POSIX/APFS file locking (`O_CREAT | O_EXCL`) or fragment isolation (`state.d/<nodeId>.json`).
3. **No Hallucinated Triage**: Parse raw CI/CD logs directly (Vitest, Jest, tsc, ESLint, GitHub Actions). Extract verified file coordinates, line numbers, failure diffs, and exact root causes into structured JSON reports. Never synthesize speculative fixes without log verification.
4. **Strict Two-Phase Gate Precedence**: High-consequence actions (`git push`, `npm publish`, `npm version`, recursive `rm`) require an uncompromised human verification gate. Enforce the BDB Pre-Tool Gate protocol: lock execution in strict read-only mode until a literal, isolated human token `"GO"` is validated.

---

## 2. When to Use vs. When to Exclude

### ✅ When to Use
- **External API & Network Flakiness**: Handling HTTP 429 rate limits, socket timeouts (`ETIMEDOUT`), connection resets (`ECONNRESET`), and temporary provider dropouts.
- **Tool Failures with Fallbacks**: Automatically rerouting failed tool invocations to secondary providers (e.g., primary MCP down → secondary CLI fallback) with immutable diversion audit trails.
- **Concurrent Agent Execution**: Protecting shared files (`state.json`), databases, or worktrees during parallel build node execution (Engineering, UI/UX, Media).
- **CI/CD Pipeline Failures**: Ingesting build and test runner failure logs, distinguishing transient infrastructure errors from code regressions, and generating actionable repair proposals.
- **Release Verification & Deployment**: Enforcing the two-phase approval gate prior to running destructive or outward-facing operations.

### ❌ When to Exclude
- **Single-Agent Read-Only Probes**: Reading static documentation, viewing local files, or querying local git status where no concurrency or network calls occur.
- **Internal Synchronous Transforms**: Pure CPU operations, in-memory string formatting, or deterministic array manipulations without side effects.
- **Explicit User-Directed Interrupts**: Direct manual cancellation or kill signals received from the operator.

---

## 3. Resilience Architecture & Operational Playbooks

```
+---------------------------------------------------------------------------------------+
|                               /bdbresilience Skill Suite                              |
|                             Master Operational Architecture                           |
+-------------------------------------------+-------------------------------------------+
                                            |
        +-----------------------------------+-----------------------------------+
        |                                                                       |
        v                                                                       v
+---------------------------------------+     +-----------------------------------------+
|      Pattern 1: Error Recovery        |     |     Pattern 2: Distributed Locking      |
|  - 4-Tier Failure Classification      |     |  - POSIX Atomic Creation (O_CREAT|EXCL) |
|  - Full Jitter Exponential Backoff    |     |  - Monotonic Fencing Tokens             |
|  - Secondary Tool Router & Diversion  |     |  - Background Heartbeat Renewal         |
|  - Fail-Closed Human Escalation       |     |  - Atomic Stale / Orphan Eviction       |
|  [references/error-recovery.md]       |     |  [references/distributed-locking.md]    |
+---------------------------------------+     +-----------------------------------------+
        |                                                                       |
        +-----------------------------------+-----------------------------------+
                                            |
        +-----------------------------------+-----------------------------------+
        |                                                                       |
        v                                                                       v
+---------------------------------------+     +-----------------------------------------+
|       Pattern 3: CI/CD Triage         |     |       Pattern 4: Two-Phase GO Gate      |
|  - Multi-Runner ANSI Normalization    |     |  - Phase 1: Strict Read-Only Planning   |
|  - Flaky vs Deterministic Classifier  |     |  - Phase 2: Literal Token Execution     |
|  - JSON Diagnostic Report Schema      |     |  - Fail-Closed Transcript Scanner       |
|  - isCleanRun() Pass Predicate        |     |  - Caller-Written approvals Ledger      |
|  [references/cicd-triage.md]          |     |  [references/two-phase-go-gate.md]      |
+---------------------------------------+     +-----------------------------------------+
```

### Specialized Reference Guides
- 📘 **[Error Recovery & Retry Routing](references/error-recovery.md)**: Taxonomy classification, Full Jitter backoff formula, diversion logging, and zero-hallucination escalation payloads.
- 📘 **[Distributed Locking & Concurrency](references/distributed-locking.md)**: Atomic lockfile creation, lease TTLs, heartbeat renewal, atomic rename break eviction, and `state.json` protection.
- 📘 **[CI/CD Self-Healing Triage](references/cicd-triage.md)**: Multi-runner log parsers, flaky vs. deterministic classifier, and structured JSON diagnostics.
- 📘 **[Two-Phase Pre-Tool GO Gate](references/two-phase-go-gate.md)**: PreToolUse hook specifications, transcript token verification, and fail-closed gate mechanics.
- 📘 **[Node Integration Contracts](contracts/nodes-integration.md)**: **PROPOSAL, not applied.** How Reviewer and Shipping *would* be equipped in `nodes.json`, plus hooks for `/startcycle-graph` and `/bdbrainstorm`. No AOS node carries `bdbresilience` today.

---

## 4. Operational Commands & Procedures

### `/bdbresilience recover`
Invokes the automated error classification and recovery pipeline for a failed operation.
```typescript
import { classifyError, withRetry, executeWithFallback } from 'bdb-cicd-resilience/recovery/index.js';

// 1. Classify error
const classification = classifyError(error, { toolName: 'api_fetch', attempt: 1 });

// 2. Retry with full jitter if transient
//    (withRetry classifies internally too, and rethrows at once on canRetry: false)
if (classification.category === 'transient') {
  const result = await withRetry(
    () => callApi(),
    { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 10000 }
  );
}

// 3. Fallback route if tool fault. The fallback is a tool NAME; your execute
//    function does the dispatch, and a canRetry:false classification suppresses
//    the diversion instead of re-sending the call to a second provider.
if (classification.category === 'tool_level_fault') {
  const fallbackResult = await executeWithFallback({
    originalTool: 'mcp_primary',
    fallbackTool: 'cli_fallback',
    execute: (toolName) => invokeTool(toolName, args),
    auditFilePath: 'production_artifacts/diversions.jsonl',
  });
}
```

### `/bdbresilience lock`
Coordinates exclusive access to a shared resource using deterministic atomic locking.
```typescript
import { withStateLock, withDistributedLock } from 'bdb-cicd-resilience/locking/index.js';

// Guard state.json mutations
await withStateLock('production_artifacts/state.json', (state) => {
  state.artifacts.backend = 'production_artifacts/02_backend_schema.md';
  state.findings.push({ id: 'F-ENG-01', status: 'fixed' });
  return state;
}, { ttlMs: 15000, acquireTimeoutMs: 10000 });
```

### `/bdbresilience triage`
Parses build or test logs to isolate failures and propose fixes.
```typescript
import { generateDiagnosticReport, isCleanRun } from 'bdb-cicd-resilience/triage/index.js';

const report = generateDiagnosticReport(rawBuildOutput, 'vitest');
console.log(`Failures: ${report.summary.totalFailures} (Transient: ${report.summary.transientCount})`);
if (isCleanRun(report)) {
  // The ONLY sanctioned "it passed". `totalFailures === 0` alone is also true
  // for an empty or unrecognised log (summary.parseStatus 'empty' / 'unparsed').
} else if (report.summary.canAutoRetry) {
  // Safe infrastructure retry
} else {
  // Escalate exact deterministic failure coordinates to engineer
}
```

### `/bdbresilience gate`
Evaluates pre-tool execution authorization against the conversation transcript.
```typescript
import { verifyGoGate, checkPreToolGate } from 'bdb-cicd-resilience/triage/index.js';

const gate = checkPreToolGate('git push origin main', transcriptPath);
if (!gate.allowed) {
  throw new Error(`Gate Closed: ${gate.reason}. Reply with GO to unlock.`);
}
```

---

## 5. Common Rationalizations vs. Reality

| Rationalization | Engineering Reality | Resilience Protocol |
|-----------------|---------------------|---------------------|
| *"A simple `setTimeout(1000)` retry is fine without jitter."* | Synchronous fixed backoffs cause thundering herds on rate-limited endpoints. | **Mandatory Full Jitter**: Sleep for $T = \text{random}(0, \min(T_{\max}, T_{\text{base}} \cdot 2^{\text{attempt}}))$. |
| *"State file collisions won't happen because agents finish quickly."* | Parallel agent fan-out runs in separate processes; uncoordinated writes cause lost updates. | **Atomic POSIX Lock**: Use `open(..., 'wx')` with fencing tokens or isolated `state.d/<nodeId>.json` fragments. |
| *"The test failed due to an intermittent CI glitch, let's ignore it."* | Masking real assertion failures as "flaky" leads to shipping broken code to production. | **Deterministic Classifier**: Only classify network/OOM/timeout as flaky; assertion and type errors must never be bypassed. |
| *"The user said 'starte jetzt', so that counts as approval."* | Compound action verbs violate the two-phase safety protocol; user intent may be unconfirmed. | **Strict Literal Token**: Gate unlocks ONLY if the single trimmed word is `"GO"`. Fail-closed on everything else. |

---

## 6. Red Flags Checklist

- [ ] **Hardcoded Delays**: Retrying without random jitter or exponential backoff.
- [ ] **Missing Finally Block**: Acquiring a distributed lock without releasing in a `finally` block or relying on process exit.
- [ ] **Unlink Without Verification**: Deleting a stale lockfile without checking process liveness (`process.kill(pid, 0)`) or using the atomic rename break protocol.
- [ ] **Synthetic Error Hallucination**: Fabricating an error root cause when log parsing failed or was inconclusive.
- [ ] **Soft Gate Bypass**: Proceeding with deployment when gate evaluation returned `allowed: false` or when transcript was missing.
- [ ] **Sidechain Approval**: Permitting an automated subagent message (`isSidechain: true`) to satisfy human approval.

---

## 7. Verification & Testing Protocol

To verify the `/bdbresilience` suite and its underlying TypeScript engine:

```bash
# 1. Typecheck TypeScript implementation
npm run typecheck

# 2. Compile to dist/ distribution
npm run build

# 3. Execute full unit, integration, and E2E verification
npm test
```
