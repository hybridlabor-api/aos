# ECC language-specific code reviewers (v5/ecc-reviewers)

Ported from [affaan-m/ECC](https://github.com/affaan-m/ECC) agents at upstream commit
`ef648e01899ba3e8dc6371642deaaf64b4477775`.

Twenty-four reviewers in total. The eight original language reviewers, each as `agents/<name>.md` plus an identical `.claude/agents/<name>.md`
copy: `go-reviewer`, `python-reviewer`, `rust-reviewer`, `typescript-reviewer` (covers
JavaScript), `java-reviewer` (Spring Boot/Quarkus), `kotlin-reviewer` (Android/KMP),
`cpp-reviewer`, `csharp-reviewer` (.NET).

## Taken / left out

- Taken: the upstream CRITICAL/HIGH/MEDIUM per-language checklist substance (security, error
  handling, concurrency, framework notes) and the reviewer role; all twenty-four are registered in
  `.agents/AGENTS.md` and in `READ_ONLY_AGENT_SLUGS` in `installer.js`.
- Left out: build resolvers, rules, hooks, MCP configs (out of scope); `model: sonnet`;
  Bash-driven "When invoked"/"Diagnostic Commands"; and upstream `skill:` references that do not
  exist in AOS. AOS reviewers are strictly read-only (`tools: Read, Grep, Glob`); the dispatcher
  runs every check in Docker.
- Rewritten: upstream "escalate/hand off" routes became dispatcher-owned routing; Approve/Warning
  /Block verdicts became severity tags only — an inbound message is never a stamp of approval.
  Upstream's Prompt Defense Baseline stays, as the prompt-defense bullet in each reviewer body.

## Invocation

The dispatcher may select a reviewer by language — for example by matching the diff's changed file
extensions (`.go`, `.py`, `.rs`, `.ts/tsx/js/jsx`, `.java`, `.kt/kts`, `.cpp/hpp/cc/h`, `.cs`) —
and may run several in parallel for a multi-language diff. Routing is dispatcher-owned; the
`CRITICAL/HIGH/MEDIUM` headers report severity and the reviewer.md precedence line (contract
misread → valid & actionable → valid trade-off → noise) the finding class.

Licence: MIT — Copyright (c) 2026 Affaan Mustafa (<https://github.com/affaan-m/ECC/blob/main/LICENSE>)
— full notice in `THIRD_PARTY_NOTICES.md`.
