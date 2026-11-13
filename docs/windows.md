# Installing and setting up AOS on Windows

This guide covers Windows 10 and 11. The installer runs the same steps as on macOS and Linux; the points below are the places where a Windows machine differs.

## Prerequisites

| Need | Why | Install |
|---|---|---|
| Node.js 22 or newer | The package declares `>=20`, but the doctor scripts use `node:sqlite`, which needs 22.5 or newer. | `winget install OpenJS.NodeJS.LTS` |
| Git for Windows | Hooks, the installer and several skills call `git` and a POSIX shell. | `winget install Git.Git` |
| uv | AOS uses it to create the memB venv and to start Python MCP servers. | `winget install astral-sh.uv` |
| Python 3.12 or 3.13 | memB needs onnxruntime, which has no wheels for the newest Python (3.15 today). memB installs on 3.10 to 3.14. | `winget install Python.Python.3.12`, or let uv install it |
| Windows Terminal and PowerShell 7 | Best rendering and UTF-8 handling for the installer UI and the status line. | `winget install Microsoft.WindowsTerminal Microsoft.PowerShell` |

Open a new terminal after each `winget install`: the PATH of a terminal that was already open does not change.

### Which Python does AOS pick

You do not have to change your default `python`. For memB the installer tries the `py` launcher for 3.13, 3.12, 3.11, 3.14 and 3.10 (in that order), then `python` on PATH, and ignores any interpreter newer than 3.14. If none fits and uv is available, uv installs Python 3.12 for the memB venv. If you installed Python 3.15 only, install uv and re-run `aos package install memb`.

### Where AOS looks for uv

AOS finds uv on PATH first, then in `%USERPROFILE%\.local\bin`, `%USERPROFILE%\.cargo\bin`, `%LOCALAPPDATA%\Programs\uv` and the winget folders `%LOCALAPPDATA%\Microsoft\WinGet\Links` and `%LOCALAPPDATA%\Microsoft\WinGet\Packages\astral-sh.uv_*`. A winget install therefore works even in a terminal that has not picked up the new PATH.

## Install

In PowerShell 7 (or Windows Terminal):

```powershell
chcp 65001
npx -y @hybridlabor-api/aos@latest
```

`chcp 65001` switches the console code page to UTF-8 so the box and status-line glyphs are not shown as `?`. To make it permanent, enable "Beta: Use Unicode UTF-8 for worldwide language support" in Windows region settings, or run the command from your PowerShell profile.

Pasting into the installer prompts: in Windows Terminal use `Ctrl+Shift+V` or right-click. A plain `Ctrl+V` is not always passed through to a prompt that reads raw keys.

## Git Bash pitfalls

Git Bash (MSYS2) rewrites arguments that look like POSIX paths. `schtasks /Query /TN \Foo` or `/Create /TR ...` can reach Windows with the path mangled. Switch the conversion off for the command:

```bash
MSYS_NO_PATHCONV=1 schtasks /Query /TN BDB_OpenWiki_Daemon
```

PowerShell and `cmd.exe` do not do this, so prefer them for `schtasks`.

## Scheduled jobs

| Job | Task name | Created by |
|---|---|---|
| OpenWiki daemon | `BDB_OpenWiki_Daemon` | the OpenWiki module |
| Nightly memB ingest | `BDB_Memb_Ingest` | `aos memory set-time HH:MM` (remove with `aos memory set-time off`) |

The task runs `wscript.exe` on a small hidden `.vbs` in `~\.memb`, so no console window opens at the scheduled time. If `schtasks` fails, `aos memory set-time` exits with code 1, prints the error text `schtasks` returned (typically "Access is denied" on a locked-down account), says that no task was written, and does not keep the new time. Create the task by hand or run the command from an account that may create tasks for itself.

## Where things live

Paths are relative to `%USERPROFILE%` (shown as `~`).

| Path | Content |
|---|---|
| `~\.local\bin\aos` and `aos.cmd` | the `aos` launcher (runs `npx -y @hybridlabor-api/aos@latest`); add this folder to PATH |
| `~\.agents` | AOS rules, hooks, workflows, gateway and the memB install |
| `~\.aos` | AOS state: hub, bus, A2A inbox, secrets file |
| `~\.claude`, `~\.codex`, `~\.gemini` | each harness's own config, skills and hooks (OpenCode keeps its own config folder) |
| `~\.memb`, `~\.MemBDB` | memB config and its SQLite store |
| `~\.openwiki` | OpenWiki provider settings (`.env`) and project list |
| `<project>\openwiki` | the wiki of a project (older versions used `.openwiki`) |

## Verify

```powershell
aos-doctor            # checks the install, hooks, gateway and memory
aos-doctor --json     # same, machine readable
aos services status   # memB, OpenWiki, gateway, hub, plan-canvas
aos hub status
```

For a single project, run `/aos-project-init` inside it (or `aos project init --files` for the files only); its doctor checks `AGENTS.md`, the `CLAUDE.md`, `RULES.md` and `CODEX.md` pointers, `openwiki/` and `.openwikiignore`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `memB needs Python 3.10-3.14` | No usable interpreter and no uv. `winget install astral-sh.uv`, open a new terminal, run `aos package install memb`. |
| `cannot start uv: ENOENT` from an MCP server | uv is not installed, or installed outside the folders listed above. Install it with winget or put its folder on PATH. |
| memB WebUI (port 8088) does not answer | Re-run `aos package install memb` and read the warnings it prints; `aos services status` shows whether memB is up. |
| `Codex plugin: plugin list FAILED (... failed to load configuration)` | Codex cannot read its own `config.toml`. Run `codex plugin list` yourself, fix the entry it names, then `aos update`. |
| Status line shows `?` instead of glyphs | The console code page is not UTF-8. Run `chcp 65001` and use Windows Terminal. |
