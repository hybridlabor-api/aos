---
name: bdb-ecosystem-health
description: Autonomous verification and health monitoring skill for the BDB Ecosystem (Kernel + 7 Standalone NPM Modules). Audits Git, NPM version drift, and GitHub Actions CI/CD status, generates dark-mode HTML reports, and executes auto-remediation plans.
category: saas-ops
---

# BDB Ecosystem Health Skill

This skill monitors and maintains 100% operational integrity across all 8 repositories in the BDB Ecosystem.

## Modules Under Audit
1. **Kernel**: `@hybridlabor-api/bdb-dev-optimized-agent-skills`
2. **Tool Installer**: `@hybridlabor-api/bdb-dev-tool-installer`
3. **Synapse 3D**: `@hybridlabor-api/bdb-synapse`
4. **memB Vector Engine**: `@hybridlabor-api/memb`
5. **Heimdall Token Saver**: `@hybridlabor-api/heimdall-token-saver`
6. **BDB OS Remote**: `@hybridlabor-api/bdb-os-remote`
7. **OS Agent Workspace**: `@hybridlabor-api/bdb-os-agent-workspace`
8. **Creator Extension**: `@hybridlabor-api/bdb-dev-creator-extension`

## Automated Health Check Script
Run the automated audit at any time:
```bash
/Users/timrennings/bdb-dev/scripts/ecosystem-health-audit.js
```

### Script Output:
* **HTML Dashboard**: `/Users/timrennings/bdb-dev/marketing-intern/reports/ecosystem_health_latest.html`
* **Browser Launch**: Automatically opens the report in Chrome / Default Browser.
* **Exit Code**: Returns `0` if all healthy, `1` if attention/remediation is required.

## Autonomous Remediation Protocol
If the audit detects any issues:
1. **Version Drift (Local != NPM)**: Bump `package.json`, update changelog, push tag or run `npm publish --access public`.
2. **Dirty Git Tree**: Review modified/untracked files, commit with semantic commit message or stash.
3. **CI/CD Workflow Failure**: Check logs with `gh run view <id> --log-failed`, resolve missing secrets/version guards, re-trigger via `gh run rerun <id>`.
