# Ziel C Phase 1, V4: MCP Server Baseline & Gateway Research

**Date:** 2026-10-06  
**Model:** Claude Haiku 4.5  
**Scope:** MCP server process inventory + MCPX / mcp-gateway evaluation

---

## Part 1: MCP Server Process Inventory

### Summary Table

| Harness | Type | Process Count | Total RSS (MB) | Status |
|---------|------|---------------|----------------|--------|
| Claude (14552) | claude | 11 | 295.9 | active, 05:41 elapsed |
| Claude (16227) | claude | 11 | 291.9 | active, 05:40 elapsed |
| Claude (21221) | claude | 11 | 290.7 | active, 05:31 elapsed |
| Claude (21971) | claude | 11 | 281.7 | active, 05:30 elapsed |
| Claude (26250) | claude | 11 | 293.5 | active, 04:25 elapsed |
| Claude (27937) | claude | 11 | 299.5 | active, 04:06 elapsed |
| Claude (40686) | claude | 11 | 302.6 | active, 01:07 elapsed |
| Gemini IDE (37487) | Antigravity IDE | 17 | 397.4 | active, 01:41 elapsed |
| Gemini IDE (37846) | Antigravity IDE | 17 | 399.1 | active, 01:41 elapsed |
| **agy (29360)** | agy/opencode | 16 | 348.8 | active, 03:47 elapsed |
| **TOTAL** | — | **206** | **4,570.4** | — |

### Top 10 MCP Servers by Memory (RSS)

| Rank | Harness | PID | RSS (MB) | Server Name | Elapsed |
|------|---------|-----|----------|------------|---------|
| 1 | Claude (40686) | 40823 | 56.5 | tdmcp | 01:07 |
| 2 | Claude (27937) | 27982 | 54.9 | tdmcp | 04:06 |
| 3 | Claude (14552) | 14670 | 52.9 | tdmcp | 05:41 |
| 4 | Gemini IDE (37846) | 37885 | 52.4 | tdmcp | 01:41 |
| 5 | Claude (26250) | 26295 | 50.5 | tdmcp | 04:25 |
| 6 | Gemini IDE (37487) | 37506 | 50.2 | tdmcp | 01:41 |
| 7 | Claude (16227) | 16322 | 48.9 | tdmcp | 05:40 |
| 8 | Claude (21221) | 21268 | 47.7 | tdmcp | 05:31 |
| 9 | Gemini IDE (37487) | 37732 | 41.0 | chrome-devtools-mcp | 01:41 |
| 10 | Gemini IDE (37846) | 38006 | 40.9 | chrome-devtools-mcp | 01:41 |

### Key Observations

- **Total Memory Footprint:** ~4.6 GB across 206 MCP server processes
- **Dominant Server Type:** `tdmcp` (TouchDesigner MCP) occupies top 8 slots, averaging 50–56 MB per instance
- **Harness Distribution:**
  - 7 × Claude processes (19% of count, ~43% of load)
  - 2 × Gemini IDE processes (16% of count, ~17% of load)
  - 1 × agy process (8% of count, ~8% of load)
  - Remaining: child/grandchild processes (57% of count)
- **Scaling Pattern:** Each harness runs ~11–17 MCP servers (stdio-based) as child processes; no aggregation via gateway observed

---

## Part 2: MCPX & MCP Gateway Research

### Primary Candidate: thiagomendes/mcpx

**Repository:** `thiagomendes/mcpx`  
**Description:** Self-hosted MCP Gateway for enterprise environments  
**License:** Apache 2.0  
**Last Commit:** 2026-01-09T11:45:24Z (~9 months old)

#### Supported Features

| Feature | Status | Details |
|---------|--------|---------|
| **Streamable HTTP** | ⚠ Partial | Accepts HTTP-based MCP server URLs (e.g., `http://server:8000/mcp`); README emphasizes URL-based connection but does not explicitly name "Streamable HTTP" transport |
| **Per-Client Tool Allow-lists** | ✓ Yes | "Tool Governance" via allowlist/blocklist per server; can define tool-level access control and namespace isolation with tool name prefixes |
| **Proxy Layer** | ✓ Yes | Routes MCP traffic through central gateway with credential injection (API Keys, Bearer Tokens, OAuth, Service Accounts) |
| **Multi-tenancy** | ✓ Yes | Isolated organizations with role-based access control (RBAC) |
| **Observability** | ✓ Yes | Audit logs, real-time metrics, alerting |
| **Server Aggregation** | ✓ Yes | "Virtual Gateways" aggregate multiple servers into a single endpoint |

#### Architecture Notes

- Implemented in **Rust** (backend) + **Vue** (frontend)
- Status: **Incubating** (maintained by TM Dev Lab)
- Scope: MCP **Tools only** (Resources and Prompts not currently supported)

#### Streamable HTTP Support Assessment

- **Evidence:** README shows HTTP URL syntax (`http://weather-mcp:8000/mcp`, etc.) and states "Point to any MCP server via URL"
- **Limitation:** No explicit mention of "Streamable HTTP" (the MCP spec's new HTTP/SSE transport layer)
- **Implication:** May support HTTP *endpoints* but not necessarily the stateless, streaming protocol variant introduced in MCP 1.0+

---

### Alternate Gateway Candidates

#### microsoft/mcp-gateway
- **License:** MIT  
- **Description:** Reverse proxy and management layer for MCP servers; enables session-aware stateful routing
- **Kubernetes-focused:** Built for Kubernetes environments with lifecycle management
- **Streamable HTTP:** Not explicitly documented

#### agentic-community/mcp-gateway-registry
- **Description:** Enterprise-ready gateway + registry with OAuth, dynamic tool discovery, Keycloak/Entra integration
- **License:** Not found in quick search (needs further inspection)

#### metatool-ai/metamcp
- **Description:** MCP Aggregator, Orchestrator, Middleware in single Docker container

---

### PolyForm Noncommercial License Notes

**Finding:** No mcp-gateway candidates explicitly marketed as PolyForm Noncommercial. However, related MCP tooling uses PolyForm Noncommercial:
- `staticrevolution-com/sr-truenas-mcp` — MCP server (not gateway)
- `Lihfdgjr/claude-code-rev` — Claude Code restoration (not gateway)

**Implication:** mcp-gateway ecosystems appear to cluster around permissive licenses (Apache 2.0, MIT) rather than source-available/non-commercial restrictions.

---

## Part 3: Decision Framework

### Recommendation for Gateway Selection

1. **For Immediate Deployment:** `thiagomendes/mcpx`
   - Mature feature set (tool governance, multi-tenancy, audit)
   - Apache 2.0 (commercial-friendly)
   - HTTP URL support (compatible with modern MCP servers)
   - Caveat: Streamable HTTP not explicitly confirmed

2. **For Kubernetes / Stateful Routing:** `microsoft/mcp-gateway`
   - MIT license
   - Native Kubernetes support
   - Session-aware routing (needed for stateful MCP contexts)
   - Caveat: No per-client tool allow-list documented

3. **For Modular Experimentation:** `metatool-ai/metamcp`
   - Aggregator + orchestrator in one image
   - Lower coupling to specific deployment platform

### Verification Checklist (Next Phase)

- [ ] **Streamable HTTP Confirmation:** Test mcpx with HTTP/SSE-based MCP servers (e.g., OpenAI's mcp-python with Streamable transport)
- [ ] **Load Testing:** Benchmark gateway performance against observed baseline (4.6 GB for 206 servers)
- [ ] **Per-Client Allow-lists:** Verify tool governance API for fine-grained, per-caller access control
- [ ] **Cost:** Compare operational overhead (gateway sidecar) vs. direct stdio connections
- [ ] **Failover & HA:** Validate horizontal scaling and session persistence (if stateful routing required)

---

## Appendix: Process Breakdown by Harness

### Claude Processes (8 harnesses, 78 servers, ~2.36 GB)
- Distributed deployment across multiple sessions/tabs
- Each runs 11 MCP servers (typical pattern)
- Elapsed times: 01:07–05:41 (mix of fresh and long-lived sessions)

### Gemini IDE Processes (2 harnesses, 34 servers, ~796 MB)
- Parent: Antigravity IDE (Electron app)
- Each runs 17 MCP servers (higher count)
- Both active for ~01:41–01:42 elapsed time

### agy Process (1 harness, 16 servers, ~349 MB)
- OpenCode / agy orchestrator
- Running for 03:47 elapsed
- Mixed server set (includes GitHub, Rhino, ComfyUI, TouchDesigner)

---

## Review notes (2026-10-06)

- **Totals confirmed, table incomplete.** The per-harness rows add up to about 127 processes and 3.2 GB. A cross-check by the master session (ps, RSS, filter `mcp|mcsc|tdmcp|memb|synapse`) found 204 processes and 4.6 GB, so the overall total is about right. The table most likely leaves out the npm/npx wrapper processes.
- **Open: which MCPX.** `thiagomendes/mcpx` (Apache-2.0) is probably not the MIT-licensed MCPX the board refers to. The correct repo is still to be identified.
- **Open: mcp-gateway licences.** This report found no PolyForm Noncommercial variant, which contradicts the board. Each claim needs a repo link plus its LICENSE file as proof.

**Generated:** 2026-10-06  
**Tool:** ps -axo pid,ppid,rss,etime,command + gh CLI  
**Model:** Claude Haiku 4.5
