# AOS CLI

The AOS dispatcher contract and AOS skills, on the [pi](https://github.com/earendil-works/pi) coding agent.

```
aos-cli
aos-cli "why is the go build failing"
aos-cli --continue
```

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

## Install

Through the AOS installer (picks this up automatically once the menu entry lands), or directly:

```sh
npm i -g @earendil-works/pi-coding-agent   # if you do not have pi yet
cd packages/aos-cli && npm i && npm link
```

Requires Node >= 22.19 — pi's floor. The AOS installer itself still supports Node >= 20, because AOS CLI is a separate install step.

## Layout

```
bin/aos-cli.mjs     the launcher (~40 lines)
themes/aos.json     pi dark theme, AOS palette
```

## Licence

MIT, same as AOS. pi is MIT, © the pi authors.
