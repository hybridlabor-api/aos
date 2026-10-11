# P1B notes

Built:
- `spike0/sidecar-worker.mjs`: A2A sidecar that registers via `lib/a2a-registry.mjs` (`register`/`unregister`/`readToken`),
  skill id `build`, executor spawns `aos-acp.mjs opencode` with the user text in a temp prompt file under `spike0/run/`,
  publishes `working`, then an artifact with the last 40 lines of the child's stdout/stderr, and completed/failed per exit code.
- `spike0/send.mjs`: token fallback to `readToken(name)` when the JSON entry has none; proxy env stripped for loopback;
  request timeout raised (env `SEND_TIMEOUT_MS`, default 360 s) so a real worker task can finish.
- `spike0/checks/p1b.sh`: full check — registry dirs, git-clean testdir, ~/.config/opencode and worktree checksums,
  registry files removed after stop, per-assertion PASS/FAIL, non-zero exit on failure.

Assumptions / open points:
- `aos-acp`'s `--log` writes `acp.jsonl`; the "last 40 lines" artifact uses the spawned child's captured stdout+stderr
  (aos-acp's own stdout), not the jsonl contents.
- The registry JSON no longer carries the token, so `send.mjs` relies on `readToken`; the phase-0 echo sidecar still
  writes the token inline, and the fallback only kicks in when absent.
- `register()` already writes the `.token` file, so the worker relies on that (no duplicate write).
- Not run: per instructions the orchestrator runs `checks/p1b.sh`.
