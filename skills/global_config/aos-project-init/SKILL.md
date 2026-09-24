---
name: aos-project-init
description: >-
  Interview a project folder into AOS and write the result: a stable slug and
  domain in .aos/project.json, an OpenWiki wiki that is actually watched and
  does not index junk, memB memory bound to the slug, a Synapse map, AGENTS.md
  with its harness symlinks, and optionally CI and issue triage.
category: bdb-core
risk: low
source: bdb
date_added: "2026-09-13"
---

# AOS Project Init — Per Workspace

`/aos-setup` prepares the machine. This prepares one folder in it — and unlike
the machine skill, **this one writes**. It asks what it cannot know, shows what
it intends to write, and writes it once you agree.

Everything it decides lands in `.aos/project.json`, so a second run knows what
was already settled and changes only what you ask it to.

---

## 1. Preconditions

```bash
aos-config show    # is this machine's vocabulary present?
```

If it reports *unvollständig*, stop and run `/aos-setup` first. The domain list
is per-machine and nothing ships with one — guessing here would invent a
vocabulary the user never chose.

Then measure this folder:

```bash
node ~/.claude/skills/aos-project-init/scripts/aos-project-doctor.mjs
```

Report the failing rows before touching anything. On an existing repo some
failures are deliberate: a repo public on purpose, a scratch folder with no
remote, a project nobody wants the wiki daemon to visit. Ask rather than
"fixing" those.

---

## 2. The interview

One question at a time, each with a proposal the user can accept in a word.
Skip anything already settled in `.aos/project.json` unless asked to change it.

**Name and slug.** Propose the folder name for both. The slug becomes the memB
`project_id`, and it is written down precisely so it survives a rename: a
binding derived from the basename orphans every memory the day the folder
moves, and two folders sharing a basename share one memory scope.

**Domain.** Offer the list from `aos-config`, preselected by what the path
implies — the first segment under the workspace root. If the project sits
outside that root, ask instead of guessing.

**Wiki.** Three separate questions, because they are three separate things:
initialise a wiki here at all · **watch it**, so the daemon refreshes it every
2h · write `.openwikiignore`.

Watching is not free. Every watched project with changes costs an LLM call per
cycle, and a free-tier key hits quota on a handful. Recommend watching repos
under active work and leaving archives out.

**memB.** Bind the slug, then draft a project card instead of offering a file
dump. Read the project yourself — `README.md`, `AGENTS.md`/`CLAUDE.md`,
`package.json`/`pyproject.toml`, and the `.aos/project.json` this interview
settles — and distill a **project card: 3–8 facts**, each ≤ 300 chars, each
prefixed with its date `(YYYY-MM-DD)`, covering what the project is, where it
lives, stack, status, and settled decisions. Show the numbered list and save
only on the user's confirmation:

```
add_memory({ text: "(2026-09-24) …", category: "project_card", project_id: "<stable-slug>", infer: false })
```

The slug settled above is the `project_id`, so the hook's candidate matching
finds the card. Facts stay small and dated because cards are shown to every
future prompt in this project.

**Synapse.** A spatial map earns its keep on a codebase too large to hold in
your head. Ask; do not default it on.

**AGENTS.md.** If missing, offer the template. If a real `CLAUDE.md` already
holds content, merge it into `AGENTS.md` first and only then replace it with a
symlink. Never silently overwrite it.

**Subagents & Multi-Harness Pipeline.** Offer to initialize `.aos/pipeline.json` using canonical tiers (or custom roles via `/subagent-setup`). Ensures subagents are automatically compiled across Claude Code, Antigravity, OpenCode, and Codex CLI.

**With a GitHub remote, two more.** Skip both entirely without a remote — a
local-only repo has nowhere to put them, and a skipped question is clearer than
one answered "no".

- **CI:** none · a gate (lint, typecheck, test — matched to the project type) ·
  gate plus `release-please`.
- **Triage:** none · GitHub labels (`needs-triage`, `needs-info`,
  `ready-for-agent`, `ready-for-human`, `wontfix`) · local markdown in
  `.scratch/`.

`release-please` computes the version from Conventional Commits and nothing
else: an unprefixed subject is invisible to it, and one `feat:` forces a minor
bump however small the change. Offering it imposes that rule on the project, so
write the rule into `AGENTS.md` in the same breath — and ask what the version
policy is. Some repos here move in patch steps only, where `feat:` needs
explicit permission.

---

## 3. Write

Show every intended write as one list, then write on agreement.

```json
{
  "name": "<Project Name>",
  "slug": "<stable-slug>",
  "domain": "<from aos-config>",
  "openwiki": { "enabled": true, "watch": true },
  "memb": { "projectId": "<stable-slug>" },
  "synapse": false,
  "ci": "gate",
  "triage": "github"
}
```

Then, only for what the interview enabled:

```bash
cp ~/.claude/skills/aos-project-init/assets/openwikiignore.template .openwikiignore
openwiki --init                # needs `openwiki auth <provider>` from /aos-setup
```

When the user chose to watch it, add the absolute path to `projects` in
`~/.openwiki/projects.json` — that file is the daemon's watch list. Merge into
it; never rewrite it.

For memB, write the project card through the MCP with the slug as `project_id`
and `project_card` as `category` — domain-category rows are dead weight, since
the hook whitelist only injects `project_card`/`godmode`:

```
add_memory({ text: "(2026-09-24) …", category: "project_card", project_id: "<stable-slug>", infer: false })
```

Raw file ingest is opt-in only — if the user explicitly asks for a dump, run
`python3 ~/.gemini/config/mcps/memb-mcp/memb_ingest.py <path>`; the default
answer is no.

Never write credentials or high-entropy strings into memory.

---

## 4. Confirm

```bash
node ~/.claude/skills/aos-project-init/scripts/aos-project-doctor.mjs
```

Report the doctor's own count, and name anything left failing on purpose. Then
commit: `chore:` for wiring, `docs:` for `AGENTS.md`. Check the project's
version policy before reaching for `feat:`.

---

## Red flags

- Inventing a domain because `aos-config` has none. Send the user to
  `/aos-setup` instead.
- Deriving the memB binding from the folder name once a slug exists.
- Treating "has a wiki" as "is watched". They are different, and that gap is
  why wikis sit stale for months.
- Turning watching on for every repo. Quota is real.
- Committing an `AGENTS.md` still full of template placeholders.
- Asking about CI or GitHub triage in a repo with no remote.
- Offering `release-please` without writing the Conventional Commits rule into
  `AGENTS.md` — it is a trap otherwise.
- Writing project memories under the domain as category — the hook never
  injects them.
