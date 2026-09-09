# 🩺 Reference Guide: CI/CD Self-Healing Triage & Diagnostic Reporting

**Pattern**: Pattern 3 — Build, Test & Lint Failure Triage  
**Module**: `bdb-cicd-resilience/triage`  
**Authoritative Source**: BDB Agent OS CI/CD Triage Specification

---

## 1. Overview & Problem Statement

When automated CI/CD pipelines fail (during `npm test`, `tsc --noEmit`, `eslint`, or GitHub Actions runs), agents frequently hallucinate root causes by reading unstructured terminal output or trying random edits without identifying the real failure. Alternatively, agents waste execution turns retrying deterministic code bugs, or conversely halt prematurely on transient infrastructure hiccups (such as an npm registry timeout or port bind collision).

The CI/CD Triage Engine ingests raw terminal logs, normalizes ANSI codes and runner annotations, parses failure coordinates across 5 major runners, classifies failures into transient infrastructure versus deterministic regressions, and produces verified JSON diagnostic summaries with exact remediation commands.

---

## 2. Multi-Runner Log Ingestion & Normalization

Raw build logs contain noisy ANSI color sequences, carriage return overwrites (`\r\n`), and runner-specific group wrappers (`##[group]`, `::error::`).

### ANSI Normalization Pipeline
1. **Control Sequence Stripping**: Removes terminal escapes (`\x1b[[0-9;]*[mGKF]`).
2. **CRLF Normalization**: Converts Windows line endings to standard Unix newlines (`\r\n` → `\n`).
3. **CI Annotation Scrubbing**: Normalizes GitHub Actions workflow commands:
   - `##[group]...##[endgroup]`
   - `##[error]...`
   - `::error file={name},line={line}::{message}`

---

## 3. Runner-Specific Log Parsers

The engine incorporates dedicated parsers for each standard ecosystem tool:

| Runner | Detected Signatures | Extracted Data Coordinates | Remediation Command Generated |
|--------|---------------------|----------------------------|-------------------------------|
| **Vitest** | `FAIL tests/...`<br>`AssertionError:`<br>`expected ... to be ...` | Test file path, line, column, assertion diff snippet | `npx vitest run <file> -t "<test>"` |
| **Jest** | `● <describe> › <test>`<br>`Expected: ... Received: ...`<br>`at ... (<file>:<line>:<col>)` | Test spec file, stack frame line/col (prioritizing user code over `node_modules`) | `npx jest <file> -t "<test>"` |
| **TypeScript (`tsc`)** | `src/auth.ts(42,15): error TS2322`<br>`src/auth.ts:42:15 - error TS2322` | Source file, line, column, TS error code, type mismatch explanation | `npx tsc --noEmit` |
| **ESLint** | `<file>:<line>:<col>: <msg> [<rule>]`<br>Tabular/Stylish reporter lines | Target source file, line, col, rule ID, severity | `npx eslint --fix <file>` |
| **GitHub Actions** | `##[error]Process completed with exit code 137`<br>`The operation was canceled`<br>`Request timeout after 30000ms` | Runner step, exit code, memory or timeout fault | Automated infrastructure retry with jitter |

---

## 4. Flaky Infrastructure vs. Deterministic Regression Classifier

The core intelligence distinguishes between errors that can be safely retried and code bugs requiring source modification:

```
                            [ Parsed Diagnostic Error ]
                                         │
                                         ▼
                 ┌───────────────────────────────────────────────┐
                 │     classifyDiagnostic(error, context)        │
                 └───────────────────────┬───────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     [ TRANSIENT INFRASTRUCTURE ]                   [ DETERMINISTIC REGRESSION ]
     - HTTP 429 Throttling                          - AssertionError (Expected X, got Y)
     - Socket ETIMEDOUT / ECONNRESET                - TypeScript Type Error (TS2322)
     - Runner Exit Code 137 (OOM)                   - SyntaxError / Parsing Failure
     - EADDRINUSE (Port collision)                  - ESLint Rule Violation
     - Registry 503 / DNS Blip                      - Missing Export / ReferenceError
                 │                                               │
                 ▼                                               ▼
       canAutoRetry: true                              canAutoRetry: false
   (Retry step with Full Jitter)                  (Requires source code repair)
```

### Classification Heuristics
- **Transient Infrastructure (`transient_infra`)**:
  - `canAutoRetry: true`
  - Does NOT count against agent repair loop limits.
  - Automatically triggered up to 2 times before escalating.
- **Deterministic Code Regression (`deterministic_code_regression`)**:
  - `canAutoRetry: false`
  - Attributed to the responsible build node (Engineering, UI/UX).
  - Feeds into `production_artifacts/review_findings.md` or `state.findings`.
- **Unrecognised text** falls to `deterministic_code_regression`, i.e. this classifier **fails closed**. That is the opposite of `classifyError`'s unknown default in the recovery module, and deliberately so — see `error-recovery.md` §7 for why neither should be changed to match the other.

---

## 5. Was Anything Understood? — `parseStatus` and `isCleanRun`

`totalFailures === 0` is **not** the answer to "did this run pass". A log that was empty, and a log that no parser recognised, both produce zero diagnostics. Reading either as a clean gate is a fail-open defect, so the report carries a third axis:

| `parseStatus` | When | `totalFailures` | `canAutoRetry` | `requiresHumanIntervention` |
|---|---|---|---|---|
| `parsed` | a runner signature matched, or a parser extracted ≥1 diagnostic | as extracted | `n > 0 && transient === n` | `deterministic > 0` |
| `empty` | the log is empty or pure ANSI after stripping | `0` | `false` | `true` |
| `unparsed` | nothing matched — e.g. a Go, pytest or Maven failure | `0` | `false` | `true` |

`empty` is deliberately **not** clean: a build step that produced no output is not evidence that it passed. Neither status ever carries a synthetic diagnostic — inventing one would inflate `totalFailures` and lie to every consumer counting failures.

The predicate is exported so no consumer has to reconstruct the rule:

```typescript
import { isCleanRun } from 'bdb-cicd-resilience/triage/index.js';

if (isCleanRun(report)) { /* the only sanctioned "it passed" */ }
```

`isCleanRun(report) === (report.summary.parseStatus === 'parsed' && report.summary.totalFailures === 0)`. Any AOS integration must call it rather than reading `totalFailures` directly.

---

## 6. Structured JSON Diagnostic Schema

`dominantCategory` is `undefined` whenever `totalFailures === 0`; it is not defaulted to a classification.

```json
{
  "timestamp": "2026-09-05T14:45:00.000Z",
  "runner": "vitest",
  "summary": {
    "totalFailures": 2,
    "transientCount": 1,
    "deterministicCount": 1,
    "parseStatus": "parsed",
    "dominantCategory": "deterministic_code_regression",
    "canAutoRetry": false,
    "requiresHumanIntervention": true
  },
  "diagnostics": [
    {
      "file": "tests/unit/auth.test.ts",
      "line": 42,
      "column": 14,
      "assertionSnippet": "expect(user.isAuthenticated).toBe(true)",
      "classification": "deterministic_code_regression",
      "rootCause": "AssertionError: expected false to be true // Received user object without auth token",
      "remediationCommand": "npx vitest run tests/unit/auth.test.ts -t \"verifies authenticated user\"",
      "canAutoRetry": false
    },
    {
      "file": "src/services/api.ts",
      "classification": "transient_infra",
      "rootCause": "FetchError: request to https://registry.npmjs.org timed out after 30000ms (ETIMEDOUT)",
      "remediationCommand": "npm cache clean --force && npm install",
      "canAutoRetry": true
    }
  ]
}
```

---

## 7. TypeScript API Usage Example

```typescript
import {
  generateDiagnosticReport,
  classifyDiagnostic,
  isCleanRun,
  stripAnsi
} from 'bdb-cicd-resilience/triage/index.js';

// Clean and parse raw output
const cleanLog = stripAnsi(rawStderr);
const report = generateDiagnosticReport(cleanLog);

if (isCleanRun(report)) {
  console.log('✅ All checks passed clean.');
} else if (report.summary.parseStatus !== 'parsed') {
  console.error(`❌ Log was ${report.summary.parseStatus} — nothing was understood, not a pass.`);
} else if (report.summary.canAutoRetry && report.summary.deterministicCount === 0) {
  console.log('⚠️ Transient infrastructure failure detected. Executing auto-retry...');
  await executeRetryCommand();
} else {
  console.error('❌ Deterministic code regression detected:');
  for (const diag of report.diagnostics) {
    if (diag.classification === 'deterministic_code_regression') {
      console.error(`  - ${diag.file}:${diag.line} -> ${diag.rootCause}`);
      console.error(`    Suggested fix command: ${diag.remediationCommand}`);
    }
  }
}
```
