# Factory Skills

The Factory family is nine experimental skills, adapted from
[BuilderIO/skills](https://github.com/BuilderIO/skills) (MIT), that turn
configured product and maintenance signals into verified, reviewed software
changes. Config lives in `.agent-factory/config.yaml` inside the target
project (see [configuration reference upstream](https://github.com/BuilderIO/skills/blob/main/docs/factory/configuration.md)).

## The nine skills

| Skill | Purpose |
| --- | --- |
| `factory` | Base: choose sources, schedules, worktree behavior, action policies, host automations. |
| `factory-collect` | Collect and triage feedback, telemetry, errors, and issues from configured sources. |
| `factory-lookback` | Compare a bounded history to find recurring patterns and systemic fixes. |
| `factory-human-digest` | Aggregate work still waiting for a human decision. |
| `factory-review-prs` | Review a filtered PR queue with separate reply/approve/merge gates. |
| `factory-babysit-pr` | Follow one explicitly authorized PR through its delivery lifecycle. |
| `factory-ship` | Publish and complete a delivery lifecycle under the project's policy. |
| `factory-watchdog` | Report stalled, authorized delivery work with a verified next step; sending a reminder needs GO. |
| `factory-recover` | Report resume candidates for interrupted runs; resuming needs GO. |

## Flow

```
sources (feedback / telemetry / issues / errors)
  -> factory-collect (current intake)     -> fix policy?  -> worktree -> PR (GO)
  -> factory-lookback (recurring patterns) -> systemic fix -> PR (GO)
  (work held for a person at any point) -> factory-human-digest
PR -> factory-review-prs (queue) or factory-babysit-pr (one authorized PR)
  -> approval gates (GO) -> merge (GO) -> factory-ship (publish, merge, verify) (GO)
factory-watchdog / factory-recover watch for stalled or interrupted runs
  (report only; any resume or notify step is (GO))
```

Every `(GO)` marks a write arrow: it happens only after the user's literal GO
for that exact action. The diagram shows possible handoffs, not automatic
permissions: every action
policy (implement, reply, close, review, approve, publish, merge, deploy,
recover, notify) is independent.

## Config model

`/.agent-factory/config.yaml` is an agent-readable convention, not a parsed
schema: `repositories[]`, `sources[]`, `workflows` (collect, lookback,
human-digest, pull-requests, pr-babysitting, ship-watchdog, recovery) with
per-action policy values (`never`, `manual`, `criteria`, `after-fix` /
`after-merge`), and an open `skill_prompts` map layered as extra project
guidance per skill. Missing config means stop and ask; the skills never create
it or guess sources. Field meanings and a starter config: see the upstream
configuration reference linked above.

## GO gating (AOS)

Nothing in the config opens the AOS GO gate. Every external write — push,
merge, release, reply, close, approve, deploy, notify — happens only after the
user's literal GO for that exact action. In queue and scheduled runs the agent
prepares a draft or readiness report and stops; the user grants GO in an
interactive session. An agent never grants itself GO.
