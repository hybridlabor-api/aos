---
name: bdb-computer-use-mcp
description: Utilizes native Rust/Node and Python-based computer-use-mcp servers to control macOS, Windows, and Linux desktops.
category: engineering-method
---

# Computer Use & OS Control MCP — Integration and AI Agent Guide

This skill file instructs AI agents on how to control macOS, Windows, or Linux desktop environments using the dual-platform `computer-use-mcp` servers. It details tool hierarchy, accessibility automation, scripting, window focus strategies, and troubleshooting steps.

## 1. Overview and Pipeline Value

The **OS Control MCP Servers** act as the ultimate fallback when structured application APIs do not exist. Agents use them to configure system settings, install dependencies, bypass modal dialogs, crop regions, perform OCR, and automate graphical interfaces.

### Dual-Engine Architecture
- **macOS & Linux (`zavora_computer_use`):** Powered by a Rust NAPI module executing native OS calls inside Node.js (CoreGraphics/AppKit/X11).
- **Windows (`bdb_windows_computer_use`):** Powered by a Python/PyWin32 automation bridge using `pywinauto`, `pyautogui`, `comtypes`, and local `pytesseract` OCR for deep Windows Desktop UI discovery.

---

## 2. System Instructions

### Workflow Priorities
1. **Discovery first:** Always call `get_tool_guide` (macOS) or query window titles/automation trees (Windows) to evaluate if target apps support scripts/PowerShell or accessibility trees.
2. **Accessibility over Coordinates:** Use native Win32 Automation IDs / macOS Accessibility labels (`AXButton`, `AXTextField`, etc.) instead of mapping pixel coordinates from a screenshot. It survives window resizes, DPI changes, and layout changes.
3. **Window Focus Strategies:** 
   - Verify focus before writing key streams.
   - Use `strict` focus for keyboard inputs to force the server to verify the target window is frontmost and visible before typing, preventing key drops.
   - Use `prepare_display` to automatically hide background apps that might steal focus or pop up notifications during execution.

---

## 3. Available Tools and API Parameters

### macOS & Linux Engine (`zavora_computer_use`)
Exposes 58 native tools. Key tools include:
- **`run_script(language, script)`**: Runs AppleScript, JXA, or Shell commands.
- **`get_ui_tree(target_app, target_window_id)`**: Returns a JSON structure of active UI roles and labels.
- **`click_element(role, label)`**: Performs a semantic click on a button or menu.
- **`set_value(role, label, value)`**: Sets values in text fields directly.
- **`screenshot(width, quality, target_window_id)`**: Captures the viewport.
- **`left_click(coordinate, target_app)`**: Simulates a left-click.

### Windows Automation Engine (`bdb_windows_computer_use`)
Exposes 22 specialized tools. Key tools include:
- **`mouse_move(x, y)` / `left_click()`**: Simulates physical mouse interactions.
- **`type(text, press_enter)`**: Types strings utilizing SendInput.
- **`screenshot()`**: Grabs active monitor outputs.
- **`get_ui_tree(backend)`**: Dumps the complete Windows UIAutomation or MSActiveAccessibility control tree.
- **`ocr(region)`**: Executes local Tesseract OCR on a screen subregion to extract text without cloud APIs.
- **`find_element(criteria)`**: Resolves a control using criteria (title, class, automation_id).

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: Retrieve and Click elements on Windows via UI Automation
Instead of coordinates, locate the Notepad "File" menu item on Windows semantically:

```json
// Step 1: Find target window and element info
// Tool: find_element(criteria={"title": "Notepad", "control_type": "Window"})

// Step 2: Semantic click on File menu button
// Tool: click_element(role="MenuItem", label="File")
```

### Recipe 2: Run JXA (Javascript for Automation) Script on macOS
Create a new note in Apple Notes and write text programmatically:

```javascript
// Tool: run_script(language="javascript", script="...")
// Script content:
var Notes = Application("Notes");
var newNote = Notes.Note({
    body: "<h1>BDB OS Integration Checklist</h1><p>Automated desktop test complete.</p>"
});
Notes.folders.byName("Notes").notes.push(newNote);
Notes.activate();
```

---

## 5. Troubleshooting and Connection Details

### Configuration and Setup
- **Windows Pre-requisites:**
  - Python >=3.12 is required. The installer auto-compiles dependencies with `uv`.
  - For full OCR support, ensure Tesseract OCR is installed on Windows (`winget install UB-Mannheim.TesseractOCR`).
- **macOS Permissions Required:** You must grant **Accessibility** and **Screen Recording** access to your editor (e.g. Cursor, Claude Desktop, or Terminal) in `System Settings -> Privacy & Security`.

### Common Errors and Fixes
1. **`FocusFailure: Target window is not frontmost`**
   - *Cause:* The `strict` focus strategy detected another application stole active focus.
   - *Fix:* Switch your `focus_strategy` to `prepare_display` to auto-hide background applications, or call `activate_window` first.
2. **`pywinauto.findwindows.ElementNotFoundError`**
   - *Cause:* The Win32 backend failed to resolve the title or control.
   - *Fix:* Switch backends (e.g., from `win32` to `uia`) or verify if the app requires Admin escalation.
