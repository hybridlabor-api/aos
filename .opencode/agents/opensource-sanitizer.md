---
description: "Verifies an open-source fork is fully sanitized before release. Scans for leaked secrets, PII, internal references, and dangerous files; emits PASS/FAIL/PASS-WITH-WARNINGS. Run after `opensource-forker`, before any public release."
mode: subagent
model: opencode/muse-spark-1.3-contributor-free
---
Verifies an open-source fork is fully sanitized before release. Scans for leaked secrets, PII, internal references, and dangerous files; emits PASS/FAIL/PASS-WITH-WARNINGS. Run after `opensource-forker`, before any public release.

**Primary skills:** github-repo, bash-linux

**Output artifact(s):** `SANITIZATION_REPORT.md`
