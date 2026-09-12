---
name: bdb-grandma3-mcp
description: Utilizes the grandMA3 MCP server to patch fixtures, execute console commands, and trigger macros via OSC.
category: media-eventtech
---

# grandMA3 MCP — Integration and AI Agent Guide

This skill file instructs AI agents on how to control grandMA3 lighting consoles using the `grandma3_mcp.py` script. It details OSC routing, command execution, fixture patching, and troubleshooting steps.

## 1. Overview and Pipeline Value

The **grandMA3 MCP Server** enables AI models to programmatically configure and drive grandMA3 lighting control software. In the BDB OS workflow, this integration automates fixture patching, triggers lighting states, executes macros, and manages live cue sequencing during stage productions.

### Architecture
- **FastMCP server:** Implements standard Model Context Protocol.
- **OSC UDP Transport:** Sends network packets via Open Sound Control (OSC) to `127.0.0.1` on port `8000`.
- **Command Router:** Maps JSON-RPC requests to OSC `/cmd` string paths, executing them natively inside grandMA3's Command Line.

---

## 2. System Instructions

### Workflow Priorities
1. **Target Port Configuration:** Ensure grandMA3's OSC settings are configured to listen on port `8000` and route `/cmd` addresses.
2. **Console State Syntax:** Commands must match grandMA3 command-line syntax (e.g., `Fixture 1 At 100`, `Go Macro 5`).
3. **Double Patch Safeguard:** Before calling `patch_fixture`, check if the targeted DMX address or fixture ID is already occupied by existing objects to avoid patching conflicts.

---

## 3. Available Tools and API Parameters

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| **`grandma3_ping`** | None | Verifies that the FastMCP server is active and ready to transmit commands. |
| **`execute_command`** | `command: string` | Sends an arbitrary grandMA3 command to the console CLI via OSC (e.g., `ClearAll`, `Go Page 2`). |
| **`execute_macro`** | `macro_number: int` | Executes a specific macro number using the `Go Macro {num}` syntax. |
| **`patch_fixture`** | `fixture_id: int`, `name: string`, `fixture_type: string`, `address: string` | Automatically runs the console CLI command to assign, name, set fixture type, and patch a fixture. |

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: Standard Fixture Patching
Patch four Robe BMFL fixtures starting at DMX address 1.101:

```json
// Tool Call: patch_fixture
{
  "fixture_id": 101,
  "name": "BMFL_StageLeft_01",
  "fixture_type": "Robe BMFL",
  "address": "1.101"
}

// Tool Call: patch_fixture
{
  "fixture_id": 102,
  "name": "BMFL_StageLeft_02",
  "fixture_type": "Robe BMFL",
  "address": "1.121"
}
```

### Recipe 2: Triggering Show Cues
Run a sequence command to clear the programmer, select fixtures, set intensity, and store a cue:

```json
// Tool Call: execute_command
{
  "command": "ClearAll"
}

// Tool Call: execute_command
{
  "command": "Fixture 101 Thru 105 At 80"
}

// Tool Call: execute_command
{
  "command": "Store Cue 1 \"Intro Light\""
}
```

---

## 5. Troubleshooting and Connection Details

### Network Configuration
- **OSC Target IP:** `127.0.0.1` (localhost)
- **OSC Target Port:** `8000` (UDP)
- **OSC Input Address:** `/cmd`

### Console Settings Checklist
1. Open grandMA3 -> **Setup** -> **In & Out** -> **OSC**.
2. Create a new OSC connection entry.
3. Configure the following parameters:
   - **Mode:** `In` (Listening)
   - **Destination IP:** `127.0.0.1`
   - **Port:** `8000`
   - **Protocol:** `UDP`
4. Verify that the OSC connection status icon is green.

### Common Errors and Fixes
1. **`OSC message sent, but console is not responding`**
   - *Cause:* grandMA3's OSC listener is disabled or binding to a different port.
   - *Fix:* Verify that the OSC entry in grandMA3 matches port `8000` and has the `/cmd` prefix active.
2. **`Patch Command Syntax Failure`**
   - *Cause:* The `fixture_type` string does not match any profile loaded in grandMA3's fixture library.
   - *Fix:* Pre-load the required fixture profiles inside grandMA3's Patch window before attempting to script patch mappings.
