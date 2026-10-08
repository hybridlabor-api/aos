# go-gate residuals (Opus recheck 10 PASS, 2026-10-08)

The gate guards against agent mistakes; it is not a sandbox. Known, accepted gaps:

- zsh `alias -g`, `noglob` and `nocorrect` are not modelled.
- `find -exec rm` is GO-guarded only, not a hard block.
- `xargs rm` with visible flags is grantable.
- D1 free-list stays free: `$X --version`, `echo$x`, `$EDITOR file`, `"$HOME"/bin/tool`, `[ -f x ]`.
- Brace expansion with more than 64 results (incl. empty-element padding of a hard target) is GO-guarded, not hard.
- Words over 4096 chars that contain a brace group are GO-guarded.
- Heads glued to a guarded-program prefix (`b$X`, `s$X`) are GO-guarded (false block, plain GO).
- `case $f in *.js|*.ts)` needs a GO.
- Backslash-escaped braces and `\${` are not modelled.
- Brace groups inside `${...}` are expanded although bash does not (over-guard).
- Zero-padded sequences `{01..03}` are not padded (no effect on verdicts).
- `hardBlockReason` has no CPU budget; bounded by MAX_COMMAND (16 KB) and the brace iteration (256) and result (64) caps.
## FIFO / huge-file hardening (c9e013bf) and click receipts (WP-9)

- Every read on the decision path is a bounded regular-file read (O_NONBLOCK + fstat); transcript scans fail closed (`SCANLIMIT`: 1 GiB forward, 512 MiB reverse, 64 MiB per line, 20 s per scan and per hook call). A legitimate transcript above 1 GiB makes the forward scan deny (or issue no go-token); the reverse scan for the last user message is lazy, normal sessions are unaffected.
- `git symbolic-ref` calls in `makeBranchResolver` have 2 s timeouts each, cached per remote, but no overall cap (needs soft mode, a push-feature grant and planted FIFOs).
- sqlite (OpenCode) sidecar check is check-then-open; a FIFO planted between the check and sqlite's open can still hang that read.
- A planted non-regular block marker keeps the cooldown on permanently while the message says it ends in minutes (fail closed).
- Several FIFO tests only prove the hook terminates; the sparse-file test trips the line cap, not the byte budgets.
- Click receipts: the credential file `~/.aos/gate/trail-credential.json` is the only trust root (R1: code running as the user can plant its own key); a revoke file can be deleted (R2); the signature counter is not checked (R3); an agent could serve its own page on the hub port (R4).
- The hub must keep fewer than 32 click receipts per session key; after a trail revoke, clicked grants stay inert until the human types `gogate soft`; go receipts ignore a typed `gogate hard` (like GO tokens); request records offer the click during a cooldown that the gate still refuses.
- Codex has no enforceable file-write guard and it is unverified; agy argument names are unverified; `gh pr view` style read commands are blocked as unscoped.
- Used `.used` markers are never pruned by the gate; agy `x-` keys are not shown in the hub.
- Live `~/.claude/settings.json` keeps the old file-tool matcher (no NotebookEdit) until Tim runs the installer.
- Optional hardening (L1): drop exactly-empty brace results in `expandBrace` so `{rm,-rf,~,` + ~62 commas + `}` stays a hard block.
