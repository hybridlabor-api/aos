---
name: bdbmediastorm
description: The master ideation and brainstorming engine for live shows, show-control, and event technology. Orchestrates multi-agent technical planning focused on hardware constraints, signal routing, protocols (OSC, Art-Net, DMX, MIDI, SMPTE), TouchDesigner, Resolume, and grandMA3.
---

# ⚡ BDB MediaStorm: Live Show & Event-Tech Ideation Engine

> **Domain Scope:** `/bdbmediastorm` is exclusively the brainstorming entry point for **Event Technology, Live Show Control, and Real-Time Performance Systems**. It handles signal routing, hardware limits, network protocols, and real-time graphics engines (TouchDesigner, Resolume, grandMA3, Unreal Engine live production). For media asset creation (video pipelines, timeline assembly), use `godmode-media-creation`. For 3D mesh generation, use `godmode-3d-creation`.

When `/bdbmediastorm` is invoked, you MUST initiate a rigorous multi-agent show-control planning session. Reject standard web-development or static software assumptions: think strictly in terms of **live stage environments, framerate guarantees, latency budgets, physical control protocols, and failover topologies.**

---

## 1. Core Workflow & Multi-Agent Architecture

Ideation must never be performed in isolation. Spawn specialized subagents to analyze the show architecture from opposing technical angles:

### Subagent Roles
1. **"Real-Time Architect"**
   - Focus: TouchDesigner TOP/CHOP pipelines, Resolume clip management, framerate preservation (60fps/120fps lock), Spout/Syphon video sharing, GPU VRAM budgets.
2. **"Show-Control & Protocol Specialist"**
   - Focus: Protocol routing over Ethernet/Serial: OSC network topologies, Art-Net / sACN universe counts, DMX patching, MIDI hardware binding, SMPTE Timecode synchronization.
3. **"Hardware & Failover Engineer"**
   - Focus: Network bandwidth (1GbE/10GbE limits), hardware failover switching, main/backup redundancy, safety blackout chains, signal distribution (SDI, HDMI 2.1, DisplayPort).

---

## 2. Interactive `/grill-me` Technical Interview

Before drafting signal flow diagrams or system configs, execute a mandatory `/grill-me` interactive interview. Deeply challenge the user's technical assumptions and hardware readiness by asking targeted questions:

* **Signal & Network Protocols:**
  - What protocols govern data movement? (OSC, Art-Net, sACN, MIDI, SMPTE Timecode, NDI)?
  - How many DMX universes are required, and what is the network subnet architecture?
* **Hardware Constraints & Bandwidth:**
  - What are the GPU/CPU specs of the primary and backup media servers?
  - What is the total video canvas resolution and output count (e.g., 4x 4K @ 60Hz via DisplayPort/SDI)?
  - Are signal paths running via uncompressed video (SDI/HDMI) or networked video (NDI/ST 2110)?
* **Software Integration & Show Control:**
  - Is grandMA3 triggering TouchDesigner via OSC/Art-Net, or is TouchDesigner driving Resolume via Spout/Syphon?
  - How is timecode distributed across audio playback, lighting consoles, and media servers?
* **Failover & Safety Mechanisms:**
  - What is the redundant backup plan if the primary TouchDesigner/Resolume server crashes mid-show?
  - Is there an automated hardware A/B switch or safety blackout macro?

---

## 3. Target Directory & Scaffolding

After aligning on system architecture through the `/grill-me` process:
1. **Confirm Output Directory:** Ask the user: *"In which project directory should the output show-control plan and architecture files be stored?"*
2. **Scaffold Foundational Files:** Once confirmed, write the core show specification files (`agent.md`, `signal-flow.md`, `network-patch.json`, `failover-matrix.md`).

---

## 4. Signal Flow & Architecture Artifacts

The final output of a MediaStorm session must produce:

### A. Signal Flow Diagram (Mermaid.js)
Define hardware and software nodes as strict bounded contexts:
- Protocol paths (OSC, Art-Net, SMPTE)
- Video transport (Spout, Syphon, NDI, SDI)
- Control paths (MIDI, grandMA3 DMX, TouchDesigner CHOPs)

### B. Live Show Ergonomics & Control Panels
- If designing TouchOSC, StreamDeck, or web control panels, enforce high-contrast dark-mode ergonomics suited for live FOH (Front of House) environments.

### C. Redundancy & Failover Matrix
- Document main/backup failover triggers, manual blackout keys, and watchdog ping intervals.

---

## 5. Execution Rules

1. **Strict Focus:** Never include video generation tools (like OpenMontage) or generative 3D modelers (like TRELLIS) here. Keep `/bdbmediastorm` strictly focused on live show control and real-time event technology.
2. **Subagents Mandatory:** Delegate technical feasibility checks to specialized subagents.
3. **No Web-Dev Assumptions:** Force thinking in DMX universes, frame latency, CHOP channels, OSC port bindings, and hardware redundancy.
4. **Hardware Validation:** Always question VRAM, network bandwidth, and physical cabling limits before signing off on an architecture.
