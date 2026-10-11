# 09 - go-gate: local commits without GO, scope `container-test`

Status: spec + failing tests. The gate is NOT edited here (`.claude/hooks/go-gate.mjs`, Tim applies it).
Tests: `tests/go-gate-container-test.test.js` (node:test, CJS, same harness as `go-gate-419` / `go-gate-modes` / `go-gate-review2`; not in package.json until the change lands).
Line numbers refer to `.claude/hooks/go-gate.mjs` as in this worktree.

## 1. Current behaviour (read from the code, not run)

Hook order (`main`, 2041-2148): hard block, store block, `isGuardedCommand` -> not guarded = allowed with no transcript or GO check (2102-2105). Guarded = a `GUARDED_PATTERNS` hit (74-106) or `commandScopes` non-empty/null (1402-1403).

| Command | Today | Why |
|---|---|---|
| `git add .` | ALLOWED, no GO | `classify` git branch (502-549): `add` is in `GIT_BUILTINS` (220), no push/reset/clean/branch/worktree/config -> `[]` (548). No pattern matches. |
| `git commit -m x` | ALLOWED | same, `commit` in `GIT_BUILTINS`, `[]` |
| `git commit --amend` | ALLOWED | same; arguments after the subcommand are only read for `push`, `reset`, `clean`, `branch`, `worktree`, `config` |
| `git commit --no-verify -m x` | ALLOWED | flags never inspected for `commit` (only `SAFE_PUSH_OPT` 197 for push) |
| `git -c core.hooksPath=/dev/null commit -m x` | ALLOWED | `-c` sets `config=true` (508) but `config` is read only for `push` (525). Pattern 94 only catches `alias.` |
| `docker run --rm -v <proj>:/src node:24 bash -c 'npm test'` | ALLOWED | `classify` has no docker branch: falls to `catchAll` (580), which finds no git/npm/gh/rm word (the quoted `'npm test'` is ONE token) -> `[]` |
| same with `-v $HOME/.claude:/c` | ALLOWED | `analyzeDeletes` sees no delete; nothing looks at mounts |
| same with `--privileged` | ALLOWED | no docker rule outside rule 16 |
| same with `--pid=host` | ALLOWED | same |
| same with `-v /var/run/docker.sock:/var/run/docker.sock` | ALLOWED | same |

Consequences:

1. Change (1) is already true in the gate. `git add` / `git commit` never need a GO today. Only `conventional-commits.mjs` can stop a commit (a quoted `-m "x"` that is not Conventional; unquoted `-m x` fails open, 61). The tests pin it (they pass today) and add what is NEW: the bypass forms must start to need a GO.
2. `docker run` is not guarded at all today. Rule 16 (`isReadOnlyDockerRun`, 647-713) is only used by `analyzeDeletes` (1224, `ro`) to skip heredoc/script-file analysis (1262, 1274); it never blocks or allows anything. So a `container-test` scope only means something if `docker run` becomes guarded. This spec does that (section 3.2). It is a tightening: an unsafe `docker run` and a safe one without a grant now need a GO.

## 2. Rules

### 2.1 Local git (no scope, no GO)

`git add ...` and `git commit ...` are unguarded unless they bypass hooks or signing. Bypass = guarded, `null` (never grantable, plain GO only):

- an argument of the commit that is `--no-verify` or an abbreviation of it (`--no-v`...`--no-verify`), `--no-gpg-sign` or an abbreviation (`--no-g`...), or a short bundle containing `n` (`-n`, `-nm`, `-anm`); compared after quote removal (`unq`)
- global `-c` / `-cKEY=...` / `--config-env=KEY=...` whose key is `core.hooksPath` or `commit.gpgsign` (case-insensitive), or whose key cannot be read (contains `$` or a backtick)
- a bare `$...` or backtick word among the arguments (`git commit $FLAGS -m x`)
- a `GIT_*` variable prefix on the commit (`gitEnv`, 144) -- fail closed, includes `GIT_AUTHOR_*`
- `git config core.hooksPath <value>` / `git config --add|--replace-all|--unset ...` of that key (write forms only; the read forms stay free)
- the same inside `bash -c '...'` / `sh -c "..."` (covered by a pattern, see 3.1)

Not part of this change: `git push`, `git merge`, `rebase`, `reset --hard` etc. stay as they are. `commit --amend`, `-S`, `--allow-empty`, `-a` are not bypasses.

### 2.2 Scope `container-test`

Grant: `gogate grant container-test <15m|2h|1d|session>` (plain form only; slash form stays non-strict and ignored; same 24 h cap, hard revokes, expiry as every scope).

A `docker run` segment (also `docker container run`) maps to `["container-test"]` only if ALL hold, otherwise to `null` (guarded, never grantable, GO only):

1. Nothing between `docker` and `run`/`container run` (any global option: `-H`, `--host`, `--context`, `-c`, `--config`, `--tlsverify` ... means another daemon or config) and no `DOCKER_*=` assignment on the segment (`DOCKER_HOST=... docker run`, `env DOCKER_HOST=...`).
2. `--rm` is present.
3. Every token before the image is on the allow-list. The image is the first token that does not start with `-` and is not the value of a value flag. Everything after the image belongs to the container and is not read for flags.
   - Plain flags: `--rm -i -t -it -ti --interactive --tty --init -q --quiet --read-only` (the rule 16 set `DOCKER_FLAG`, 653).
   - Value flags: `-e --env -w --workdir --name --entrypoint --platform --memory --cpus -u --user --pull -l --label` (`DOCKER_VALUE`, 654), plus `--network` / `--net` ONLY with `none` or `bridge` (exact; `host`, `container:*`, any other value or a missing value is a deny).
   - `-v` / `--volume` (also `--volume=`, `-v=` is not special-cased) with a mount source that passes 2.3.
   - NOT allowed, so deny: `--privileged` in any spelling (`=true`), `--pid`, `--ipc`, `--uts`, `--userns`, `--network|--net host`, `--cap-add`, `--device`, `--security-opt`, `--mount` (any form, even a harmless one: its source cannot be judged cheaply), `--volumes-from`, `-p`/`--publish`, any other flag, bundled short flags with a value (`-itv`), an attached value (`-v/path`), `--rm=false`.
4. No shell expansion before the image: any `$` (not inside single quotes) or backtick in a token before and including the image. `$(...)` splits the segment in `scopesOf` (1329 `SEG_SPLIT`), which leaves a docker segment with no image: the existing "no image -> not covered" rule handles it. Consequence: `-v $PWD:/src` and `-v "$(pwd)":/src` are NOT covered; the caller must spell the absolute path.
5. The words after the image, split on whitespace like an opaque `sh -c` text, do not trip `catchAll(tok, seg, true)` (587-602): no `git push/reset/clean/branch/worktree/config`, `npm publish/version`, `gh <write verb>`, `rm -r`. So `docker run ... bash -c 'git push origin main'` and `docker run ... npm publish` are `null`. (`npm publish` is already `null` today through the non-opaque `catchAll`.)

### 2.3 Mount source (the part that decides what the container can touch)

Rule 16 learned that a deny-list of broad paths is bypassable (`/.`, `//Users/x`, case, symlinks, 663-675). So the container-test rule is an allow-list, the same one for read-only and writable mounts: the source (before the first `:`) must

- match `^/[A-Za-z0-9._ /-]+$`, contain no `//` and no `.` / `..` segment
- exist, be a DIRECTORY (so a socket, device or file is out), and its `realpath` (symlinks followed) must lie at least TWO levels inside the real home, with no segment starting with `.` and not under `~/Library`

This excludes, writable or not: `~`, `~/.claude`, `~/.gemini`, `~/.codex`, `~/.aos` (and `.aos/gate`), every dotdir, `/`, `/var/run/docker.sock` and its parents, a symlink into any of these, `~` / `$HOME` / `${HOME}` spellings (not absolute, or an expansion), and `~/<one level>`. A project directory such as `~/dev/bdb-dev/aos` or `~/projects/work` passes, read-write or `:ro`/`:rw`.

Stricter than approved (flagged, see Doubts): ro mounts of `~/.claude` etc. are also refused (the approved text says ro mounts stay "as rule 16 treats them"; rule 16 itself refuses them as a read-only RUN but does not guard anything). A top-level home dir (`~/dev`) is refused even writable.

### 2.4 Combination, cooldown, everything else

- Scopes are the union over the segments (`scopesOf`, 1339-1400) and `grantsCover` (1834) needs every scope covered. `docker ... && git push origin feat:feat` = `[container-test, push-feature]`; a `container-test` grant alone covers neither the push nor `; rm -rf x` (`destructive`). One uncovered `null` part makes the whole command GO-only (1382).
- `container-test` never covers push, merge, publish, destructive, github-write (those have their own scopes; they are separate segments).
- Cooldown (`analyzeDeletes(...).cooldown`, 2121; `scriptInto` 1111): only host-side script files can trigger it. `docker` is not in `FILE_HEAD` (1052), so a docker run never reads a script file and the cooldown neither blocks nor lifts it. A grant is not consulted while `cooling` (2130), which cannot happen for a docker-only command. Tested: a block earlier in the session does not stop a covered run.
- A plain GO (`goAllows`, 1621) still lifts any docker run; a `GO #n` PR GO does not (it covers only gh pr verbs).
- `mode off` / `hard` / `soft` unchanged; `hard` revokes the grant.
- Rule 16 / `isReadOnlyDockerRun` and `analyzeDeletes`' `ro` shortcut are unchanged.

## 3. Proposed code change (prose; not applied)

### 3.1 Git

- `GUARDED_PATTERNS` (74-106): one new entry next to the `alias.` one (94), built with `re(...)` so it also sees `bash -c '...'` and `env X=1 git ...` through `A`/`WRAP`:
  `git` + (optional `G` global options) + `commit` + anywhere in the same segment (`S`) a `--no-v...`, `--no-g...` flag or a short bundle with `n`; and `git` + `-c core.hooksPath` / `commit.gpgsign` / `--config-env=core.hooksPath` + `commit`. A pattern hit with no scope makes `scopesOf` return `null` (1383), which is what the inner-quote forms need (`classify` is not run on the inside of `sh -c "..."` for `commit`, because `GIT_VERBS` 587 has no `commit` and must not get one: it would guard every `bash -c 'git commit'`).
- `classify`, git branch (502-549): before `return []` at 548 add `if (sub === "commit") return commitBypass(config-keys, r, gitEnv) ? null : [];`. `commitBypass` works on the unquoted tokens: the flag tests of 2.1, the key test of each `-c`/`--config-env` (collect the keys in the option loop 505-522, where `config` is set today), a `$`/backtick word, `gitEnv`. This is the token-level authority; the pattern is the fast line and the quote-hidden case.
- `git config` (537-541): add `hookspath` to `PUSHY_CONFIG` (487) so a write returns `null` through the existing read/write split; the read forms (`--get`, `--list`, single argument) stay `[]`.
- Taint: unchanged (`commit`/`add` are not in `TAINT_SUBS`, 1331).

### 3.2 Docker

- `SCOPES` (114): append `"container-test"`. `parseGogateArgs` (1715-1729), `go-grant.mjs` and `effectiveGate` pick it up with no change (they only test `SCOPES.includes`). Add the scope to the text lists in the gogate skill / docs that enumerate scopes (not checked here).
- New `dockerRunScopes(tok, seg)` next to `isReadOnlyDockerRun`, reusing `DOCKER_FLAG` / `DOCKER_VALUE`, `unqQ`, `words`, and the existing `$` expansion test (698). Refactor `roMount` (663) into `mountSource(src)` (the regex + `realpath` + depth + dot + Library checks) plus the `:ro` part, add the `isDirectory()` check, and call `mountSource` from both so rule 16 behaves exactly as now.
- `classify` (493-581): new branch `if (cmd === "docker")` after the `gh` branch (578) and before the `push|publish` line (579): not `run`/`container run` -> `[]` as today (docker ps/build/exec/compose unchanged); else `catchAll(tok, seg) ? null : dockerRunScopes(...)`, which returns `["container-test"]` or `null`. The `DOCKER_*=` prefix and global-option checks (2.2 rule 1) go there, because `stripPrefix` drops the assignments and options.
- `catchAll` call over the words after the image with `opaque = true` (2.2 rule 5).
- No change to `analyzeDeletes`, `isGuardedCommand`, `grantsCover`, `main`.

### 3.3 Existing tests to re-check

Any existing test that asserts `docker run ...` has scopes `[]` or is allowed without a GO (rule 16 tests, TEST_HINT tests that mention the container) changes with 3.2; run the full suite after the edit. Not checked here (no grep available in this task).

## 4. Case table (mirrors the test file)

Legend: `[]` = no scope, allowed; `CT` = `["container-test"]`; `null` = guarded, GO only. P = project dir two levels inside home, H = home.

### 4.1 Git

| Command | Expected | Passes today? |
|---|---|---|
| `git add .` / `git add -A` / `git add a b` | `[]` | yes |
| `git commit -m x` / `-am x` / `--amend` / `--amend --no-edit` / `--allow-empty` / `-S` | `[]` | yes |
| `git -C P commit -m x`, `git -c user.name=x commit -m x` | `[]` | yes |
| `git add . && git commit -m x`, `cd P && git add . && git commit ...` | `[]` | yes |
| `git config core.hooksPath`, `git config --get core.hooksPath` | `[]` | yes |
| `git commit --no-verify -m x`, `-m x --no-verify` | `null` | no |
| `git commit -n -m x`, `-nm x`, `-anm x`, `--no-ver -m x` | `null` | no |
| `git commit --no-gpg-sign -m x` | `null` | no |
| `git -c core.hooksPath=/dev/null commit -m x` (also attached `-ccore...`, `CORE.HOOKSPATH`, quoted, `--config-env=`) | `null` | no |
| `git -c commit.gpgsign=false commit -m x` | `null` | no |
| `git commit '--no-verify' -m x`, `git "commit" --no-verify -m x`, `git commit $FLAGS -m x` | `null` | no |
| `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath ... git commit -m x` | `null` | no |
| `git config core.hooksPath /dev/null && git commit -m x` | `null` | no |
| `bash -c 'git commit --no-verify -m x'`, `sh -c "git -c core.hooksPath=... commit"` | `null` | no |
| `git add . && git commit --no-verify -m x`, `env X=1 git commit --no-verify -m x` | `null` | no |

Hook: plain add/commit allowed with no GO and no grant (passes today); bypass blocked even with a `container-test` grant, allowed after a GO.

### 4.2 Docker, covered (`CT`)

`docker run --rm -v P:/src node:24 bash -c 'npm test'`; same with `:rw`, `:ro`, `--volume P:/src`, `--volume=P:/src`; no mount; the listed value flags; `--network none`, `--network=bridge`, `--net bridge`; `docker container run`; with `2>&1 | tail -20`; arguments after the image such as `npm test -- --privileged` or `-v /var/run/docker.sock:/s` (container arguments).

### 4.3 Docker, never covered (`null`)

No `--rm`, `--rm=false`; `--privileged`, `--privileged=true`; `--pid=host`, `--pid host`, `--pid=container:x`; `--network|--net host` (all four spellings), `--network container:x`; `--ipc host`, `--userns host`; docker.sock via `-v`, `--volume=`, `:ro`, `--mount`; any `--mount`, `--mount=`; `--volumes-from`; `--cap-add` (two spellings); `--device`; `--security-opt` (two spellings); bundled `-itv`; attached `-vP:/src`; mounts of `H/.claude`, `.gemini`, `.codex`, `.aos`, `.aos/gate`, H, `H/`, `/`, `//./` and `..` spellings, a symlink to `~/.claude`, `~`, `$HOME`, `"$HOME"`, `${HOME}` spellings (with and without `:rw`, `--volume`); `$FLAGS` before the image, `"$IMG"` as image, `-e KEY=$SECRET`, `-v $PWD:/src`, `$(echo --privileged)`, `"$(pwd)"` mount, backticks, `-e "X=$(id)"`; `docker -H ...`, `--host=`, `--context`, `DOCKER_HOST=` prefix, `env DOCKER_HOST=`; `bash -c 'git push origin main'`, `npm publish`, `sh -c 'gh pr merge 5'` inside the container.
Stricter-than-approved group: `:ro` of `H/.claude`, `:ro` home, `H/projects` (depth 1), `-p 8080:80`, a missing mount source.

### 4.4 Unchanged

`docker ps|images|build|exec|compose up|logs|pull`, `git status`, `ls` -> `[]`. `isReadOnlyDockerRun` returns true/false exactly as before.

### 4.5 Combined (scopes)

| Command | Expected |
|---|---|
| `git add . && git commit -m x` | `[]` |
| `git commit -m x && git push origin feat:feat` | `[push-feature]` |
| `docker run <safe> ; rm -rf build` | `[container-test, destructive]` |
| `docker run <safe> && git push origin feat:feat` | `[container-test, push-feature]` |
| `rm -rf build && docker run <safe>` | `[container-test, destructive]` |
| `git add . && docker run <safe>`, `docker run <safe> && git commit -m x` | `CT` |
| `docker run --rm --privileged node:24 true ; rm -rf build` | `null` |
| `git commit --no-verify -m x && docker run <safe>` | `null` |

### 4.6 Grant semantics (hook)

| Situation | Expected |
|---|---|
| no grant, covered run | blocked; allowed after GO |
| `container-test` grant active, any covered run | allowed (also with `2>&1 \| tail`) |
| same grant: push (feature or main, force), merge, publish, version, `rm -rf`, gh issue create, gh release create, reset --hard | blocked |
| same grant: every unsafe docker run of 4.3 | blocked |
| same grant: `docker <safe> && git push <feature>` / `; rm -rf` | blocked |
| `container-test,push-feature` grant: `docker <safe> && git push <feature>` | allowed; `; rm -rf` still blocked until `destructive` is granted too |
| grant of any one of the six other scopes only | docker run blocked |
| expired container-test grant (15m typed an hour ago) | blocked |
| slash form `/bdb-aos:gogate grant container-test 2h` | ignored, blocked |
| grant typed by a loop prompt (not human) | ignored, blocked |
| `gogate hard` after the grant | blocked; `soft` does not restore; a new grant works |
| a block earlier in the session | covered run still allowed (no cooldown effect) |
| plain GO | any docker run allowed |
| `parseGogate('gogate grant container-test 2h')`, `SCOPES` includes it, `container-tests` is an unknown scope | as stated |

## 5. Doubts

1. `docker run` is unguarded today (section 1). Making it guarded is a tightening that Tim did not literally ask for: after this change a safe test run WITHOUT a grant needs a GO, and `docker run --privileged` needs a GO instead of nothing. If Tim only wants the unsafe forms guarded and safe runs free, the scope is pointless; tell me and the safe rows become `[]`.
2. Mount policy is the rule 16 allow-list (project dir at least two levels inside home), not the approved deny-list of five paths. That refuses `-v ~/dev:/x` and `-v /private/tmp/x:/w` (outside home), and any ro mount of a dot dir. Looser alternative: deny-list of `~`, its ancestors, `/`, the four dot dirs, docker.sock, plus realpath; the test group "stricter than approved" documents exactly what to relax.
3. `-v $PWD:/src` and `-v "$(pwd)":/src` are not covered (expansion rule). That is the most common spelling for test runs; the caller must pass an absolute path. Allowing `$PWD` alone would be a one-line exception if wanted.
4. `docker run ... bash -c 'rm -rf build && npm test'` (a delete INSIDE the container) is `null` because rule 5 reuses `catchAll`. Harmless in a container but the gate cannot tell a container delete from a host one in the same text; the existing `bash -c` handling grants `destructive` for it, so a `container-test,destructive` pair covers `...; rm -rf` outside but the inside form needs a GO. Say if the inner text should instead be classified and merged.
5. Git bypass detection is text-based: `git commit -m x $(echo --no-verify)`, a hook-disabling alias or a repo-local `core.hooksPath` already in `.git/config` are not seen (only the setter command is). Not asserted in the tests.
6. `GIT_*` prefix on a commit goes to GO (fail closed), which also hits harmless `GIT_AUTHOR_DATE=... git commit`. Narrowing to `GIT_CONFIG*` is easy; chosen wide for symmetry with `unsafe` in push (525).
7. `-c` with a non-hook key (`-c user.name=x commit`) stays free; the approved text names only hook bypasses. `commit.gpgsign=false` is treated as a signing bypass because `--no-gpg-sign` is.
8. Container pushes: a mounted project holds `.git` with remote URLs and possibly credential helpers, so a container with network can push. Rule 5 only reads the command text; a script file inside the project that pushes is invisible (same limit rule 16 documents).
9. `docker compose run`, `docker exec`, `docker build` stay free as today (not parsed). `docker compose run` can mount anything; out of scope, flagged only.
10. Not run: this task had no shell, so neither the current-behaviour list nor the new tests were executed. Expected today: the 4.1 "no" rows fail; every docker `CT`/`null` assertion fails (`docker run` classifies as `[]` today); the container-test scope/parse tests fail; the `[]` rows, rule 16 pins, and `npm publish` inside docker pass. Run `node --test tests/go-gate-container-test.test.js` before and after.
