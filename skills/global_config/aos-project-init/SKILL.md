---
name: aos-project-init
description: >-
  Wire one project folder into AOS — git and private remote, AGENTS.md with its
  harness symlinks, the dispatcher harness, an OpenWiki wiki, memB project
  memory, and a Synapse map. Use when starting a new project, or when an
  existing repo has drifted and its agents behave like they know nothing about it.
category: bdb-core
risk: low
source: bdb
date_added: "2026-09-13"
---

# AOS Project Init — Per Workspace

A machine-level AOS install gives an agent the skills. It gives it nothing
about *this* project: no repo rules, no memory bound to it, no wiki, no
dispatcher contract. That per-project layer is what this skill installs.

Machine-level setup is `/aos-setup` and comes first — this skill assumes memB,
OpenWiki and Synapse already exist on the machine.

**This is prompt-driven, not a script that runs blind.** Explore, report,
confirm, then write.

---

## 1. Measure

```bash
node ~/.claude/skills/aos-project-init/scripts/aos-project-doctor.mjs [dir]
```

`[dir]` defaults to the current directory. `--json` for machine-readable
output. 16 checks across five areas:

| Area | What is verified |
|---|---|
| `git` | repo, `origin`, **private** visibility, `.gitignore` covers `.env` |
| `docs` | `AGENTS.md`, and `CLAUDE.md` / `GEMINI.md` / `CODEX.md` as symlinks to it |
| `harness` | `.agents/graph.md`, `.agents/nodes.json`, `.claude/{workflows,hooks,agents,settings.json}` |
| `openwiki` | `.openwiki/` holds pages |
| `memB` | memories bound to `project_id = <folder name>` |

Report the failing rows before touching anything. On an existing repo, some
failures are deliberate — a public repo that is meant to be public, a scratch
folder with no remote. Ask rather than "fixing" those.

---

## 2. Git and the remote

```bash
git init && git add -A && git commit -m "chore: initial commit"
gh repo create <name> --private --source=. --remote=origin
```

Repositories are **private by default**. Verify rather than assume — the
doctor reads actual visibility through `gh`, not intent. Live secrets never
enter the repo: keep `.env` files outside it and commit a placeholder.

---

## 3. AGENTS.md and its symlinks

One file holds the repo's agent rules; every harness reads the same bytes:

```bash
cp ~/.claude/skills/aos-project-init/assets/AGENTS.template.md AGENTS.md
ln -sf AGENTS.md CLAUDE.md
ln -sf AGENTS.md GEMINI.md
ln -sf AGENTS.md CODEX.md
```

Then fill the template in — see [AGENTS.template.md](./assets/AGENTS.template.md).
Do not leave the placeholders: an `AGENTS.md` full of `<PROJECT NAME>` is worse
than none, because agents will trust it. Interview the user for the stack, the
commands, and above all the **domain notes** — the constraints that are not
derivable from the code.

If a real `CLAUDE.md` already exists with content of its own, merge it into
`AGENTS.md` first and only then replace it with the symlink. Never silently
overwrite it.

---

## 4. The dispatcher harness

Only for projects that will actually run `/startcycle-graph` — it is not
required for a small repo.

```bash
npx -y @hybridlabor-api/aos --project-harness
```

Copies into the project, writing nothing to `$HOME`:

- `.agents/` — the graph contract, node registry, state schema
- `.claude/workflows/` — the dispatcher
- `.claude/hooks/` — `go-gate.mjs` and `graph-gate.mjs`
- `.claude/agents/` — the agent definitions the dispatcher's prompts reference
- `.claude/settings.json` — wired to the project-local hooks

Take all of it or none: a bare `.agents/` copy leaves the graph contract
half-installed, and the dispatcher's pointers resolve to nothing.

---

## 5. memB — bind memory to this project

memB scopes memories by `project_id`, and `project_id` is **the folder's
basename**. Two consequences worth stating out loud:

- Renaming the folder orphans every memory bound to the old name.
- Two folders with the same basename share one memory scope.

Seed the project by ingesting it:

```bash
~/.gemini/config/mcps/memb-mcp/.venv/bin/python \
  ~/.gemini/config/mcps/memb-mcp/memb_ingest.py <project dir>
```

Add `--transcripts` only when past conversation logs should be pulled in too —
that is off by default for a reason.

Afterwards, write the decisions that matter through the memB MCP with an
explicit `project_id`: `add_memory({ text: "…", category: "project_node",
project_id: "<folder name>" })`. Never write credentials or high-entropy
strings into memory.

Re-run the doctor to confirm the count went above zero. An ingest script that
exits `0` is not evidence that anything was stored.

---

## 6. OpenWiki — the project wiki

```bash
openwiki --init              # first time, inside the project
openwiki --update            # after significant changes
```

Pages land in `.openwiki/`. The machine-level daemon refreshes wikis every two
hours once the repo has one; without `--init` this repo is simply skipped.

Requires provider credentials from `/aos-setup` (`openwiki auth <provider>`).

---

## 7. Synapse — spatial map

```bash
synapse map .
```

Optional, and useful mainly on a codebase large enough that structure is hard
to hold in your head. Needs the daemon on `:7781` (`/aos-setup` covers it).

---

## 8. Confirm

```bash
node ~/.claude/skills/aos-project-init/scripts/aos-project-doctor.mjs
# 16/16 checks pass. Project is fully wired.
```

Report the doctor's own count, and name explicitly anything left failing on
purpose. Then commit the new files — `chore:` for the harness wiring, `docs:`
for `AGENTS.md`.

---

## Red flags

- Committing an `AGENTS.md` still holding template placeholders.
- Replacing an existing `CLAUDE.md` with a symlink without merging its content.
- Reporting the memB ingest as done from the script's exit code instead of the
  memory count.
- Installing the dispatcher harness into a repo that will never run the graph —
  five directories of machinery nobody uses.
- Renaming a project folder later without moving its memories to the new
  `project_id`.
