---
name: bdb-after-effects-mcp
description: Utilizes the After Effects MCP servers (after-effects-mcp and ae-mcp) to create compositions, layers, masks, keyframe animations, and run ExtendScript.
category: media-eventtech
---

# After Effects MCP — Integration and AI Agent Guide

This skill file instructs AI agents on how to control Adobe After Effects using the Node.js `after-effects-mcp` and Go `ae-mcp` integrations. It details ExtendScript scripting, layer manipulation, keyframe animation, and troubleshooting steps.

## 1. Overview and Pipeline Value

The **After Effects MCP Server** integrations enable AI assistants to programmatically control Adobe After Effects (2022+). They automate title design, motion graphics layouts, layer adjustments, mask path generations, and visual effects pipelines.

### Architecture
- **JSX Script Bridge:** Because After Effects lacks a native REST API, control is achieved using an ExtendScript (`.jsx`) panel.
- **`after-effects-mcp` (Node.js):** Writes commands to a local temp file. An AE panel script (`mcp-bridge-auto.jsx`) polls this file every few seconds, executes the script via AE's JavaScript engine, and writes the output back to disk.
- **`ae-mcp` (Go):** Exposes similar ExtendScript bridges and includes a **Manim Integration** to render mathematical equations using Python's Manim package and import them into AE as transparent WebP animations.

---

## 2. System Instructions

### Workflow Priorities
1. **Enable Scripting Preferences:** After Effects must have **"Allow Scripts to Write Files and Access Network"** enabled (`Preferences -> Scripting & Expressions`).
2. **Verify the Bridge Panel is Open:** Ensure the `mcp-bridge-auto.jsx` panel is loaded in After Effects (`Window -> mcp-bridge-auto.jsx`) and that the "Auto-run commands" checkbox is checked. Without it, commands will hang.
3. **Handle coordinates safely:** After Effects uses a 2D coordinate system originating from the top-left corner `[0,0]` of the active composition.
4. **ExtendScript Fallback:** If a high-level tool cannot perform a complex layer relationship task, write a custom script and execute it via the `run-script` tool.

---

## 3. Available Tools and API Parameters

### Node-based `after-effects-mcp` Tools

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| **`create-composition`** | `name: string`, `width: int`, `height: int`, `frameRate: float`, `duration: float` | Spawns a new comp in the active project. |
| **`run-script`** | `script: string` | Evaluates arbitrary ExtendScript code inside the AE DOM. |
| **`get-results`** | None | Reads the result of the last executed script. |
| **`setLayerProperties`** | `layerIndex: int`, `properties: object` | Adjusts position `[x,y,z]`, scale `[x,y,z]`, opacity, rotation, 3D status, or blendMode. |
| **`setLayerKeyframe`** | `layerIndex: int`, `propertyName: string`, `time: float`, `value: any` | Creates a keyframe on a layer property at a specified timeline position. |
| **`setLayerExpression`** | `layerIndex: int`, `propertyName: string`, `expression: string` | Binds a Javascript expression to a target property (e.g. `wiggle(5, 20)`). |
| **`createCamera`** | `name: string`, `zoom: float` | Adds a 3D camera layer to the active composition. |
| **`setLayerMask`** | `layerIndex: int`, `maskName: string`, `points: float[][]` | Configures mask paths, feathering, expansion, and opacity. |

### Go-based `ae-mcp` Tools
- Includes identical layer creation wrappers.
- **`generate-manim-render(code: string)`**: Executes Python Manim to render math equations and imports them as WebP clips into the project assets folder.

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: Standard Kinetic Typography
Create a composition, add a text layer, center it, and apply a scale wiggle expression:

```json
// Step 1: Create Comp
// Tool: create-composition(name="TitleAnimation", width=1920, height=1080, frameRate=29.97, duration=5.0)

// Step 2: Write ExtendScript to add a text layer
// Tool: run-script(script="var comp = app.project.activeItem; var textLayer = comp.layers.addText('HELLO BDB OS'); textLayer.property('Position').setValue([960, 540]);")

// Step 3: Apply Wiggle to Scale
// Tool: setLayerExpression(layerIndex=1, propertyName="Scale", expression="wiggle(2, 15)")
```

### Recipe 2: Custom Text Ingest from File
To batch-generate subtitles or title cards using `run-script`:

```javascript
// Call tool: run-script(script="...")
var comp = app.project.activeItem;
if (comp && comp instanceof CompItem) {
    app.beginUndoGroup("Create Titles");
    var titles = ["Design", "Develop", "Deploy"];
    for (var i = 0; i < titles.length; i++) {
        var textLayer = comp.layers.addText(titles[i]);
        textLayer.property("Position").setValue([960, 200 + (i * 200)]);
        textLayer.startTime = i * 1.5;
        textLayer.outPoint = (i + 1) * 1.5;
    }
    app.endUndoGroup();
    "Successfully created " + titles.length + " text layers.";
} else {
    "Error: No active composition.";
}
```

---

## 5. Troubleshooting and Connection Details

### Configuration and Setup
- **ExtendScript Panel:** The bridge operates via `mcp-bridge-auto.jsx`.
- **Install Panel:**
  ```bash
  # run installer script from the after-effects-mcp folder
  npm run install-bridge
  ```
  This places the script inside After Effects' ScriptUI Panels folder.
- **Active Communication:** Node MCP runs locally using standard stdio. Ensure the client config file is properly wired up:
  ```json
  "AfterEffectsMCP": {
    "command": "node",
    "args": ["<your-home-directory>/.gemini/config/mcps/after-effects-mcp/build/index.js"]
  }
  ```

### Common Errors and Fixes
1. **`Adobe Script Error: Security setting does not allow this script to write files`**
   - *Fix:* In After Effects, go to `Preferences -> Scripting & Expressions` and check the box **"Allow Scripts to Write Files and Access Network"**.
2. **`Commands are hanging / No response from server`**
   - *Cause:* The bridge UI panel is closed in After Effects, or the "Auto-run" checkbox is disabled.
   - *Fix:* Navigate to `Window -> mcp-bridge-auto.jsx` in the top menu and verify that the panel is open and actively polling (indicated by status prints in the panel window).
3. **`ExtendScript undefined variable or Layer index out of bounds`**
   - *Cause:* ExtendScript arrays in After Effects are **1-indexed** for layers (`comp.layer(1)`) while the Node tools layer indices might be 0-indexed depending on the tool call translation. Ensure you map boundaries carefully.
