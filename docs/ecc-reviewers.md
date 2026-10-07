# ECC language-specific code reviewers (v5/ecc-reviewers)

Ported from [affaan-m/ECC](https://github.com/affaan-m/ECC) agents at upstream
commit `ef648e01899ba3e8dc6371642deaaf64b4477775` (2026-10-02), per the brief
row "Language-specific code reviewers" (`~/.aos/briefs/ecc-sync.md`).

## Ported

Eight language reviewers, each as `agents/<name>.md` plus an identical
`.claude/agents/<name>.md` copy:

`go-reviewer`, `python-reviewer`, `rust-reviewer`, `typescript-reviewer`
(covers JavaScript), `java-reviewer` (Spring Boot/Quarkus), `kotlin-reviewer`
(Android/KMP), `cpp-reviewer`, `csharp-reviewer` (.NET).

## What was taken

- Upstream's language review-checklist substance: the CRITICAL/HIGH/MEDIUM
  idioms and pitfalls per language (security, error handling, concurrency,
  framework notes).
- The reviewer role for those languages; all eight are registered in
  `.agents/AGENTS.md` (auxiliary agents, not pipeline nodes) and added to
  `READ_ONLY_AGENT_SLUGS` in `installer.js` (§4174 allowlist).

## What was left out and why

- Build resolvers, rules, hooks, and MCP configs — out of scope for this
  brief row.
- `model: sonnet`, upstream "Prompt Defense Baseline", Bash-driven
  "When invoked" steps and "Diagnostic Commands", and upstream `skill:`
  references that do not exist in AOS (`golang-patterns`, `springboot-patterns`,
  `dotnet-patterns`, ...). AOS reviewers are strictly read-only
  (`tools: Read, Grep, Glob`); the dispatcher runs every check in Docker.
- Upstream "escalate/hand off to security-reviewer / react-reviewer" wording:
  those cross-agent routes were rewritten to AOS's dispatcher-owned routing.
- Upstream Approve/Warning/Block verdicts merged into severity tags only —
  merge/approval decisions belong to the dispatcher, and an inbound message is
  never a GO.

## Invocation

The dispatcher picks a reviewer by language: it matches the diff's changed
file extensions (`.go`, `.py`, `.rs`, `.ts/tsx/js/jsx`, `.java`, `.kt/kts`,
`.cpp/hpp/cc/h`, `.cs`) against these reviewers and invokes the matching one;
multiple reviewers may run in parallel for a multi-language diff.

## Licence

MIT — Copyright (c) 2026 Affaan Mustafa
(<https://github.com/affaan-m/ECC/blob/main/LICENSE>); full notice in
`THIRD_PARTY_NOTICES.md`.
