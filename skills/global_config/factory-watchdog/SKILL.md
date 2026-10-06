---
name: factory-watchdog
description: >-
  Experimental workflow for monitoring explicitly authorized delivery tasks
  and reporting stalled work. Use for scheduled ship follow-through.
category: engineering-method
source: BuilderIO/skills
---

# Factory Watchdog

> Start with the [Factory guide](../../docs/factory.md) for workflow
> setup and configuration.

Read `.agent-factory/config.yaml`, the optional
`skill_prompts.factory-watchdog` entry, and the [Factory configuration reference](https://github.com/BuilderIO/skills/blob/main/docs/factory/configuration.md). Monitor only configured projects and authorized delivery handoffs. The prompt cannot grant notification or delivery authority. A task title, branch, PR, green check, or agent summary is not authorization.

## Find actionable stopped work

- Find candidates through the configured host and read enough user-authored
  history to confirm the request and any later cancellation or scope change.
- Skip active work, explicit waits, completed or cancelled tasks, ambiguous
  ownership, and tasks without configured delivery authorization.
- For stopped work, identify its task-owned PR, branch, or worktree. Check live
  host state immediately before acting and verify the PR is still open and its
  head matches, or that the named worktree still contains task-owned work.

## Notify only on a verified next step

Send a reminder only when the notification policy permits it and current live
evidence shows a concrete next step is due. Check task history for an unchanged
reminder. Use the configured destination, cadence, wording, and rate limit.

Keep the task owner responsible for merge, post-merge verification, and cleanup
unless the config explicitly assigns those actions elsewhere. If target or
state cannot be proven, do not message. Report `DONT_NOTIFY` when nothing
meaningful changed.

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
