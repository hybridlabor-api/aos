# Unified memory

Unified memory is one install choice for the AOS memory packages. It is on by default.

| Part | What it is |
|---|---|
| memB (`memb`) | `@hybridlabor-api/memb`: local vector memory, the `memb_mcp` MCP server, the `memb-inject` context hook and a WebUI on port 8088. |
| deja (`deja`) | `@vshulcz/deja-vu`: local transcript index with its `deja` MCP entry. Installed by the memB step. |
| OpenWiki (`openwiki`) | `openwiki` CLI, daemon and visualizer. |
| Codebase Memory MCP | `codebase-memory-mcp` (third party). Only in coding mode, see below. |

The bundle id is `memory` (`BUNDLES` in `lib/v5/profile.js`): `--without=memory` stands for
`--without=memb,deja,openwiki`.

## When it is on

- **Standard profile and `-y`:** on. Nothing is asked.
- **Interactive install:** a "Unified memory" step, default "Install unified memory". Choosing
  "Skip" saves `memb`, `deja` and `openwiki` in the `disabled` list of `~/.aos/v5-settings.json`,
  exactly like `--without=memory`, so `aos update`, `aos repair`, `--hooks-only` and the gateway
  keep them off too. The step is not shown when `memb` is already excluded.
- **Off:** `--without=memory`, `--without=memb`, or `--profile=minimal` (which excludes `memb`,
  `deja` and `openwiki`).

Unified memory follows `memb`: whenever `memb` is excluded, it is off.

## What "off" means

With unified memory off, no harness is wired for it (Claude Code, Antigravity, Codex, OpenCode,
the MCP gateway):

- the `memb_mcp` and `deja` MCP entries are dropped from the MCP configs the installer writes
  (`MEMORY_MCPS` in `lib/v5/profile.js`);
- `memb-mcp` is not offered in the MCP picker;
- the `memb-inject` hook entry is not written.

## How a session gets its memory

One hook, `memb-inject.mjs`, serves every harness; deja, OpenWiki and codebase-memory are pulled on demand.

| Harness | Start context | Per prompt |
|---|---|---|
| Claude Code | `SessionStart` hook | `UserPromptSubmit` hook |
| Codex | `[[hooks.SessionStart]]` in `config.toml` | `[[hooks.UserPromptSubmit]]` |
| Antigravity (agy) | `aos-context` `PreInvocation`, first turn of a conversation | later turns |
| OpenCode | `bdb-aos.js` plugin, first message of a root session | later messages |

- **Start context (small, once):** persona file, identity rows (`godmode`), the project's cards (max 5,
  180 chars each) and `deja wip`. Capped per context profile (`aos context`).
- **Per prompt:** only full-text hits that share at least two prompt terms. A hit without a project is
  injected only if it relates to this project or prompt: project cards must name the project, other
  categories (branding, mail, ...) must match a project id or a prompt term.
- **Pull more:** the session hint (`aos-session-hint.mjs`, all four harnesses) ends with one line naming
  the installed tools: `memb search`, `deja search`, `openwiki_search`, `codebase_memory_mcp`. Tools that
  are not installed, or whose package is in the `disabled` list, are left out; AOS works with none of them.
- **Visible line (human):** at session start, `memory: <n> notes (<project>) · last session: <title>, <when>
  · aos memory show` goes to stderr (OpenCode: toast). At most 160 chars; titles that look like secrets
  are dropped. `aos memory show` prints the full start context for the current folder.
- **Optional deja digest:** `aos memory deja-context on` (setting `memory.dejaContext` in
  `~/.aos/v5-settings.json`, or `AOS_DEJA_CONTEXT=on`) adds the output of `deja hook-context --plain --once`
  to the start context in place of `deja wip`. Off by default. Because every harness runs
  `memb-inject`, no extra hook entry is written per harness. Needs `deja` on PATH; silent otherwise.
- **Switches:** `AOS_SESSION_START_CONTEXT=off`, `AOS_SESSION_HINT=off`, delegated workers
  (`AOS_DELEGATE_DEPTH>0`) stay silent.
- **Check:** `aos doctor` has a "Memory start context" row per harness (Claude Code, Codex, Antigravity,
  OpenCode); a harness that is not installed or unified memory switched off is not a failure.

## Codebase Memory MCP

With unified memory on, a coding tool detected on this machine answers "Do you use AOS for
coding?" with yes. `--coding` / `--no-coding` and an answer already stored in
`~/.aos/v5-settings.json` (`codingMode`) win over detection.

In coding mode, when the `codebase-memory-mcp` binary is not found, the installer runs
`npm install -g codebase-memory-mcp@0.11.0` (`lib/codebase-memory.js`). A failed install only
warns. The MCP entry is registered only where the binary is present.

## What it installs, per OS

All platforms:

- the memB module under `~/.agents/memB`, with a Python venv in `.venv`:
  `.venv/bin/python` on macOS and Linux, `.venv\Scripts\python.exe` on Windows;
- memB's `requirements.txt` into that venv (with `uv` when available), plus `fastapi` and
  `uvicorn` for the WebUI;
- deja: `npm install -g @vshulcz/deja-vu@0.21.1`, plus the line `secret` in the deja exclude list
  (`$XDG_CONFIG_HOME/deja/exclude`, default `~/.config/deja/exclude`).

The memB WebUI service (port 8088, logs in `~/.memb/`):

| OS | Service |
|---|---|
| macOS | LaunchAgent `~/Library/LaunchAgents/com.bdb.memb.webui.plist` |
| Linux | systemd user unit `com.bdb.memb.webui.service` |
| Windows | Startup entry `com.bdb.memb.webui.vbs` in the user's Startup folder |

`aos status` and `aos repair` check memB with `verify` in `lib/v5/packages.js`: the venv python
runs, `mcp` and the `memb-mcp` copy import, every `memb_mcp` entry in a harness config points at
an existing venv python, `fastapi`/`uvicorn` import for the WebUI, the memb-mcp copy matches the
memB version, and on macOS the LaunchAgent's last exit status is 0.

## Add it later

Excluded packages are in the `disabled` list. Remove them there: `aos`, Settings, then Install
(or Enable) memB, deja and OpenWiki. The next `aos update` wires `memb_mcp`, `deja` and
`memb-inject` again, because unified memory is on whenever `memb` is not excluded.

`aos package install memb` installs the package but does not change the `disabled` list.

## Uninstall

`aos-uninstall` removes:

- the memB module folder (`~/.agents/memB`) when the install recorded it;
- the WebUI LaunchAgent (macOS) or systemd user unit (Linux);
- deja, only when AOS installed it (`npm uninstall -g @vshulcz/deja-vu`), and then its `deja`
  entry from the JSON MCP configs and the AOS-written `deja` table in `~/.codex/config.toml`;
  a `deja` entry in `~/.config/opencode/opencode.jsonc` is reported, not rewritten.

Kept unless `--purge`: `~/.MemBDB` (the memory store), `~/.memb` (WebUI logs), `~/.openwiki`,
`~/.cache/deja` and `~/.config/deja`.

Not handled by `aos-uninstall`: the Windows Startup entry `com.bdb.memb.webui.vbs` (not in its
Windows startup list) and the `codebase-memory-mcp` npm package.
