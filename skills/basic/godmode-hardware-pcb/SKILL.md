---
name: godmode-hardware-pcb
description: "Use when designing electrical schematics, PCB layouts, KiCad projects, or OpenSCAD enclosures — trace geometry, impedance, stackup, DFM/DRC/ERC sign-off, and hardware-software co-design boundaries."
category: engineering-hardware
---

# ⚡ BDB Hardware & PCB Godmode

This skill is the architectural authority for **Electrical Schematics, PCB Layout, Physical Constraints, and Manufacturing Sign-Off** in the AOS hardware engineering pipeline. It defines how agents must derive physical parameters from first principles, validate designs against IPC standards, and gate release to fabrication — without compromising on measurable, machine-checkable evidence.

---

## 1. Role & Architectural Boundaries

* **Physical Design Authority:** Governs schematic capture, board layout, layer stackup, netclass definition, controlled-impedance routing, and DFM/DFA sign-off across KiCad-driven projects. Also governs parametric enclosure and mechanical co-design via OpenSCAD.
* **Peer Integration:** Operates alongside `godmode-engineering` (firmware and software running on the board) and `godmode-eventtech` (live show-control hardware in the field) — this skill owns the board and enclosure itself, not the code that runs on it or the show that uses it. A request that touches firmware register maps or a live show's signal budget hands off to those peers instead of being re-derived here.
* **No Informal Constraints:** A schematic or layout may never proceed on default trace widths, unconstrained nets, or "it looked fine in the 3D viewer." Every physical parameter traces back to a formula or a standard, not a guess.

---

## 2. Mathematical and Physical Foundations

All trace geometry and thermal boundaries are derived from first principles and IPC standards, never estimated by eye:

* **Trace Current Capacity (IPC-2152):** $I = k \cdot \Delta T^{0.44} \cdot A^{0.725}$, with $k = 0.048$ for external (convective) traces and $k = 0.024$ for internal (conductive-only) traces. A $2.5\text{A}$ DC rail at $\Delta T = 10^\circ\text{C}$ on $1\text{ oz}$ external copper needs $\approx 0.79\text{mm}$ trace width — not a rounded-up guess.
* **Controlled Impedance (IPC-2141):** Single-ended microstrip $Z_0 = \frac{87}{\sqrt{\varepsilon_r + 1.41}} \ln\left(\frac{5.98h}{0.8w+t}\right)$; edge-coupled differential $Z_{diff} \approx 2Z_0\left(1 - 0.48e^{-0.96 s/h}\right)$. USB is a $90\Omega$ differential target, Ethernet/PCIe is $100\Omega$ — these are not interchangeable, and getting the pair spacing wrong by a fraction of $h$ misses the target by more than manufacturing tolerance forgives.
* **DC IR Drop:** $R_{trace} = \rho \cdot L / (w \cdot t)$, $V_{drop} = I_{peak} \cdot R_{trace}$. On a $+3.3\text{V}$ rail, $V_{drop}$ must stay $\le 0.10\text{V}$ ($3\%$); if it doesn't, widen the trace or move the net to a copper flood — don't just note the number and move on.
* **Crosstalk (the 3W rule):** center-to-center separation $D \ge 3w$ for parallel traces longer than $15\text{mm}$ keeps mutual coupling below a $70\%$ reduction threshold. This is the default spacing assumption for any signal or clock line, not an optional refinement.

---

## 3. Headless Validation — the Unforgiving Gate

**No board may be released to fabrication on visual inspection or LLM self-attestation.** This is not a style preference; it's the same lesson this whole ecosystem has paid for repeatedly elsewhere: a clean-looking run is not evidence, a real exit code is.

* **ERC:** `kicad-cli sch erc --exit-code-violations -o reports/erc_report.txt project.kicad_sch` — exit 0 means zero errors and zero unhandled warnings, not "looks connected."
* **DRC:** `kicad-cli pcb drc --exit-code-violations --format json -o reports/drc_report.json board.kicad_pcb` — must show zero unrouted nets, zero clearance violations, zero broken annular rings, zero thermal spoke disconnections.
* **DFM/DFA:** benchmark the layout against the target fab house's real capabilities (e.g. JLCPCB standard, PCBWay 4-layer minimum trace/space/via), not a generic "should be fine" assumption.
* A non-zero exit code from any of the above is an immediate gate blockage — the pipeline halts, it does not continue with a caveat noted for later.

---

## 4. Dedicated MCP Tool Validation Requirement

Before issuing schematic edits, layout changes, or fabrication exports, the agent MUST validate the required MCP servers are actually reachable — not assume they are because a config file lists them:

1. **KiCad MCP:** validate the kicad-mcp-server responds over stdio (`tools/list` returns its full tool set — schematic editing, PCB layout, ERC/DRC execution, Gerber/BOM/CPL export) before issuing any node or netlist command.
2. **OpenSCAD MCP:** validate the openscad-mcp-server responds before requesting parametric model generation, modification, or STL/3MF export for enclosure co-design.
3. **Version awareness:** a stale or absent `kicad-cli` (KiCad 8+) or `openscad` binary on the host changes what's actually possible — check for it and say so plainly, rather than emitting commands that will fail downstream with no clear cause.

---

## 5. Hardware/Software Co-Design Boundary

* PCB and enclosure design decisions here must stay coordinated with, but not encroach on, the firmware/software skills that consume the resulting pinout and register map — a GPIO reassignment on the board is a breaking change to firmware that already assumed the old pin, and must be flagged as such, not silently absorbed.
* Mechanical (OpenSCAD) and electrical (KiCad) constraints are two halves of the same physical object: a connector placement that satisfies routing but collides with the enclosure wall is not a valid design, even if ERC/DRC both pass.

---

## Universal Agent Harness Integration

This Godmode rulebook is universally available across the BDB ecosystem, installed alongside the `@hybridlabor-api/bdb-hardware-pcb` module (KiCad + OpenSCAD MCP servers, 5 companion skills under the `engineering-hardware` category):
* **Claude Code / CLI Agents:** loaded during electrical, PCB, and enclosure design sessions.
* **Peer skills:** `code-first-hardware-design`, `pcb-constraint-definition`, `pcb-layout-routing-automation`, `pcb-validation-dfm-signoff`, `schematic-datasheet-analysis`.

## Overview
This skill acts as the architectural authority for electrical and PCB design, enforcing IPC-standard physical constraints, headless validation gates, and hardware/software co-design boundaries.

## When to Use
- **Trigger:** The user is designing or modifying a schematic, PCB layout, layer stackup, netclass, or an OpenSCAD enclosure meant to house the board.
- **Exclude:** Do not use for firmware/register-level software running on the board (hand off to `godmode-engineering`), or for live show-control signal routing in the field (hand off to `godmode-eventtech`).

## Core Process
1. Derive every trace width, impedance target, and clearance from the formulas above or a cited IPC standard — never from a rounded-up guess.
2. Validate KiCad and OpenSCAD MCP servers are actually responsive before issuing edits.
3. Run headless ERC and DRC with `--exit-code-violations`; treat any non-zero exit as a hard stop.
4. Benchmark the layout against the real target fab house's DFM limits before calling a design release-ready.
5. Cross-check the enclosure (OpenSCAD) against the board outline and connector placements (KiCad) before sign-off.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "0.25mm default trace width is fine for a power rail." | IPC-2152 current-capacity math, not the CAD tool's default, sets minimum trace width — a 2.5A rail needs ~0.79mm at 1oz copper, not the default. |
| "The 3D viewer looks correct, so the board is done." | A visual check is not ERC/DRC. Only a headless run with `--exit-code-violations` and a real exit code is evidence. |
| "USB and Ethernet differential pairs can use the same spacing." | USB targets 90Ω differential, Ethernet/PCIe targets 100Ω — same formula, different required spacing for the same dielectric height. |
| "The GPIO can be reassigned in layout; firmware can just adapt." | A pin reassignment is a breaking change to any firmware that already assumed the old pinout — it must be flagged to the software side, not silently absorbed. |

## Red Flags

- Proceeding to layout with unconstrained nets or no defined netclasses.
- Treating a clean-looking 3D render as equivalent to a passing ERC/DRC exit code.
- Skipping DFM benchmarking against the actual target fab house's capabilities.
- Changing a pinout or connector placement without flagging the firmware or enclosure impact.

## Verification

- [ ] Every load-bearing trace width/impedance/clearance traces back to a formula or IPC standard, not a default or a guess.
- [ ] ERC and DRC were run headless with `--exit-code-violations`, and the actual exit code — not a description of the run — was checked.
- [ ] KiCad and OpenSCAD MCP tool availability was validated before issuing edits.
- [ ] DFM limits were checked against the real target fab house, not a generic assumption.
- [ ] Any pinout/connector change was cross-checked against firmware assumptions and enclosure geometry.
