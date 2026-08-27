---
name: bdb-updater
description: Proactively check for and install updates to the BDB Antigravity Skills package via NPM.
category: bdb-core
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
