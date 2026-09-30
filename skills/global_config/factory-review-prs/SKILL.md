---
name: factory-review-prs
description: >-
  Experimental workflow for reviewing configured repositories' pull requests.
  Use for manual or scheduled PR triage, approval, or merge decisions.
category: engineering-method
source: BuilderIO/skills
---

# Factory Review PRs

This skill reviews a filtered queue. For one long-lived, explicitly authorized
PR, use `factory-babysit-pr`. Read the filters and independent action policies
from `.agent-factory/config.yaml`.
Apply the optional `skill_prompts.factory-review-prs` entry as additional
project guidance; it does not replace this skill or authorize an action
disabled by policy.

## Review the queue

For each candidate PR:

1. Read live state from the configured host. Exclude drafts and PRs outside the
   configured filters. Skip a PR with a current review unless re-review is
   requested by policy.
2. Inspect the diff, linked issues, required checks, review threads, author
   eligibility, and exact head revision. Treat bot findings as leads and
   preserve human review direction unless source evidence disproves it.
3. Report actionable findings with file, line, impact, and a concrete fix. If
   none exist, record that outcome without inventing a comment.

Unavailable or partial state is unknown, never a clean result.

## Apply separate action gates

| Action | Proceed only when |
| --- | --- |
| Review | The PR matches configured filters and has not already had the required current review. |
| Reply or other PR write | Draft only. Put the exact text in the report; posting needs the user's GO. |
| Approve | Report whether approval conditions hold on the exact head. Approving needs the user's GO for that PR. |
| Merge | Report merge readiness only. `gh pr merge` is blocked by the GO gate unless the user sends a literal GO. |

Host-level mergeability, one green check, or a bot approval does not prove all
gates passed. Re-read the exact head and live state immediately before an
approval or merge. Restart a configured soak if the head or a gate changes.

## Report

For each PR, state the decision and evidence. List skipped, unavailable, and
held PRs with the reason. Keep review findings separate from approvals, replies,
and merge decisions.

## AOS safety rules

- Configuration lives in `.agent-factory/config.yaml`. If it is missing, stop and
  ask the user; never create it or guess sources.
- Nothing in the config can open the AOS GO gate. `git push`, `gh pr merge`,
  `gh release create` and every external write (reply, comment, approval, close,
  status change, notification) need the user's literal GO for that exact action.
  Prepare the change or draft text, show it, and stop.
- Scheduled or unattended runs are read-only. Report; do not act.
- Connectors are whatever the host already exposes. Do not install or register
  integrations or MCP servers.
