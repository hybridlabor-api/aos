# go-gate delete guard: status report

Branch `feat/gogate-delete` (local only), base `d08e7d0`.

## Rounds

| Round | Model | Commit | Result |
|---|---|---|---|
| Build | sonnet | 687b27e | A–K implemented; 1st attempt stopped by a block (heredoc patch, own rule violation), resumed with Edit/Write only |
| Review | sonnet | – | 3 blocking (cwd-relative targets, variable indirection, `~user`), 6 should-fix |
| Repair 1 | sonnet | d8cc247 | all review findings fixed; 8 gate test files 175/175 (verified by dispatcher) |
| Security check | opus | – | DO-NOT-SHIP against the stated goal; details below |
| Repair 2 (worker A) + aos-22 | sonnet | c45c48a | fail-closed, F-B2 regression, F-S1, F-S2, F-S4, Tim's policy, N3, known limits doc, npm view in loops; 8 gate test files 192/192 (verified by dispatcher) |

## Tim's decisions applied (2026-10-07)

- Worker B (coverage hunt for eval/awk/source/npm run/make) dropped. Documented as known limits in `docs/codex-gate-smoke.md`.
- No matcher extension beyond Bash; no blocking of transcript/token writes. GO forgery is a documented known limit; protection comes from step 1 (separate user / sandbox).
- HARD only for recursive delete/move of home, `/`, top-level home directories, home-level globs/braces, `chmod/chown -R` / `rsync --delete` onto those, and `~/.aos/{gate,go}`. Single files directly in `~` and dotfile overwrites need a GO (not liftable by a "destructive" grant).

## Status after repair 2

Fixed: F-B2, F-B4, F-S1, F-S2, F-S4, F-S7, N1 (now GO-required), N3, aos-22.
Open by decision: F-B1, F-B3 (partly), F-B5, F-S3, F-S5, F-S6, N2.
Remaining known gaps from the builder: `sed '1e rm -rf ~'` is unscoped (GO) but not HARD; `mv -t DIR` not parsed; `node --test <dir>` / `python3 <dir>` now unscoped.

## Opus security check: findings

### Blocking
- **F-B1** Home wipes classified `none`: shell indirection (`eval "$(printf …)"`, `$(which rm)`, `R=rm; $R`, aliases), inner shells (`fish -c`, `awk system()`, `find -exec sh -c`, `vim -c "!…"`, `ssh host "…"`), code fed from agent-written files (`cat f.py | python3`, `python3 - < f.py`, `node -r ./f.js`, `source f.sh`, `npm run`, `make`), python deletes via `Path.unlink/rmdir/rglob/os.walk`, `tar --remove-files`, `mv -t`, `gio trash`, `srm`.
- **F-B2** Regression from data blanking: `echo 'rm -rf ~' | tee /dev/null | sh`, `awk 'BEGIN{system("git push …")}'`, `sed -n '1e …'` are `none` on the branch, guarded on base.
- **F-B3** Grant-liftable misses: leading redirect/empty word (`>/dev/null rm -rf ~`), one variable hop in code (`const h=process.env.HOME; rmSync(h,…)`), un-normalised absolute paths (`/tmp/../Users/<u>`, `/System/Volumes/Data/Users/<u>`), brace expansion, `HOME=/; rm -rf ~/Users/<u>`, symlink to home in the same command, `xargs`.
- **F-B4** Script reading can hang before the hard check: `python3 /dev/zero & rm -rf ~`, FIFO script path. A hook timeout likely fails open.
- **F-B5** GO forgery by writing files (pre-existing): a fake "human GO" line appended to the agent's own transcript is accepted; token and grant files under `~/.aos` can be written via `cd ~/.aos && cp …`. Every non-HARD classification is therefore agent-liftable. Real fix needs a trust anchor the agent's uid cannot write.

### Should-fix
- **F-S1** Cooldown marker can be set to a future ts or deleted (`cd ~/.aos && echo … > gate/x.block`).
- **F-S2** Non-string `command` (array) fails open.
- **F-S3** Only the `Bash` matcher is gated; Monitor and MCP exec tools are not.
- **F-S4** Quadratic regexes (pre-existing): 40 KB inputs take 14–39 s, so padding can push a GO-required command past the hook timeout. HARD check stays fast.
- **F-S5** Missing wrappers: busybox, toybox, ionice, flock, chrt, unbuffer, watch, coproc, `while …; do`.
- **F-S6** ANSI-C quoting `$'…'` not decoded (unscoped, not HARD).
- **F-S7** Unliftable over-blocks on single regular files: `mv ~/.zshrc.bak ~/.zshrc`, `rm ~/file.txt`, `rm ~/.DS_Store`, `unlink`, `shred -u`.

### Nits
- N1 single-file overwrites (`: > ~/.zshrc`, `truncate`, `dd of=`, `ln -sf /dev/null`) are `none`.
- N2 `git -C ~ clean -fdx` only destructive.
- N3 missing space in package.json test script.

### Verified fixed (HARD, probe-observed)
cwd-relative targets, variable and `$(echo ~)` indirection, `~user`, `${HOME:-x}`, mv/rsync/chmod/rimraf on home, globs and braces on `~`, wrappers (exec, time, nohup, env, sudo, doas, timeout, nice, caffeinate, parallel), `\rm`/`/bin/rm`, CRLF, `IFS`, `HOME=/ rm -rf ~`, ruby/perl/pwsh/node/deno/bun forms, `node -r` with an analysable file. Control flow: hard block precedes GO/grant/mode/token in all four front ends; exceptions fail closed.

## Assessment

A pattern gate cannot be made complete: F-B1 is an open-ended list, and F-B5 means anything below HARD can be lifted by the agent itself. The gate is a tripwire, not a boundary. The boundary has to come from step 1 (OS-level sandbox / separate user / central `safeRemove` in AOS code) and from harness sandboxes (Claude `/sandbox`, Codex `sandbox_mode`).

## Repair plan (round 2, sonnet, sequential in this worktree)

1. **Fail-closed and regression first** (worker A): hard pass over the whole command before any file I/O; `isFile()` + bounded read for script files (F-B4); deny commands > 16 KB at the top of main (F-S4); non-string commands joined or denied (F-S2); no blanking when any later pipeline segment is a shell/interpreter, never blank awk/sed, catchAll on raw text (F-B2); future `ts` clamped, `cd …/.aos` + relative `gate/`/`go/` protected (F-S1).
2. **Coverage** (worker B, after A): F-B1 (stdin/`<`/`-`/`source`/`.`/`-r --require --import` modules read or unscoped; awk system, find -exec sh -c, fish/vim -c, ssh as inner shell; unresolved `$…` head with home-level arg → HARD; python `.unlink/.rmdir/rglob/os.walk`; tar --remove-files, mv -t, gio trash, srm), F-B3 (leading redirects, home expression anywhere + unreadable delete arg → HARD, path normalisation incl. `/System/Volumes/Data`, braces, assigned HOME, ln to home, xargs), F-S5, F-S6, F-S7 (single regular file at lstat → destructive), N3.

## Needs Tim's decision

- **F-B5** (GO forgery): short-term block writes to `~/.claude/projects/**/*.jsonl` and `~/.aos/{go,gate}` in every form; long-term trust anchor outside the agent's uid (separate OS user for agents, or keychain-prompted token).
- **F-S3**: widen the hook matcher beyond `Bash` (Monitor, MCP exec tools). This changes settings.json / installer hook registration.
- **F-S7 / N1 policy**: allow GO-liftable single-file ops on direct children of home; whether overwrites of dotfiles become HARD.
