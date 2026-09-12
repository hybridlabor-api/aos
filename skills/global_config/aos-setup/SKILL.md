---
name: aos-setup
description: >-
  Bring a machine to a complete, verified AOS installation: the skills pack,
  MCP servers, gate hooks, memB (engine, MCP, ambient hook, WebUI), OpenWiki
  (CLI, auth, harness integrations, refresh daemon) and Synapse. Run once on a
  new computer, and again whenever something in the ecosystem stopped working.
category: bdb-core
risk: low
source: bdb
date_added: "2026-09-13"
---

# AOS Setup — Machine Level

Installing the AOS npm package is the easy half. The half that quietly fails is
everything around it: memB has no venv, the ambient memory hook was never
wired, OpenWiki has a CLI but no provider credentials, Synapse's binary is not
on `PATH`. The result is a machine where most skills work and the memory,
documentation and visualization layers silently do nothing.

This skill closes that gap: **measure first, then fix only what is broken.**

For per-project wiring — a new project folder, its `AGENTS.md`, its memB
project binding, its wiki — use `/aos-project-init` after this one.

---

## 1. Measure

Run the doctor. It is read-only; it installs and edits nothing.

```bash
node skills/global_config/aos-setup/scripts/aos-doctor.mjs        # from the AOS repo
node ~/.claude/skills/aos-setup/scripts/aos-doctor.mjs            # from an installed copy
```

Flags: `--json` for machine-readable output, `--net` to also compare the
installed AOS version against npm.

It reports 26 checks across six areas, each with the exact fix command:

| Area | What is verified |
|---|---|
| `prereq` | Node ≥ 22, `python3`, `git`, `uv`, `gh` |
| `aos` | `~/.agents/.bdb-manifest.json`, skills synced into each harness's skill directory |
| `hooks` | `go-gate.mjs`, `graph-gate.mjs`, `memb-inject.mjs` — present **and** wired in `~/.claude/settings.json` |
| `memB` | module, venv, `~/.MemBDB/memb.db`, WebUI on `:8088`, autostart, `memb-mcp` venv, MCP registration |
| `openwiki` | CLI, `~/.openwiki/.env` credentials, harness integrations, 2-hourly refresh daemon |
| `synapse` | binary on `PATH`, daemon on `:7781` |

Exit code is `0` only when every check passes. **Report the failing rows to the
user before changing anything**, then work the sections below in order — each
one covers a block the doctor can flag.

---

## 2. Install or update AOS itself

```bash
npx -y @hybridlabor-api/aos@latest
```

The interactive installer asks which harnesses to target (Claude Code, Gemini /
Antigravity, Codex, OpenCode, Claude Desktop, …), which MCP servers to wire,
and which optional modules to pull. Non-interactive variants:

```bash
npx -y @hybridlabor-api/aos -y --platforms=2      # unattended, one platform
npx -y @hybridlabor-api/aos --dry-run             # show what it would do
```

Two things worth insisting on when the installer asks:

- **Pick every harness the user actually runs.** A harness left unselected gets
  no skills at all, which is the single most common "AOS doesn't work here".
- **Enable the optional modules** — memB, Synapse, OS Remote, Creator
  Extension, Tool Installer. They are what the doctor's memB and Synapse
  sections check for.

The installer writes `~/.agents/.bdb-manifest.json`. If that file is absent,
nothing was ever installed globally, no matter how many skills happen to sit in
a harness directory.

---

## 3. memB — memory that actually retains

memB is three separate pieces, and a machine can have any subset:

| Piece | Lives at | Doctor row |
|---|---|---|
| Engine + WebUI | `~/.agents/memB` (venv, `:8088` daemon) | `module`, `python venv`, `WebUI :8088`, `autostart` |
| MCP server | `~/.gemini/config/mcps/memb-mcp` (venv + `run.py`) | `memb-mcp server`, `memb_mcp registered` |
| Ambient hook | `~/.claude/hooks/memb-inject.mjs` | `memb-inject.mjs`, `memb-inject.mjs wired` |

The engine and the MCP come from the installer. If the venv is missing, repair
it in place rather than reinstalling everything:

```bash
cd ~/.agents/memB
uv venv --seed .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

`uv venv --seed` has been observed to create a venv without `pip`; that is why
`uv pip install --python <venv>` is the command above and not `python -m pip`.

The store lives in `~/.MemBDB/memb.db`. An empty store is normal on a fresh
machine — `/aos-project-init` seeds it per project.

---

## 4. The ambient memory hook

The hook is what makes memB *ambient* rather than something an agent has to
remember to query. On every prompt it reads the SQLite store directly and
injects the relevant memories as context. It fails open: any error exits `0`
and the prompt proceeds untouched.

This is the piece most often missing on a second machine, because the installer
does not ship it. Install it from this skill:

```bash
cp skills/global_config/aos-setup/assets/memb-inject.mjs ~/.claude/hooks/memb-inject.mjs
```

Then wire it in `~/.claude/settings.json` (merge into the existing `hooks`
object — never replace it, the two gate hooks live there too):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/memb-inject.mjs\"" }] }
    ]
  }
}
```

Standing facts that should reach every prompt — persona, brand rules, house
style — go one per line into `~/.MemBDB/ambient-persona.txt`. Lines starting
with `#` are ignored. Ask the user what belongs there rather than inventing it.

Verify by starting a session and checking that the first prompt carries a
`[memB Ambient Memory Context]` block.

---

## 5. OpenWiki

```bash
npm install -g openwiki@latest        # CLI, needs Node >= 22
openwiki auth <provider>              # google | openai | groq | openrouter | ollama | …
openwiki integrations list            # per-harness host integration status
openwiki integrations install claude  # repeat for codex / cursor / opencode
```

Credentials land in `~/.openwiki/.env`. Without them every wiki run fails at
auth — the CLI being on `PATH` proves nothing on its own.

The 2-hourly refresh daemon comes from the AOS installer when an OpenWiki API
key is supplied. To install it separately:

```bash
bash ~/.claude/skills/openwiki-skill/scripts/install_daemon.sh          # macOS / Linux
powershell -ExecutionPolicy Bypass -File install_daemon.ps1             # Windows
```

Wikis themselves are per-repository (`.openwiki/` in each project) — that is
`/aos-project-init`'s job, not this one's.

---

## 6. Synapse

The installer downloads the module, symlinks the binary to
`~/.local/bin/synapse` and registers a daemon on port `7781`. Two failure modes
the doctor separates deliberately:

- **Binary not found** — usually `~/.local/bin` missing from `PATH`. Add it to
  the shell profile; do not copy the binary somewhere else.
- **Port closed** — the daemon is not running. On macOS:
  `launchctl load -w ~/Library/LaunchAgents/com.bdb.synapse.plist`.

If no pre-built binary exists for the platform, build it:
`cd ~/.agents/bdb-synapse && go build -o synapse ./cmd/synapse/`.

---

## 7. Confirm

Re-run the doctor. Do not report success from the fact that commands ran —
report the doctor's own count:

```bash
node skills/global_config/aos-setup/scripts/aos-doctor.mjs
# 26/26 checks pass. AOS is fully wired.
```

Anything still failing that the user deliberately does not want (no Synapse on
a headless server, no OpenWiki daemon on a laptop) is fine — say so explicitly
instead of leaving it looking broken.

Then hand off: **the machine is ready; per-project setup runs through
`/aos-project-init` in each repository.**

---

## Red flags

- Reporting "AOS installed" on the strength of a successful `npx` run. The
  installer succeeds happily with memB skipped and no hook wired.
- Overwriting `~/.claude/settings.json` instead of merging into its `hooks`
  object — that silently removes the go-gate.
- Treating an empty `~/.MemBDB` as a defect. It is the expected state until
  something is ingested.
- Copying the reference machine's persona file verbatim onto someone else's
  computer. Ask what their standing facts are.
