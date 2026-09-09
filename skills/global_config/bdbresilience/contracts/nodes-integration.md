# 🤝 Node & Pipeline Integration Contracts

> **Status: partially applied. Read the split below before relying on anything here.**
>
> **Applied (2026-09-09).** This skill ships inside AOS at
> `skills/global_config/bdbresilience/`, and `.agents/nodes.json` lists
> `bdbresilience` in the `skills` array of two nodes: **`shipping`** (it runs
> lint/typecheck/tests, which is exactly what the triage parsers read) and
> **`engineering`** (the error taxonomy and backoff guidance). The dispatcher
> injects each node's `skills` list into its prompt, so those two nodes are told
> to reach for this skill. That is the whole of the integration: **guidance, not
> code.** AOS does not depend on the `bdb-cicd-resilience` package — it has two
> runtime dependencies and neither is this one.
>
> **Not applied, and not currently possible.** Every code-level integration below.
> `startcycle-dispatch.mjs` contains no `withStateLock` call and cannot contain one:
> the Workflow runtime gives the dispatcher script **no filesystem access**, which is
> precisely why AOS solves its own concurrent-write race with single-writer fragments
> (`production_artifacts/state.d/<node>.json`) plus a merge step instead of a lock.
> A lock needs a filesystem; the dispatcher does not have one. Do not wire one in.
>
> **Where a lock would genuinely fit**, if this is revisited: `installer.js`, which
> does a real read-modify-write on `~/.agents/.bdb-install-manifest.json` and can be
> run twice concurrently. That is the only place in AOS with both filesystem access
> and real contention. Before doing it, note that this library's Windows paths
> (`EPERM`/`EBUSY` handling, close-before-unlink ordering) are **written but never
> executed** — two tests skip on non-Windows — and AOS ships to Windows users.
>
> §6 documents the `withStateLock()` signature as it actually exists in
> `src/locking/resource-lock.ts`.

**Deliverable**: Requirement R4 Integration Contracts (proposal)  
**Target Architecture**: BDB Agent OS (`.agents/nodes.json`, `/startcycle-graph`, `/bdbrainstorm`)  
**Specification Reference**: `survey_miner_1/survey_report.md`

---

## 1. Proposed Architectural Role

The proposal is to wire the `/bdbresilience` skill suite into the BDB Agent OS multi-agent dispatcher graph. Equipping the **Reviewer** and **Shipping** nodes with resilience capabilities would give the ecosystem automated adversarial auditing of network and concurrency boundaries, and deterministic self-healing quality gates.

Resilience principles would additionally be seeded upstream in **`/bdbrainstorm`** during concept ideation, so that downstream implementation nodes (Engineering, UI/UX, Media) receive explicit reliability requirements.

Applying this proposal is out of scope for the current cycle. It belongs to an AOS integration cycle, which is also where several deferred design questions get their answers — fencing-token verification, the default `ttlMs`, and retry idempotency.

---

## 2. Not adopted: the Reviewer node

> **This proposal was considered and declined on 2026-09-09.** The live
> `nodes.json` does **not** carry `bdbresilience` in `reviewer.skills`, and that is
> deliberate, not an oversight.
>
> Reviewer reads build artifacts and the plan's contract and argues about
> correctness. It does not run CI, does not read tool logs, and does not classify
> retryable failures — the three things this skill is for. A skill allowlist that
> lists everything guides nothing, so the registration went to `shipping` (which
> runs the gates whose output the triage parsers read) and `engineering` (which
> owns the error taxonomy) and stopped there.
>
> The section is kept because the reasoning is worth having on record, and because
> the shape of the entry is a useful template if a future node genuinely needs it.

The **Reviewer** node executes adversarial verification of build-node outputs against the execution plan contract using the *doubt-driven development* discipline. The JSON below is the entry that **would** be added, had this been adopted.

### Declarative Configuration (`.agents/nodes.json`)
```json
{
  "reviewer": {
    "label": "Reviewer",
    "agentType": "reviewer",
    "personaFile": ".claude/agents/reviewer.md",
    "model": "sonnet",
    "role": "review",
    "artifactKey": "review",
    "writes": null,
    "optional": false,
    "skills": [
      "ui-review",
      "ux-audit",
      "architect-review",
      "systematic-debugging",
      "bdbresilience"
    ],
    "instructions": null
  }
}
```

### Proposed Reviewer Resilience Audit Discipline
Once equipped with `bdbresilience`, Reviewer would evaluate build outputs (`state.artifacts.{frontend,backend,media}`) against strict resilience checks:

1. **Network & Tool Call Audits**:
   - Verifies that all external HTTP, API, database, and MCP calls implement structured error classification and Full Jitter exponential backoff.
   - Flags bare `catch (e) {}` blocks, unhandled Promise rejections, and silent error swallows as:
     `{ "id": "F-RES-NET-01", "severity": "blocking", "node": "engineering", "status": "open" }`.
2. **Concurrency & Resource Access Audits**:
   - Verifies that parallel operations accessing shared files, worktrees, or databases either write isolated fragments (`production_artifacts/state.d/<nodeId>.json`) or acquire a distributed file lock.
   - Flags missing `finally { await handle.release(); }` blocks as `severity: "blocking"`.
3. **Ownership Attribution & Stable ID Generation**:
   - Findings must be attributed strictly to the owning build node (`engineering`, `ui_ux`, or `media`).
   - Finding IDs must remain stable across cycles (e.g. `F-ENG-01`) so the dispatcher's **No-Progress Guard** can detect stalled repair loops and escalate immediately to human review.

---

## 3. Applied: the Shipping node (`.agents/nodes.json`)

> **Adopted 2026-09-09.** `shipping.skills` now ends with `"bdbresilience"`, and
> `engineering.skills` likewise. Those two are the whole of the applied
> integration — see the status block at the top of this file.

The **Shipping** node acts as the release gatekeeper, running mechanical verification gates (lint, typecheck, tests, a11y, seo) after Reviewer findings are cleared. It is the natural home for this skill: the triage parsers read exactly the tsc, ESLint and Jest/Vitest output those gates produce, and `isCleanRun()` is the predicate that decides whether an unrecognised log counts as passing (it does not).

### Declarative Configuration (`.agents/nodes.json`)
```json
{
  "shipping": {
    "label": "Godmode_Shipping",
    "agentType": "godmode-shipping",
    "personaFile": ".claude/agents/godmode-shipping.md",
    "model": "sonnet",
    "role": "gate",
    "artifactKey": "report",
    "writes": null,
    "optional": false,
    "skills": [
      "godmode-shipping",
      "webapp-testing",
      "seo-audit",
      "wcag-audit-patterns",
      "github-repo",
      "clean-code",
      "bdbresilience"
    ],
    "instructions": null
  }
}
```

### Proposed Shipping Quality Gate & Verification Discipline
Once equipped with `bdbresilience`, Shipping would execute automated diagnostic triage and gating:

1. **Automated Diagnostic Triage Execution**:
   - Runs mechanical verification commands: `npm run typecheck`, `npm run build`, `npm test`, `npm run lint`.
   - If a command fails, Shipping pipes stderr/stdout directly into `generateDiagnosticReport(log, runner)`:
     - A run counts as clean **only if `isCleanRun(report)` is true**, never on `totalFailures === 0` alone — an empty or unparseable log also has zero diagnostics, and reading that as a pass is a fail-open gate.
     - If all failures are classified as `transient_infra` (`canAutoRetry: true`): Shipping automatically retries the command up to 2 times with Full Jitter before recording a failure.
     - If any failure is classified as `deterministic_code_regression`: Shipping generates a structured failure section in `production_artifacts/04_release_report.md` detailing the exact failed assertion, target file, line coordinate, and remediation command.
2. **Gate Population & Node Attribution**:
   - Updates `state.gate`:
     ```json
     {
       "lint": "pass",
       "typecheck": "fail",
       "tests": "pass",
       "a11y": "skip",
       "seo": "skip",
       "blockingNodes": ["engineering"]
     }
     ```
   - Instructs the dispatcher to re-invoke only the failing node (`engineering`) rather than re-running all build nodes.
3. **Pre-Tool GO Gate Release Protocol**:
   - When all checks pass, Shipping sets `state.phase = "ready_to_ship"`.
   - Concludes turn by outputting the Release Report and instructing the operator:
     > *"All quality gates passed. Reply with the literal word GO to authorize release deployment."*
   - Strictly prohibits calling `git push` or `npm publish` without human approval verified via `verifyGoGate()`.

---

## 4. Proposed: Integration with `/startcycle-graph`

`~/.claude/workflows/startcycle-dispatch.mjs` and `~/.claude/hooks/graph-gate.mjs` both exist, but neither references this library. The proposal is that `bdbresilience` would power core graph infrastructure:

1. **Parallel Build Fan-Out Isolation**:
   - When `ui_ux`, `engineering`, and `media` execute concurrently, each node would write exclusively to:
     `production_artifacts/state.d/<nodeId>.json`
   - A dedicated barrier folding agent would consolidate fragments into `production_artifacts/state.json` under `withStateLock()`. **This call does not exist in the dispatcher today.**
2. **Loop Retention Hook (`graph-gate.mjs`)**:
   - Would intercept turn completion if `state.gate` contains failing checks and `iteration < max_iterations`, blocking session turn-end with exit code 2 to force repair execution. Whether the existing hook already does this independently of `bdbresilience` was not verified for this document.
3. **No-Progress Guard**:
   - If Reviewer reports the exact same set of blocking finding IDs across successive iterations, the dispatcher halts immediately (`state.phase = "escalated"`, `state.needs_human = true`). This guard is part of the AOS graph contract, not of this library.

---

## 5. Proposed: Integration with `/bdbrainstorm`

The proposal is that `~/.agents/skills/bdbrainstorm/SKILL.md` would embed resilience requirements into concept planning. Its current content was not inspected for this document:

1. **Pillar 2: `/grill-me` Interactive Inquiries**:
   - Grills the user on SLA thresholds, API rate limits, failure blast radius, and recovery procedures:
     - *"What are the rate limits and fallback providers for external dependency X?"*
     - *"How will concurrent writes to shared database entities be serialized?"*
2. **Pillar 4: Engineering Godmode (DDD & Clean Architecture)**:
   - Mandates that domain models represent failure states explicitly as Discriminated Unions (e.g. `Result<T, ClassifiedError>`).
   - Requires Architecture Decision Records (ADRs) for locking mechanisms and retry backoff strategies.
3. **Pillar 6: Shipping Godmode & Pipeline Hand-off**:
   - Packages resilience specifications directly into `state.goal` so downstream Architect and TechLead nodes include them in `production_artifacts/00_execution_plan.md`.

---

## 6. `withStateLock()` — the one part of this document that is real

This function exists today in `src/locking/resource-lock.ts` and behaves as described. It is what a barrier folding agent in §4 would call.

```typescript
import { withStateLock } from 'bdb-cicd-resilience/locking/index.js';

const merged = await withStateLock(
  'production_artifacts/state.json',
  async (state) => {
    state.findings.push({ id: 'F-ENG-01', status: 'fixed' });
    return state;
  },
  { ttlMs: 15000, acquireTimeoutMs: 10000 }
);
```

- Signature: `withStateLock<T>(statePath, updater, options?) => Promise<T>`.
- The lock resource key is `state:<resolved absolute path>`, so two callers passing different relative paths to the same file still serialize.
- `acquireTimeoutMs` defaults to `10000` here (not `0` as in `acquireLock`), so callers queue rather than fail on first contention.
- A missing state file is read as `{}`; any other read error propagates.
- The updater's return value is written; returning `undefined` writes the state object as mutated.
- **The write is refused if the lease was lost while the updater ran** — `handle.isExpired()` is checked after the updater returns and before the temp+rename write, and throws rather than clobber a successor's state file.
- The state file itself *is* written temp+rename. That is unrelated to the lockfile, which is never renamed into place (see `references/distributed-locking.md` §2).
- The lock is released in a `finally`, and release errors are swallowed.
