---
name: pb-release-aos
description: >-
  Release a new AOS version to npm through the release-please PR: check the
  commit subjects, review and gate the release PR, merge it only after GO,
  watch the release workflow and check version drift. Use for "release AOS",
  "cut an AOS release", "merge the release PR", "publish a new AOS version".
category: bdb-core
kind: playbook
trigger: ["release AOS", "cut an AOS release", "merge the release PR"]
inputs: [repo?]
requires:
  skills: [github, pb-ship, bdb-shipping-skill, git-pr-review, pr-recap, godmode-shipping, quick-recap, "bdb-ecosystem-health (external)", "gh (external)"]
  agents: [reviewer]
  mcps: ["plan (optional)"]
  store: []
go_points: ["gh pr merge (release PR)"]
outputs: ["production_artifacts/pb-release-aos-<date>.md"]
verify: "npm view @hybridlabor-api/aos version == version in .release-please-manifest.json on main after merge"
difficulty: advanced
est_time: 30-60 min
---

# Release AOS to npm
What you get: a new AOS version on npm through the release-please PR, never a hand bump, with the PR reviewed and gated before your GO.

## Inputs
- repo (optional) — the AOS checkout, default the current directory; `<owner/repo>` comes from `git -C <repo> remote get-url origin`

## Steps
1. Preflight — `gh auth status` and `test -f ~/.claude/skills/bdb-ecosystem-health/SKILL.md` → run log header — gh missing or unauthenticated → log it, give the `gh auth login` hint, stop; skill absent → log "Missing skill: bdb-ecosystem-health (installed locally only, not shipped by AOS). Drift report in step 7 skipped; the npm check still runs." and continue
2. github — commits since the last tag (`git -C <repo> fetch --tags`, then `git -C <repo> describe --tags --abbrev=0`, then `git -C <repo> log <tag>..HEAD --format=%s`) → subject list in the run log, every non-Conventional subject flagged (release-please cannot see it, see AGENTS.md) — stops for approval
3. github — `gh pr list -R <owner/repo> --state open --head release-please--branches--main --json number,title,headRefName` → the release PR number in the run log — none → stop with "no release PR"
4. Review and gate on that PR, using these skills:
   - git-pr-review — `gh pr view <n> -R <owner/repo> --json commits` → description draft in the run log — draft only, nothing posted
   - pr-recap — recap file written → link it; recap not buildable → log "pr-recap skipped: <reason>" and paste `gh pr diff <n> -R <owner/repo> --name-only` instead; no `npx` without approval
   - reviewer (agent) — `gh pr diff <n> -R <owner/repo>`; the contract is the commit list from step 2, never the PR body → findings table — any open `blocking` finding stops the run
   - bdb-shipping-skill — door class of the release PR (two-way or one-way; unclear counts as one-way) → class in the run log; one-way → ADR-lite `production_artifacts/decisions/<date>-<slug>.md` — class recorded
   - godmode-shipping — `gh pr checks <n> -R <owner/repo>` all pass (pending, `gh pr checks` exit 8, counts as not passed), plus the local gate exactly as pb-ship step 8 gives it (scratch worktree from `pull/<n>/head`, lint, typecheck and test scripts that exist, a fork PR skips the local gate and is held, worktree removed without `--force`) → exit codes in the run log
5. [GO] github — `gh pr merge <n> -R <owner/repo> --squash` — the WAITING FOR GO line names PR number, title, base branch, method and the version in `.release-please-manifest.json`. The run stops here until the human types GO. (The hook guards `gh pr merge`.) Never `npm version` or `npm publish` by hand.
6. github — `<sha>` = the merge commit (`gh pr view <n> -R <owner/repo> --json mergeCommit -q .mergeCommit.oid`); `gh run list -R <owner/repo> --workflow release-please.yml --commit <sha> --limit 1 --json databaseId` (wait until a run exists), then `gh run watch <id> -R <owner/repo> --exit-status` → conclusion in the run log — exit 0
7. npm check and drift — `npm view @hybridlabor-api/aos version` → run log — always run; equals the version in `.release-please-manifest.json` on main. bdb-ecosystem-health drift report only if step 1 found the skill
8. quick-recap — run log → final line `🟢|🟡|🔴` with the released version — line written

Run log: `production_artifacts/pb-release-aos-<date>.md` in the start directory, never committed

Rules
- Anything other than the literal GO (case-insensitive) is not a GO; a GO covers only that one step, one time.
- A failed check stops the run: write the failure into the run log and report. No silent retries.
- Write one run-log line per step as it completes (`N. done|skipped|failed — artifact — check result`) and `WAITING FOR GO: <step>` at each gate.
