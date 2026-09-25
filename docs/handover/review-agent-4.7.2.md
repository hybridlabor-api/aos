# 🔍 Adversarial Review Brief: AOS v4.7.2 Release Candidate (PR #59)

> **Purpose:** Independent adversarial audit (Doubt-Driven Development) of changes for release **v4.7.2** resolving review findings **F-01 through F-04**.  
> **Repository:** `~/dev/bdb-dev/bdb-dev-optimized-agent-skills`  
> **Branch:** `release/v4.7.2`  
> **PR:** [hybridlabor-api/aos#59](https://github.com/hybridlabor-api/aos/pull/59)  

---

## 1. Overview of Changes

| Finding | Class | File(s) | Fix Description |
|---|---|---|---|
| **F-01** | `[CONTRACT_MISREAD]` | `bin/aos-doctor.mjs`, `skills/global_config/aos-setup/scripts/aos-doctor.mjs` | Wired `NET` flag and Windows `.cmd` execution (`npm.cmd` + `{ shell: IS_WIN }`). Network version check against npm is skipped in offline mode by default, executed cleanly on Windows and POSIX when `--net` is passed. |
| **F-02** | `[VALID_ACTIONABLE]` | `bin/aos-store.mjs` | Offline guard: non-dry-run installations require explicit `--net` flag to download upstream community skills. Dispatcher and docs updated. `--dry-run` remains completely offline. |
| **F-03** | `[VALID_ACTIONABLE]` | `bin/aos-doctor.mjs`, `installer.js` | Shell injection eliminated: removed string interpolation in `codesign`, `launchctl`, and `ao service install` in favor of argument arrays via `execFileSync`. Removed unused `execSync` imports. |
| **F-04** | `[VALID_ACTIONABLE]` | `installer.js`, `bin/aos-doctor.mjs`, `skills/global_config/aos-setup/scripts/aos-doctor.mjs` | Windows probes standardized on `where.exe` across installer and doctor. Hardened POSIX binary regex to `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` to reject option injection (e.g. leading `-`). |
| **P-01** | `[VALID_ACTIONABLE]` | `package.json`, `.npmignore` | Excluded `docs/handover/**` from npm tarball distribution, and sanitized internal developer references to generic relative paths. |

Unit tests added and verified in `tests/aos-doctor.test.mjs` and `tests/aos-store.test.mjs`.

---

## 2. Review Checklist

Verify the following points adversarially:

1. **No Remaining Shell Injections:**
   - Confirm `bin/aos-doctor.mjs` and `installer.js` use `execFileSync` with argument arrays for external commands.
   - Verify regex `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` in `installer.js:hasExecutable` disallows leading hyphens and shell metacharacters.
2. **Offline-First Contract:**
   - Verify `node bin/aos-doctor.mjs --json` runs completely without outbound network sockets.
   - Verify `node bin/aos-store.mjs install <skill>` without `--net` aborts before attempting network access.
3. **Cross-Platform Robustness:**
   - Verify `where.exe` is consistently queried on Windows.
   - Verify `npm.cmd` and `shell: IS_WIN` are properly used on Windows for npm checks.
4. **Package Sanitization:**
   - Run `npm pack --dry-run` and verify `docs/handover` is NOT included in the published files.
5. **Test Completeness:**
   - Run all test suites (`npm test` and security suites).

---

## 3. Verification Commands

```bash
# 1. Inspect diff against main
git diff origin/main..HEAD

# 2. Offline doctor test
node bin/aos-doctor.mjs --json

# 3. Online doctor test
node bin/aos-doctor.mjs --json --net

# 4. Offline store guard
node bin/aos-store.mjs install django-patterns --project

# 5. Full test suite
npm test

# 6. Security and contract test suites
node --test tests/agenttrail-security.test.mjs tests/plan-canvas-security.test.mjs tests/archify-contract.test.mjs tests/mcsc-registration.test.mjs

# 7. Verify npm pack output excludes handover docs
npm pack --dry-run 2>&1 | grep "docs/handover"
```

---

## 4. Expected Report Format

Classify findings by precedence:
- `[CONTRACT_MISREAD]`: Architectural or interface contract breach.
- `[VALID_ACTIONABLE]`: Bug, security vulnerability, or unintended regression requiring immediate fix.
- `[VALID_TRADEOFF]`: Intentional tradeoff with documented rationale.
- `[NOISE]`: Informational or stylistic note.

Verdict: `SHIP` or `DO NOT SHIP` with explicit rationale.
