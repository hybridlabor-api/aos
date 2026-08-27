---
name: bdb-dev-os-skill
description: Use when internal maintainer rules for the BDB Agent OS Ecosystem (Tim & Noah only).
category: bdb-core
---

# BDB Ecosystem Release Rules

1. **Private by Default:** All GitHub repositories are private. Distribution is strictly via NPM Tarballs.
2. **Version Pinning:** The installer must pin exact, validated semantic versions. No `latest`.
3. **Cross-Commit Awareness:** Always audit ecosystem modules when the Kernel updates, and vice versa.
4. **Sub-Modul Liste:**
   - `bdb-synapse`
   - `memB`
   - `heimdall-token-saver`
   - `bdb-os-agent-workspace`
   - `creator-extension`
   - `bdb-os-remote`

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
