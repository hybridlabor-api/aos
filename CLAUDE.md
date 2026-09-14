# AOS — Claude Code

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to Claude Code.

## The release gate is a real hook here

`.claude/hooks/go-gate.mjs` (registered in `.claude/settings.json`) mechanically
blocks `git push`, `npm publish`, `npm version`, and recursive `rm` unless your
immediately preceding message is the literal word **GO**. On this harness the
gate is enforced, not merely honoured — you cannot argue around it, and it works
whether or not this file was loaded. See AGENTS.md for the policy layer and the
three clarifications that have caused real incidents.

## Delegation subagents available on this harness

These ship as Claude Code plugins and are the preferred path over shelling out
to the underlying CLI, because they already handle wrapper flags, cost
discipline, and the digest contract:

- `antigravity:antigravity-delegate` — agy / Gemini
- `opencode:opencode-rescue`
- `codex:codex-rescue`

On any other harness, calling the CLI directly is the only path. The break-even
rule and the "verify the result, never the status field" rule are in AGENTS.md
and apply identically.

## Pipeline entry points

- `/startcycle` — `skills/basic/startcycle/SKILL.md`
- `/startcycle-graph` — `skills/basic/startcycle-graph/SKILL.md`, contract in `.agents/graph.md`, registry in `.agents/nodes.json`, dispatcher at `.claude/workflows/startcycle-dispatch.mjs`
- `/startcycle-graph-user` — `skills/basic/startcycle-graph-user/SKILL.md`

Agent personas live in `.claude/agents/`. Agent Teams were evaluated and
deferred for `/startcycle-graph` — it runs headless and teams need an
interactive session. Read `.agents/graph.md` and F-17's addendum in
`docs/sessions/audit-agents.md` before reversing that.

## Validating a skill change

```bash
npm run validate          # the skill contract, as CI enforces it
npm test                  # selftest + validate
```


# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".

# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".

# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".

# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".

# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".

# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".

# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".

# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".

# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".

# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".

# AOS — Antigravity / Gemini

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here — a rule that lives in two files is a
rule that will eventually disagree with itself.

This file covers only what is specific to running AOS under Antigravity.

## Nothing enforces the gate here — you are the enforcement

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run on this
harness. Not one of the four release commands is mechanically blocked for you,
and neither is anything else.

So the full rule in AGENTS.md applies here in its entirety, not just its
hook-enforced subset: when the user asks for a plan, review, audit or
multi-step action, you are read-only until they answer with the literal **GO**
— including file writes and `git commit`. On Claude Code a hook would catch the
four worst cases if discipline failed. Here there is no backstop, which makes
this the harness where the rule matters most, not least.

## Model routing

The tier names in `agy-delegate` map to models that go stale — the built-in
`flash` still points at Gemini 3.7 while 3.8 ships. Re-check against
`agy models` after every upgrade; the id carries both the version and the
effort suffix.

| Work | Model |
|---|---|
| Media, fast or mechanical coding, boilerplate | `Gemini 3.8 Flash (Medium)` |
| Trivial one-liners | `Gemini 3.8 Flash (Low)` |
| Review, architecture, hard reasoning | `Claude Sonnet 4.6 (Thinking)` |

Set these once via `CLAUDE_PLUGIN_OPTION_TIER_{FLASH,FLASH_LO,PRO}` in
`~/.zshenv` — **not** `~/.zshrc`, which non-interactive tool shells never
source.

Adversarial review is the case that most repays the stronger model: a Flash
tier tends to agree with what it is shown, which is the one thing a reviewer
must not do.

## Headless timeouts

A trivial headless `agy` prompt was measured at **605s** in 2026-09.
`agy-delegate` defaults to `--print-timeout 5m`, so it aborts at 300s and
reports an empty body while the answer is still arriving. Pass `--timeout 15m`
for anything non-trivial. A short timeout does not read as "slow", it reads as
"broken".