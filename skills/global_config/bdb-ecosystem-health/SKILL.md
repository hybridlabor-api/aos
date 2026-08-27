---
name: bdb-ecosystem-health
description: Use when auditing the BDB Ecosystem. Verifies 8 repositories for Git/NPM version drift and CI/CD status, generates HTML reports, and executes auto-remediation.
category: saas-ops
---

# BDB Ecosystem Health Skill

This skill monitors and maintains 100% operational integrity across all 8 repositories in the BDB Ecosystem.

## Overview
Autonomous verification and remediation skill for maintaining 100% operational integrity across all 8 repositories in the BDB Ecosystem.

## When to Use
* **Use when** auditing the ecosystem for NPM version drift or Git staleness.
* **Use when** running CI/CD health checks across multiple linked repositories.
* **Do NOT use when** fixing logic bugs in specific application code (use standard engineering skills).

## Core Process
1. Run the ecosystem health audit script (`ecosystem-health-audit.js`).
2. Confirm zero CI failures and zero version drift before reporting green.
3. Execute the autonomous remediation protocol (bumping versions, publishing) if discrepancies are found.
4. Present the HTML dashboard to the user for final review.

## Common Rationalizations
| Rationalization | Reality |
| :--- | :--- |
| "The audit script reported a failure, but nothing was touched recently, so it's a false positive." | Environmental drift, dependency updates, or upstream API changes can break CI without local commits. |
| "I'll just fix this one repo and ignore the others since it's a minor change." | The BDB Ecosystem is tightly coupled; a change in one module often requires version bumps in dependent modules. |
| "I'm skipping the changelog update because I only changed a comment." | All releases must be documented to maintain strict ecosystem versioning transparency. |

## Red Flags
* Exiting the audit early because the first few repositories look healthy.
* Bumping NPM versions without pushing the corresponding Git tags.
* Ignoring `1` exit codes from the health check script.

## Verification
- [ ] Health check script `ecosystem-health-audit.js` run completed with exit code `0`.
- [ ] HTML report generated and verifiable at `/Users/timrennings/bdb-dev/marketing-intern/reports/ecosystem_health_latest.html`.
- [ ] Git working trees for all 8 repositories are clean.
- [ ] NPM versions are fully synchronized with remote packages.

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
