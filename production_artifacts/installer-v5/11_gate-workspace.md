# Gate v5, change 11 — grant scope `workspace`

Spec for New Workspace grant scope `workspace`
Approved by Tim (2026-10-07): `gogate grant workspace,container-test 8h`.
Author of this spec: worker agent.

---

## 1. Goal

`workspace` is a count-me-out-as-often-as-possible grant: with it active, an agent may clone, inspect, fork, build, and commit inside its own session repo/clone WITHOUT a GO. It must never enable anything that touches the HOST outside the session repo/clone — no deletes outside it, no push, no publish, no host installs, no writes to the agent config dirs or the gate's own store dirs.

Grant syntax follows the existing grammar (`parseGogate`, go-gate.mjs:1807/1819):

```
gogate grant workspace 8h
gogate grant workspace,container-test 8h
gogate grant workspace session
```

`workspace` joins `SCOPES` (go-gate.mjs:114). Nothing else in the gogate CLI reads it; the interplay with `hard`/`soft`, expiry (`MAX_GRANT_MS`, 24h), OpenCode's 2h cap, strict-human verification (`isStrictHumanEntry`, :1683), revocation by a later `hard` (`effectiveGate`, :1923-1934) and masking are all unchanged.

---

## 2. Current behaviour of the listed actions (before this change)

Line numbers refer to .claude/hooks/go-gate.mjs as of this writing. `[]` = unguarded (no GO, no grant); `null` = guarded but classifiable to no scope (plain GO only). Cite:

| Action | Today | Why |
|---|---|---|
| local `git add` / `git commit` | already free | classify git falls through to `[]` (verify, and `git add`/`git commit #:566` via the Change-1 rules of 09_gate-container-test.md: bypass flags make it `null` at :565 / catchAll :615) |
| `git clone` into scratchpad or ~/dev | already free | classify git: `clone` is a GIT_BUILTINS verb (:228), no branch-ref guard, falls to `[]` (:566); only segments that cannot be parsed (opaque heads, catchAll true :607-624) stay `null` |
| `git worktree add` | already free | only `worktree remove` is guarded (:553 and GUARDED_PATTERNS :86) |
| launching `aos-acp` / `opencode` workers (`opencode run "..."` without load/-s/-c/--session/--continue) | already free | GUARDED_PATTERNS only match resume/continue forms (:101-103); `aos-acp` is not a guarded head, catchAll false → `[]` (:599) |
| `npm run <x>` / `npm test` / `node --test` | already free — the npm script body is NEVER read | classify: npm `run`/`exec`/`x`/`dlx` are `[]` unless catchAll fires (:575; catchAll fires only for pollute/version words :618). NOTE: package.json `scripts.<x>.mjs` are not read by the gate — an npm-run body that deletes is invisible today. This is a pre-existing hole; this spec does not widen or close it beyond noting it. `node scripts/x.mjs` (direct run) IS analyzed (:1162 scriptFile, :131 analyzeDeletes collects files :1346, and scriptInto reads them :1205). |
| `node scripts/build-plugin-manifest.mjs` where the script contains a delete (`rmSync('build', { recursive: true })`) | NEEDS A GO — the real pain point | scopesOf runs analyzeDeletes on the command (:1493); scriptInto (:1205) reads the file and codeInto (:1126) hits DEL_CALL (:1067) → sets `r.destructive` → out.add("destructive") (:1495) → needs scope `destructive`; if the delete target is a home-level path or unjudgeable (`p = ""` → :1137-1139) → `r.unscoped` → the whole command is `null` (:1494). Either way, GO. |
| unreadable/oversized script file (`node scripts/missing.mjs`, > 256 KB) | plain GO | null (scriptInto :1208/:1216/:1224 fail closed) |
| deletes OUTSIDE the own repo (`rm -r ...`) | plain GO (or scope `destructive` for a clearly-inside-path one) — never grantable under this scope | GUARDED_PATTERNS :82, shellDelete :1027-1031, catchAll :621; home-level recursive targets are HARD (homeVerdict :1004-1011, hardBlockReason :1406) |
| `git push` | plain GO, scope push-feature/push-main | :74-75, pushScopes :369; never grantable under workspace |
| `npm publish` | plain GO, scope publish | :76 |
| `npm version` | plain GO, scope publish | :77 |
| `gh pr merge`/writes, `gh api` writes | plain GO, scopes merge/github-write | :78-79, :87-92, :582-596 |
| `git reset --hard`, `git clean -f`, `git branch -D`, `git worktree remove` | plain GO, scope destructive | :546-547, :548-553 |
| host installs (`npm install -g`, `brew`, `pip install` outside a repo venv) | plain GO — never grantable under this scope | NOTE (doubt, see §7): none of these are in GUARDED_PATTERNS today, so a workspace grant does not change their gate behaviour; the deny is POLICY (the scope must never be claimed to cover them) not a new mechanism |
| writes to ~/.claude / ~/.gemini / ~/.codex, gate store ~/.aos/gate + ~/.aos/go | plain GO or HARD, never grantable | home-children dotfiles, `isHomeDotfile` :1013-1014 with writes :1347-1357, gate store protection :1519-1530; and container/rule-16 allow-list excludes them :685-694 |

---

## 3. Proposed rule (smallest safe change)

**Scope name:** `workspace`.

**Covered WITHOUT a GO while the grant is active:**
- everything already `[]` above (clone, worktree add, local add/commit, launching aos-acp/opencode workers, npm-run invocations);
- NEW: running `node`/`nodejs`/`bun`/`deno`/`python`/`perl`/`ruby` script FILES that live inside the session repo/clone, when the only guarded content of the command is what the script analysis attributes to those in-repo files: the `r.destructive` and the `r.unscoped` that come from `scriptInto` + `codeInto` reading those files (typically `rmSync('build', { recursive: true })` inside a build/manifest script). These parts count toward the scope `workspace` instead of `destructive`.

**Conditions for a workspace-covered `unscoped`/`destructive` result (all must hold):**
1. Script-provenance only: every `unscoped`/`destructive` contribution of `analyzeDeletes` must come from the script FILE analysis (scriptInto/scriptInto-driven codeInto), never from the shell command text itself, never from a resurrection through `r.cmds` recursion (analyzeDeletes drain :1384-1391) and never from inline code (`node -e`). Provenance attribute: scriptInto records whether the unscoped/destructive it produced was `from-script`, and the drain keeps `from-script` from propagating into parent analyzeDelete results.
2. In-repo boundary (`withinWorkspace`, mirroring isContainerTestRun/dockerScopes :745-813 approach): for each attributed script file, its native realpath must stay under a repo boundary that (i) realresolves through symlinks, (ii) has no dot-segments in the path, (iii) is at least two levels inside the real home dir (`rel.length >= 2` from realHome, not under ~/Library), (iv) is the session repo (either the repo the session cwd points at via locateGit, or a `git clone` worktree of it — actually since gateCtx.cwd is the session cwd, boundary = the git base of the script's dir; the scratchpad alternative adds the same two-levels-inside-home constraint for ~/dev clones).
   - If any realpath check fails (symlink out of the repo, dotdir in the path, missing/unreadable, depth<2) the unscoped stands → `null` (plain GO only).
3. Never when the delete target leaves the workspace or is unjudgeable: scriptInto records every delete-target path derived by `codeArgToPath` (:1075-1086); if any of them is not normPath-resolvable INSIDE the workspace boundary (relative resolved against the session cwd, `..` segments followed, `~` never allowed in an attributed target), the result stays plain GO (`null`).
4. Never hard blocks: any `r.hard` (hardBlockReason :1406) precedes grants and stays unconditional.
5. Never destructive in the command text itself: a host `rm -rf build` in the SAME command as `node script.mjs` yields scopes `["workspace", "destructive"]` and each needs its own grant/GO. Universal denies (`git push`, `npm publish`, `gh` writes, opaque runs) are still `null`/their own scope at classify level (:1486-1487, :1501).
6. Cooldown stands: `r.cooldown` (scriptInto :1215) → always `null` (denial + 10-min block cooldown, COOLDOWN_MESSAGE :1155).

**Grant semantics:** unchanged, one new set of scopes in SCOPES only.

---

## 4. Case table (with `workspace` active unless noted)

| Case | Result | Scope(s) |
|---|---|---|
| `node scripts/build-plugin-manifest.mjs` (script `rmSync('build', { recursive: true })`) | covered | workspace |
| `node scripts/clean.js` (non-recursive delete inside the repo) | free (was never guarded) | [] |
| rmSync on a home-child path (always outside the repo) | plain GO | null (delete target outside repo, even non-recursive) |
| script symlink that escapes the repo (realpath lands out) | plain GO | null |
| repo at depth 1 inside home (e.g. `~/repo`) with script delete | plain GO | null |
| `npm run build:manifest` | free (unchanged; script body never read — pre-existing) | [] |
| `git add . && node scripts/build-plugin-manifest.mjs` | covered | workspace |
| `node script (covered) && git push` | not covered | workspace + push-feature (needs push-feature grant too) |
| `node script (covered) && rm -rf build` on the HOST | not covered | workspace + destructive |
| `git clone <url> work && cd work && git worktree add w main` | covered (already free) | [] |
| `git commit --no-verify -m x` | never, even with grant | null |
| `docker run --privileged …` | plain GO (null) | null |
| `git reset --hard` / `git clean -f` | plain GO | destructive |
| `gh pr merge` / `npm publish` / `git push` | plain GO | merge / publish / push-* |
| hardBlockReason fires (delete of home) | never covered, even with grant | hard |
| gate store write | plain GO or hard | — |
| after a block, a script written during cooldown | plain GO (cooldown) | null |
| script unreadable / over SCRIPT_MAX (256 KB) | plain GO | null |

---

## 5. Remaining risk (summed up)

- A repo script can delete and overwrite FILES INSIDE the repo and anything it computes: the workspace grant vouches for "inside", not for "harmless".
- A repo script can read its own project files and any secret in that repo (skills can peek at .env), and reach the network.
- An `npm run <x>` body is never read today, so a workspace agent can already run the equivalent of any node script indirectly if it can edit package.json — this hole predates this change.
- An agent that can write files can patch a script's content between the gate's read (scriptInto) and the shell's run (TOCTOU, scriptInto mtime/read window). Nothing in-process fixes that; threat model note at :34-35.
- Inline `node -e`/`bash -c` code is NOT covered by workspace; it keeps its today behaviour (inline deletes → destructive/null via :1369 / :1130), except hard paths.

---

## 6. Doubts / open questions for Tim

1. npm-install family (`npm install -g x`, `brew install`, `pip install`) is not in GUARDED_PATTERNS today, so the gate does not see them at all; "denied under workspace" is a policy statement, not an added hook rule. Should a future change add them to the guarded set?
2. `npm run <x>` should arguably read the package.json `scripts` map (like scriptInto reads script files); today it is skipped entirely. Out of scope here (would widen the analysis, slow the gate); flagged for a future change.
3. Scratchpad-dir spelling: "session scratchpad dir" is currently the session's cwd tree; if it should mean a specific `~/.aos/...` scratchpad path, that is out of this change's scope (any dotdir cannot be in-workspace anyway).
4. `_worktree` naming clash: `git worktree add ../wt` inside `~/dev/x` would need git to already own the repo at `~/dev/x` — clone + then worktree in it. Both are separately covered; the combined chain `git clone <url> wt && cd wt && git worktree add wt2 main` is covered as [] today and by the new scope when extended.
5. Docker in-workspace (`docker` runs against mounts) stays on the `container-test` scope; workspace is not a substitute — grants of the two can be combined, never confused.
