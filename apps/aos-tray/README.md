# AOS App (v0.1, unreleased)

A desktop companion for AOS. It sits in the Windows taskbar tray and the macOS menu bar, so
you can install, update, repair, check and configure AOS without a terminal. It is a Tauri v2
app: a Rust backend and a small static web UI, built as one binary per OS.

The tray does not reimplement AOS. It runs the existing AOS CLIs and reads the same files
they use.

## What it does

**App window.** One window with a dark sidebar. All strings exist in English and German
(Settings > Language; the default follows the system language). Closing the window hides it;
the tray icon stays. Quitting stops only the app, never the AOS services.

| Screen | What it shows or does | Backed by |
|---|---|---|
| Home | Installed version and update state, services up/down, doctor results on demand | files below, `aos services status --json`, `aos doctor --json` |
| Store | Opens the hub in a separate in-app window; lists installed skills and packs | `aos-hub start --no-open`, port from `~/.aos/hub/hub.json`, `~/.agents/skills/*/SKILL.md`, `aos store packs` |
| Services | One row per service with Restart (typed confirm); gateway upstream health with add/remove of a shipped server | `aos services status --json`, `aos services restart <id> --confirm <id>`, `aos-gateway status --json`, `aos-gateway add/remove <server>` |
| Projects | Every repo under the workspace root: name, slug and domain from `.aos/project.json`, wiki present, git changes. Read-only | `workspaceRoot` in `~/.agents/aos-config.json`, `git status --porcelain` |
| Secrets | Names and set/empty state of `~/.aos/secrets.env`; set or remove a value | file, same format as `lib/mcp-secrets.js` |
| Settings | Language, install/update/repair, the `~/AGENTS.md` editor, read-only router and memory views | `npx`/`aos repair`, file, `aos-router show --json`, `aos memory list` |

When a CLI answer does not parse as JSON, the screen shows the raw text instead of an empty card.

**Tray / menu bar menu.** Status lines (version, update, services), Install or Repair, Update,
Run doctor, Open Store, Open AOS, Quit. The tray tooltip is the status light: it carries the
one-line service state. The status refreshes every 60 seconds and after each action.

### CLI calls

Every call is an entry of the `Action` enum in `src-tauri/src/cli.rs`. Each entry has a fixed
argv, and the flags come from `docs/cli-reference.md`.

| Action | Command |
|---|---|
| Install | `npx -y @hybridlabor-api/aos@latest --yes` |
| Update | `npx -y @hybridlabor-api/aos@latest update --yes` (`aos update` alone re-runs the installed package) |
| Repair | `aos repair --yes` |
| Status | `aos services status --json`, `aos-gateway status --json` |
| Doctor | `aos doctor --json` |
| Gateway | `aos-gateway add <server>`, `aos-gateway remove <server>` |
| Services | `aos services restart <id> --confirm <id>` (id from a fixed list) |
| Store | `aos-hub start --no-open` |
| Read-only | `aos store packs`, `aos memory list`, `aos-router show --json`, `aos-hub open --tab services\|store` |

The tray runs "aos" as `node <packageRoot>/installer.js`, and the other CLIs as
`node <packageRoot>/bin/<cli>.mjs`. It does not use the npm shims, so these calls involve no
`cmd.exe` on Windows. The exceptions are Install and Update: they run `npx`, which on Windows
is `npx.cmd`. Rust starts a `.cmd` file through `cmd.exe`. Their arguments are constants, so no
user input reaches that command line. `packageRoot` comes from `~/.agents/lib/.aos-package-root.json`, which the
installer writes. The tray only trusts that path if `package.json` there is named
`@hybridlabor-api/aos`.

### Files read

- `~/.agents/lib/.aos-package-root.json`: package root.
- `<packageRoot>/package.json`: installed version. If that is missing, `~/.agents/.bdb-manifest.json`.
- `~/.aos/cache/versions.json`: latest npm version, cached by the CLI's own update check (24 h). The tray never contacts npm itself.
- `~/.aos/v5-settings.json`: profile, disabled packages and update mode (display only).
- `~/AGENTS.md`, `~/.aos/secrets.env`: the two editors.

The hub token in `~/.aos/hub/hub.json` is never read.

## Security model

- **No shell, fixed argv.** Commands run through `std::process::Command` with constant
  arguments. The one shell on the path is `cmd.exe` for `npx.cmd` on Windows (Install and
  Update), and its arguments are constants too. The only value from the UI that can reach an argv is a gateway server name, and it
  must be one of the shipped `GATEWAY_SERVERS` (`lib/gateway/config.js`). Every name in that
  list is checked against the list, so a leading `-` is impossible.
- **Native confirmation for every change.** Install, update, repair, gateway add/remove,
  saving AGENTS.md and setting or removing a secret each show an OK/Cancel dialog. The dialog
  is opened from Rust, and its text is built in Rust, so the web UI cannot skip it.
- **Never as administrator/root.** A state-changing action is refused when the tray runs
  elevated. On Windows, a successful `%SystemRoot%\System32\net.exe session` means elevated; on
  macOS, `/usr/bin/id -u` returning 0 does. The tools are called by absolute path, the same
  probe as `lib/executable-probe.js`. The Windows installer is per-user (NSIS
  `installMode: currentUser`).
- **One action at a time.** A second change while one runs is refused. The background refresh
  skips while a change is running.
- **Child processes:**
  - stdin is `null`, so a prompt cannot hang the tray.
  - Each action has a timeout (30 min for install/update/repair). On timeout the whole process
    tree is killed: `taskkill /T` on Windows, the process group on macOS.
  - Output collection is bounded too, so a service the CLI leaves running cannot block the tray.
  - No console window opens on Windows.
- **Secrets:**
  - Values never go back to the UI. It only gets names and whether each has a value, so they are masked and cannot be revealed.
  - Values are never logged, and never appear in a dialog.
  - Writes go to a new temp file (mode 600 on macOS) that is renamed over `secrets.env`. The temp file is created exclusively, so a pre-existing path is never followed.
  - If `~/.aos` is missing, it is created with mode 700. An existing directory keeps its mode.
  - On macOS a file readable by group or others is refused, as the CLI refuses it.
  - A symlinked `secrets.env` is refused.
  - Values with line breaks are rejected. The file is capped at 64 KiB.
- **AGENTS.md:** a save is refused if the file changed on disk since it was loaded, for example
  because an AOS update rewrote its managed blocks. Before each save the old file is copied to
  `~/.aos/backups/aos-tray/`, and the last 10 copies are kept. A symlinked `~/AGENTS.md` is
  written through to its target, so the link stays.
- **Hub window without IPC.** The store window (label `hub`) loads `http://127.0.0.1:<port>/`. It is not listed in `capabilities/default.json` and no capability has `remote` URLs, so the hub page cannot call any app command (a unit test checks this). Navigation is pinned to the hub origin. The hub keeps its own per-start token and Origin checks; the app never reads the token.
- **Service restart.** The UI enables Restart only after the service id is typed; Rust checks the typed id again and against a fixed id list, shows the native dialog, and the CLI checks `--confirm <id>` itself.
- **Projects are read-only.** The scan reads folder names, `.aos/project.json`, and runs `git status --porcelain` per repo (no shell, 15 s timeout).
- **No telemetry, no network** of its own. The web UI uses a strict CSP and only `core:default`
  Tauri permissions; all data is rendered with `textContent`.

## Build

Requirements:

- Rust stable.
- Node.js 20+, for the Tauri CLI via npx.
- On Windows, WebView2 (preinstalled on Windows 10/11).

Commands, from `apps/aos-tray/`:

```sh
npx --yes @tauri-apps/cli@2.12.4 icon src-tauri/app-icon.png   # generates src-tauri/icons/
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --lib   # unit tests (no Tauri)
npx --yes @tauri-apps/cli@2.12.4 build                         # installers in src-tauri/target/release/bundle/
```

On Windows the build produces an NSIS `.exe` and an `.msi`. On macOS it produces a `.app` and a `.dmg`.

CI: `.github/workflows/aos-tray.yml` runs the same steps on `windows-latest` and `macos-latest`.
It runs on manual dispatch and on changes under `apps/aos-tray/`, and uploads the installers as
artifacts.

The unit tests cover the pure logic:

- argv building and the server allowlist;
- version comparison, ported from `lib/update-check.js`;
- parsing of the settings and CLI JSON;
- reading and writing the secrets file, with round-trips and permissions;
- the AGENTS.md backup and conflict check;
- the workspace scan, `.aos/project.json` parsing and the hub navigation rule.

UI logic and the English/German string tables are tested with `node --test test/` (from `apps/aos-tray/`), also in CI.

## Limits (v0.1)

- **Unsigned builds.** Windows SmartScreen and macOS Gatekeeper warn on first start. On macOS,
  right-click > Open, or remove the quarantine attribute.
- **Node lookup.** On macOS a GUI app does not get the shell `PATH`. Node is looked up on `PATH`,
  `/opt/homebrew/bin` and `/usr/local/bin`; nvm/fnm/volta installs are not found.
- **Restrictive permissions are not enforced on Windows.** There, `secrets.env` inherits the
  ACL of the user profile.
- **"Update available" uses the CLI's cache.** It is only as fresh as the CLI's last update check.
- **Linux is not packaged.**
- **No `Cargo.lock` is committed yet.** CI uploads the resolved lock as an artifact, so it can be committed later.

The app is not part of the npm package: `apps/` is not in `package.json` `files`. Its version
(`0.1.0`) is independent of the AOS release version.
