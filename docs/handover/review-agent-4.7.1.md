# 🔍 Review Handover: AOS v4.7.1 Release Candidate & Cross-Ecosystem Sync

> **Purpose:**  
> Adversarial audit briefing (Doubt-Driven Development) for the release candidate **v4.7.1 (PR #57)** and cross-ecosystem synchronization with **AO** and **MCSC**.

---

## 1. Repositories & Components

| Component | Relative Path | Branch / Reference | Status |
|---|---|---|---|
| **AOS Kernel** | `~/dev/bdb-dev/bdb-dev-optimized-agent-skills` | `release/v4.7.1` | **PR #57** merged |
| **AO Orchestrator** | `~/dev/agents/bdb-agent-orchestrator` | `main` | local branch |
| **MCSC Gateway** | `~/dev/sandbox/multi-cli-subagent-configurator` | `main` | local branch |

---

## 2. Core Files to Inspect in AOS (`release/v4.7.1`)

1. **System Health & Diagnostics:**
   - `bin/aos-doctor.mjs`
   - `tests/aos-doctor.test.mjs`
2. **Installer & CLI Integration:**
   - `installer.js` (AO Beta-Banner, `doctor`-Routing, Windows `.cmd`/`.ps1`-Wrapper)
   - `package.json`
3. **Offline ECC Store:**
   - `bin/aos-store.mjs`
   - `lib/ecc-store-index.json`
   - `tests/aos-store.test.mjs`
4. **MCSC & Native Todo Streaming:**
   - `mcp_config.json`
   - `skills/global_config/mcsc/SKILL.md`
   - `skills/global_config/agenttrail/bin/agenttrail.mjs`
5. **Archify Contracts & Security Hardening:**
   - `lib/aos-archify-contract.mjs`
   - `skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js`

---

## 3. Critical Verification Points

1. **Cross-Platform Robustness (macOS vs. Windows):**
   - Check path resolution in `aos-doctor.mjs` and `installer.js` (`where.exe`, `%APPDATA%`, `process.platform === 'win32'`).
   - Ensure the AMFI codesigning probe (`codesign -v`) does not crash on Windows/Linux.
2. **Security Boundaries & Path Traversal:**
   - Verify `resolveWithinDir` in Plan-Canvas prevents directory traversal (`../../etc/passwd`).
   - Verify `readCapped` in AgentTrail protects against memory exhaustion (OOM) on large payloads (> 1 MB).
3. **Hook Interference & GO-Gate:**
   - Ensure CLI tools do not bypass `go-gate.mjs` or `graph-gate.mjs`.
4. **Offline Functionality:**
   - Test that `aos-store` and `aos-doctor` operate without outbound requests unless `--net` is explicitly passed.

---

## 4. Verification Commands

```bash
# 1. Run all unit tests in AOS
npm test

# 2. Security and contract test suites
node tests/agenttrail-security.test.mjs
node tests/plan-canvas-security.test.mjs
node tests/archify-contract.test.mjs

# 3. Doctor in JSON mode
node bin/aos-doctor.mjs --json
```

---

## 5. Output Format for Review Findings

Classify all findings according to precedence:
- `[CONTRACT_MISREAD]` (Blocker: breach of architecture contract)
- `[VALID_ACTIONABLE]` (Blocker: actionable bug, vulnerability, or regression)
- `[VALID_TRADEOFF]` (Non-blocker: intentional tradeoff)
- `[NOISE]` (Informational / style preference)

Output artifact: `production_artifacts/review_findings.md`.
