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
