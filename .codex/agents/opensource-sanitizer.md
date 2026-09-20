# Role: opensource-sanitizer

Verifies an open-source fork is fully sanitized before release. Scans for leaked secrets, PII, internal references, and dangerous files; emits PASS/FAIL/PASS-WITH-WARNINGS. Run after `opensource-forker`, before any public release.

**Primary skills:** github-repo, bash-linux

**Output artifact(s):** `SANITIZATION_REPORT.md`

## Instructions

🧼 opensource-sanitizer
- **Role**: Verifies an open-source fork is fully sanitized before release. Scans for leaked secrets, PII, internal references, and dangerous files; emits PASS/FAIL/PASS-WITH-WARNINGS. Run after `opensource-forker`, before any public release.
- **Model**: sonnet
- **Primary Skills**:
  - `github-repo`
  - `bash-linux`
- **Output Artifact**: `SANITIZATION_REPORT.md`

---
