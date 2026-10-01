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
| `WireframeBlock` (`wireframe`), `Screen` (`screen`) | `html`, `surface`, `css`, `label`, `caption`, `height`, or wireframe-kit children | `html`: sandboxed frame (no `allow-scripts`); kit children: low-fi markup, see [Wireframe kit](#wireframe-kit) |
| `Diff` (`diff`) | `before`, `after`, `filename`, `language`, `mode`, `summary`, `annotations[]` | split or unified two-pane diff |
| `Code` (`code`), `AnnotatedCode` (`annotated-code`) | `code`, `filename`, `language`, `annotations[]` | code block + margin notes |
| `Endpoint` (`endpoint`, `api-endpoint`, `ApiEndpoint`) | `method`, `path`, `params[]`, `examples[]`, children prose | method/path header, param table, JSON examples |
| `DataModel` (`data-model`) | `entities[].fields[]` with `name`, `type`, `change`, `was`, `note` | nested entity cards |
| `QuestionForm` (`question-form`) | `title`, `questions[]` with `title`, `mode`, `options[]` | Open Questions card, recommended option marked |
| `Columns` (`columns`) | `columns[].label` + nested blocks | two-column grid, stacked on phones |
| `TabsBlock` (`tabs`, `Tabs`) | `tabs[].label` + nested blocks | stacked labelled groups (no click JS — the annotation layer owns clicks) |
| `Archify` (`archify`) | `src` (relative `.html` inside the plan folder), `label`, `height` | delivered Archify diagram in `<iframe sandbox="allow-scripts">` (never `allow-same-origin`), caption and link row; see [Archify](#archify) |
| `AgentTrail` (`agent-trail`) | `live` (http(s) URL on localhost/127.0.0.1), `embed` (flag, needs `live`) | static dependency graph of the plan's components (columns by `needs` depth, edges only for stated needs, task progress, expandable tasks) derived from the same folder's `{#id}` headings, `ImplementationMap` and `Checklist`; `live` adds an "Open live agent trail" link, `embed` a sandboxed iframe (`allow-scripts allow-same-origin`); works inside `<Artboard surface="web">`; no components gives a visible card and a warning |
| `CustomHtml` (`custom-html`) | `html`, `css`, `label`, `height` | sandboxed frame, **no `allow-scripts`** |
| `RichText` (`rich-text`) | `title`, markdown children | prose |
| `Callout` | `tone`, `title`, markdown children | bordered card |
| `Checklist` (`checklist`) | `title`, `items[]` (strings or `{label, checked, note}`), children: `- [x] item` lines or `<Item checked>` tags | checkbox list |
| `Table` (`table`) | `title`, `columns[]`, `rows[]` (arrays, or objects keyed by column), or a markdown table as children | bordered table, inline markdown in cells |
| `CodeTabs` (`code-tabs`) | `tabs[]` with `label`, `language`, `code` | one card, every tab stacked under its filename |
| `Decision` (`decision`) | `title`, `question`, `options[]` (`label`, `detail`, `recommended`), `recommended` (id, label or index), `rationale` or children prose | question, option cards with a `recommended` badge, rationale |
| `HtmlBlock` (`html-block`) | `html` or children, `title`, `css`, `height` | sandboxed frame, **no `allow-scripts`** (same as `CustomHtml`) |
| `ImplementationMap` (`implementation-map`) | `title`, `files[]` (`path`, `title`, `note`, `change`, `snippet`), or children lines | file list with change badges; an unparsable `files` shows its escaped raw text in a visible card plus a warning |
| `Compare` (`compare`) | `before`, `after` (markdown, `{html}`), `beforeLabel`, `afterLabel`, or `<Before>`/`<After>` children, or exactly two child blocks | Before / After two-column comparison |
| `Json`, `OpenApiSpec` (`openapi`) | `code`/`data`, `spec` | code block |
| `DesignBoard`, `Section` | children | pass-through (canvas.mdx containers) |
| `Artboard` | `id`, `label`/`title`, `surface`, `x`, `y`, `width`, `height`, `order`, children | card wrapping the artboard's `Screen`; absolutely positioned when `x`/`y` are set, see [Absolute board layout](#absolute-board-layout) |
| `Annotation` | `title`, markdown children or `text`, `targetId`, `placement`, `x`, `y` | small muted note with an arrow glyph |
| `Connector` | `label`/`text` | connector label card |

**Unknown tag → visible card.** Any tag not in the table renders as a bordered
"unsupported block" card showing the tag name plus its escaped raw source, and
adds a line to `warnings` (also shown in a banner at the top of the page).
Content is never dropped silently. A block that fails to render becomes an error
card instead of taking the document down.

## Prop syntax

`{...}` attribute values are JSON **or** a data-only JavaScript literal:
unquoted keys, single quotes, trailing commas, comments and `'a' + 'b'` string
concatenation all parse. Nothing is evaluated; an expression that is neither
becomes a warning and the raw text is kept.

## Wireframe kit

A `<Screen>` (or `<FrameScreen>`) without an `html` prop whose children are tags
renders the kit below as plain markup in the page (no iframe). Low-fi look:
muted greys on dark, 1px borders, the BDB accent only for `active`/`primary`/done
states, and the same UI font stack as plan-canvas and the AOS store (no handwriting font). An empty `<Screen>` renders an empty frame.

| Tag | Props | Renders |
|---|---|---|
| `FrameScreen`, `Main`, `Col`, `Row` | `full` | flex containers; `full` fills the remaining space |
| `Box`, `Card` | `dashed`, `full` | thin bordered container |
| `Lines` | `n`, `widths[]` (percent) | `n` text bars |
| `IconSquare` | `active` | small rounded square, accent when active |
| `Divider`, `StatusBar` | | rule; phone status strip |
| `TaskRow` | `title`, `done`, `note` | checkbox row |
| `Text` | `value` (or children), `tone="muted"`, `weight="bold"` | wireframe text |
| `Title`, `SectionLabel`, `Btn`, `Chips` | `text`, `label`, `label`/`primary`, `items[]` | heading, caps label, button, chip row |
| `Skeleton` | `lines` + `widths`, or `width`/`height` | placeholder bars |

An unknown kit tag renders a small labelled placeholder (`<Name>`) and adds a
warning. Semantic `<Screen html={...}/>` is unchanged: sandboxed iframe.

## Absolute board layout

If any `<Artboard>` carries numeric `x` and `y`, the board switches from numbered
flow rows to an absolute canvas with a dotted grid:

- Artboards sit at `x`/`y` with `width`/`height` (defaults from `surface`), sorted in
  the DOM by `order` (shown as a small number chip); the canvas is the bounding box
  of everything plus a margin.
- The artboard `label` sits above the frame, a `Screen` `caption` under it, and a
  `Section` `title`/`subtitle` becomes a numbered label above its artboards.
- `Annotation` goes under (`placement="bottom"`, default), above, left or right of
  its `targetId` artboard, or at its own `x`/`y`. Notes for the same target stack.
- Artboards without coordinates, annotations without a target or position, and
  non-artboard blocks are listed in a tray below the canvas.
- Connectors are unchanged: only stated `transitions` / `Connector` / `edges`.
  A coordinate-free canvas keeps the flow-row layout.

## Visual recap

A plan whose frontmatter has `kind: recap` (or whose `.plan-state.json` has
`"kind": "recap"`) gets a recap header instead of the plain title: the eyebrow
`VISUAL RECAP`, a large title, a subtitle, and a chip row.

| Frontmatter | Chip |
|---|---|
| `title`, `subtitle` (or `summary`) | title, subtitle |
| `pr` | `PR #214` |
| `branch`, `base` | `branch feat/x → main` |
| `commit`, `author`, `date` | commit, `by …`, date |
| `files` | `4 files` |
| `additions`, `deletions` | `+186`, `−41` |

Fields that are missing are skipped. Use `<Compare>` for the Before / After
comparison:

```mdx
<Compare>
<Before><Screen surface="mobile">...</Screen></Before>
<After><Screen surface="mobile">...</Screen></After>
</Compare>
```

`<Compare before="..." after="..." />` takes markdown, and a `<Compare>` with
exactly two child blocks (paragraphs count) pairs them as before and after.

## Board view

Visual blocks render on a dark, pan/zoomable **board**: numbered rows of
fixed-width cards (`1 · Auth Entry`), SVG arrows with small muted labels, a
zoom control bottom-left, and a `VISUAL PLAN` mark in the footer.

**Board markup rule** (everything else stays document-style):

1. Everything in `canvas.mdx` is a board. `<Section title>` (or a Markdown
   heading) starts a numbered row; `<DesignBoard>` is pass-through.
2. In `plan.mdx`, a heading tagged `{#board}` (`## Flow {#board}`) hands its
   section, up to the next heading of the same or a higher level, to a board.
   The tag is stripped from the heading text.
3. A block carrying a `board` prop (`<Mermaid board ... />`) is boarded; a run
   of such blocks shares one board.
4. A plan with none of these renders exactly as before and ships no board JS.

**Arrows** are drawn only from relations the plan states, never inferred:
`transitions={[{from, to, label}]}` on any container, `<Connector from to
label />`, or `data.edges` of a node/edge `Diagram` (its nodes become cards).
`from`/`to` match a card `id` (or `blockId`, or the slug of its title; `source`,
`target`, `fromId`, `toId` are accepted too). An unknown endpoint adds a warning
and draws no arrow.

**Interaction** (`board-client.js`, inlined, no dependencies): `+`, `-`, `fit`,
`1:1` buttons and Ctrl/Cmd+wheel zoom with a percentage readout; drag empty
background or hold Space and drag to pan. The script never listens for clicks
on cards or text (the annotation layer owns those) and only calls
`preventDefault` for Ctrl/Cmd+wheel and the Space key over a board. Arrow paths
are measured in the browser, so without JS the board simply scrolls inside its
own container and arrows are not drawn (a hidden list keeps the relations
readable). Below 900px the side navigation is hidden when the page is
board-only.

**Demos** (`aos-plan-canvas open lib/plan-builder/examples/<name> --mode bdb-plan-builder`):

- `demo-plan`: 4 screens, 3 transitions, 2 numbered sections, one Mermaid diagram.
- `signup-storyboard`: 6 absolutely positioned kit artboards, 2 sections, 5 transitions, 2 annotations.
- `recap-demo`: `kind: recap` header, Before/After, implementation map, table, code tabs.

All demo content is invented.

## Archify

`<Archify src="00_architecture.html" label="System" height={560} />` embeds the
standalone HTML produced by the `archify` skill. `src` is resolved against the
plan folder and must stay inside it: `..`, absolute paths, URLs and symlink
escapes show an error card plus a warning, as does a missing file ("file not
found"), a non-`.html` file, or a file over 5 MB. The page runs in
`sandbox="allow-scripts"` only (no same-origin, forms, popups or top
navigation) and a link row opens the file standalone.

## Prototype hint

If any `Artboard` or `Screen` has `surface` `web` or `desktop`, or the `plan.mdx`
frontmatter says `prototype: suggest`, the document ends with one "Suggested next
step" callout naming those screens and saying a throwaway prototype can be built
with the `prototype` skill. It is plain escaped text and starts nothing.
`prototype: skip`, or a plan with no such screens, omits it.

## Trail export

`aos-plan-canvas trail <plan-dir|plan.mdx> [--out <file>] [--force]` writes an
agenttrail plan file (`trail.js`) so `aos-trail . --plan <file> --no-open` shows
the live map after approval. Components: headings tagged `{#id}` and `<Section
id title>`, in document order across `plan.mdx`, `canvas.mdx`, `prototype.mdx`.
`needs`: `<Section needs=[...]>` or frontmatter `needs-<id>: a, b`. `files`:
`<ImplementationMap>` entries. Tasks: `<Checklist>` items (`{#id}` kept, else
generated). The default output is `production_artifacts/00_execution_plan.md`; it must resolve
inside the workspace root (cwd), is never overwritten without `--force`, and no
components means exit 2. Prints `{out, components, tasks, next_step}`.

## Security

- Everything from the plan is escaped (`escapeHtml`, and `renderMarkdown` escapes
  before any inline rule runs).
- `Archify` is the one sandbox that allows scripts (`allow-scripts`, no same-origin), for a file read from inside the plan folder.
- Raw HTML — `custom-html`, `HtmlBlock`, and the `html` of wireframe/diagram blocks — only
  reaches `<iframe sandbox srcdoc=...>` **without `allow-scripts`**.
- Attribute values are JSON-parsed, never evaluated. Template-literal
  interpolation is refused with a warning.

## Files

| File | Role |
|---|---|
| `index.js` | `renderPlanFolder` / `renderPlanSource` / re-export `parseMdx` |
| `trail.js` | agenttrail plan file from a plan folder |
| `mdx.js` | frontmatter, headings, prose, JSX-like tags; never throws |
| `render.js` | block → HTML, flow and absolute boards, recap header, Mermaid loader, page shell |
| `kit.js` | wireframe kit tags → markup |
| `board-client.js` | pan/zoom + arrow routing, inlined only when a board exists |
| `theme.css` | BDB CI theme, inlined into the output |
| `examples/demo-plan/` | richer demo: plan.mdx + canvas.mdx |
| `examples/signup-storyboard/`, `examples/recap-demo/` | kit storyboard and recap demos |

Adding this directory is also what flips `bdb-plan-builder` to **available** in
`aos-plan-canvas modes`.