---
name: pb-worktrees-land
description: >-
  Clean up git worktrees across your repos: list every worktree, classify it
  as merged, remote-only, local-only or dirty, recap what each holds, and
  remove only the merged clean ones after GO. Use for "clean up worktrees",
  "what is in my aos-wt folders", "land my worktrees", "prune worktrees".
category: bdb-core
kind: playbook
trigger: ["clean up worktrees", "land my worktrees", "prune worktrees"]
inputs: [repos?]
requires:
  skills: [using-git-worktrees, github, visual-recap, pb-ship, "gh (external)"]
  agents: []
  mcps: ["plan (optional)"]
  store: []
go_points: [git worktree remove]
outputs: ["production_artifacts/pb-worktrees-land-<date>.md"]
verify: "git -C <repo> worktree list no longer shows any path the log marks removed; every removed branch was merged before removal"
difficulty: intermediate
est_time: 10-30 min
disable-model-invocation: true
---

# Land and clean up worktrees
What you get: an inventory of your worktrees with a class for each, and the merged clean ones removed after your GO.

## Inputs
- repos (optional) — repo paths to scan; default is the current repo's main worktree (`git rev-parse --path-format=absolute --git-common-dir`, parent dir)
- `<owner/repo>` for each repo comes from `git -C <repo> remote get-url origin`

## Steps
1. Ask — repos (default as above) → run log in the start directory — repo list confirmed; stops for approval
2. using-git-worktrees — per repo: `git -C <repo> worktree list --porcelain` → inventory table (path, branch, HEAD) in the run log — the main worktree, the worktree running this playbook, and any entry marked `locked` or `prunable` are `keep`
3. github — `gh auth status` (fails → log it, skip the squash predicate, only ancestry merges count); `git -C <repo> fetch origin --prune`; default branch: `default=$(git -C <repo> symbolic-ref --short refs/remotes/origin/HEAD); default=${default#origin/}` (the command prints `origin/main`) → both in the run log — fetch fails → log it, classify against the local refs, mark the table "stale"
4. Classify, first match wins:
   - `dirty`: `git -C <wt> status --porcelain --ignored` shows anything other than `!!` entries; `!!` (ignored files, deleted by removal) are listed per row in the GO line
   - detached HEAD (no `<branch>`): always `local-only`, never removed
   - `merged`: `git -C <repo> merge-base --is-ancestor <branch> origin/<default>`, or (squash merge) `gh pr list -R <owner/repo> --head <branch> --state merged --json number,headRefOid` has a PR whose `headRefOid` equals the worktree `HEAD` (`git -C <wt> rev-parse HEAD`); a reused branch name with a different `headRefOid` does not count
   - `remote-only`: the upstream exists and `git -C <wt> rev-list --count @{u}..HEAD` is 0 (safe on the remote, unmerged)
   - `local-only`: everything else; commits exist only here
   - check: every row has exactly one class plus the output of its evidence command
5. visual-recap — per non-merged worktree: recap link; without the `plan` connector log `git -C <wt> log --oneline origin/<default>..HEAD` and `git -C <wt> diff --stat origin/<default>...HEAD` instead — one recap or fallback per row
6. [GO] removal list = rows classified `merged` and not `keep`, shown in full with these exact commands per row: `git -C <repo> worktree remove <path>` (label the row `merged (empty)` when `git -C <repo> rev-parse <branch>` equals `git -C <repo> rev-parse origin/<default>`; never `--force`; git refuses dirty trees), then `git -C <repo> branch -d <branch>` (`-d` refuses squash-merged branches → log "branch kept, needs -D, human decides"; never `-D`). The run stops here until the human types GO. GO covers exactly that list, once. The hook does not guard these commands, so GO is by contract. Never remove dirty, remote-only, local-only or `keep` rows, and never use `rm -r`.
7. Verify — `git -C <repo> worktree list` → removed paths are gone, kept rows unchanged
8. Hand-off — remote-only and local-only rows → next action per row in the run log ("land via /pb-ship", or "push needs GO in that worktree") — nothing runs

Run log: `production_artifacts/pb-worktrees-land-<date>.md` in the start directory, never committed

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
