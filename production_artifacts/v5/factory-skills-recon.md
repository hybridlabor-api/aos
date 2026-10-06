# Task 24 — /factory skills recon (phase 1, read-only)

Sources consulted:
- In clone: grep over the whole tree, `THIRD_PARTY_NOTICES.md`, the four existing `SKILL.md` files, `.claude-plugin/plugin.json`, `skills.sh.json`, `prompts/templates.md`.
- Outside: `/Users/timrennings/.aos/briefs/` (grep for 'factory'), `/Users/timrennings/dev/WORKSPACE.md` (read), name search for 'factory' under `/Users/timrennings/dev` (glob).
- Web: upstream README fetched from GitHub.

## 1. Existing skills (4, in this clone)

All live under `skills/global_config/`; all registered in `.claude-plugin/plugin.json` (lines 105–108), `plugins/bdb-aos/.claude-plugin/plugin.json` (105–108), `plugins/bdb-aos/plugin.json` (104–107), `skills.sh.json` (27, 66–68), and adapted from upstream BuilderIO/skills per `THIRD_PARTY_NOTICES.md:312`.

| Skill | File | Purpose | Dependencies |
|---|---|---|---|
| `factory-collect` | `skills/global_config/factory-collect/SKILL.md` (74 lines) | Collect and triage product feedback, telemetry, runtime errors, issue reports from configured sources. Source-coverage verification, classification (defect / symptom / request / duplicate / …), fix-by-default with implement-gate, reply/close draft-only behind AOS GO. | Reads `.agent-factory/config.yaml` (`workflows.collect.sources`, optional `skill_prompts.factory-collect`). Refers to `factory-lookback`. No scripts/executables. |
| `factory-lookback` | `skills/global_config/factory-lookback/SKILL.md` (95 lines) | Periodic/cross-source audit of recurring feedback, telemetry, errors, brittle delivery paths; find systemic fixes. Bounded evidence set, clustering, cause tracing, recommend-only fixes. | Reads `.agent-factory/config.yaml` (`workflows.lookback`, optional `skill_prompts.factory-lookback`). Refers to `factory-collect` / `factory-human-digest` flow implicitly. No scripts. |
| `factory-human-digest` | `skills/global_config/factory-human-digest/SKILL.md` (92 lines) | Summarize work needing human judgment across PRs, issues, feedback, errors, delivery signals; human decision queue. Defaults: last 7 days, balanced granularity; scheduled runs read workflows.human-digest. | Reads `.agent-factory/config.yaml` (`workflows.human-digest`, optional `skill_prompts.factory-human-digest`). No scripts. |
| `factory-review-prs` | `skills/global_config/factory-review-prs/SKILL.md` (63 lines) | Review a filtered PR queue with separate reply/approve/merge gates; report readiness only in AOS port (approve/merge/user GO). | Reads `.agent-factory/config.yaml` (filters, action policies, optional `skill_prompts.factory-review-prs`). Explicitly points to a missing sibling: **`factory-babysit-pr`** for single-PR work — does NOT exist in this repo. No scripts. |

Shared shape: pure-prose skills, no `scripts/`, no MCP calls hardcoded; all external writes (push, `gh pr merge`, `gh release create`, replies, approvals, closes) are gated behind the AOS GO gate per the "AOS safety rules" section (added in the AOS port; see `THIRD_PARTY_NOTICES.md:312`).

## 2. Evidence inside this clone naming *other* factory skills

Grep of the whole clone (code hits like `sqlite3.Row`, `row_factory`, `default_factory` excluded as noise). Distinct factory-* names found:

| Name | Evidence | File:line |
|---|---|---|
| `factory-babysit-pr` | Cross-reference by an existing ported skill: "For one long-lived, explicitly authorized PR, use `factory-babysit-pr`" | `skills/global_config/factory-review-prs/SKILL.md:13` |
| Nothing else. | No other file in the clone names any additional factory skill; there is **no base `/factory` skill**, no design doc, no changelog entry listing the missing five. | — |

Also no `.agent-factory/` config example ships in the repo — the skills assume it exists in the target project.

## 3. Outside-the-clone read-only search

- `/Users/timrennings/.aos/briefs/tim-aos-master-list.md:25` — item 24: "/factory skills (/factory, /factory-collect, /factory-lookback, … ~9 skills)". That is the entire brief; no spec.
- `/Users/timrennings/.aos/briefs/tim-aos-master-list-audit.md:34` — item 24 marked PARTIAL: "4 exist … no base /factory; 5 short of Tim's ~9 … Tim: assign import of the missing ones". No spec, no source named in the audit text.
- `/Users/timrennings/dev/WORKSPACE.md` — no factory mention at all.
- Name search 'factory' under `/Users/timrennings/dev` (excluding nothing by tool capability; pattern `*factory*`): ~100+ hits, all false positives — `node_modules` artifacts (framer-motion `create-factory.mjs`, prop-types `factory.js`), MCP code files (`transport/factory.ts`, `server-factory.ts`, `response-factory.ts`), memB `utils/factory.py`, `artifactory` security-tool templates, `speedfactory` marketing images. **No skill or markdown file about the factory skills was found anywhere on disk.**

## 4. Upstream source (found and confirmed)

The provenance is recorded in-close: every ported skill carries `source: BuilderIO/skills` in frontmatter, and `THIRD_PARTY_NOTICES.md:308-327` names `<https://github.com/BuilderIO/skills>` (MIT, Copyright (c) 2026 Builder.io).

Fetched the upstream README (live, public). The Factory family is **exactly 9 skills** — matching Tim's "~9":

1. `/factory` (base, experimental) — config hub; guide at `docs/factory/README.md`, skill at `skills/factory/SKILL.md`, config reference at `docs/factory/configuration.md`
2. `/factory-collect` — **ported** (exists)
3. `/factory-babysit-pr` — **missing**
4. `/factory-review-prs` — **ported** (exists)
5. `/factory-ship` — **missing**
6. `/factory-lookback` — **ported** (exists)
7. `/factory-human-digest` — **ported** (exists)
8. `/factory-watchdog` — **missing**
9. `/factory-recover` — **missing**

So the missing five are exactly: **`factory` (base), `factory-babysit-pr`, `factory-ship`, `factory-watchdog`, `factory-recover`**. The base `/factory` README blurb describes it as "Configure connected sources, prompts, schedules, and delivery policies" with a full flow diagram (collect/lookback → policy-gated fix → PR → ship → reply/close source item). Pull request URLs for the 5 missing skills:

- https://github.com/BuilderIO/skills/tree/main/skills/factory
- https://github.com/BuilderIO/skills/tree/main/skills/factory-babysit-pr
- https://github.com/BuilderIO/skills/tree/main/skills/factory-ship
- https://github.com/BuilderIO/skills/tree/main/skills/factory-watchdog
- https://github.com/BuilderIO/skills/tree/main/skills/factory-recover
- Guide + config reference: https://github.com/BuilderIO/skills/tree/main/docs/factory (`README.md`, `configuration.md`)

Note: local copies of the upstream four exist with the system prompt-visible adaptation, so the written-from-source pattern is already established (`AOS-safety-rules` section, GO-gated — `THIRD_PARTY_NOTICES.md:312`). The 312 line notes "The other 13 skills in that repo (as of commit 0dba9ef) are not vendored", so a deliberate skip record for these skills already exists; importing the missing five is a decision, not an oversight.

## 5. Recommendation

- **The missing five can be written from found sources.** The spec exists upstream (BuilderIO/skills `skills/factory*/SKILL.md` + `docs/factory/{README,configuration}.md`), reachable web. No source-of-truth is missing and nothing needs to be invented — import phase 2 should port the upstream 5-step SKILL.md files verbatim, then apply the same AOS adaptation as the imported four (frontmatter fix: add `category:` + `source:`, drop `installer-group` style upstream keys; add the "AOS safety rules" section where the skill performs writes; keep everything GO-gated).
- For each ported file, record the exact uploader commit hash and note differences in `THIRD_PARTY_NOTICES.md` (BuilderIO/skills section). The import must not touch the plugin manifests more than appending the five skill paths.
- `factory-babysit-pr` is the highest-value first import because an already-shipped skill (`factory-review-prs`) cross-references it by name — today that reference is a dangling dependency.
- Base `/factory` should come with `docs/factory/README.md` + `configuration.md` content folded in or referenced, since it is the config-authority skill all eight others read `.agent-factory/config.yaml` under.
- No risk of the invented-behaviour failure mode: no sources needed to be invented; every account of the missing five above comes verbatim from the upstream README's own one-line descriptions and its described config model.
