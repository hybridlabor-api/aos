---
name: aos-store
description: Browse, preview, and install AOS Core, ECC and Scenario skills and agents from a local web UI. Use when exploring or adding new skills to a project.
category: bdb-core
metadata:
  version: "1.0.0"
  license: Apache-2.0
---

# AOS Store

A web UI for discovering and installing AOS skills and agents. Lists what is already installed, previews new items before adding them, and confirms every install explicitly.

## When to Use

- You want to explore available AOS Core, ECC and Scenario skills and agents in a local web UI.
- You need to preview a skill or agent before installing it.
- You want to install skills or agents globally (all harnesses) or into the current project, with explicit confirmation before each install.

## How It Works

The store can be run standalone or inside the AOS Hub. Run `aos-store ui` to start the local store server; it prints the URL (default `http://127.0.0.1:4322`), opens your browser unless `--no-open` is set, and runs in the foreground. Alternatively start `aos hub` (same security model, port 7900) and open the store's tab there — the hub embeds the store UI, nothing else changes.

```bash
# Start the store UI (opens browser automatically)
aos-store ui

# Start the store as a tab of the AOS Hub
aos hub

# Start with a custom port
AOS_STORE_PORT=5000 aos-store ui

# Roll back the most recent install of a named item (every target and backup
# is re-validated first; nothing is ever deleted)
aos store rollback <skill-name>
```

**Confirmations are typed, not clicked:** writes need the exact name spelled back (`confirm`), and stopping or restarting a service through the hub CLI needs `--confirm <id>`. Nothing is installed or rolled back silently.

**Fallback (if `aos-store` is not on PATH):**
```bash
npx -p @hybridlabor-api/aos aos-store ui
```

### On Harnesses Without Browser Support

Some harnesses (e.g. OpenCode) cannot open a browser automatically. **Always print the store URL in chat** (e.g., `http://127.0.0.1:4322`) so the user can click it manually.

## Store Features

- **Browse:** Lists all available AOS Core, ECC and Scenario skills and agents. Scenario items are MIT-licensed third-party skills; some contain scripts (the preview warns, and flags bridges that execute received code).
- **Show Installed:** Marks what is already installed and which items are AOS Core (always included).
- **Preview:** "+ Add" first shows the exact target paths for the chosen scope (global or project); nothing is written yet.
- **Confirm:** Every install requires explicit user confirmation — nothing is installed silently.
- **Multi-file skills:** Skills with extra files (scripts, references) install completely, every file verified by SHA-256. Skills that ship a `hooks/` folder are copied only; their hooks are not registered in your harness settings (the preview warns).

## Health Check

Check if the store server is running:

```bash
curl http://127.0.0.1:4322/api/health
```

Returns `200 OK` if healthy.

## Stopping the Store

The store runs in the foreground. Stop it with **Ctrl-C**. No separate stop command is available.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `AOS_STORE_PORT` | Server port | `4322` |

