---
name: live-preview-canvas
description: A prototyping skill that generates a local HTML mock with a built-in feedback layer, allowing users to drop visual comments (red dots) for UI fixes.
category: design-ui-ux
---
# live-preview-canvas

**live-preview-canvas** is an AOS (BDB Agent OS) skill designed to bridge the gap between design and implementation feedback. It combines rapid local prototyping with direct visual feedback.

## Workflow

1. **Generate Prototype**: The agent uses the `base_template.html` to generate a local HTML mock of a UI component or page.
2. **Review & Comment**: The user opens the HTML file in their browser. They can click anywhere on the UI to leave a visual comment (represented by a red dot) and enter text detailing what needs to be fixed or changed.
3. **Export Feedback**: The user clicks the "Export Feedback" button to generate a JSON payload of all comments, including coordinates and text.
4. **Agent Action**: The agent reads the exported feedback (either pasted back by the user or saved to a file) and correlates the visual comments with the UI structure to apply precise fixes.

## Usage

When a user requests a UI prototype or a visual iteration, copy the contents of `scripts/base_template.html` and inject your HTML/CSS/JS for the prototype into the designated areas. Instruct the user to open the file, click to leave feedback, and share the exported JSON back for the next iteration.
