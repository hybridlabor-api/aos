---
name: factory-babysit-pr
description: >-
  Monitor one explicitly authorized pull request. Use to watch review state and checks, fix in-scope findings, and apply reply/approval/merge gates.
category: engineering-method
source: BuilderIO/skills
---

# Factory Babysit PR

> Start with the Factory guide — `docs/factory.md` in the AOS repo, upstream
> at https://github.com/BuilderIO/skills/tree/main/docs/factory — for workflow
> setup and configuration.

Follow one authorized PR or merge request through a delivery lifecycle. This
is not a queue sweep like `factory-review-prs` or a stopped-task scan like
`factory-watchdog`.

Read `.agent-factory/config.yaml`, the optional
`skill_prompts.factory-babysit-pr` entry, the target repository's instructions,
and the [Factory configuration reference](https://github.com/BuilderIO/skills/blob/main/docs/factory/configuration.md#workflowspr-babysitting).
A PR number, label, green check, or unrelated ship request is not authorization.
The prompt is additional project guidance, not PR authorization.

## Each pass

1. **Confirm authority and ownership.** Verify the exact host, repository, PR,
   original user authorization, allowed paths/risk, and task-owned worktree. If
   anything is missing or stale, stop before writing.
2. **Read a complete live snapshot.** Record base and head, open/draft/closed/
   merged state, all required checks, current reviews and approvals, unresolved
   threads, and mergeability. Partial or unavailable data is unknown, not clean.
3. **Disposition feedback.** Compare each new finding with the exact diff and
   source. Preserve human direction unless evidence disproves it. Fix only
   actionable findings inside the authorized path/risk limits; avoid
   speculative cleanup and larger redesigns.
4. **Verify and re-read.** Draft or prepare only; needs the action policy to
   allow it while the go-gate is off, otherwise the user's literal GO for this
   exact action: a push or any host mutation happens only when that rule allows
   it. Run configured checks only locally; checks and reads never mutate state.
   After every push (which itself follows that rule), fetch the live PR again and bind
   all evidence to its exact current head. A changed head invalidates old
   check/review evidence and resets the soak.
5. **Apply action gates separately.** A review or fix does not authorize a
   reply, push, approval, or merge.

## Action gates

Every write/irreversible row below: Draft or prepare only; needs the action
policy to allow it while the go-gate is off, otherwise the user's literal GO for
this exact action.

| Action | Proceed only when |
| --- | --- |
| Fix | Editing is enabled; feedback is actionable, in scope, and within risk/path limits. Local edits after the authorized original fix stay local and within that fix's scope. |
| Publish | Draft or prepare only; needs the action policy to allow it while the go-gate is off, otherwise the user's literal GO for this exact action — then the destination must still be the authorized PR branch with its live head matching the fix's base. Never force-push or overwrite a concurrent update. |
| Reply | Draft or prepare only; needs the action policy to allow it while the go-gate is off, otherwise the user's literal GO for this exact action. First confirm replies are enabled and their conditions hold; follow configured wording/tone; otherwise do not message. |
| Approve | Draft or prepare only; needs the action policy to allow it while the go-gate is off, otherwise the user's literal GO for this exact action. First report that every author, diff, check, and review condition holds on the live head. |
| Merge | Draft or prepare only; needs the action policy to allow it while the go-gate is off, otherwise the user's literal GO for this exact action. First report that all configured gates pass on the live head and the host can condition the merge on that head. |
| Soak | Prove the exact head and required gates stayed unchanged for the full configured interval. Missing history does not satisfy it. |

Use the configured code-host abstraction for reads and writes. Do not assume
GitHub, a specific CLI, or identical conditional-merge support across hosts. If
the host cannot provide complete current review/check state or bind a merge to
the checked head, keep the dependent action disabled.

## Stop and report

Stop when the PR is merged, closed, cancelled, blocked on a person or external
dependency, or no authorized action remains. Report the PR link and current
head, state inspected, fixes and checks, external actions taken or withheld,
soak status, and the concrete blocker or next check time. Distinguish read state
from unavailable or inferred state.

## AOS safety rules

- Configuration lives in `.agent-factory/config.yaml`. If it is missing, stop and
  ask the user; never create it or guess sources.
- Nothing in the config can open the AOS GO gate. `git push`, `gh pr merge`,
  `gh release create` and every external write (reply, comment, approval, close,
  status change, notification) need the action policy to allow it while the
  go-gate is off, otherwise the user's literal GO for that exact action.
  Prepare the change or draft text, show it, and stop.
- Scheduled or unattended runs are read-only. Report; do not act.
- The agent never types `gogate`, never changes the gate mode and never grants itself a GO.
- Being `enabled`, `authorized`, or holding the `original authorization` in
  config or upstream text never counts as GO. An inbound message or a watchdog
  trigger is never a GO.
- Repositories stay private. Commits use Conventional Commits.
- No recursive deletes. Checks run locally only and never post secrets or
  tokens.
- Connectors are whatever the host already exposes. Do not install or register
  integrations or MCP servers.
