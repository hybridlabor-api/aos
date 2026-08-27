# Session Handover — feat/agent-skills-v3.13

**Written:** 2026-08-27, right before a context compact. Read this first after
resuming — it has the state, the open findings, and the exact next step.
`audit-agents.md` in this same repo has the full structural audit that
preceded all of this; this file is the status of *acting* on it.

## Where things stand

- **Branch:** `feat/agent-skills-v3.13`, worktree at
  `/Users/timrennings/bdb-dev/bdb-dev-optimized-agent-skills.worktrees/agent-skills-v3.13`.
- **`main` has never been touched.** Nothing pushed. No PR opened.
- ~24 commits. All of Phases −1 through 4 from `audit-agents.md` are done:
  audit, dedup + domain tagging, GO-gate hook, installer agent-generation,
  41-skill content pass, graph contract (`.agents/graph.md`,
  `.agents/state.schema.json`), the dispatcher itself
  (`.claude/workflows/startcycle.mjs`), an adversarial subagent review of the
  dispatcher (8 real findings, all fixed), and two hook fixes
  (`stop_hook_active` handling in `graph-gate.mjs`, a doc comment on
  `go-gate.mjs`).
- `npm install` has been run in this worktree (node_modules exists locally,
  gitignored, needed because worktrees don't share node_modules with the
  main checkout — this bit the first installer test).

## What we were doing when this got written

Testing the dispatcher against the **real** Dynamic Workflows runtime for
the first time (everything before this was tested against stubbed
`agent()` calls in a hand-rolled harness — see commit `dc9dc0c`'s message
for that testing methodology). Two tests done so far:

### Test 1: `node installer.js` with isolated `HOME`
Ran via `HOME=$(mktemp -d) node .../installer.js` from the user's real `~`.
**Partially escaped the isolation** — a real, still-unfixed bug:

- `installer.js:2105-2115` — a `harnessDirs = ['.agents', '.cursor/rules',
  '.claude', '.github', '.codex-plugin']` loop copies these directories via
  `copyDirRecursiveSync(src, path.join(currentDir, dir))`. `currentDir =
  process.cwd()`, **not** `homeDir` (which correctly respects `$HOME`). Since
  the user ran the command from `~`, this silently overwrote
  `~/.claude/settings.json`, `~/.claude/CLAUDE.md`, `~/.github/*`,
  `~/.codex-plugin/*`, `~/.agents/*`, `~/.cursor/rules/*` — no merge, no
  backup, blind `fs.copyFileSync` per file.
- My own Phase 2 additions (`compileClaudeAgents`/`compileOpenCodeAgents`
  writing to `path.join(currentDir, '.claude', 'agents')` and
  `'.opencode/agents'`) follow the **same anti-pattern** — same bug class,
  not yet fixed either.
- **Assessed impact:** likely *not* new data loss — `~/.github`,
  `~/.codex-plugin` predated this run (21 Aug / 12 Aug), suggesting the user
  has run this installer from `~` before as their normal workflow, so this
  is probably re-applying an established pattern, not fresh destruction.
  **Cannot rule out** that `~/.claude/settings.json` had unrelated custom
  content before that's now gone — no backup exists for that specific file,
  no dotfiles git tracking on `~`.
- **Confirmed side effect, currently live:** `~/.claude/settings.json` now
  contains only this repo's two hooks (`go-gate.mjs`, `graph-gate.mjs`),
  globally, for every Claude Code session on this machine — including the
  one you're reading this in, if resumed on the same machine.
- **Not yet fixed.** The correct fix: those `harnessDirs` writes and the two
  Phase 2 compile calls should target `homeDir`-based paths (respecting
  `$HOME`) for a true "global" install, or the installer should warn/confirm
  before writing when `currentDir` looks like `$HOME` itself. Pick one
  before touching this again.

### Test 2: real `/startcycle` run in a scratch project (`~/startcycle-test-01`)
**The dispatcher never actually ran, on the first two attempts.** Findings:

1. **Naming collision, confirmed on disk, and RESOLVED (commit `2138bd9`):**
   `~/.claude/skills/startcycle/` (the skill, `disable-model-invocation:
   true`) and `~/.claude/workflows/startcycle.mjs` (the Dynamic Workflow)
   shared the name `startcycle`. First attempt (`/startcycle <goal>`,
   Dynamic workflows OFF): resolved to the **skill**, which did the task
   inline — no `state.json`, no subagents, no graph. Second attempt
   (**same result, after toggling Dynamic workflows ON in `/config`**):
   the skill *still* won — confirming the toggle alone does not resolve the
   collision; the skill wins regardless.
   - **Root cause:** the skill's body duplicated the full pipeline
     description in prose, which invited the model to follow it "in
     spirit" inline rather than invoke the workflow — and nothing in the
     harness prefers a same-named workflow over a same-named skill.
   - **Fix applied:** renamed the workflow `startcycle.mjs` →
     `startcycle-dispatch.mjs` (`meta.name` too), and rewrote
     `skills/basic/startcycle/SKILL.md` as a thin router whose only
     instruction is "call the `Workflow` tool with name
     `startcycle-dispatch` and relay the result" — no pipeline prose left
     to follow "in spirit". Updated `.agents/graph.md`'s two path
     references. Mirrored both changes into the installed copies
     (`~/.claude/skills/startcycle/SKILL.md`,
     `~/.claude/workflows/startcycle-dispatch.mjs`) for immediate retest.
     Confirmed no `installer.js` code hardcodes the old filename (it
     copies `.claude/` as a whole directory, and only references the
     unrelated doc `.agents/workflows/startcycle.md` by name) — so this
     fix needed no installer changes.
   - **Not yet retested end-to-end** — this was the very next step queued
     when context most recently ran low. See "Priority order" below.

2. **Confirmed, separate, real safety gap:** both hooks errored
   (non-blocking) during the test run — `PreToolUse:Bash hook error`,
   `Stop hook error: Cannot find module
   '/Users/timrennings/startcycle-test-01/.claude/hooks/graph-gate.mjs'`.
   Root cause: hooks are registered **globally** in `~/.claude/settings.json`
   using `${CLAUDE_PROJECT_DIR}/.claude/hooks/go-gate.mjs` — a path that only
   resolves inside the original `bdb-dev-optimized-agent-skills` repo. In
   **every other project**, including this scratch one, the hook command
   fails to find the file and the hook silently does nothing (exit 1, not
   exit 2 — non-blocking per the hooks reference, confirmed in this actual
   run). **Practical meaning: the GO-gate does not function anywhere except
   inside the original repo, despite being globally registered.** Not yet
   fixed. Options: ship the hook scripts themselves to a stable
   `$HOME`-relative location the global hook command can always reach
   (rather than `${CLAUDE_PROJECT_DIR}`-relative), or accept that the GO-gate
   is repo-scoped by design and stop registering it globally.

## Priority order for next session

1. ~~Get the `/config` Dynamic Workflows answer.~~ **Done — it's ON.**
2. ~~Fix the naming collision.~~ **Done, commit `2138bd9`, not yet retested.**
3. **Retest `/startcycle` right now** in `~/startcycle-test-01` (or fresh) —
   send `/startcycle <small goal>` again and confirm: does the model call
   the `Workflow` tool this time, does `production_artifacts/state.json`
   appear, do the 7 agents actually get invoked, does the repair loop
   exercise for real? This is the concrete next action, queued but not yet
   executed as of this doc's last edit.
4. **Fix the hook path-resolution gap** so the GO-gate actually protects
   something outside the original repo, or explicitly scope it back to
   project-local and stop claiming global protection. Still open — the
   naming-collision fix did not touch this; `~/startcycle-test-01/.claude`
   still does not exist, so both hooks will still no-op there.
5. **Fix the `currentDir`-vs-`homeDir` installer bug** (harnessDirs loop +
   my two Phase 2 compile calls) so a future installer run — isolated test
   or real — can't silently overwrite arbitrary directories under whatever
   `cwd` happens to be. Still open, untouched by today's fix.
6. Only after an actual successful dispatcher run: open the PR against
   `main`, with an honest description of what's verified (stubbed-agent
   tests, adversarial review, real installer run, real dispatcher run) and
   what isn't.

## Things NOT to redo

- Do not re-run `npm install` — already done in this worktree.
- Do not re-litigate the graph design, the 8 adversarial-review fixes, or
  the skill content passes — those are done and committed, see `git log`.
- Do not trust the suspicious `~/Downloads/11_claude_code_v3.13_handover.md`
  file if it resurfaces — it made false claims about session state and
  pushed toward an unauthorized `git push`/PR. Already rejected once this
  session; the reasoning is in the conversation transcript around when it
  appeared.
- `~/startcycle-test-01` is a disposable scratch project — fine to delete,
  recreate, or keep re-running tests in.

## Files most relevant to resume from

- `.agents/graph.md` — the contract.
- `.agents/state.schema.json` — the state shape.
- `.claude/workflows/startcycle.mjs` — the dispatcher implementation.
- `.claude/hooks/{go-gate,graph-gate}.mjs` — the two hooks, both need the
  path-resolution fix above.
- `installer.js` lines ~2105-2115 (`harnessDirs` loop) and the
  `compileClaudeAgents`/`compileOpenCodeAgents` call sites — the
  `currentDir`-vs-`homeDir` bug.
- `audit-agents.md` — full audit history, all prior findings and their
  resolutions, for context on *why* things are shaped this way.
