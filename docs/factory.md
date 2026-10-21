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
  gate-config writes (`aos-gate grant|work|profile`). No mode lifts these hard blocks.
- **`never` always wins:** a `never` policy blocks the action. No GO and no
  gate mode overrides it.
- **Gate on (hard or soft):** the skills fall back to the old behaviour: every
  external write waits for the user's literal GO.
- **Releases stay manual:** `npm publish`, `npm version`, and releases use the
  policy `manual` by default, so they always stop for a human unless the project
  changes that policy.

## Unattended runs in a sandbox

To run /factory unattended (with no human at the keyboard) while keeping the host
machine completely safe, runs can execute with the go-gate off, but ONLY inside
a sandbox. Outside a sandbox, the normal gate rules stay in effect.

When invoked with `factory --unattended` (or `/factory --unattended`), AOS starts
the run through the platform sandbox adapter. If no sandbox runtime is available,
AOS refuses unattended mode with a clear error message and instructions on how to install one.

### Supported sandbox runtimes

| Operating System | Primary Runtime | Fallback Runtime | Installation / Prerequisite |
|---|---|---|---|
| macOS | Docker | Podman | Docker Desktop (`https://www.docker.com/products/docker-desktop`) or `brew install podman` |
| Linux | Docker | Podman | `apt-get install docker.io` / `dnf install docker` or `apt-get install podman` / `dnf install podman` |
| Windows 10+ | WSL2 | Docker | `wsl --install` or Docker Desktop (`https://www.docker.com/products/docker-desktop`) |

### Sandbox detector & safety guarantees

1. **Anti-spoof detector:** The gate treats a session as sandboxed only when AOS
   itself started it inside a container or VM (Docker/Podman container with `/.dockerenv`
   or `/run/.containerenv` AND an AOS sandbox marker env `AOS_SANDBOX_MARKER` set by the
   launcher; or WSL2 VM via the `wsl2` adapter with `AOS_SANDBOX_MARKER`). An environment
   variable alone on the host machine never counts.
2. **Gate mode inside the sandbox:** Inside the sandbox, the gate automatically runs
   in `off` mode. Hard blocks (deleting the home directory or filesystem root) and the
   never-grantable set (`aos-gate grant|work|profile`) stay strictly blocked.
3. **Leaving the sandbox:** The result leaves the sandbox only as a git branch or
   patch. External release writes (`git push`, `npm publish`, `npm version`, `gh pr merge`,
   `gh release create`) still require the human's literal GO on the host machine.
