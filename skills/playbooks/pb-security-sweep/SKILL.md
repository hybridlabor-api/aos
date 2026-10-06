---
name: pb-security-sweep
description: >-
  Run a security sweep over one repo: secrets, dependencies and the diff,
  a security review and a silent-failure hunt, one deduped and ranked findings
  report, issues filed for blocking findings only after GO, each one handed to
  pb-bug-fix. Use for "security sweep", "audit this repo", "check for leaked
  secrets and vulnerable deps".
category: engineering-method
kind: playbook
trigger: ["security sweep", "audit this repo", "check for leaked secrets"]
inputs: [repo, scope]
requires:
  skills: [bdb-security-audit, pb-bug-fix, github, verification-before-completion, "gh (external)"]
  agents: [security-reviewer, silent-failure-hunter]
  mcps: []
  store: []
go_points: ["gh issue create"]
outputs: ["production_artifacts/pb-security-sweep-<date>.md", "production_artifacts/pb-security-sweep-<date>/findings.md"]
verify: "re-run shows zero open blocking findings, or each remaining one names its pb-bug-fix PR"
difficulty: advanced
est_time: 1-2 h
---

# Security sweep with ranked findings
What you get: one ranked findings report for the repo (blocking, should, note), an issue per blocking finding filed after your GO on a private repo, and a before-and-after delta from the re-run.

## Inputs
- repo — the current directory, or the one the user names; `<owner/repo>` comes from `git -C <repo> remote get-url origin`
- scope — `diff` (changes against the default branch) or `full` (the whole tree), asked if missing

## Steps
1. bdb-security-audit — repo, scope → secrets, dependency and diff findings in `production_artifacts/pb-security-sweep-<date>/findings.md` (optional scanners the skill cannot find are logged as skipped by the skill itself) — file written; secret values are never copied into the report, only file and line
2. security-reviewer (agent) — same scope → findings appended to `findings.md` — each finding cites file and line
3. silent-failure-hunter (agent) — same scope → findings appended to `findings.md` — each finding cites file and line
4. Dedupe and rank — `findings.md` → one table, each finding `blocking`, `should` or `note`, with id, file, line, source step — stops for approval (the human confirms the ranking and which blocking findings get an issue)
5. github — `gh repo view <owner/repo> --json visibility -q .visibility` → run log line — equals `PRIVATE`; `PUBLIC` or unknown → no issue is filed, the blocking findings stay in the report only (a secret in a public issue leaks it), logged, steps 6 and 7 skipped
6. [GO] gh issue create — per approved blocking finding: `gh issue create -R <owner/repo> --title "<title>" --body-file <body>` with file, line and impact but no secret value — the WAITING FOR GO line names the finding id and the title. The run stops here until the human types GO. One GO = one issue. (`gh issue create` is not hooked; this GO is its only guard.)
7. pb-bug-fix — per filed issue → one pb-bug-fix run with its own GO for the push and the PR (nothing is pushed from this playbook) — each issue number is logged next to its PR URL or "deferred"
8. bdb-security-audit — re-run as in step 1 → delta (fixed, still open, new) in the run log — every remaining blocking finding names its pb-bug-fix PR
9. verification-before-completion — delta → run log line — zero open blocking findings, or each remaining one named with its PR; output pasted, not claimed

Run log: `production_artifacts/pb-security-sweep-<date>.md` in the start directory, never committed; the findings file stays in `production_artifacts/` and is not staged

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- GO is by contract in every harness. The go-gate hook is only a backstop on Claude Code, OpenCode and agy (Codex: unverified; Cursor, Kimi: none). A missing hook is never permission to proceed.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
