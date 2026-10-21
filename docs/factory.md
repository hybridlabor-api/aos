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
| `factory-watchdog` | Report stalled, authorized delivery work with a verified next step; sending a reminder follows the GO gating rules below. |
| `factory-recover` | Report resume candidates for interrupted runs; resuming follows the GO gating rules below. |

## Flow

```
sources (feedback / telemetry / issues / errors)
  -> factory-collect (current intake)     -> fix policy?  -> worktree -> PR (policy)
  -> factory-lookback (recurring patterns) -> systemic fix -> PR (policy)
  (work held for a person at any point) -> factory-human-digest
PR -> factory-review-prs (queue) or factory-babysit-pr (one authorized PR)
  -> approval gates (policy) -> merge (policy) -> factory-ship (publish, merge, verify) (policy)
factory-watchdog / factory-recover watch for stalled or interrupted runs
  (report only; any resume or notify step is (policy))
```

(policy) = allowed by the action policy when the gate is off; otherwise a literal GO.

Every `(policy)` marks a write arrow. With the gate off, it happens when the
action policy allows it; with the gate on, it happens only after the user's
literal GO for that exact action. The diagram shows possible handoffs, not
automatic permissions: every action policy (implement, reply, close, review,
approve, publish, merge, deploy, recover, notify) is independent.

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

Factory runs are meant to run with the go-gate off. Before a run, the human
types `gogate off` as a plain message in the session that runs the factory (or
the run starts from a session where it is already off). The agent never types
`gogate`, never grants itself GO, and never changes the gate mode. `off` only
logs; it lasts for that session, for at most 24 hours.

- **Gate off:** external writes (push, merge, reply, close, approve, deploy,
  notify) follow the project's action policies in `.agent-factory/config.yaml`
  (`never`, `manual`, `criteria`, `after-fix` / `after-merge`). `manual` still
  means: stop and ask the human.
- **Hard blocks always stay:** deleting or moving the home directory, the
  filesystem root, or a top-level home directory; and the never-grantable
  gate-config writes (`aos-gate grant|work|profile`). No mode lifts them.
- **Gate on (hard or soft):** the skills fall back to the old behaviour: every
  external write waits for the user's literal GO.
- **Releases stay manual:** `npm publish`, `npm version`, and releases use the
  policy `manual` by default, so they always stop for a human unless the project
  changes that policy.
