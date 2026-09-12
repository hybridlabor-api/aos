---
name: bdb-touchdesigner-mcp
description: Utilizes the TouchDesigner MCP servers (tdmcp and touchdesigner-mcp) to create TOP/CHOP chains, script operators, inspect parameters, and debug node networks.
category: media-eventtech
---

# TouchDesigner MCP — Integration and AI Agent Guide

This skill file instructs AI agents on how to construct real-time visual systems inside TouchDesigner using the `tdmcp` (MindDesigner) and `touchdesigner-mcp` (Backup) integrations. It details node building, operator classes, preview generation, and troubleshooting steps.

## 1. Overview and Pipeline Value

The **TouchDesigner MCP (MindDesigner)** server enables AI models to programmatically construct, connect, parameterize, and debug node networks in TouchDesigner. In the BDB OS architecture, this automates audio-reactive particle simulations, feedback systems, projection mapping, GLSL shader chains, and data visualizations.

### Architecture
- **In-Process WebServer / Socket Bridge:** A custom component (e.g. `tdmcp_bridge_package.tox` or `mcp_webserver_base.tox`) is placed inside TouchDesigner. It listens on a local port and translates incoming JSON commands to Python operations (like `parent().create(noiseTOP)`).
- **Dual Server Layout:**
  - *`tdmcp` (MindDesigner):* Runs on port `9980`. Focuses on creative visual engineering with 332 high-level generation tools.
  - *`touchdesigner-mcp` (Backup/Direct):* Runs on port `9981`. Focuses on atomic node CRUD and low-level scripting fallback.

---

## 2. System Instructions

### Workflow Priorities
1. **Bridge Verification first:** Always call `get_td_info` to confirm the TouchDesigner bridge is reachable and running compatible versions.
2. **Consult Operator Knowledge:** Consult the operator library before placing nodes. Never guess operator types or namespaces (e.g. use `noiseTOP` for a Noise TOP, `constantCHOP` for a Constant CHOP).
3. **Structured Tools first:** Prefer structured inspection and modification tools (`find_td_nodes`, `get_td_node_parameters`, `update_td_node_parameters`, `get_td_node_errors`) over raw Python execution. Use `execute_python_script` only when no structured tool fits the request.
4. **Visual Feedback:** After creating or modifying a network, call `get_preview` or `get_inline_preview` so the user can verify the rendering in real-time.

---

## 3. Available Tools and API Parameters

### High-Level Creative Tools (`tdmcp`)
- **`create_audio_reactive(layer_name: string)`**: Sets up a complete audio spectrum analyzer routing to video modifiers.
- **`create_feedback_network(parent: string, input_op: string)`**: Creates a feedback loop using feedback, blur, level, and composite TOPs.
- **`create_particle_system(parent: string)`**: Generates a GPU particle flow using SOPs, CHOPs, and TOPs.
- **`animate_parameter(op_path: string, par_name: string, chop_expr: string)`**: Binds a node parameter to a CHOP expression.

### Atomic Node Tools (`touchdesigner-mcp` & fallback)
- **`create_td_node(type: string, path: string, name: string)`**: Places a single node in a network container.
- **`delete_td_node(path: string)`**: Deletes an operator.
- **`connect_nodes(from_op: string, to_op: string, from_connector?: int, to_connector?: int)`**: Connects outputs to inputs.
- **`get_td_nodes(path: string)`**: Lists all operators in a specific network.
- **`get_td_node_errors(path: string)`**: Checks for active operator errors (red flags) recursively.
- **`update_td_node_parameters(path: string, parameters: object)`**: Modifies parameter settings.

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: Procedural Feedback Loop (MindDesigner)
Generate a feedback warp tunnel TOP chain:

```json
// Step 1: Create noise source
// Tool: create_td_node(type="noiseTOP", path="/project1", name="noise_src")

// Step 2: Set noise parameters
// Tool: update_td_node_parameters(path="/project1/noise_src", parameters={"resolutionw": 1080, "resolutionh": 1080, "period": 2.5})

// Step 3: Set up feedback loop
// Tool: create_feedback_network(parent="/project1", input_op="/project1/noise_src")
```

### Recipe 2: Run Custom Python Script for Network Connection
Connect a series of CHOPs programmatically when structured connection tools are not flexible enough:

```python
# Call tool: execute_python_script(script="...")
parent_comp = op('/project1')
lfo = parent_comp.create(lfoCHOP, 'oscillator')
math_op = parent_comp.create(mathCHOP, 'modifier')
null_op = parent_comp.create(nullCHOP, 'out_signal')

# Connect ports
math_op.inputConnectors[0].connect(lfo)
null_op.inputConnectors[0].connect(math_op)

# Set Math CHOP range multiplier
math_op.par.mult = 100.0
```

---

## 5. Troubleshooting and Connection Details

### Configuration and Ports
- **MindDesigner Port:** `9980` (`TDMCP_PORT` environment variable)
- **Backup Controller Port:** `9981` (WebServer port)
- **Verify Endpoint Availability:**
  ```bash
  # Check if MindDesigner is reachable
  curl http://localhost:9980/api/info
  ```

### Bridge Installation inside TouchDesigner
1. Download `tdmcp_bridge_package.tox` or `mcp_webserver_base.tox`.
2. Drag the `.tox` component directly into your active network pane (e.g. `/project1`).
3. Press **Install** / verify the active port is running.

Alternative Textport Bootstrap Installation:
Open TouchDesigner Textport (`Dialogs -> Textport and DATs`), paste and run:
```python
import urllib.request; exec(urllib.request.urlopen("https://github.com/Pantani/tdmcp/raw/v0.12.0/td/bootstrap.py").read().decode())
```

### Common Errors and Fixes
1. **`TouchDesignerClient ECONNREFUSED`**
   - *Cause:* The bridge component is either not installed or disabled in TouchDesigner.
   - *Fix:* Ensure you dragged the `.tox` component into the project and that its internal server is toggled active.
2. **`Operator compilation error or red flag`**
   - *Cause:* An invalid parameter type or code was set.
   - *Fix:* Run `get_td_node_errors` on the path of the flagged node to read the compiled compiler/interpreter traceback.
3. **`Version Mismatch Warning`**
   - *Fix:* Download the latest bridge zip file from releases, delete the old `touchdesigner-mcp-td` folder in your project, restart TouchDesigner, and drop in the new `.tox`.
