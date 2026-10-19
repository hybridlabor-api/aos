# One port and the discovery file

The AOS Hub (`127.0.0.1:7900`, supervised by launchd/systemd) is the single address for the local tools.
The tools' own ports keep working.

## Prefixes

| Prefix | Upstream | Browser pages under the prefix |
|---|---|---|
| `/canvas` | plan-canvas `:4519` | proxied (`safe`), honours `X-Forwarded-Prefix` |
| `/memb` | memB `:8088` | redirect to `:8088` (see "Changes other repos need") |
| `/synapse` | Synapse `:7781` | redirect to `:7781` (see below) |
| `/trail` | first live agenttrail map (`5330-5344`, `5350`); `/trail/<port>/...` picks one | redirect to the map's own port until agenttrail is prefix-safe |
| `/store` | the hub's own Store tab | redirect to `/?tab=store` |

Non-navigation requests (curl, API clients, fetch) are always proxied. Navigations (`Sec-Fetch-Mode: navigate`)
to a route that is not `safe` get a 302 to the tool's own port.

Guards are the hub's: loopback peer, exact Host and Origin, Sec-Fetch-Site, embed allowlist headers on hub pages.
Methods other than GET/HEAD need the hub token (`x-aos-hub-token`), which is not forwarded. Upstreams get
`Host` and `Origin` rewritten to their own origin. SSE streams through; no tool uses WebSockets.

## The `X-Forwarded-Prefix` contract

The proxy sets `X-Forwarded-Prefix` on **every** proxied request (any client-supplied value is overwritten).
Value: the public path prefix without trailing slash, for example `/canvas`, `/trail/5333`.

A tool that wants `safe: true` must, when the header matches `^/[a-z0-9-]+(/[0-9]+)?$`:

1. emit every root-absolute URL (`src`, `href`, `action`, `fetch`, `EventSource`, `Location`) with that prefix, or use relative URLs;
2. keep working unchanged when the header is absent (direct port access).

plan-canvas does this in `skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js` (`prefixResponse`):
HTML and JS bodies and redirect targets are rewritten on the way out. Its own page route is `/canvas/<key>`,
so through the hub it is `http://127.0.0.1:7900/canvas/canvas/<key>`.
When a tool is ready, set `safe: true` on its entry in `lib/hub/proxy.mjs` (`PROXY_ROUTES`).
For relative-URL tools the hub redirects the bare prefix (`/memb`) to `/memb/`.

## Changes other repos need

- **memB** (`src/frontend/app.js`): only two root-absolute URLs, `fetch('/api/nodes')` and `fetch('/api/edges')`.
  Make them relative (`fetch('api/nodes')`, `fetch('api/edges')`); `index.html` already uses relative `style.css` / `app.js`.
  Then set `safe: true` for `/memb`.
- **Synapse** (`web/`, Vite SPA): set `base: './'` in `vite.config.ts` so built asset URLs are relative; make the
  9 `'/api...'` fetches in `src/api/client.ts` and the 2 `'/assets/...'` image sources relative (or prefix them with
  `import.meta.env.BASE_URL`); `index.html` uses `/favicon.svg` and `/src/main.tsx` (rewritten by the Vite base).
  The Go server must serve the SPA at a trailing-slash root and its `/api` routes must not depend on the path prefix.
  Then set `safe: true` for `/synapse`.
- **agenttrail / hub / store**: being made prefix-safe by the UI-redesign worker with the same header contract
  (agenttrail uses root-absolute `/shared/*`, `/events`, `/world`, `/suggest`, `/spawn`, `/ask/*`, `/answer`, `/tree-of`).
- **AO 2.0**: stop hard-coding `:4519`; read the discovery file below.

## Discovery file `~/.aos/endpoints.json`

```json
{
  "schema": 1,
  "updated": "2026-10-19T12:00:00.000Z",
  "hub": "http://127.0.0.1:7900",
  "services": {
    "plan-canvas": { "url": "http://127.0.0.1:4519", "port": 4519, "pid": 123, "version": "1.1.0", "status": "up", "via": "http://127.0.0.1:7900/canvas" }
  },
  "agenttrail": [
    { "repo": "/abs/main/checkout", "url": "http://127.0.0.1:5333", "port": 5333, "pid": 456 }
  ]
}
```

- Service ids: `hub`, `gateway`, `plan-canvas`, `memb`, `synapse`, `ao`. `status` is `up|down|unknown`; `via` is the one-port URL or `null`.
- Default ports when nothing is recorded: hub 7900, gateway 7790, plan-canvas 4519, memb 8088, synapse 7781, ao 3101.
- **Writers**: the hub supervisor on every watch round (`lib/endpoints.mjs`, `patchFromRows`); plan-canvas and agenttrail
  maps upsert their own entry on start and mark it down / remove it on exit (`endpoints-lite` modules next to each skill),
  so the file is useful without the hub. All writes are atomic (tmp + rename) and merge per service id.
- **Readers** (`lib/endpoints.mjs`, `readEndpoints({ home })`, `urlOf(id)`) must tolerate a missing or broken file and unknown keys,
  fall back to the default ports, and treat an entry whose `pid` is not alive as `down` (the helper does this).
- The same document (normalised, defaults filled in) is served at `GET http://127.0.0.1:7900/api/endpoints` under the hub guards.

## Supervisor

`standard` and `full` profiles install the hub service; `aos update` adds it for existing installs with a one-line notice.
Settings -> "Supervisor (now: on|off)" turns it off (adds `hub` to `disabled`, unloads the service) or on (installs/loads it).
The watcher never touches a service listed in `disabled` or excluded by the profile, and starts a service whose LaunchAgent plist
exists but is no longer loaded (the reboot case). `aos status` and `aos-doctor` show the supervisor state and the one-port URL.
