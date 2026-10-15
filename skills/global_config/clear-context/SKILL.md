---
name: clear-context
description: Use to survive a /clear or a context limit. `/clear-context save` writes a verified handoff (state, rules, running work, next steps) and stores the key decisions in unified memory; `/clear-context` after the clear reads the newest handoff, cross-checks it with deja and memB, re-verifies the live state and continues. Works in every harness.
category: bdb-core
risk: low
source: bdb
---

# clear-context: lose the chat, keep the work

A long session fills the context window. `/clear` empties it, so everything that is only in the chat is gone. This skill moves the state into three places that survive: a **handoff file** (authoritative), **memB** (decisions, searchable) and **deja** (the transcript index). After the clear it rebuilds the picture and re-checks it against reality instead of trusting it.

## Mode 1: `/clear-context save [note]` (run before /clear)

1. **Collect facts, do not recall them.** Run read-only commands and write only what they return: `git status -sb` and `git log --oneline -5` for each worktree you worked in, `git worktree list`, `gh pr list --state open` (if gh exists), the version of every package you released (`npm view <pkg> dist-tags --prefer-online`), `pgrep -fl` for background workers, the running services you care about, disk space when a run was heavy. Anything you cannot verify goes under "Unverified".
2. **Write the handoff** to `~/.aos/briefs/handoff-<harness>-<project-slug>-<YYYY-MM-DD-HHMM>.md` (slug from `.aos/project.json`, else the repository name of `git remote get-url origin`, else the folder name; a worktree must use the repository name, so every worktree finds the same pointer). Use exactly these sections, each short and concrete, with absolute paths and command lines a stranger can run:
   - `0 Rules that cost time` (permission and approval rules, how workers are started, secrets handling, limits)
   - `1 State of the world (verified <time>)` (releases, open PRs, branches/worktrees with their commits, incidents and how they were fixed)
   - `2 Running now` (table: worker, task, worktree/branch, where the output lands, how to check it)
   - `3 Next steps in order` (numbered; mark every step that needs a human approval word)
   - `4 Open decisions` and `5 Do not touch`
   - `6 Verify first (read-only)` (the exact commands to re-check sections 1 and 2)
   Never write secrets, tokens, key values or file contents that may hold them. Name the file and variable where a secret lives, never the value. Do not paste whole logs.
3. **Update the pointer:** copy the file to `~/.aos/briefs/LATEST-<project-slug>.md` (a copy, not a symlink, so it survives tools that do not follow links).
4. **Store the decisions in unified memory:** ingest the handoff into memB (skill `memb-ingest`, or the memB MCP store call) with the project slug, and add 5 to 10 one-sentence decisions as separate notes (why we chose X, what we rejected, which rule Tim gave). deja needs no step: it indexes the transcripts on its own.
5. **Finish with one line:** `Handoff saved: <path>. Now type /clear, then /clear-context.` Do not clear anything yourself.

## Mode 2: `/clear-context` (run right after /clear; also with `resume`)

1. **Find the handoff:** read `~/.aos/briefs/LATEST-<project-slug>.md`. If it is missing, list `~/.aos/briefs/handoff-*` and take the newest for this project. Say its age; if older than 24 hours, warn that the state may have moved.
2. **Cross-check with unified memory:**
   - `deja wip` in the project directory (what the last session was doing; it only knows the session start, so it can be older than the handoff).
   - memB recall for the project slug and the handoff's main nouns (the decisions you stored).
   - Optional: `deja handoff --to <this harness>` builds a handoff from the indexed transcript; use it only to fill gaps, the handoff file wins on conflict.
3. **Re-verify the live state:** run the commands in the handoff's section 6, then compare with sections 1 and 2. List every difference (new commits, finished or died workers, merged or closed PRs, changed versions) before doing anything.
4. **Report in at most 10 lines:** what is done, what is running, what changed since the handoff, the next step from section 3, and which step needs an approval word.
5. **Stop and wait** for the human. A handoff is context, not permission: never run a guarded command (push, publish, merge, delete, deploy) because the file says it was planned; ask for the approval word the project requires.

## Notes

- Unified memory roles: **handoff file** = authoritative state; **memB** = decisions and rules, searchable across sessions and harnesses; **deja** = transcript index (`deja wip`, `deja search`, `deja handoff`, `deja resume <id>`).
- A SessionStart hook that prints the `LATEST-<slug>.md` path (the memB hook already prints `deja wip`) would make step 1 automatic; the hook never reads the file's content into the context by itself.
- Same idea for agent-to-agent hand-over: write the handoff, then start the other harness with `Read <path> and continue`.
