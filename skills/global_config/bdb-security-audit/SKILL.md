---
name: bdb-security-audit
description: Comprehensive security auditing, diff analysis, defensive checklists, and vulnerability testing.
category: engineering-method
user-invocable: true
---

# BDB Security Audit

Defensive security auditing for BDB projects. Use before commits, during PR review,
inside the Shipping quality gate, or whenever a codebase needs a structured security
pass. This skill is **defensive only**: it verifies, hardens, and reports. It never
produces attack tooling, exploit payloads, or offensive reconnaissance.

## The Three Pillars

| Pillar | What it is | When it runs |
|---|---|---|
| **Skylos** | Diff and AST-level security analyzer for code changes. Catches dangerous call patterns, hardcoded credentials, and dead code that carries secrets — on staged files and PR diffs, before they land. | Pre-commit, PR review, Shipping gate |
| **Claude-Red Checklists** | Structured defensive audit checklists derived from red-team knowledge, inverted into verification questions. Covers OWASP Top 10, AuthN/AuthZ, injection classes, SSRF, LLM/agent security, and secret leakage. | Deep audits, new-feature review, release prep |
| **Xalgorix Bridge** | Decoupled connection to the `xalgorix` automated security suite. Discovered at runtime via `$PATH` or `XALGORIX_URL` — never hardcoded. Runs broader automated scans and returns findings. | Scheduled scans, pre-release sweeps, CI |

The pillars are independent. A machine may have none, one, or all three; every
workflow below degrades gracefully and must report "could not check" rather than
"checked, fine" when a tool is absent.

## When to Use

- "Audit this before I push" — run Skylos on the diff, then the relevant checklists.
- "Security review this PR" — `skylos diff` against the base branch, triage findings.
- Shipping gate step — Skylos must pass (or every finding must be dispositioned) before a release.
- "Is this endpoint/agent/tool safe?" — pull the matching section from `references/audit-checklists.md`.
- Periodic automated sweep — Xalgorix Bridge, if the suite is reachable.

## Workflow

### 1. Diff pass (always first, always cheap)

```sh
# Staged / uncommitted changes
skylos diff

# Whole tree, if no baseline exists
skylos scan .
```

Verify the binary exists first — `command -v skylos` — and check `skylos --help`
for the flags your installed version supports. If skylos is absent, record
**"could not check"** and continue; do not silently treat the step as passed.

### 2. Checklist pass (targeted, human-driven)

Open `references/audit-checklists.md` and work only the sections the change
touches: touched auth code → Authentication & Session Management; new endpoint →
Input Validation + Infrastructure; new agent/tool surface → LLM & Agent Security.
Every item is phrased as a verification question. Mark each **pass / fail / not
applicable** — an unmarked item is not a pass.

### 3. Automated sweep (optional, decoupled)

```sh
# Discover the suite — never assume, never hardcode
command -v xalgorix || echo "not on PATH"
echo "${XALGORIX_URL:-not configured}"
```

If neither is present, skip and report. If present, run the scan per
`references/xalgorix-bridge.md` and forward findings to Reviewer/Shipping.

### 4. Report

Consolidate into one summary for Reviewer or Shipping:

- Per finding: file, line, severity, checklist or scanner origin, disposition (fix now / ticket / accepted risk).
- Per check: `pass`, `fail`, or `could not check` — never leave a check unreported.
- A gate verdict only from evidence: a passing report with two "could not check" rows is **not** a green gate.

## Commands Quick Reference

```sh
command -v skylos            # pillar 1 present?
skylos diff                  # security scan of staged/changed code
skylos scan .                # full-tree scan
skylos --help                # confirm flags for your installed version

command -v xalgorix          # pillar 3 on PATH?
echo "$XALGORIX_URL"         # pillar 3 via remote endpoint?
```

## Guardrails

1. **Defensive posture only.** Findings describe what is wrong and how to fix it.
   Never write or store exploit payloads, working attack strings, or recon steps —
   not even in reports, tickets, or memory.
2. **No hardcoded paths.** Tools are discovered via `$PATH` or environment
   variables (`XALGORIX_URL`). Skills, agents, and configs never contain absolute
   machine paths.
3. **No secret leakage.** Audit outputs must redact credentials, tokens, and keys
   found during scanning. Name the file and line, never the value.
4. **Honest gates.** "Could not check" is a distinct, reported state. Silent
   degradation to "pass" is the defect class this skill exists to prevent.
5. **English only, minimal scope.** Reports state findings and fixes; they do not
   lecture, and they do not expand scope beyond the diff or audit target.

## References

- [references/audit-checklists.md](references/audit-checklists.md) — the full defensive checklist set.
- [references/skylos-guide.md](references/skylos-guide.md) — installing, running, and interpreting Skylos; Shipping gate wiring.
- [references/xalgorix-bridge.md](references/xalgorix-bridge.md) — runtime discovery, decoupled configuration, scan reporting.
