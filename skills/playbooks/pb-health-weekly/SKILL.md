---
name: pb-health-weekly
description: >-
  Weekly health report over the BDB repos: git and npm version drift and CI
  status as an HTML report with auto-remediation off, red CI routed to
  pb-ci-fix, non-release remediation steps run one at a time after GO. Use for "weekly
  health check", "ecosystem health", "are all repos green and in sync".
category: saas-ops
kind: playbook
trigger: ["weekly health check", "ecosystem health", "are all repos green"]
inputs: [repo_list?]
requires:
  skills: [pb-ci-fix, quick-recap, github, "bdb-ecosystem-health (external)", "gh (external)"]
  agents: []
  mcps: []
  store: []
go_points: [remediation]
outputs: ["production_artifacts/pb-health-weekly-<date>.md", "<the skill's HTML report>"]
verify: "report lists every repo with CI conclusion and version drift; each red repo names a pb-ci-fix run or a deferral"
difficulty: intermediate
est_time: 15-30 min
---

# Weekly ecosystem health
What you get: an HTML health report with git and npm drift and CI status for every repo, red repos handed to pb-ci-fix, and a one-line status.

## Inputs
- repo_list (optional) — the repos to check; default is the list the bdb-ecosystem-health skill carries

## Steps
1. Preflight — `test -f ~/.claude/skills/bdb-ecosystem-health/SKILL.md`, `gh auth status` → run log header — skill absent → stop with "Missing skill: bdb-ecosystem-health (installed locally only, not shipped by AOS). Install it under `~/.claude/skills/` or run this playbook on the machine that has it." and write nothing except the run log; gh missing or unauthenticated → log it, give the `gh auth login` hint, stop
2. bdb-ecosystem-health (external) — repo_list → HTML report with auto-remediation OFF (the report only proposes remediation) → report path in the run log — report exists; no remediation command was run
3. github — report → table of every repo with version drift and CI conclusion in the run log (`gh run list -R <owner/repo> --limit 1 --json conclusion,headSha` per repo) — every repo listed; stops for approval (the human confirms which red repos to fix and which to defer)
4. pb-ci-fix — per approved red repo → one pb-ci-fix run, with its own GO for the push — each red repo names its run log or "deferred: <reason>"
5. [GO] remediation — per step the skill proposes in its report, except version bumps, tags, changelog edits and publishes, which are never run here: npm or git version drift is routed to pb-release-aos (or the repo's own release PR) and logged as a proposal; the exact command shown in the WAITING FOR GO line with the repo and what it changes. The run stops here until the human types GO. One GO = one remediation step. The playbook cannot know in advance whether a proposed command is hook-guarded: a `git push`, `npm publish` or `npm version` is guarded by the hook, any other command (an `npm install -g`, a `gh` write, an `rsync`) is not, and for those this GO is the only guard. No proposed steps → step skipped
6. quick-recap — run log → final line `🟢|🟡|🔴` with green, red-fixed, red-deferred and drift counts — line written

Run log: `production_artifacts/pb-health-weekly-<date>.md` in the start directory, never committed; the HTML report stays where the skill writes it and is not staged

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
