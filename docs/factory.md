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

With no human at the keyboard, nobody can type `gogate off` or GO. For that case
`bin/aos-factory.mjs --unattended` runs the factory inside a container, where the
gate is off, and brings only commits back. The host gate is not changed and has no
sandbox shortcut: nothing a host session writes or exports loosens it.

```sh
node <aos>/bin/aos-factory.mjs --unattended [--image <image>] --env ANTHROPIC_API_KEY -- claude -p "/factory"
```

If `--image` is omitted, `aos-factory:local` is used. Build the default image:

```sh
docker build -t aos-factory:local -f docker/factory/Dockerfile .
```

Override the default image by passing `--image <your-image>`.

The default image contains the AOS sandbox: Node, git, the AOS hooks and CLIs
(`bin/`, `lib/`, `.claude/hooks/`). It contains no agent CLI. An agent run such as
the `claude -p` example needs an image derived from it, passed via `--image`:

```Dockerfile
FROM aos-factory:local
USER root
RUN npm install -g @anthropic-ai/claude-code
USER aos
```

The default image is run with `--pull=never`, so it is never fetched from a registry.

**Isolated:**

- The container sees one host path: a fresh `git clone --no-local --no-hardlinks`
  of the current branch in a temp dir. Not the worktree, its `.git`, `$HOME`,
  `~/.ssh`, `~/.gitconfig`, `~/.aos`, the Docker socket or any credential file.
- The clone has no remotes, so a push fails at once.
- The container has its own HOME. Before the command starts, AOS writes the `off`
  gate profile (the file `aos-gate profile off` writes) into that HOME only.
  Hard blocks and the never-grantable set still apply, because they are part of
  the gate installed in the image.
- `--rm`, `--cap-drop ALL`, `no-new-privileges`, never `--privileged`. The
  image's own user is used; prefer an image with a non-root `USER`.
- A repo that is your home directory or one of its parents is refused.

**Not isolated:**

- The network is open. Only the variables you name with `--env` enter, so pass
  the agent's API key and nothing else (no GitHub or npm tokens).
- Uncommitted changes on the host are not part of the run; commit first.
- The `off` profile expires after 2 hours (the profile maximum); after that the
  gate inside falls back to strict and blocks guarded commands.

| OS | Accepted runtime | Refused |
| --- | --- | --- |
| macOS | Docker Desktop or Podman (machine running) | no runtime or daemon down |
| Linux | Docker Engine or Podman | no runtime or daemon down |
| Windows 10+ | Docker Desktop | WSL2 alone (it mounts the Windows drives under `/mnt` and can start Windows programs), Podman |

Without a reachable runtime the command refuses with install hints and exits
non-zero. Paths with a comma, quote or newline are refused because they break
the `--mount` argument; Windows paths are passed as `C:/...`.

**Results:** when the container exits, the new commits are exported to
`~/.aos/factory/runs/<id>/` as `patches/*.patch`, `run.bundle` and `run.json`,
and the temp clone is removed. Review and apply on the host:

```sh
git fetch ~/.aos/factory/runs/<id>/run.bundle HEAD:factory/<id>
git log -p factory/<id>          # review
git am ~/.aos/factory/runs/<id>/patches/*.patch   # or apply as patches
```

A non-zero container exit makes `aos-factory` exit non-zero; commits made before
the failure are still exported. Push, merge and publish happen on the host and
need your GO there.
