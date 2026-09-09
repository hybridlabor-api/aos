# 🔁 Reference Guide: Error Recovery & Fallback Routing

**Pattern**: Pattern 1 — Agent Runtime & Tool Fault Tolerance  
**Module**: `bdb-cicd-resilience/recovery`  
**Authoritative Source**: BDB Agent OS Resilience Specification

---

## 1. Overview & Problem Statement

Autonomous AI agents executing complex development cycles interface with numerous external boundaries: MCP servers, remote HTTP APIs, local compilers, and subprocess tools. In unhardened architectures, transient hiccups (such as an HTTP 429 rate limit or network socket drop) cause immediate agent crashes, session restarts, or synthetic hallucinations where the agent fabricates tool responses.

The BDB Error Recovery Engine intercepts every runtime and tool failure, deterministically categorizing the error into a 4-tier taxonomy, executing exponential backoff with Full Jitter, diverting to secondary fallback tools when applicable, and escalating unrecoverable errors cleanly to human operators.

---

## 2. 4-Tier Failure Classification Taxonomy

Every caught exception is inspected against error codes, HTTP status codes, error messages, and causal chains:

```
                          [ Caught Exception / Rejection ]
                                         │
                                         ▼
                         ┌───────────────────────────────┐
                         │      classifyError() Logic    │
                         └───────────────┬───────────────┘
                                         │
         ┌──────────────────┬────────────┴───────────┬──────────────────┐
         │                  │                        │                  │
         ▼                  ▼                        ▼                  ▼
  ┌──────────────┐   ┌──────────────┐         ┌──────────────┐   ┌──────────────┐
  │  TRANSIENT   │   │  TOOL_FAULT  │         │     AUTH     │   │UNRECOVERABLE │
  │ (429, 503,   │   │ (Crash, Bad  │         │  (401, 403,  │   │(Loop, Context│
  │  ETIMEDOUT,  │   │  JSON, Schema│         │  Missing     │   │ Exhausted,   │
  │  ECONNRESET) │   │  Mismatch)   │         │  API Token)  │   │ Fatal State) │
  └──────┬───────┘   └──────┬───────┘         └──────┬───────┘   └──────┬───────┘
         │                  │                        │                  │
         ▼                  ▼                        ▼                  ▼
  [Full Jitter      [Secondary Tool           [Escalate to       [Fail-Closed   ]
   Retry Loop]       Fallback Routing]         Human Env Setup]   Escalation    ]
```

### Classification Matrix

The checks run **in this order**, and the first match wins. The order is load-bearing: `ECONNREFUSED` is classified `transient`, not `tool_level_fault`, because the transient check is reached first.

| # | Category | Actual signatures in `classifyError` | Can Retry? | Suggested Action | Handling Strategy |
|---|----------|-------------------|------------|------------------|-------------------|
| 1 | **`unrecoverable`** | loop phrases (`loop detected`, `no progress loop detected`, `identical reviewer finding ids`, `max iterations reached`, `infinite loop`); context exhaustion (`context overflow`, `context exhaustion`, `prompt length exceeds`); fatal state (`critical_fatal`, `corrupted state tree`, `fatal syntax in production`); a `SyntaxError` that is **not** about JSON | `false` | `escalate_to_human` | Immediate fail-closed escalation with full diagnostic payload. |
| 2 | **`auth_credential`** | HTTP `401`/`403`; codes `EAUTH`, `UNAUTHORIZED`, `FORBIDDEN`, `AUTH_FAILED`; messages `unauthorized`, `forbidden`, `invalid token`, `invalid_token`, `missing api key`, `bad credentials`, `authentication failed` | `false` | `escalate_to_human` | Halt immediately. Do not retry credentials, and do not divert to another provider. |
| 3 | **`transient`** | HTTP `429`/`502`/`503`/`504`; codes `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `EAI_AGAIN`, `ENOTFOUND`, `LOCK_TIMEOUT`, `TIMEOUT`, `ESOCKETTIMEDOUT`; messages `rate limit`, `too many requests`, `timed out`, `connection reset`, `network error`, `bad gateway`, `service unavailable`, `lock acquisition timed out` | `true` | `backoff_retry` | Full Jitter backoff up to `maxRetries`; a `Retry-After` sets the floor. |
| 4 | **`tool_level_fault`** | MCP/tool crash, non-zero exit, schema argument mismatch, malformed JSON output | `true`, unless `context.hasFallback === false` | `fallback_route` (or `escalate_to_human` with no fallback) | Route to the registered secondary provider. |
| 5 | **anything unrecognised** | terminal fall-through | `true` (fails open) | `fallback_route` | See §7 — this default is the opposite of the triage classifier's, deliberately. |

`EACCES` is **not** an auth signature here despite being a permission error; unless its message matches one of the phrases above it falls through to row 5. `ENOENT` is not a signature at any row.

---

## 3. Full Jitter Exponential Backoff Algorithm

Fixed delay retries and naive exponential backoffs create the **thundering herd problem**, where multiple concurrent agents or threads retry against a recovering service simultaneously, re-saturating the endpoint.

### Mathematical Formulation
The BDB Engine implements AWS-standard **Full Jitter**:

$$T_{\text{wait}} = \text{random}(0, \, \min(T_{\max}, \, T_{\text{base}} \cdot 2^{\text{attempt}}))$$

Where:
- $T_{\text{base}}$: Base initial backoff duration (`baseDelayMs`, **default `100 ms`**)
- $T_{\max}$: Ceiling duration cap (`maxDelayMs`, default `10,000 ms`)
- $\text{attempt}$: Zero-indexed retry attempt count ($0, 1, 2, \dots$)
- $\text{random}(0, X)$: Uniformly distributed pseudo-random value in $[0, X)$, floored to an integer

Three behaviours of `calculateBackoff` that the formula does not show:
- It returns **`-1`** once `attempt >= maxRetries` (default `3`) — a termination signal, not a delay. With the defaults, only attempts 0, 1 and 2 produce a wait.
- `jitter: false` disables the randomisation and returns the clamped exponential window directly.
- A parsed `Retry-After` acts as a **floor**, not a replacement: `delay = max(jitteredDelay, retryAfterMs)`. Per RFC 9110 a numeric `Retry-After` is delta-seconds unconditionally — there is no magnitude at which it becomes milliseconds — and the parsed value is clamped to `86,400,000 ms` so a broken or hostile server cannot pin a CI job indefinitely.

### Concrete Progression Example, with $T_{\text{base}}$ set explicitly to $500\text{ ms}$, $T_{\max} = 10,000\text{ ms}$

| Attempt | Exponential Window ($T_{\text{base}} \cdot 2^{\text{attempt}}$) | Clamped Ceiling | Jitter Range | Expected Average Wait |
|:-------:|:---------------------------------------------------------------:|:---------------:|:------------:|:---------------------:|
| 0 | $500 \cdot 2^0 = 500\text{ ms}$ | $500\text{ ms}$ | $0\text{ to }500\text{ ms}$ | $250\text{ ms}$ |
| 1 | $500 \cdot 2^1 = 1,000\text{ ms}$ | $1,000\text{ ms}$ | $0\text{ to }1,000\text{ ms}$ | $500\text{ ms}$ |
| 2 | $500 \cdot 2^2 = 2,000\text{ ms}$ | $2,000\text{ ms}$ | $0\text{ to }2,000\text{ ms}$ | $1,000\text{ ms}$ |
| 3 | $500 \cdot 2^3 = 4,000\text{ ms}$ | $4,000\text{ ms}$ | $0\text{ to }4,000\text{ ms}$ | $2,000\text{ ms}$ |
| 4 | $500 \cdot 2^4 = 8,000\text{ ms}$ | $8,000\text{ ms}$ | $0\text{ to }8,000\text{ ms}$ | $4,000\text{ ms}$ |
| 5+ | $500 \cdot 2^5 = 16,000\text{ ms}$ | $10,000\text{ ms}$ (Capped) | $0\text{ to }10,000\text{ ms}$ | $5,000\text{ ms}$ |

The table shows the clamping arithmetic only. With the default `maxRetries: 3`, attempts 3 and above never reach it — they return `-1`. The exponent is additionally capped at $2^{30}$ so a large attempt number cannot overflow to `Infinity`.

---

## 4. Secondary Tool Fallback Routing

When a primary tool experiences a `tool_level_fault` (e.g. MCP bridge disconnect, malformed response payload), the recovery engine routes execution to a secondary fallback provider without interrupting the agent workflow.

### Architecture
1. **Fallback Registry** (`ToolRouter`): Maps primary tool identifiers to registered fallback tool **names** (strings, not functions).
   - Example: `mcp_git_commit` → `cli_git_commit`
   - Example: `mcp_file_search` → `find_by_name`
2. **Execution Diversion**: `executeWithFallback` calls your `execute(toolName)` a second time with the fallback name. The caller owns the dispatch; the router only decides *whether* and *to what*.
3. **Audit Logging**: Every decision is appended to a JSONL audit file — `auditFilePath` if supplied, otherwise `diversions.jsonl` in the process working directory.

### The classification is a safety signal, not a log label

`executeWithFallback` refuses to divert when `classifyError` returns `canRetry: false`. An `auth_credential` rejection must not be re-sent to a second provider — that is a data-egress decision — and an `unrecoverable` fault will fail there too. The suppression is still audited (`status: "escalated"`) and the **primary** error is rethrown. With no fallback registered at all, the primary error is rethrown without an audit entry.

### Diversion Record Schema
Fields are exactly `DiversionRecord`. There is no `success` or `durationMs` field; the outcome is carried by `status`.
```json
{
  "timestamp": "2026-09-05T14:40:00.123Z",
  "originalTool": "mcp_aftereffects_applyEffect",
  "fallbackTool": "cli_ae_script_runner",
  "errorCategory": "tool_level_fault",
  "reason": "Connection reset on MCP socket port 9080",
  "status": "diverted"
}
```
`status` is one of `diverted` (fallback succeeded), `exhausted` (both failed — the **fallback** error is rethrown), or `escalated` (diversion suppressed by `canRetry: false`). `eventId`, `agentId` and `attempt` are optional and only written when supplied.

---

## 5. Anti-Hallucination Escalation Protocol

### The Zero-Hallucination Mandate
When retries are exhausted or when an error is classified as `unrecoverable` or `auth_credential`, the system must **NEVER**:
- Fabricate synthetic data to "keep going".
- Invent simulated success responses from tools.
- Pretend an API call succeeded when it returned an error.

### Structured Escalation Payload
`escalateToHuman(error, context)` **returns** this payload. It does not write it anywhere — persisting it to `production_artifacts/state.json` is the caller's job. The shape is exactly `EscalationPayload`:

```json
{
  "escalationType": "HUMAN_REVIEW_REQUIRED",
  "phase": "escalated",
  "needs_human": true,
  "timestamp": "2026-09-05T14:52:11.004Z",
  "classification": "unrecoverable",
  "primaryFailure": {
    "tool": "fetch_database_schema",
    "errorCode": "ECONNREFUSED",
    "message": "Connection refused at 10.0.0.4:5432",
    "attempts": 4
  },
  "impactedResource": "production_artifacts/state.json",
  "remediationOptions": [
    "Inspect the raw stack trace and correct syntax or semantic errors in source code.",
    "Verify database schema definitions and migration scripts.",
    "Revert recent uncommitted modifications to restore known-healthy state."
  ],
  "antiHallucinationAssertion": "Fail-closed verification: No synthetic or hallucinated remediation applied. Execution halted awaiting explicit human review and authorization."
}
```

`remediationOptions` is a fixed list selected by `classification` (with two message-keyword special cases for loop and context/token exhaustion) — it is a checklist, not a diagnosis of this specific failure. `tool` is read from `context.tool` or `context.originalTool`, `attempts` from `context.attempts` (default `1`), `impactedResource` from `context.impactedResource` or `context.resource`; `fallbacksAttempted` and `impactedResource` are omitted entirely when absent. `createEscalationPayload` is an alias for the same function.

---

## 6. TypeScript Implementation Example

```typescript
import {
  classifyError,
  calculateBackoff,
  withRetry,
  ToolRouter
} from 'bdb-cicd-resilience/recovery/index.js';

// Setup the fallback registry: primary tool name -> fallback tool NAME
const router = new ToolRouter({ auditFilePath: 'production_artifacts/diversions.jsonl' });
router.registerFallback('mcp_fetch', 'cli_fetch');

async function callResilientTool(toolName: string, args: Record<string, unknown>) {
  return await withRetry(
    // router.execute passes the tool name to invoke; on a retryable primary
    // failure it calls the same function again with the fallback name.
    () => router.execute(toolName, (name) => invokeTool(name, args)),
    { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 10000 }
  );
}
```

`withRetry` classifies each caught error itself and rethrows immediately on `canRetry: false`, so an auth failure is not retried three times before escalating. `calculateBackoff(attempt, options, retryAfterMs?)` is exported separately for callers driving their own loop, and `BackoffEngine` wraps it with fixed options.

---

## 7. Opposite unknown-error defaults, and why they stay opposite

`recovery/classifier.ts` and `triage/classifier.ts` both have a terminal fall-through for input they do not recognise, and the two point in **opposite directions**. This is deliberate, and changing either to match the other makes one of the two modules worse.

| | `classifyError` (recovery) | `classifyDiagnostic` (triage) |
|---|---|---|
| Input | a live operational error from one in-flight call | a finished test or build log |
| Unknown default | `tool_level_fault`, `canRetry: true` — **fails open** | `deterministic_code_regression`, `canAutoRetry: false` — **fails closed** |
| Cost of being wrong | one extra bounded attempt | an unbounded CI loop re-running the pipeline against a real regression |

**The retry budget is what makes the difference.** The recovery path has one — `withRetry`'s `maxRetries`, the router's single fallback hop — so an extra attempt is bounded and usually succeeds; failing closed there would page a human for every unrecognised transient. The triage path has no budget at all: a wrong "retryable" on a deterministic regression loops forever, while failing closed costs one human look. Consistently: when `context.hasFallback === false` the recovery path has no budget left either, and it escalates too.

---

## 8. Constraint: retries assume idempotency

`withRetry` and `executeWithFallback` re-execute the operation you hand them. **They are safe only around idempotent operations.** A retried non-idempotent call — posting a PR comment, dispatching a workflow, triggering a deployment — can take effect more than once, and a diversion to a second provider can take effect on *both*. Nothing in this library detects or prevents that.

No `idempotent` flag is offered, deliberately: with no real call sites it would be set to `true` by everyone by default and would document nothing. The real design belongs where the CI call sites exist, in the AOS integration cycle. Until then, the constraint is the caller's to honour.
