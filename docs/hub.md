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
aos hub open --tab services   # start if needed, then open the browser on a tab
aos hub --help       # usage, side-effect free
```

Options: `--port N` (default 7900), `--tab ID` (the tab to open), `--no-open`
(also `AOS_NO_OPEN=1`). `--serve [--watch]` is for service managers: it serves
in the foreground, and with `--watch` also supervises the other services; it
exits 3 when the hub's code changed on disk so the service manager restarts it
on the new code. `AOS_HUB_HOME` moves the state directory. Exit codes: 0 ok
(also `status` when the hub is down), 1 port in use, did not come up within
5 s, or `stop` could not verify the process, 2 unexpected error. Full spec:
`docs/cli-reference.md`.

The hub binds to 127.0.0.1 only, default port 7900 (`--port` overrides). It
writes `~/.aos/hub/hub.json` (mode 600, dir 700) with pid, port, version and
token. Nothing runs at login; the hub exists only while it is needed.

## Tabs

- **Plans** — plan-kit sessions and the linked agenttrail map (linked, not embedded).
- **Services** — status of every local service with start/stop/restart and log tails.
- **Store** — the AOS store (browse, preview, install, rollback).
- **Catalog** — read-only list of every skill, agent, command and MCP.
- **Router** — which agent takes which role.

## Services from the CLI

```bash
aos services status [--json]
aos services start <id>
aos services stop <id> --confirm <id>
aos services restart <id> --confirm <id>
```

Only start/stop/restart need the typed confirm; `status` is always free.

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

## Troubleshooting

**OpenWiki "down" or "Wikis: none yet".** OpenWiki is a launchd interval job
(every 2 h): loaded but idle shows as *scheduled*. The Wikis list reads
`~/.openwiki/projects.json` and scans `~/dev` (four levels) for `.openwiki`
directories, relative to the home of the user the hub runs as
(`AOS_HUB_HOME` overrides it). If repos live under another home, run
`aos hub restart` from the account that owns them.
