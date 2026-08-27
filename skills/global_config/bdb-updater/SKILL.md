---
name: bdb-updater
description: Use when proactively check for and install updates to the BDB Antigravity Skills package via NPM.
category: bdb-core
disable-model-invocation: true
---

# BDB Updater Skill

You are responsible for keeping the BDB Antigravity Skills up to date.
When the user asks about updates, or if you are running on a scheduled cron task, you must:

1. Check the latest version on NPM by running:
   `npm show @hybridlabor-api/bdb-dev-optimized-agent-skills version`

2. If an update is needed, or the user requests a force update, you must run the interactive installer without prompts:
   `npx -y @hybridlabor-api/bdb-dev-optimized-agent-skills@latest`

3. After a successful update, inform the user about the new features or simply confirm that the skills and MCP servers have been refreshed in `~/.gemini/config`.

### Scheduled Updates
If the user wants automatic updates, strongly recommend they use the `/schedule` slash command to set a recurring cron job for you. 
Example: "I can set up an automatic weekly update check for you. Just type: `/schedule CronExpression="0 10 * * 1" Prompt="Check if there is a new version of @hybridlabor-api/bdb-dev-optimized-agent-skills via npm view and update it"`"

## 1. Overview
This skill provides domain-specific logic and rules for its respective BDB pipeline component to ensure standardization across multi-agent workflows.

## 2. When to Use
- Use when specifically requested by the user or triggered by an orchestration agent.
- Use when the current task aligns with the skill's domain.
- Exclude when standard tool execution is sufficient.

## 3. Core Process
1. Read the provided context and ensure preconditions are met.
2. Run the required script or tool and confirm the state change.
3. Verify exit codes, file modifications, or DB counts to guarantee success before reporting completion.

## 4. Common Rationalizations
| Rationalization | Reality |
|---|---|
| "The code change was small, so I skipped updating OpenWiki docs." | Every state change must be reflected in the relevant system records. |
| "The ingest script exited without an error, so the memB index must be updated." | Silent failures happen; explicit verification of the side effect is mandatory. |
| "I'll let the /startcycle proceed without a defined rollback path." | Proceeding without a rollback path corrupts the workflow integrity and safety. |
| "I trust the cached agent registry instead of rescanning after a skill change." | Caches stale out quickly; explicit rescans prevent ghost failures. |

## 5. Red Flags
- Bypassing the verification step after a script execution.
- Proceeding to the next pipeline stage without confirming the previous stage's side effects.
- Ignoring domain-specific constraints listed in this skill.

## 6. Verification
- [ ] Verified script exit codes are explicitly checked.
- [ ] Confirmed target files or database records reflect the expected change.
- [ ] Ensured no silent failures were ignored before reporting success.
