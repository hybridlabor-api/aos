# AOS Hub

The AOS Hub is the single local web page for everything AOS runs on demand:
the services table (memB, Synapse, AO, OpenWiki, RemoteOS, store, ...), the
plan-kit overview and the store browser. It replaces the old
`bin/aos-dashboard.mjs` HTTP server — that binary is now a thin alias that
starts the hub on the same port.

## Starting and controlling

```bash
aos hub              # start on demand (default: start + open the browser)
aos hub status       # check if it is running (also --json)
aos hub stop         # stop it
aos hub restart      # stop, then start again
aos hub --no-open    # start without opening a browser
```

The hub binds to 127.0.0.1 only, default port 7900 (`--port` overrides). It
writes `~/.aos/hub/hub.json` (mode 600, dir 700) with pid, port, version and
token. Nothing runs at login; the hub exists only while it is needed.

## Tabs

- **Plans** — plan-kit sessions and the linked agenttrail map (linked, not embedded).
- **Services** — status of every local service with start/stop/restart and log tails.
- **Store** — the AOS store (browse, preview, install, rollback).

## Services from the CLI

```bash
aos services status [--json]
aos services start <id>
aos services stop <id> --confirm <id>
aos services restart <id> --confirm <id>
```

Only start/stop/restart need the typed confirm; `status` is always free.

## Plan canvas as a Windows service (text only)

`lib/hub/services-win.mjs` is the Windows mirror of the macOS `com.bdb.plan-canvas` LaunchAgent. Pure functions, no spawn or fs writes:

- `buildPlanCanvasTaskXml({ nodePath, scriptPath, workingDir })` returns Task Scheduler XML: starts `node <script> server` at logon, restarts on failure (1 min, 999x), no time limit.
- `parsePlanCanvasTaskXml(xml)` reads those fields back.
- `schtasksArgs(action, { xmlPath })` returns constant `schtasks` argument lists (create, start, stop, delete, query).
- `parseSchtasksStatus(output)` returns `{ installed, running, status }` from `schtasks /Query /FO LIST /V`.

Paths must be absolute Windows paths without quotes, newlines or control characters; everything is XML-escaped. Registration is not wired into the installer yet.

## Security model

- Loopback only: the hub listens on 127.0.0.1 and never on 0.0.0.0.
- Exact Host: only `Host: 127.0.0.1:<port>` (or localhost variants) is accepted; anything else gets 403.
- Origin/Same-Site: cross-site POSTs are refused (Origin check, same-site mode rules) — a foreign page cannot post to it.
- Token: mutating actions need the per-process token from `hub.json` (sha256-compared, sent in `x-aos-hub-token`).
- Typed confirm: destructive or install actions must repeat the target id or name in a `confirm` field (CLI: `--confirm <id>`).
- No secrets: log tails are redacted and the hub never stores or displays API keys or tokens.

## Notes

- On-demand start: `aos hub` probes `/api/health` first; if the hub is already running it only opens the browser.
- agenttrail is linked, not embedded: the Plans tab deep-links to the trail's own port.
- The hub performs no GO actions and no pushes; gates (gogate) stay CLI-side.
- Shell-free everywhere: probes and control use spawn with an args array (`shell:false`); args never become commands.
