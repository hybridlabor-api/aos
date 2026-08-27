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
   - **Retested — the dispatcher genuinely ran for the first time.**
     `/startcycle <goal>` (fresh Claude Code session, same scratch project)
     produced a real `Workflow` tool call, a real spawned subagent
     (`architect-0`, Sonnet 5, 46.1k tokens), and a Run ID
     (`wf_f3a0d7da-768`) visible in `/workflows`. This is the first actual
     end-to-end execution since the graph was designed.

2. **New finding from that same run, fixed (commit `05382aa`):**
   `Workflow(name: "startcycle-dispatch")` itself failed —
   `Error: Workflow "startcycle-dispatch" not found. Available:
   deep-research` — even though the script exists, is correctly named, and
   the naming collision is resolved. Only `deep-research` (apparently
   built-in) is known to by-name lookup; a custom script under
   `.claude/workflows/` is NOT automatically registered by name just by
   existing there. The live session self-recovered by calling `Workflow`
   with `scriptPath` instead, which worked. **Fix:** rewrote the skill to
   use `scriptPath` (resolved via `$HOME`, never a hardcoded username) as
   the primary and only mechanism — removes the dependency on whatever
   by-name registration step actually exists (the `/workflows` monitor's
   `s save` hint looks like a candidate, but it's an interactive action a
   slash command can't trigger itself, so don't build on it without
   confirming it actually does that).
   - **Not yet independently reconfirmed** with the `scriptPath`-only
     version of the skill (the successful run above used the model's own
     workaround, not this fix) — next retest should confirm the skill's
     instructions alone (no improvisation needed) produce the same result.

3. **Status of that specific run, resolved by a peer session
   (`startcycle-test-01-db`) that checked directly:** `architect-0`
   SUCCEEDED cleanly (state="done", wrote a real 53-line plan + state.json,
   TechLead was correctly spawned next — the architect→techlead edge
   fires). The "paused/stopped" in `/workflows` was NOT a permission wait —
   the persisted run file showed `status:"killed", error:"Error: Workflow
   aborted"`. **Root cause: this Claude Code session's own process did not
   survive between turns, so the backgrounded Dynamic Workflow got killed
   mid-run** (TechLead was killed mid-`ls .agents/` at end-of-turn). This is
   a genuine, previously-undocumented runtime characteristic: a background
   `Workflow` run does NOT survive the parent session ending its turn —
   resuming requires an explicit `Workflow({scriptPath, resumeFromRunId})`
   call, not just `/workflows`' interactive `p` (resume). **Practical
   implication:** driving a real multi-round `/startcycle` run end-to-end
   may require keeping the invoking session alive/active for the whole
   run, or a deliberate resume step after any turn boundary. Not yet solved
   architecturally — just observed and worked around once by the peer
   manually resuming.

4. **New finding + FIXED (commit `639cb2e`):** the `state.json` written by
   that run did not conform to `.agents/state.schema.json` at all — missing
   `run_id`/`max_iterations`/`gate`/`findings`/`approvals`, and had several
   fields the schema doesn't define (`additionalProperties: false`
   violated: `status`, `updatedAt`, `updatedBy`, `needsMedia`, `buildOrder`,
   `history`). Root cause: `dispatchNote()` in the workflow script tells
   every agent to write state "per `.agents/state.schema.json`" — a path
   relative to whatever project the workflow runs in. That path only
   exists globally (`$HOME/.agents/`, a side effect of the earlier
   installer bug), NOT in the actual target project
   (`~/startcycle-test-01/.agents/` was confirmed missing). Every agent
   freelanced the shape with nothing to read. `.claude/agents/*.md` (the 7
   persona files) are NOT affected — Claude Code resolves those fine from
   `~/.claude/agents/` without a project-local copy; only the two contract
   files needed this. **Fix:** added a "Step 0" to the skill — before
   calling `Workflow`, copy `.agents/graph.md` and
   `.agents/state.schema.json` from `$HOME/.agents/` into the current
   project if not already present there, or stop and warn if even the
   `$HOME` copy doesn't exist. This is a stopgap at the skill level;
   **the real fix belongs in the installer** as a proper project-scoped
   install mode (see priority item 5 below — this expands that item's
   scope, it's not just the `currentDir`/`homeDir` global-write bug
   anymore).
   - **Not yet retested** — needs a fresh `/startcycle` run in a project
     that doesn't already have a stale non-conforming `state.json` (either
     `rm -rf production_artifacts/.agents` in the scratch project first, or
     use a brand new scratch dir) to confirm the bootstrap actually
     produces a schema-conforming file this time.

5. **Confirmed, separate, real safety gap:** both hooks errored
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
2. ~~Fix the naming collision.~~ **Done, commit `2138bd9`.**
3. ~~Fix `Workflow(name:...)` lookup failure.~~ **Done, commit `05382aa`
   — route via `scriptPath` instead.**
4. ~~Fix `.agents/` contract missing from the target project.~~ **Done,
   commit `639cb2e`** — Step 0 bootstrap added to the skill. **Not yet
   retested.**
5. **Retest `/startcycle` end-to-end, clean.** Use a FRESH scratch project
   (or `rm -rf production_artifacts .agents` in `~/startcycle-test-01`
   first — the existing `state.json` there is already non-conforming and
   would confuse a retest). Confirm: `Workflow` tool fires via
   `scriptPath`, `.agents/` gets bootstrapped, `production_artifacts/
   state.json` conforms to `.agents/state.schema.json` this time, TechLead
   actually approves/rejects, and — the big unresolved one — **whether the
   run survives to completion despite the "background workflow dies when
   the parent turn ends" behavior observed in finding 3 above.** If it
   doesn't survive unattended, that's a real architectural limit to
   document (not just a bug to fix), possibly requiring the invoking
   session to stay active/keep resuming for the whole run.
6. **Fix the hook path-resolution gap** so the GO-gate actually protects
   something outside the original repo, or explicitly scope it back to
   project-local and stop claiming global protection. Still open —
   `~/startcycle-test-01/.claude/hooks/` still does not exist.
7. **Fix the installer properly**, now with a wider scope than originally
   diagnosed: (a) the `currentDir`-vs-`homeDir` bug (harnessDirs loop + the
   two Phase 2 agent-compile calls) so a global install can't silently
   overwrite whatever directory happens to be the shell's cwd, AND (b) add
   an actual **project-scoped install mode** that drops `.agents/graph.md`
   + `.agents/state.schema.json` into whatever project `/startcycle` will
   run in — the Step 0 skill bootstrap (item 4) is a stopgap, not a real
   fix; it depends on a global `$HOME/.agents/` copy existing, which on a
   fresh machine it won't.
8. Only after an actual successful, schema-conforming, survives-to-completion
   dispatcher run: open the PR against `main`, with an honest description
   of what's verified (stubbed-agent tests, adversarial review, real
   installer run, real dispatcher run) and what isn't.

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
