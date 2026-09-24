# Skylos Guide — Diff & AST Security Scanning

Skylos is pillar 1 of the BDB Security Audit skill: a static security analyzer that
works at the **AST level** (it parses code structure, not text) and supports
**diff mode**, so it can gate exactly the lines a PR or staging area touches.
Its role is a pre-commit and Shipping quality-gate check — the automated half of
`bdb-security-audit`, before the human-driven checklists run.

This guide covers installation, running, gate integration, and interpretation.
Command surface below reflects the two core entrypoints (`skylos scan`,
`skylos diff`); **always confirm flags against `skylos --help` for the installed
version** — do not assume flags from this document alone.

## 1. Installation

Skylos ships as a Python CLI package. Install it as an isolated tool so it does
not pollute project environments:

```sh
# Preferred: isolated tool install
pipx install skylos
# or
uv tool install skylos

# Verify
command -v skylos
skylos --help
```

If `command -v skylos` finds nothing, the pillar is **absent**: report
"could not check" for the scan step. Never fake a pass, and never hardcode an
install location into scripts or skills — install via the standard tool manager
so it lands on `$PATH`.

## 2. Running

### Diff mode — PRs and staged changes (primary use)

Diff mode scans only what changed, which keeps the signal high and the runtime low:

```sh
skylos diff                 # staged / uncommitted changes vs the baseline
```

Typical review flow:

```sh
git checkout feature-branch
skylos diff                 # security view of the branch's changes
```

Run it before every push and as the first step of any PR security review.
Findings on diff mode are gate-relevant by default — the change introduced them.

### Full-tree mode — audits and baselines

```sh
skylos scan .               # whole project, from the repo root
```

Use full scans for: first-time audits, release preparation, and re-scanning after
a dependency or architecture change. Full scans surface legacy findings the diff
never touched; triage those into tickets rather than blocking the current PR on them.

### Version pinning in CI

Pin the version in CI/workflows so a scanner upgrade cannot silently change gate
behavior mid-release. Update the pin deliberately, review the new findings, then
bump.

## 3. Integration into the Shipping Quality Gate

Position Skylos as a **blocking** gate step, after lint/typecheck and before the
release decision:

```text
Build → Lint → Typecheck → [Skylos security scan] → Tests → Reviewer → Shipping
```

Gate rules:

1. **Non-zero exit = gate failure.** A scanner that exits with findings must stop
   the gate. Do not wrap the command in a way that swallows the exit code, and do
   not `|| true` it. A discarded exit code is a swallowed failure.
2. **Empty output on a run that claims to have run is a failure**, not a pass —
   the same rule as delegated CLIs: verify the finding list exists and names real
   files, never trust a bare success status.
3. **Disposition every finding.** Each finding ends as `fixed`, `ticketed (link)`,
   or `accepted risk (who accepted, why)`. An untriaged finding blocks the gate.
4. **"Could not check" is reported, not skipped.** If skylos is unavailable in the
   gate environment, the gate report lists the step as `could not check` and the
   release decision accounts for it — it must not read as green.
5. **Fixes re-scan.** After remediation, re-run the same scan command; the fix is
   proven by the new scan output, not by the edit having been made.

## 4. Interpreting Findings: AST Security vs Style Lints

Skylos reads the AST, so its findings differ in kind from style-linter output.
Keep the two categories separate — they have different severities and different
dispositions:

| | Style lint | AST security finding |
|---|---|---|
| Source | Textual/format conventions | Code structure: data flow, call patterns, definitions |
| Examples | Naming, formatting, unused imports as a tidiness matter | Credential material in source, dangerous call patterns, dead code paths that retain secrets |
| Default severity | Advisory | Gate-blocking until dispositioned |
| Suppression | Fine, with a reason | Only via the scanner's explicit ignore mechanism **with an inline justification comment**; never by weakening lint config or filtering output |

Interpretation rules:

- **Hardcoded credential findings are always blocking.** Even test fixtures:
  real-looking keys in tests train the habit and leak via public fixtures. Replace
  with placeholders and rotate anything that was ever committed.
- **Dead-code findings are security-relevant, not cosmetic.** An unused function
  that contains a connection string or an obsolete auth path is attack surface and
  residue; removal is the fix, suppression is not.
- **Dangerous-call findings** (execution/serialization primitives reachable with
  untrusted input) are validated against the checklist item that matches them —
  see `references/audit-checklists.md` §3 and §4. The scanner says *where*;
  the checklist decides *how bad, given the data flow*.
- **False positives:** suppress in the code at the finding site with a reason
  (`# skylos: ignore — <why this input is trusted>`), never globally, never by
  post-processing the report. A global filter hides tomorrow's real finding.
- **Findings vs the diff:** in diff mode, a finding means *this change* introduced
  or reactivated the issue — treat it as belonging to the PR author's gate. A
  finding that predates the branch is triaged out of the PR and ticketed.

## 5. Reporting to Reviewer/Shipping

The scan result enters the gate report as:

```text
Skylos: <pass | fail | could not check>  (command: skylos diff, exit: N)
Findings:
  - <file>:<line> — <rule/summary> — severity — disposition
```

One line per finding, every finding dispositioned, secrets redacted (name the
file and line, never the value).
