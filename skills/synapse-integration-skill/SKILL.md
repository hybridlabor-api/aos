---
name: synapse-integration-skill
description: Global skill for BDB Synapse (3D Codebase Visualizer) integration.
category: bdb-core
---

# BDB Synapse Integration

This skill provides access to BDB Synapse tools (`mindwalk`, `judge`, `adapter`, `citymap`, `model`).
Use these tools to generate spatial 3D maps of codebases and evaluate multi-agent sessions.

- **Initialization:** When starting a new conversation in a project, trigger `synapse map <repo>` to visualize the workspace.
- **Tools:** The agent should use Synapse CLI to understand the codebase context spatially alongside memB and OpenWiki.
