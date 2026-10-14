# Pulse demo driver

Fictional 36 s "live build" for a screen recording of the agenttrail board. Node >= 20, no dependencies.

```bash
# 1. create the demo repo (absolute path, no username in it)
node driver.mjs --setup --dir /tmp/pulse-demo

# 2. start the board on that dir with its plan (separate terminal)
aos-trail /tmp/pulse-demo --plan PLAN.md --no-open

# 3. replay, then record the board
node driver.mjs --dir /tmp/pulse-demo [--duration 36] [--speed 1] [--port 5350]
```

- Preview without side effects: `node driver.mjs --dry-run` (50x, temp copy of the plan, no POSTs).
- Check: `node --test`.
- Duration: 36 s at `--speed 1`; a burst of activity around 20-25 s; all tasks done in the last second.
- Re-run: `--setup` again resets PLAN.md in an existing demo dir; it never deletes anything.

Ignore:
- Everything is invented (product, people, agents' work). Files like `src/engine/clock.ts` are never created.
- Event POST failures are silent by design; the exit code stays 0 with no board running.
- The "needs a GO for the release tag" message is fiction, not a real gate request.
