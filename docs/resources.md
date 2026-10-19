# Resource efficiency

Idle AOS must stay small enough to run next to a browser, an IDE and several agent sessions on a 16 GB machine.
`aos doctor --resources` checks it; this page holds the targets and the mechanisms behind them.

## Acceptance targets

Idle = gateway + hub supervisor + one agenttrail map + plan-canvas, no agent sessions.

| Check | Target |
|---|---|
| AOS processes | <= 12 |
| AOS resident memory (RSS) | <= 700 MB |
| Orphans | 0 |
| Duplicate MCP servers | 0 |
| Idle CPU (AOS processes, summed, averaged over 10 s) | < 2% of one core |

The numbers are the owner's starting point (measured on 8 cores / 16 GB: 79 node processes, about 3.6 GB). Tune them
only with a measurement from a real idle machine.

## `aos doctor --resources`

```
aos doctor --resources [--sample <seconds>] [--json]
```

- Read-only. macOS/Linux: `ps -axo pid=,ppid=,rss=,time=,command=`. Windows: `Get-CimInstance Win32_Process` through PowerShell.
- A process is AOS-owned when its command line carries an AOS marker (`~/.agents`, `aos-gateway`, `aos-a2a`,
  `aos-hub`, `plan-canvas`, `agenttrail`, `@1mcp/agent`, `~/.gemini/config/mcps`, npx cache) or when it descends from one.
- Orphans: an a2a sidecar whose `--parent-pid` is gone; a daemon (gateway, hub, plan-canvas, agenttrail) running from a
  worktree or temp directory (a leaked test server); any other owned process whose parent is gone (ppid 1 / missing).
- Duplicate MCP servers: the same MCP command line running more than once, or several a2a sidecars of one parent process.
  `mcsc` is deliberately per session and shows up here; that is expected until its depth env is made shareable.
- Idle CPU: two snapshots `--sample` seconds apart (default 10), cumulative CPU time delta of the owned processes.
  `--sample 0` skips it.
- Also warns when a legacy `~/.agents/mcp_config.json` (the old shipped template) exists: agy started in `$HOME` reads it as
  a workspace config and spawns every listed server beside the gateway. `aos update` moves it aside.
- Prints one `PASS`/`WARN` line per check with its target. Exit code is 0.

## What keeps the numbers down

- **One MCP layer.** Harness configs point at the gateway (`lib/gateway/harness.js`); servers in `GATEWAY_SERVERS` run once.
- **No npx wrappers.** `lib/gateway/npx-pin.js`: exact-version `npx -y pkg@x.y.z` servers are installed once into
  `~/.agents/gateway/mcp-pkgs` by `aos update`/gateway install and started as `node <bin entry>`. If the install fails, or in a
  test sandbox, the server stays on npx.
- **A2A sidecars die with their session.** A sidecar polls its `--parent-pid`; the newest sidecar of one harness process retires
  older siblings (`/clear`, resume and compact create a new session id in the same process). Ceiling: the parent check is
  `kill(pid, 0)`, so a reused pid keeps a sidecar alive until the next sibling takeover.
- **On-demand servers idle-exit.** agenttrail map: 30 min without a request, viewer or open question
  (`AOS_TRAIL_IDLE_MS`, `0`/`off` disables). plan-canvas: 30 min (`AOS_PLAN_CANVAS_IDLE_MS`). Under `AOS_TEST_SANDBOX` both default
  to 60 s so tests cannot leave daemons behind.
- **Supervised services never idle-exit.** `AOS_SUPERVISED=1` (or `--supervised` for the map; plan-canvas treats it as
  `AOS_PLAN_CANVAS_IDLE_MS=0`). A supervisor that starts a service must set it.
- **Single instance.** agenttrail probes `/whoami` per repo before binding; plan-canvas reuses `server.json`; both existed before.
- **Event-driven map.** agenttrail asks expire through one timer aimed at the next deadline (no 1 s tick); lane and sibling-board
  refresh run only while a viewer is connected and once on connect. trail-hub's 2 s rebuild tick became a 30 s safety net and
  identical models are not re-sent.

## Tests

- `tests/helpers/reap.mjs`: `spawnReaped()` starts a child in its own process group and kills the group when the test file ends.
  Use it for every daemon a test starts.
- `npm test` runs every `node --test` with `--test-timeout=120000` (needs Node >= 20.11).
- Tests never run `npm install -g` for real: the v5 step runner and the installer skip it under `AOS_TEST_SANDBOX=1`.
