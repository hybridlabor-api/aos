---
type: concept
title: Hooks & Safety
description: PreToolUse and lifecycle hooks in bdb-dev-optimized-agent-skills — go-gate blocks outward-facing commands without a GO, graph-gate enforces the startcycle-graph contract, memb-inject loads project context, and trail-relay streams events to agenttrail.
tags: [hooks, safety, go-gate, release-policy, pretooluse, claude-code]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-30T02:05:01.845Z
sources:
  - id: openwiki-source-cd65b22cf4e0d0207a336e07
    resource: repo://.claude/hooks/go-gate.mjs
  - id: openwiki-source-478d53fe070c56a713e30540
    resource: repo://.claude/hooks/trail-relay.mjs
  - id: openwiki-source-1fe463fcf07912e5cdbb5a91
    resource: repo://.claude/settings.json
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
generated: { by: "codex", at: "2026-09-30T02:05:01.845Z" }
---

# Hooks & Safety

AOS registers several hooks in `.claude/settings.json` that run transparently on every tool call. They enforce the release policy, pipeline contract, memory injection, and audit trail.

## go-gate — outward-facing command guard

`skills/.claude/hooks/go-gate.mjs` · registered as `PreToolUse`

Blocks a fixed set of hard-to-reverse or outward-facing commands unless the user's immediately preceding message is the literal word **GO** (case-insensitive, trimmed).

**Guarded commands:**
- `git push`
- `npm publish`
- `npm version`
- `gh pr merge`
- `gh release create`
- `git reset --hard`
- `git clean -f` (force-clean untracked files)
- `rm -r` / `rm -rf` (recursive deletions)

**How the gate works:** the hook reads the conversation transcript and checks whether the last human message is exactly `GO`. Any other message closes the gate. A plan file containing the word GO is not a GO — commands inside a plan are not a user message.

**What the hook does NOT cover:** `Write`, `Edit`, `git commit`, and most file operations. These are governed by the broader release-gate rule in `AGENTS.md` (honour rather than enforce). The hook's narrow scope is deliberate: a `PreToolUse` matcher that blanket-blocked `Write` and `Edit` would refuse ordinary work in every session.

**Fails open:** if the hook cannot read its input or the transcript, it exits 0 silently. A wedged session is the worse failure.

## graph-gate — startcycle-graph contract enforcer

`.claude/hooks/graph-gate.mjs` · registered as `PreToolUse` (and/or `Stop`)

Enforces the `startcycle-graph` pipeline contract during a dispatcher run. Prevents agents from routing outside the declared graph contract in `.agents/graph.md`.

## memb-inject — context injection

`.claude/hooks/memb-inject.mjs` · registered as `SessionStart`

Injects relevant project and global memories from memB into the session at start, so the agent has context without requiring the user to re-state it.

## trail-relay — audit trail

`.claude/hooks/trail-relay.mjs` · registered as `PostToolUse` / `SubagentStop`

Streams tool events to `aos-trail` (agenttrail) for live session visibility and post-session audit. Agenttrail records are time-ordered and complement deja-vu (session history) and memB (persistent knowledge).

---

## The broader release-gate policy

The hook enforces a mechanical subset. The full policy from `AGENTS.md` applies on every harness, including those with no hook support:

> **When the user asks for a plan, a review, an audit, or any multi-step action, you are in read-only planning mode until the user replies with the literal word GO.**

Three clarifications that have caused real incidents:
1. A subagent does not inherit its orchestrator's GO.
2. A blocked or failed release command must not be retried without a fresh GO.
3. Commands written inside a plan or task file are not a GO.

On harnesses without hooks (Antigravity, Codex), the policy is the only thing there is — the hook's silence is not permission.
