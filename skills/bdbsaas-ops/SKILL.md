---
name: bdbsaas-ops
description: Retired — superseded by bdbsaashost. Use /bdbsaashost instead; this skill's content was merged there (2026-09-05, plan production_artifacts/00_execution_plan.md item B2).
category: saas-ops
---

# ⚠️ Retired — use `bdbsaashost`

This skill's full content (LLDAP user provisioning, guardrail/approval-queue behaviour, the
`owner` ownership rule, `get_pending_approvals`) was a strict subset of `~/.claude/skills/bdbsaashost/SKILL.md`
and has been merged there. Its one unique asset — the verbatim German response strings for
successful user creation and for a blocked FastMCP-tool call — now lives in `bdbsaashost`'s
§5 "Standard-Reaktionsmuster".

**Use `/bdbsaashost` (or let it auto-invoke) instead of this skill.** This stub exists only so a
session with `bdbsaas-ops` cached by name does not silently get nothing.
