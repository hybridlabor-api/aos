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
- Optional hardening (L1): drop exactly-empty brace results in `expandBrace` so `{rm,-rf,~,` + ~62 commas + `}` stays a hard block.
