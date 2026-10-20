---
name: godmode-eventtech
description: "Real-time show-control execution: signal flows, OSC/DMX, MCP orchestration. grandMA3, Resolume, Unreal, Rhino, Vectorworks, Adobe."
category: media-eventtech
---

# 🎛️ BDB EventTech Godmode

This skill is the architectural authority for **Real-Time Performance, Signal Flow, Protocol Routing, and Hardware Limits** in live show and event-tech environments. It defines how agents must execute real-time graphics pipelines, hardware-level show control, and multi-server communication without compromising stability or latency.

---

## Plan first

Planning starts on the plan canvas with the `show-control` template, and the human approves it there — not in chat.

One live show or event: lighting, video, audio and network in a single reviewable technical document.

```bash
aos-plan-canvas new show-control <plan-dir>                     # scaffold the plan folder
aos-plan-canvas open <plan-dir> --mode bdb-plan-builder  # render and open in the browser
aos-plan-canvas await <plan-dir>/plan.mdx                # keep listening until the verdict
```

On `approve`, `aos-plan-canvas trail <plan-dir>` derives the agenttrail map for the build. The full loop and every template: the `plan-canvas` skill — a plain CLI, identical on every harness.

## 1. Role & Architectural Boundaries

For agency-layer tasks (vendor management, production coordination, inbox triage,
pre-show logistics), load `bdb-eventagency-skill` alongside this skill.

* **Real-Time & Live Show Authority:** Focuses on deterministic frame timing, zero-latency signal routing, hardware boundaries, and physical protocol management (OSC, Art-Net, sACN, DMX, MIDI, SMPTE, NDI, Spout/Syphon).
* **Peer Integration:** Operates alongside specialized media and 3D creation skills, enforcing strict hardware stability, network bandwidth limits, and live-environment fault tolerance across all event technology systems.

---

## 2. Real-Time Performance & Signal Flow Rules

Generative show-control and live performance engines operate under strict real-time constraints where frame drops or dropped packets are fatal.

* **Zero Latency Spikes:** Never poll a live server (TouchDesigner, Resolume, grandMA3) via blocking REST calls at 60fps. Utilize optimized, low-overhead protocols (OSC, Shared Memory, direct C++ bindings, or WebSocket events).
* **Deterministic Signal Topology:** Signal loops and feedback networks must be explicitly bounded (e.g., TouchDesigner Feedback TOPs must enforce explicit 1-frame delays to prevent infinite stack depth or race conditions).
* **Framerate Lock & Buffer Strategy:** Design pipelines with guaranteed 60fps/120fps headroom. Explicitly account for VRAM fill rate, canvas compositing limits, and SDI/HDMI sync timing.

---

## 3. Hardware Limits & MCP Validation

Before triggering high-resolution real-time renders or compiling complex node graphs:

* **MCP Health Validation:** Validate that all required supported MCP servers (e.g., TouchDesigner MCP, grandMA3 MCP, Resolume MCP, Unreal MCP) are active and responsive before executing node changes or patch operations.
* **Hardware & VRAM Auditing:** Check GPU VRAM allocation, display output resolutions, and CPU core loading. Ensure real-time rendering tasks leave sufficient VRAM margin for video capture buffers and texture sharing.
* **Network & Bandwidth Budgeting:** Account for total network payload. Calculate Art-Net universe bandwidth (approx. 250 Kbps per universe) and NDI stream bitrates (100–250 Mbps for 1080p60/4K60) to prevent NIC saturation.

---

## 4. Live Environment Failovers & Redundancy

* **Safety Blackouts & Emergency Macros:** System designs MUST include hardware or software safety blackout chains and immediate manual takeover toggles.
* **Main / Backup Redundancy:** For critical live productions, enforce dual-server tracking (Main/Backup) with automated heartbeat monitoring and instantaneous seamless signal switching.

---

## 5. Dedicated MCP Tool Validation Requirement

When orchestrating event-tech workflows, the agent MUST validate the availability of the required supported MCP tools before issuing node modification commands or protocol bindings:

1. **TouchDesigner / Node Control**: Validate TouchDesigner MCP tools (`get_td_nodes`, `create_td_node`, `update_td_node_parameters`).
2. **Lighting & DMX Systems**: Validate Lighting / grandMA3 MCP tools for fixture patching and cue execution.
3. **Real-Time Rendering & Engines**: Validate Unreal Engine or Resolume MCP connections for real-time video compositing and scene execution.

---

## Universal Agent Harness Integration

This Godmode rulebook is universally available across the BDB ecosystem:
* **Cursor:** Referenced via `.cursor/rules/godmode-eventtech.mdc`.
* **Claude Code / CLI Agents:** Loaded during `/bdbmediastorm` and live event-tech execution sessions.


## Overview
This skill acts as the architectural authority for real-time performance systems, enforcing hardware limits, deterministic frame timing, and zero-latency protocol routing.

## When to Use
- **Trigger:** The user is designing or modifying a real-time graphics pipeline, network protocol binding, or live performance showfile.
- **Exclude:** Do not use for pre-rendered video editing or offline 3D rendering.

## Core Process
1. Audit the current GPU VRAM allocation and network bandwidth budget.
2. Validate that required MCP servers (TouchDesigner, grandMA3, Resolume) are active and responsive.
3. Implement node or patch changes using low-overhead protocols (OSC, Shared Memory).
4. Establish a hardware/software safety blackout chain.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "We can poll the REST API at 60fps for live data." | Blocking REST calls cause frame drops; use OSC or WebSocket events for real-time sync. |
| "Feedback loops don't need a delay if the PC is fast." | TouchDesigner Feedback TOPs must enforce a 1-frame delay to prevent infinite stack depth crashes. |
| "Art-Net can share the main internet network." | Art-Net requires a dedicated subnet to prevent packet collision and broadcast storms. |

## Red Flags

- Designing a pipeline using HTTP polling instead of UDP/OSC for real-time data.
- Failing to validate TouchDesigner or grandMA3 MCP health before sending commands.
- Ignoring VRAM limits when suggesting 4K output streams.

## Verification

- [ ] MCP server health (e.g., `bdb_td_minddesigner`) was validated before execution.
- [ ] Network bandwidth and VRAM budgets are explicitly calculated in the plan.
- [ ] Real-time control relies on OSC, MIDI, or DMX/Art-Net, not blocking HTTP calls.



---

## Live show Pack Skills

<!-- aos:pack-index:start -->
- **bdb-grandma3-mcp** — Utilizes the grandMA3 MCP server to patch fixtures, execute console commands, and trigger macros via OSC.
- **bdb-resolume-mcp** — Utilizes the Resolume Arena MCP server to trigger clips, clear layers, adjust speeds, and query composition status via the Resolume REST API.
- **bdb-touchdesigner-mcp** — Utilizes the TouchDesigner MCP servers (tdmcp and touchdesigner-mcp) to create TOP/CHOP chains, script operators, inspect parameters, and debug node networks.
- **bdb-unreal-mcp** — Utilizes the Unreal Engine MCP server to control UE5 via a native C++ Automation Bridge plugin.
- **bdb-vectorworks-mcp** — Utilizes the Vectorworks RAG + MCP server to search and retrieve Python and VectorScript API documentation.
- **bdb-rhino-mcp** — Utilizes the Rhino MCP servers (RhinoMCP and golem-rhino-mcp) to create and manipulate 3D models and run Grasshopper graphs.
- **mcp-manage** — "Use when checking capabilities or instructing the user on how to interact with specialized MCP servers like Unreal, Rhino, DaVinci, or TouchDesigner."
- **bdb-computer-use-mcp** — Utilizes native Rust/Node and Python-based computer-use-mcp servers to control macOS, Windows, and Linux desktops.

**Install:** `aos store install --pack live-show`
<!-- aos:pack-index:end -->
