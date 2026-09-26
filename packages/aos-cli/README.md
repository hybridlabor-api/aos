# AOS CLI

The AOS dispatcher contract and AOS skills, on the [pi](https://github.com/earendil-works/pi) coding agent.

```
aos-cli
aos-cli "why is the go build failing"
aos-cli --continue
```

## Which skills are loaded

**Ten, not all of them.** pi advertises every discovered skill by name and description in *every* system prompt. Measured on this machine: 210 skills, **~11,150 tokens per request**, of which the four `firecrawl` entries alone are ~2,250. That is a permanent tax on every turn.

`core-skills.json` narrows that to the handful worth having always:

```
ask-tim  aos-setup  aos-project-init  mcp-manage  systematic-debugging
planning-with-files  token-saver-config  archify  deja-memory  grill-me
```

Edit the file. It is a flat list of directory names under `~/.agents/skills/`, nothing more.

**The tradeoff, stated plainly:** a skill outside that list is not merely unadvertised — it is unreachable, `/skill:name` included. That is the cost of `--no-skills`, and it is why `aos-store` is how one gets added. If you want a skill in every session, put it in the list.

Names that are not installed are skipped with a note rather than being fatal: the list should quietly shrink when a skill is pruned, not stop pi from starting.

## In-session commands

| | |
|---|---|
| `/aos-status` | Runs `aos-doctor --json` and shows every check, with the failing ones marked |
| `/aos` | Menu: status, or the command to run outside for install / update / uninstall |

Both are **read-only**. `aos-doctor --json` exits 1 whenever a check is not ok, which is the normal "something needs attention" answer, so the exit code is ignored and the report's own `ok` field decides. The install, update and uninstall entries do not spawn the installer: it animates and prompts, and nesting it inside pi's TUI corrupts both renderers. They report the command to run in a separate terminal instead.

## What it actually is

A launcher, not a reimplementation. It adds three things to a plain `pi`:

| | |
|---|---|
| **AOS theme** | `themes/aos.json` — pi's `dark`, with the AOS palette (purple, amethyst, gold, forge, emerald, beige) |
| **Dispatcher graph** | `~/.agents/AGENTS.md` appended to the system prompt |
| **AOS skills** | nothing to do — pi already discovers `~/.agents/skills` (Agent Skills spec) |

Everything else — the agent loop, the model providers, the TUI, sessions, MCP-less tool use — is pi's. AOS CLI does not fork pi and does not wrap it; it starts it with three flags.

## What it deliberately does not do

**It does not depend on `@hybridlabor-api/aos`.** It reads `~/.agents/` at runtime, which the `aos` installer writes. That is the whole contract:

- AOS CLI and the AOS installer version and update independently. A pi update never drags in a 98 MB AOS reinstall.
- AOS CLI runs without AOS installed — it just starts with no AOS skills and says so.
- **It is not a pipeline executor.** The 7-node dispatcher graph reaches pi as instructions in `~/.agents/AGENTS.md`, not as machinery: the nodes are agent definitions, and the main session acts as the dispatcher, which is what `.agents/graph.md` specifies anyway. There is no `state.json` loop.
- **No MCP.** pi has no MCP client, so memB, deja and mcsc are not available here. AOS CLI is a chat + skills harness; the other seven harnesses remain the machinery.

## Install

Through the AOS installer (picks this up automatically once the menu entry lands), or directly:

```sh
npm i -g @earendil-works/pi-coding-agent   # if you do not have pi yet
cd packages/aos-cli && npm i && npm link
```

Requires Node >= 22.19 — pi's floor. The AOS installer itself still supports Node >= 20, because AOS CLI is a separate install step.

## Layout

```
bin/aos-cli.mjs          the launcher (~40 lines)
themes/aos.json          pi dark theme, AOS palette
extensions/aos.ts        /aos and /aos-status
scripts/check-theme.mjs  theme contract guard, run by `npm test`
```

## Licence

MIT, same as AOS. pi is MIT, © the pi authors.
