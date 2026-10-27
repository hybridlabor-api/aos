# The update engine as of 5.3.0

How `aos update` decides what to touch, why a second run is cheap, and how a
failed run is retried. Every claim cites the code or the commit that carries it.

## The plan: `planUpdate` (`lib/v5/menu.js`)

`update()` no longer mutates first and reports second. It first builds a plan
via `planUpdate(host, o, { rows, vs })` (lib/v5/menu.js:273), one row per
component: `kernel`, `harnesses`, and every registered package. Each row is
`{ id, name, changed, reason }`. The plan phase was introduced by
`feat(update): diff-based plan phase and gating for kernel and packages`
(359a005f, in the release/5.2.2-bundle merge PR #167).

Decision order per component (lib/v5/menu.js:283-393):

1. `--force` marks everything `changed` with reason `forced` (food for `aos
   update --force`; see below).
2. The kernel row is `changed` when the installed kernel version differs from
   the running package version, is missing, or is a retry of a failed run.
3. If the kernel is current and no failed run is pending, hash-based drift
   detection runs (`detectManifestDrift`, lib/v5/menu.js:243) and can still
   flip the kernel row to `changed` with a `missing <file>` / `modified
   <file>` reason (cba4d381 introduced the drift part).
4. Packages follow their `p.plan()` hook when the package defines one;
   otherwise the plain outdated check, with `alwaysUpdate` packages reapplied
   after a kernel/harnesses change (baaf9e3e) and verify-failed packages
   planned as `broken (...)` (9860dfe).

## Drift detection is scoped on purpose

The drift hash table is the install manifest
(`~/.agents/.bdb-install-manifest.json`, lib/v5/menu.js:247). Two scope rules
stop false alarms (lib/v5/menu.js:257-259):

- only manifest entries whose recorded `version` matches the *installed
  kernel's* version are checked, so entries written by older releases or by
  test sandboxes are ignored (`d46f515`: "drift detection only counts files
  the installed kernel wrote, inside HOME");
- only paths under HOME are checked (`path.resolve(filePath).startsWith(
  path.resolve(home) + path.sep)`).

A missing file or a changed sha256 of one counted file is drift; the run then
re-applies so drift cannot become permanent.

## `--force` and the failed-run retry

`force` is accepted from the options object, from `o.argv` or from
`process.argv` (lib/v5/menu.js:280). Forced runs plan every component as
`forced` and skip drift/verify shortcuts.

Failure persistence lives in the v5 settings file (`~/.aos/v5-settings.json`,
lib/v5/profile.js:184; the owned keys are `lastRunFailed` and
`lastFailedSteps`, lib/v5/profile.js:88). `update()` writes
`lastRunFailed: true` plus the set of failed step ids on a broken run, clears
both on a clean current run, and deliberately keeps the flag when the run was
stale (lib/v5/menu.js:526-537; the sanitize path is 6315604). `aos repair`
reads `lastFailedSteps` and retries exactly those steps via `update`/`repair`
hooks (lib/v5/menu.js:542-573); the retry behaviour is 48be7d2 and the F5 test
landed in the `fix/repair-retry-failed` merges into integ/open-points (PR
#169).

## Idempotent gateway apply (`lib/v5/pkg-gateway.js`)

The gateway package's `update` is `apply(ctx, 'update')`. Before doing
anything it calls `upToDate(ctx, ...)` (lib/v5/pkg-gateway.js:174-185), which
compares the pinned 1mcp version on disk, the token format, the rendered
`mcp.json`, the presets ledger and the rendered service definition
(launchd plist / systemd unit / Windows VBS). When everything matches it
returns `unchanged: true` and only re-syncs harness entries
(lib/v5/pkg-gateway.js:265-269). "skip reinstall and restart when the gateway
is unchanged" is 9763d1c; "honor direct mode in update" is folded into
7a7cf51. On `direct` mode in v5 settings the harness-sync step is skipped
entirely (lib/v5/pkg-gateway.js:22-27). A real change re-runs
`npm install --prefix <gatewayDir> <pin>` and through `restartService` (lib/v5/pkg-gateway.js:201-249) restarts exactly
the service that is registered on that platform — launchctl kickstart with a
bootout/bootstrap fallback, `systemctl --user restart`, or Stop-Process plus
the Startup VBS on Windows. `restart only services whose package changed in
this run` is 6c23df8, implemented as the `changed` set passed to
`restartRunningServices` (lib/v5/menu.js:138-151): a service restarts only if
its package id is in `changed`, or if the kernel updated and the service has
no package id of its own (98ad8d4).

## Persisted gateway choice and the Settings -> Gateway menu

The gateway settings object `{ adopted, declined, promptedAt, mode }` is
persisted in v5 settings under the `gateway` key (written in
`adoptGateway`/`gatewaySettings`, lib/v5/menu.js:606-612; validated by
lib/v5/profile.js:134-149; "remember the MCP adoption choice" is 3fc846e).
Answering "none" to the adoption prompt no longer switches to direct mode
(6092eb3). The Settings menu exposes a Gateway sub-menu — status, choose,
enable (all), direct (restore), restart — when the gateway is installed
(lib/v5/menu.js:576-631, 640-649; "add gateway sub-menu for status, adoption,
and direct restore" is e8963a0).

## Single pins module

`lib/v5/pins.js` holds the two update cross-checks in one place:
`DEJA_VERSION` and `GATEWAY_1MCP_PIN` (lib/v5/pins.js:1-5; 0568986 "single
source for the deja and 1mcp pins"). `pkg-gateway.js` imports the pin for the
npm install check (lib/v5/pkg-gateway.js:14), `installer.js` imports the deja
pin for its global install.

## `AOS_NO_OPEN`

`update()`, `repair()` and the settings sub-flows set `process.env.AOS_NO_OPEN
= '1'` before doing anything (lib/v5/menu.js:399, 543, 698, 702, 809, 832), so
no browser tab opens during a headless update. The environment variable is
honoured by every browser-opener path: hub/dashboard/store-ui, plan-canvas,
agenttrail and archify (test suite: tests/update-no-browser.test.js). The
installer no longer generates a launchpad page; update and install remove the
old launchpad login item and page (`reverseLaunchpad`).

## Flow, in text

```
aos update
  |
  v
scan packages + check versions (npm view, short timeout)
  |
  v
planUpdate():
  kernel outdated? missing? failed run? manifest drift (kernel-written
  files only, under HOME only)? or --force -> plan Kernel row
  harnesses follow the kernel row
  each package: plan hook / outdated / broken / alwaysUpdate -> row
  |
  v
print Plan line (or "Everything is current")
  |
  v  for every row with changed=true:
Kernel update -> Harnesses update -> (secrets) -> gateway if needed
  -> packages: update, then verify, one repair/update retry, verify again
  |
  v
restart services whose package ran-and-changed (or no-package services
  after a kernel update; hub/gateway handled elsewhere)
  |
  v
record manifest for files the kernel wrote (even when stale), set or
  clear lastRunFailed / lastFailedSteps, print Verify summary + log path
```

On failure: run `aos repair`; it verifies every installed package and fixes
the ones whose step id is in `lastFailedSteps`.
