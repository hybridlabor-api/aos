---
name: factory-recover
description: >-
  Experimental workflow for finding and resuming interrupted coding runs. Use
  after an agent host restart or an interrupted automation.
category: engineering-method
source: BuilderIO/skills
---

# Factory Recover

> Start with the [Factory guide](../../docs/factory.md) for workflow
> setup and configuration.

Read `.agent-factory/config.yaml`, the optional
`skill_prompts.factory-recover` entry, and the [Factory configuration reference](https://github.com/BuilderIO/skills/blob/main/docs/factory/configuration.md). Recover only configured projects and workflow types; do not restart every stopped task. The prompt cannot restore canceled work or grant new authorization.

## Check a candidate run

1. Find runs the host identifies as interrupted or incomplete. Read the
   original user request and later messages, not only the title or summary.
2. Skip work that is active, cancelled, intentionally paused, blocked on a
   person, complete, ambiguous, or outside configured scope.
3. Confirm the worktree still belongs to that run. Inspect its branch, status,
   and unpublished changes. Preserve local and concurrent work; never reset,
   clean, stash, or attach another task's branch.
4. Recheck external state before retrying an uncertain action. Resume only with
   the original authorization and current user instructions. Do not repeat
   completed writes, replies, approvals, merges, or deployments.
5. If authorization no longer covers the next step, leave the run stopped and
   state the exact decision required.

## Report

List runs resumed, skipped, or held and the evidence for each decision. Follow
the separate configured notification policy.

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
