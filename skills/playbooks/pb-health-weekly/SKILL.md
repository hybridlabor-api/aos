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
What you get: a health report (full HTML report with git and npm drift when the health skill is installed, else a plain markdown report with git drift and CI status) for every repo, red repos handed to pb-ci-fix, and a one-line status.
Availability: needs bdb-ecosystem-health (not shipped, aos-internal-staging) for the full report; without it only a plain markdown report, and only when repo_list is given.

## Inputs
- repo_list (optional) — the repos to check; default is the list the bdb-ecosystem-health skill carries

## Steps
1. Preflight — bdb-ecosystem-health listed in the harness skill list or its SKILL.md under the harness skills dir (`~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, `~/.config/opencode/skills`), `gh auth status` → run log header — skill absent → log "health skill not installed" and fallback mode: repo_list empty → stop with "Availability: needs bdb-ecosystem-health (not shipped, aos-internal-staging) for the full report"; else build a plain markdown report from `git`/`gh` facts only (version, tags, CI conclusion per repo; no HTML, no npm drift); gh missing or unauthenticated → log it, give the `gh auth login` hint, stop
2. bdb-ecosystem-health (external; skipped when absent, step 3 then builds the report) — repo_list → HTML report with auto-remediation OFF (the report only proposes remediation) → report path in the run log — report exists; no remediation command was run
3. github — report → table of every repo with version drift and CI conclusion in the run log (`gh run list -R <owner/repo> --limit 1 --json conclusion,headSha` per repo) — every repo listed; stops for approval (the human confirms which red repos to fix and which to defer)
4. pb-ci-fix — per approved red repo → one pb-ci-fix run, with its own GO for the push — each red repo names its run log or "deferred: <reason>"
5. [GO] remediation — per step the skill proposes in its report, except version bumps, tags, changelog edits and publishes, which are never run here: npm or git version drift is routed to pb-release-aos (or the repo's own release PR) and logged as a proposal; the exact command shown in the WAITING FOR GO line with the repo and what it changes. The run stops here until the human types GO. One GO = one remediation step. The playbook cannot know in advance whether the go-gate hook covers a proposed command (Claude Code, OpenCode, agy only): a `git push`, `npm publish` or `npm version` is covered by the go-gate hook where it runs (Claude Code, OpenCode, agy), any other command (an `npm install -g`, a `gh` write, an `rsync`) is not, and for those, and in every harness without the hook, this GO is the only guard. No proposed steps → step skipped
6. quick-recap — run log → final line `🟢|🟡|🔴` with green, red-fixed, red-deferred and drift counts (`n/a` in fallback mode) — line written

Run log: `production_artifacts/pb-health-weekly-<date>.md` in the start directory, never committed; the full HTML report (when the health skill is installed) stays where the skill writes it and is not staged; in fallback mode the report is the run log's markdown table

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
- GO is by contract in every harness. The go-gate hook is only a backstop on Claude Code, OpenCode and agy (Codex: unverified; Cursor, Kimi: none). A missing hook is never permission to proceed.
