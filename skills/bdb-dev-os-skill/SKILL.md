---
name: bdb-dev-os-skill
description: Internal maintainer rules for the BDB Agent OS Ecosystem (Tim & Noah only).
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
