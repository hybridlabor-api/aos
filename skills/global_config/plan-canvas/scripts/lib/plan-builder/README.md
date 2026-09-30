# BDB Plan Builder

Renders an Agent-Native-style **plan folder** (local-files format) into ONE
self-contained HTML file in the BDB look, which `aos-plan-canvas` then opens
through its normal `.html` artifact path — so annotation, chat and verdict
already work with no canvas changes.

CommonJS, zero dependencies, no network at build time.

## Input / output

| Path | Role |
|---|---|
| `<plan-dir>/plan.mdx` | **required** — frontmatter + document blocks |
| `<plan-dir>/canvas.mdx` | optional — appended as a "Canvas" section |
| `<plan-dir>/prototype.mdx` | optional — appended as a "Prototype" section |
| `<plan-dir>/.plan-state.json` | optional — `title`, `status`/`kind`, `localOnly` |
| `<plan-dir>/plan.builder.html` | **output** — written next to the plan |

The output lives inside the folder because plan-canvas only opens artifacts
inside the workspace root.

## Usage

```bash
# Build and open in one step
aos-plan-canvas open <plan-dir> --mode bdb-plan-builder
aos-plan-canvas open <plan-dir>/plan.mdx --mode bdb-plan-builder --no-open

# Then listen for the review verdict
aos-plan-canvas await <plan-dir>/plan.builder.html
```

Rebuild by re-running `open`: edit the MDX, run `open` again. A path with no
`plan.mdx` exits **2** with the reason on stderr and stdout.

Library:

```js
const { renderPlanFolder, renderPlanSource, parseMdx } = require('./index');

renderPlanFolder('./plans/my-plan');            // { html, warnings, outFile }
renderPlanSource({ plan, canvas, state });      // { html, warnings }
parseMdx('<Code code={"x"} />');                // block array
```

`renderPlanFolder` reports a missing `plan.mdx` as `error` in the return value;
it never throws.

## Supported tags

Tag names are the block-registry MDX names from `visual-plan` / `visual-recap`.
The lowercase conceptual names are accepted as aliases.

| Tag (aliases) | Props read | Renders as |
|---|---|---|
| `Diagram` (`diagram`) | `data.html`, `data.css`, `data.source`, `data.nodes`, `data.edges`, `frame`, `label` | sandboxed frame for HTML; Mermaid for `source`; table for nodes/edges |
| `Mermaid` (`mermaid`) | `source`, `code`, `label` | `<pre class="mermaid">` + pinned ESM loader |
| `FileTree` (`file-tree`) | `entries[]` with `path`, `change`, `note`, `snippet`, `depth` | change-badged monospace tree |
| `WireframeBlock` (`wireframe`), `Screen` (`screen`) | `html`, `surface`, `css`, `label`, `height` | sandboxed frame (no `allow-scripts`) |
| `Diff` (`diff`) | `before`, `after`, `filename`, `language`, `mode`, `summary`, `annotations[]` | split or unified two-pane diff |
| `Code` (`code`), `AnnotatedCode` (`annotated-code`) | `code`, `filename`, `language`, `annotations[]` | code block + margin notes |
| `Endpoint` (`endpoint`, `api-endpoint`, `ApiEndpoint`) | `method`, `path`, `params[]`, `examples[]`, children prose | method/path header, param table, JSON examples |
| `DataModel` (`data-model`) | `entities[].fields[]` with `name`, `type`, `change`, `was`, `note` | nested entity cards |
| `QuestionForm` (`question-form`) | `title`, `questions[]` with `title`, `mode`, `options[]` | Open Questions card, recommended option marked |
| `Columns` (`columns`) | `columns[].label` + nested blocks | two-column grid, stacked on phones |
| `TabsBlock` (`tabs`, `Tabs`) | `tabs[].label` + nested blocks | stacked labelled groups (no click JS — the annotation layer owns clicks) |
| `CustomHtml` (`custom-html`) | `html`, `css`, `label`, `height` | sandboxed frame, **no `allow-scripts`** |
| `RichText` (`rich-text`) | markdown children | prose |
| `Callout` | `tone` + markdown children | bordered card |
| `Checklist` | `items[]` | labelled items |
| `Table` | `columns`, `rows` | JSON card |
| `Json`, `OpenApiSpec` (`openapi`) | `code`/`data`, `spec` | code block |
| `DesignBoard`, `Section` | children | pass-through (canvas.mdx containers) |
| `Artboard` | `title`, children | card wrapping the artboard's `Screen` |
| `Annotation` | markdown children or `text` | designer-note card |
| `Connector` | `label`/`text` | connector label card |

**Unknown tag → visible card.** Any tag not in the table renders as a bordered
"unsupported block" card showing the tag name plus its escaped raw source, and
adds a line to `warnings` (also shown in a banner at the top of the page).
Content is never dropped silently. A block that fails to render becomes an error
card instead of taking the document down.

## Security

- Everything from the plan is escaped (`escapeHtml`, and `renderMarkdown` escapes
  before any inline rule runs).
- Raw HTML — `custom-html`, and the `html` of wireframe/diagram blocks — only
  reaches `<iframe sandbox srcdoc=...>` **without `allow-scripts`**.
- Attribute values are JSON-parsed, never evaluated. Template-literal
  interpolation is refused with a warning.

## Files

| File | Role |
|---|---|
| `index.js` | `renderPlanFolder` / `renderPlanSource` / re-export `parseMdx` |
| `mdx.js` | frontmatter, headings, prose, JSX-like tags; never throws |
| `render.js` | block → HTML, Mermaid loader, page shell |
| `theme.css` | BDB CI theme, inlined into the output |

Adding this directory is also what flips `bdb-plan-builder` to **available** in
`aos-plan-canvas modes`.