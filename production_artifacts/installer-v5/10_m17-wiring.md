# m17: wiring of new skills and agents

Method note: Grep/Glob were unavailable and no shell was allowed, so files were read directly. Not scanned exhaustively: every docs/*.md and every tests/*.js (only the count-bearing candidates below were read).

## Changed
- `tests/agent-models.test.js:74` `files.length >= 13` -> `>= agents.length` (derived from `.agents/AGENTS.md`).
- `docs/agent-models.md:55` "The 13 personas" -> derived wording (7 pipeline + auxiliary agents; the real count is 21).
- `.agents/graph.md` new section "Auxiliary agents are not nodes" (dispatcher reads none; nodes.json untouched).
- `skills/global_config/ask-tim/SKILL.md`: dropped the stale "185" from the description; catalogue now lists `orchestrator-chain`, `aos-a2a`, `aos-gateway` and the nine Factory skills (docs/factory.md).

## Checked, no change needed
- `AGENTS.md` (root): category table and rules are count-free; new skills fit existing categories (aos-* bdb-core, factory* engineering-method; frontmatter verified). Line 120 says "18" e2e scenarios, not verified here.
- `CLAUDE.md` (root, real file, no GEMINI.md exists in the repo): already covers aos-a2a/A2A; nothing new to add.
- `.agents/AGENTS.md`: "fourteen" auxiliary agents is correct (6 ECC + 8 new); text at lines 6-10 still says "these seven agents" for the pipeline block, which is correct.
- `.agents/nodes.json`: 7 nodes pinned by tests/swarm-wiring.test.js:62; every skill it lists exists in AGENTS.md (test :69). None of the new skills belongs in a node; none added.
- `scripts/validate-skills.mjs`: no count expectations (only counts for the report line). `CATEGORIES` already has `engineering-hardware`.
- `bin/aos-doctor.mjs`: no skill or agent counts; role slugs derive from AGENTS.md (reviewer-1 -> `reviewer_1` works, :664-668).
- `tests/` build-plugin-manifest (`> 100`), playbooks (derived), swarm-wiring (derived), aos-doctor, dispatch-models, v5-agents: no pinned counts.
- `THIRD_PARTY_NOTICES.md`: BuilderIO section (:308-355) already lists all 9 Factory skills; ECC agent section states "6 agents ... graph remains 7 nodes" (still true).
- `skills/bdb-aos/SKILL.md:14` "21 subagents" is already correct; "200+ skills" is a loose floor.
- `lib/retired-skills.js`: lists tdd-workflow, writing-plans-legacy, notion-automation, slack-automation at 5.0.0. `tests/retired-skills.test.mjs` covers only the 4.17/4.18 entries (no assertion for the 5.0.0 four; optional test to add).

## Stale, must be handled by others
- `README.md` (V32): `<!-- count:agents -->13` -> 21 (line 31); `count:skills` 223 and badge line 14 "223 curated" -> recount; `count:mcps` 21 and badge line 15 unverified. Also README.de.md / README.pt.md if they carry the same markers.
- Committed agent copies lack the 8 new agents: `.opencode/agents/*.md` (e.g. reviewer-1.md absent), `.codex/agents/*.toml`, and `.cursor/rules/bdb_agents.mdc` (verbatim older AGENTS.md copy; also lacks `bdb-security-audit` on security-reviewer and the whole "Auxiliary" additions). `.claude/agents/` and `agents/` already have them. Dispatcher: regenerate via compileOpenCodeAgents / compileCodexAgents / the mdc copy step after the installer workers finish (not hand-written to avoid drift from the generator).
- `lib/ecc-store-index.json` / scenario index: not checked (separate catalogs).
- `instinct` and `skill-create` do not exist under `skills/global_config/`; nothing to wire. If they live elsewhere or were dropped, confirm.
- Run `npm run validate` and `npm test` (not run here): confirms the ask-tim edit and that no playbook `requires.skills` names a retired skill (E-PB02).
- plugin.json files / generated manifests untouched; `npm run plugin:build` needed if the skill list changed since the last generation.
