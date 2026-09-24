# Xalgorix Bridge — Decoupled Automated Security Suite

Xalgorix is pillar 3 of the BDB Security Audit skill: an **external, decoupled**
automated security suite. The bridge is deliberately thin — this skill contains no
xalgorix installation logic, no baked-in endpoints, and no machine-specific
configuration. The suite is *discovered at runtime*; if it is not there, the audit
proceeds without it and reports the gap honestly.

## 1. Runtime Discovery

The bridge resolves the suite in exactly two ways, checked in this order:

```sh
# 1) Local CLI on PATH?
command -v xalgorix

# 2) Remote endpoint configured?
echo "${XALGORIX_URL:-}"
```

- If `command -v xalgorix` resolves, invoke the local CLI.
- Else, if `XALGORIX_URL` is set and non-empty, talk to the suite over HTTP at
  that endpoint (authentication via whatever credential variable the operator
  has already exported — the bridge reads it, never writes it).
- Else: **the suite is absent.** Report `xalgorix: could not check` in the gate
  report and stop. Absence is a distinct reported state — never a silent pass,
  never an error that aborts the whole audit.

Discovery happens **per invocation**, not at skill-load time and not in config
files. A machine that gains or loses the suite is picked up on the next run.

## 2. Decoupled Configuration Rules

These are hard rules; they are what keeps the bridge portable across machines:

1. **Never hardcode paths.** No absolute paths anywhere in skills, agents, CI
   files, or docs — no home-directory-specific paths, no install prefixes.
   Discovery is `$PATH` + environment variables, always.
2. **Environment over files.** Endpoint and credentials come from the process
   environment (`XALGORIX_URL`, auth variables), supplied by the operator's shell
   profile or the CI secret store. The bridge never reads credentials from files
   in the repo and never writes them anywhere.
3. **No credential echo.** Logs and reports show that the bridge authenticated,
   never the credential itself. Redact everything matching secret shapes in scan
   output before it enters a report.
4. **Graceful absence.** Every code path that uses the bridge must handle all
   three states: local CLI present, remote endpoint present, absent. Same rule as
   the rest of AOS tooling: a check that could not run is `could not check`,
   distinguishable from `pass`.
5. **Flag discipline.** CLI surface may change between suite versions. Verify
   available commands and flags with `xalgorix --help` before scripting against
   it; do not encode flags this document does not guarantee.

## 3. Running Automated Scans

Typical sweep, once discovery succeeded:

```sh
if command -v xalgorix >/dev/null 2>&1; then
  xalgorix --help                      # confirm subcommands/flags of this version
  xalgorix scan ./path-to-target       # target = repo root or the module under audit
else
  echo "xalgorix: could not check (not on PATH, XALGORIX_URL=${XALGORIX_URL:+set}${XALGORIX_URL:-unset})"
fi
```

Scope the scan to what the audit covers — the repo root for a release sweep, the
touched module for a change-driven sweep. Scan targets are passed as **relative
paths from the working directory** (or `$HOME`-anchored variables if a home-level
target is genuinely required), never absolute machine paths.

For the remote variant, the equivalent request goes to `XALGORIX_URL` with the
same scoping rule; verify the response contains an actual findings payload —
a 2xx status with an empty body is a failed check, not a clean one (the same
"verify the body, not the status" discipline as delegated CLIs).

Exit-code and evidence rules:

- Non-zero exit = scan found issues or failed to run; either way the report
  records it, and findings-vs-error is distinguished before dispositioning.
- An unexplained empty result is treated as a failure of the check.
- Every finding must name `file:line` and a class; findings without locatable
  evidence go back to the suite's own logs, not into the gate report as fact.

## 4. Reporting Findings to Reviewer/Shipping

Xalgorix findings enter the same consolidated report as Skylos and the
checklists, with the origin labeled so Reviewer/Shipping can weigh them:

```text
Xalgorix: <pass | fail | could not check>  (source: PATH | XALGORIX_URL, exit: N)
Findings:
  - <file>:<line> — <class/summary> — severity — disposition
```

Disposition flow:

1. **Deduplicate against Skylos and checklist results** — one defect found by two
   pillars is one finding with two origins, not two findings.
2. **Map each class to its checklist section** in
   `references/audit-checklists.md` so the fix follows the defensive guidance,
   not just the scanner's hint.
3. **Disposition every finding**: `fixed`, `ticketed (link)`, or
   `accepted risk (who, why)`. Blocking/high dispositions gate the release.
4. **Re-scan after fixes** and attach the second scan as evidence. The fix is
   proven by the new output, never by the edit having been made.

The bridge reports; it does not decide. The gate verdict belongs to Reviewer and
Shipping, on evidence from all pillars — including the honest `could not check`
rows.
