# p2b — Claude Code "live peer" spike

- `sidecar-live.mjs`: A2A sidecar that on each inbound message writes `$AOS_A2A_INBOX/<name>/<taskId>.json` (0700 dir, 0600 file), publishes `working`, waits up to 300 s for `<taskId>.reply`, then publishes an `answer` artifact and `completed` (timeout → `failed`). Reuses `@a2a-js/sdk` 1.3.0 via `node_modules` symlinks into `../spike0/node_modules`. Proxy env stripped, `NO_PROXY=127.0.0.1,localhost,::1`.
- `hook-drain.mjs`: UserPromptSubmit hook. Reads stdin JSON, lists pending `*.json` in `$AOS_A2A_INBOX/$AOS_A2A_NAME`, emits each as `additionalContext` in the exact required format, renames files to `.delivered`. Empty inbox → exit 0, no output.
- `reply.mjs <taskId> "<text>"`: writes `$AOS_A2A_INBOX/$AOS_A2A_NAME/<taskId>.reply` (0600), max 8 KiB.
- `testproj/.claude/settings.json`: registers hook-drain as UserPromptSubmit hook and allowlists exactly `Bash(node <abs>/reply.mjs:*)`.
- `checks/p2b.sh`: end-to-end check (sidecars, one real `claude -p` turn capped at 180 s, COMPLETED + artifact contains "5", `.delivered` rename, no new files under `~/.aos/go`, aos-wt-zielc untouched).

Doubts:
- `send.mjs` prints `state` as `TaskState[stateId]`, so the completed assertion expects the string `TASK_STATE_COMPLETED` (matches spike0/p1b behavior).
- Artifact assertion greps for `"5"` in the raw JSON; a chattier answer (e.g. "2+3 = 5") still matches, but "The answer is five" would fail — the prompt demands the number only.
- The negative GO leg sends a second message that is never answered; its task is left `working` and the sidecar is killed, so the sidecar's registry entry cleanup depends on SIGTERM handling.
- Hook output shape copied from `memb-inject.mjs` (`hookSpecificOutput.additionalContext`); the `<your answer>` placeholder is left literal since the answering agent supplies its own text.
