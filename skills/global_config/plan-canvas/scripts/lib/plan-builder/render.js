'use strict';

/**
 * Block renderers for the BDB Plan Builder.
 *
 * Security model: plan content is untrusted. Every string that reaches the page
 * goes through escapeHtml (or renderMarkdown, which escapes first). The only
 * raw HTML surfaces are the two sandboxed iframes — `custom-html` and the
 * `html` payload of wireframe/diagram blocks — and both are `sandbox` WITHOUT
 * `allow-scripts`, so a plan can draw but never run.
 */

const fs = require('fs');
const path = require('path');

const { escapeHtml, renderMarkdown, slugify } = require('../plan-canvas/markdown');
// Same pinned Mermaid ESM build (and AOS_PLAN_CANVAS_MERMAID_URL override) as
// lib/plan-canvas/ui.js — one CDN, one pin, no second URL to invent.
const { mermaidUrl } = require('../plan-canvas/ui');

function mermaidLoaderScript(url) {
  return `<script type="module">
  try {
    const mermaid = (await import(${JSON.stringify(url)})).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      themeVariables: {
        primaryColor: '#161616', primaryBorderColor: '#9b30c4', primaryTextColor: '#ffffff',
        lineColor: '#7a7a7a', secondaryColor: '#1c1c1c', tertiaryColor: '#121212',
        background: '#0a0a0a', mainBkg: '#161616', clusterBkg: '#121212'
      }
    });
    await mermaid.run({ querySelector: '.mermaid' });
  } catch (err) {
    document.querySelectorAll('.mermaid').forEach(el => el.classList.add('mermaid-unrendered'));
    console.warn('Mermaid render skipped:', err && err.message);
  }
</script>`;
}

// "Diagram source shown — renderer unavailable" is the offline fallback the
// canvas already uses: the source stays readable, the block is never blank.

const esc = escapeHtml;

function text(value, fallback = '') {
  if (value === undefined || value === null || value === true) return fallback;
  return String(value);
}

// Attribute values may arrive as JSON (numbers, objects) or as plain strings.
function asText(value) {
  if (value === undefined || value === null || value === true) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split('\n');
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function codeBlock(source, cls = '') {
  const body = text(source).replace(/\n+$/, '');
  if (!body) return '<pre><code' + (cls ? ' class="language-' + esc(cls) + '"' : '') + '></code></pre>';
  return '<pre><code' + (cls ? ' class="language-' + esc(cls) + '"' : '') + '>' + esc(body) + '</code></pre>';
}

// The --wf-* tokens visual-plan wireframes are authored against, defined in the
// frame so plan-authored markup renders instead of showing undefined colors.
const WF_TOKENS = `:root{
  --wf-paper:#0d0d0d; --wf-card:#161616; --wf-ink:#ffffff; --wf-muted:#7a7a7a;
  --wf-line:#262626; --wf-accent:#9b30c4; --wf-accent-fg:#ffffff; --wf-accent-soft:rgba(155,48,196,.16);
  --wf-warn:#9b30c4; --wf-ok:#9b30c4; --wf-radius:6px;
}
.wf-card,.wf-box{border:1px solid var(--wf-line);border-radius:var(--wf-radius);padding:10px 12px;background:var(--wf-card)}
.wf-muted,.wf-pill-secondary{color:var(--wf-muted)}
.wf-pill,.wf-accent{color:var(--wf-accent-fg);background:var(--wf-accent);border-radius:999px;padding:2px 8px}
button.primary{background:var(--wf-accent);color:var(--wf-accent-fg);border:0;border-radius:var(--wf-radius);padding:6px 12px}`;

function sandboxFrame(html, label, { height = 420, css = '' } = {}) {
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:16px;background:var(--wf-paper);color:var(--wf-ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;box-sizing:border-box}
*{box-sizing:border-box}
img{max-width:100%}
${WF_TOKENS}
${css}
</style></head><body>${String(html == null ? '' : html)}</body></html>`;
  return [
    `<div class="frame-wrap"><div class="label">${esc(label)}</div>`,
    `<iframe class="frame" sandbox loading="lazy" title="${esc(label)}" height="${Number(height) || 420}" srcdoc="${esc(doc)}"></iframe>`,
    '</div>'
  ].join('');
}

function card(label, inner, extraClass = '') {
  return `<div class="card${extraClass ? ' ' + extraClass : ''}">` +
    (label ? `<div class="label">${esc(label)}</div>` : '') +
    inner + '</div>';
}

function noteList(annotations, label) {
  const items = asArray(annotations);
  if (!items.length) return '';
  const rows = items.map((a) => {
    if (a && typeof a === 'object') {
      const lines = a.lines != null ? `L${text(a.lines)}` : '';
      return `<li><span class="at">${esc(lines || label)}</span><span class="note">${esc(asText(a.note != null ? a.note : a.text))}</span></li>`;
    }
    return `<li><span class="note">${esc(asText(a))}</span></li>`;
  });
  return `<ul class="notes">${rows.join('')}</ul>`;
}

function table(headers, rows) {
  const head = headers.filter(Boolean).map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((row) => '<tr>' + row.map((cell) => `<td>${cell}</td>`).join('') + '</tr>').join('');
  return `<table class="kv"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// --- blocks -------------------------------------------------------------

function renderDiagram(block, ctx) {
  const data = block.props.data && typeof block.props.data === 'object' ? block.props.data : {};
  const html = asText(data.html != null ? data.html : block.props.html);
  if (html) {
    return card(text(block.props.label, 'diagram'), sandboxFrame(html, text(block.props.label, 'diagram'), { height: block.props.height, css: asText(data.css) }));
  }
  const source = asText(data.source != null ? data.source : block.props.source);
  if (source) {
    ctx.hasMermaid = true;
    return card(text(block.props.label, 'mermaid'), '<pre class="mermaid">' + esc(source) + '</pre>');
  }
  const nodes = asArray(data.nodes);
  const edges = asArray(data.edges);
  if (!nodes.length && !edges.length) {
    return card(text(block.props.label, 'diagram'), '<div class="note">diagram block carried no html, source, nodes or edges</div>');
  }
  const rows = [
    ...nodes.map((n) => (typeof n === 'object' ? [esc(asText(n.label || n.id || n.text)), esc(asText(n.description))] : ['node', esc(asText(n))])),
    ...edges.map((e) => (typeof e === 'object'
      ? [esc(asText(`${e.from || e.source || '?'} → ${e.to || e.target || '?'}`)), esc(asText(e.label))]
      : ['edge', esc(asText(e))]))
  ];
  return card(text(block.props.label, 'diagram'), table(['element', 'detail'], rows));
}

function renderMermaid(block, ctx) {
  const source = asText(block.props.source != null ? block.props.source : block.props.code);
  ctx.hasMermaid = true;
  return card(text(block.props.label, 'mermaid'), '<pre class="mermaid">' + esc(source) + '</pre>');
}

function renderFileTree(block) {
  const entries = asArray(block.props.entries || block.props.files || block.props.items);
  if (!entries.length) return card('file tree', '<div class="note">no entries</div>');
  const items = entries.map((entry) => {
    if (typeof entry === 'string') return `<li><span class="path">${esc(entry)}</span></li>`;
    const change = text(entry.change);
    const pathText = text(entry.path || entry.name);
    const depth = Number(entry.depth || 0) || 0;
    return `<li style="padding-left:${depth * 14}px">` +
      (change ? `<span class="badge ${esc(change)}">${esc(change)}</span>` : '') +
      `<span class="path">${esc(pathText)}</span>` +
      (entry.snippet ? codeBlock(entry.snippet) : '') +
      (entry.note ? ` <span class="note">${esc(asText(entry.note))}</span>` : '') +
      '</li>';
  });
  return card(text(block.props.label, 'file tree'), `<ul class="tree">${items.join('')}</ul>`);
}

function renderDiff(block) {
  const before = text(block.props.before);
  const after = text(block.props.after);
  const filename = text(block.props.filename);
  const summary = text(block.props.summary);
  const mode = text(block.props.mode, 'split');
  const lines = (src, cls) => String(src)
    .split('\n')
    .map((line) => `<span class="line ${cls}">${esc(line)}</span>`)
    .join('');
  const body = mode === 'unified'
    ? `<div class="side"><div class="label">${esc(filename || 'diff')}</div><pre>${lines(after, 'add')}</pre></div>`
    : `<div class="side"><div class="label">before</div><pre>${lines(before, 'del')}</pre></div>` +
      `<div class="side"><div class="label">after</div><pre>${lines(after, 'add')}</pre></div>`;
  const head = [
    filename ? `<div class="filename">${esc(filename)}${block.props.language ? ' · ' + esc(block.props.language) : ''}</div>` : '',
    summary ? `<div class="prose" style="padding:10px 14px 0"><p>${esc(summary)}</p></div>` : ''
  ].join('');
  const notes = noteList(block.props.annotations, filename || 'diff');
  return `<div class="card flush">${head}<div class="diff ${esc(mode)}">${body}</div>${notes ? `<div style="padding:0 14px 14px">${notes}</div>` : ''}</div>`;
}

function renderCode(block) {
  const filename = text(block.props.filename || block.props.file);
  return `<div class="card flush">` +
    (filename ? `<div class="filename">${esc(filename)}${block.props.language ? ' · ' + esc(block.props.language) : ''}</div>` : '') +
    codeBlock(block.props.code != null ? block.props.code : block.props.body, text(block.props.language)) +
    (noteList(block.props.annotations, filename) ? `<div style="padding:0 14px 14px">${noteList(block.props.annotations, filename)}</div>` : '') +
    '</div>';
}

function renderEndpoint(block) {
  const method = text(block.props.method, 'GET').toUpperCase();
  const endpointPath = text(block.props.path || block.props.url);
  const description = childText(block);
  const params = asArray(block.props.params);
  const rows = [];
  rows.push([`<span class="method">${esc(method)}</span>`, '']);
  for (const p of params) {
    if (p && typeof p === 'object') {
      rows.push([
        esc(asText(p.name)),
        `<span class="plain">${esc(asText(p.type || 'any'))}${p.required ? ' · required' : ''}${p.in ? ' · in: ' + esc(asText(p.in)) : ''}${p.description ? '<br>' + esc(asText(p.description)) : ''}</span>`
      ]);
    } else {
      rows.push(['param', `<span class="plain">${esc(asText(p))}</span>`]);
    }
  }
  const examples = asArray(block.props.examples || block.props.responses).map((ex) => {
    const label = ex && typeof ex === 'object' ? text(ex.label || ex.status || 'response') : 'response';
    const body = ex && typeof ex === 'object' ? text(ex.body != null ? ex.body : ex.example) : asText(ex);
    return `<div class="filename">${esc(label)}</div>${codeBlock(body, 'json')}`;
  }).join('');
  const head = `<div class="endpoint-path"><span class="method">${esc(method)}</span>${esc(endpointPath)}</div>`;
  const desc = description ? `<div class="prose" style="padding-bottom:8px">${renderMarkdown(description)}</div>` : '';
  const paramTable = params.length ? table(['param', 'detail'], rows.slice(1)) : '';
  return card(text(block.props.label, 'api endpoint'), head + desc + paramTable +
    (examples ? `<div style="margin-top:12px">${examples}</div>` : ''));
}

function renderDataModel(block) {
  const entities = asArray(block.props.entities);
  if (!entities.length) return card(text(block.props.label, 'data model'), '<div class="note">no entities</div>');
  const cards = entities.map((entity) => {
    if (!entity || typeof entity !== 'object') return card(null, `<pre><code>${esc(asText(entity))}</code></pre>`);
    const fields = asArray(entity.fields);
    const rows = fields.map((f) => {
      if (f && typeof f === 'object') {
        return [
          `<span class="badge ${esc(text(f.change, ''))}">${esc(text(f.change))}</span>${esc(asText(f.name))}`,
          `<span class="plain">${esc(asText(f.type))}${f.was ? ' (was ' + esc(asText(f.was)) + ')' : ''}${f.note ? '<br>' + esc(asText(f.note)) : ''}</span>`
        ];
      }
      return [esc(asText(f)), '<span class="plain">—</span>'];
    });
    return card(text(entity.name || entity.entity, 'entity'), table(['field', 'type'], rows));
  }).join('');
  return card(text(block.props.label, 'data model'), `<div class="flow">${cards}</div>`);
}

function renderQuestionForm(block) {
  const questions = asArray(block.props.questions);
  if (!questions.length) return card(text(block.props.title, 'open questions'), '<div class="note">no questions</div>');
  const items = questions.map((q) => {
    if (!q || typeof q !== 'object') return `<div class="question"><div class="q">${esc(asText(q))}</div></div>`;
    const options = asArray(q.options).map((opt) => {
      const o = opt && typeof opt === 'object' ? opt : { label: asText(opt) };
      const rec = o.recommended ? ' rec' : '';
      return `<li class="${rec}">${esc(asText(o.label))}${o.detail ? ` <span class="detail">${esc(asText(o.detail))}</span>` : ''}${o.recommended ? ' <span class="badge">recommended</span>' : ''}</li>`;
    }).join('');
    return `<div class="question"><div class="q">${esc(asText(q.title || q.label || q.id))}<span class="mode">${esc(text(q.mode, 'open'))}</span></div>` +
      (q.description ? `<div class="prose"><p>${esc(asText(q.description))}</p></div>` : '') +
      (options ? `<ul>${options}</ul>` : '') + '</div>';
  }).join('');
  return card(text(block.props.title || block.props.label, 'open questions'), items);
}

function renderColumns(block, ctx) {
  const columns = asArray(block.props.columns);
  const wrap = `<div class="columns cols-${Math.min(columns.length || 1, 2)}">`;
  const inner = columns.map((col, idx) => {
    const label = col && typeof col === 'object' ? text(col.label || col.title, `column ${idx + 1}`) : `column ${idx + 1}`;
    const payload = col && typeof col === 'object' ? (col.blocks || col.children || col.content) : col;
    return `<div><div class="group"><div class="group-label">${esc(label)}</div><div class="group-body">` +
      renderPayload(payload, ctx) + '</div></div></div>';
  }).join('');
  return wrap + inner + '</div>';
}

function renderTabs(block, ctx) {
  const tabs = asArray(block.props.tabs);
  if (!tabs.length) return card(text(block.props.label, 'tabs'), '<div class="note">no tabs</div>');
  // Rendered stacked: an annotation layer owns clicks, so no tab switching JS.
  const inner = tabs.map((tab, idx) => {
    const label = tab && typeof tab === 'object' ? text(tab.label || tab.title, `tab ${idx + 1}`) : `tab ${idx + 1}`;
    const payload = tab && typeof tab === 'object' ? (tab.blocks || tab.children || tab.content) : tab;
    return `<div class="group"><div class="group-label">${esc(label)}</div><div class="group-body">${renderPayload(payload, ctx)}</div></div>`;
  }).join('');
  return card(text(block.props.label, ''), inner);
}

function renderCustomHtml(block) {
  const html = block.props.html != null ? block.props.html : childRaw(block);
  return card(text(block.props.label, 'custom html'), sandboxFrame(asText(html), text(block.props.label, 'custom html'), { height: block.props.height, css: asText(block.props.css) }));
}

function renderScreen(block, ctx) {
  const label = text(block.props.label || block.props.title, text(block.props.surface, 'screen'));
  const html = block.props.html != null ? asText(block.props.html) : childRaw(block);
  if (html) return sandboxFrame(html, label, { height: block.props.height, css: asText(block.props.css) });
  // A WireframeBlock body is normally a single <Screen>; without an html
  // payload its children are ordinary blocks.
  return renderPayload(block.children, ctx);
}

function renderRichText(block) {
  return `<div class="prose">${renderMarkdown(childText(block))}</div>`;
}

function renderCallout(block) {
  const tone = text(block.props.tone, 'note');
  return card(`callout · ${tone}`, `<div class="prose">${renderMarkdown(childText(block))}</div>`);
}

function renderUnknown(block, ctx) {
  const warning = `unsupported block <${block.name}>`;
  ctx.warnings.push(warning);
  return `<div class="card unsupported"><div class="label">unsupported block · &lt;${esc(block.name)}&gt;</div>` +
    '<div class="note">This plan builder does not render this tag. The source is shown below so nothing is lost.</div>' +
    '<pre><code>' + esc(block.raw || '') + '</code></pre></div>';
}

// Canonical tag names from the visual-plan / visual-recap block reference.
// Hyphenated conceptual names are accepted as aliases so a hand-written plan
// using either spelling renders.
const HANDLERS = {
  Diagram: renderDiagram,
  Mermaid: renderMermaid,
  FileTree: renderFileTree,
  WireframeBlock: renderScreen,
  Screen: renderScreen,
  Diff: renderDiff,
  Code: renderCode,
  AnnotatedCode: renderCode,
  Endpoint: renderEndpoint,
  ApiEndpoint: renderEndpoint,
  DataModel: renderDataModel,
  QuestionForm: renderQuestionForm,
  Columns: renderColumns,
  TabsBlock: renderTabs,
  Tabs: renderTabs,
  CustomHtml: renderCustomHtml,
  RichText: renderRichText,
  Callout: renderCallout,
  Json: (block) => card('json', codeBlock(block.props.code != null ? block.props.code : block.props.data, 'json')),
  OpenApiSpec: (block) => card('openapi spec', codeBlock(block.props.code != null ? block.props.code : block.props.spec, 'yaml')),
  Checklist: (block) => renderQuestionForm({ ...block, props: { questions: asArray(block.props.items).map((it, i) => ({ title: text(it && it.label ? it.label : it, `item ${i + 1}`), mode: 'check' })) } }),
  Table: (block) => card(text(block.props.label, 'table'), codeBlock(JSON.stringify({ columns: block.props.columns, rows: block.props.rows }, null, 2), 'json')),
  // canvas.mdx containers: pass-through so artboards and their Screen bodies
  // still render instead of collapsing into one unsupported card.
  DesignBoard: (block, ctx) => renderPayload(block.children, ctx),
  Section: (block, ctx) => renderPayload(block.children, ctx),
  Artboard: (block, ctx) => card(text(block.props.title || block.props.label, 'artboard'), renderPayload(block.children, ctx)),
  Annotation: (block) => `<div class="card"><div class="label">annotation</div><div class="prose">${renderMarkdown(childText(block) || text(block.props.text) || text(block.props.body))}</div></div>`,
  Connector: (block) => card('connector', `<div class="note">${esc(asText(block.props.label || block.props.text || ''))}</div>`)
};

const ALIASES = {
  diagram: 'Diagram',
  mermaid: 'Mermaid',
  'file-tree': 'FileTree',
  wireframe: 'WireframeBlock',
  screen: 'Screen',
  diff: 'Diff',
  code: 'Code',
  'annotated-code': 'AnnotatedCode',
  endpoint: 'Endpoint',
  'api-endpoint': 'ApiEndpoint',
  'data-model': 'DataModel',
  'question-form': 'QuestionForm',
  columns: 'Columns',
  tabs: 'TabsBlock',
  'custom-html': 'CustomHtml',
  'rich-text': 'RichText',
  callout: 'Callout',
  json: 'Json',
  checklist: 'Checklist',
  table: 'Table',
  openapi: 'OpenApiSpec'
};

function childRaw(block) {
  return (block.childrenRaw || '').trim();
}

function childText(block) {
  if (typeof block.childrenRaw === 'string' && block.childrenRaw.trim()) return block.childrenRaw.trim();
  return '';
}

// Nested block payloads (columns/tabs/artboard children) arrive either as real
// blocks, a nested block object, a raw HTML string, or plain text.
function renderPayload(payload, ctx) {
  if (payload === undefined || payload === null || payload === '') return '<div class="note">empty</div>';
  if (Array.isArray(payload)) return renderBlocks(payload, ctx);
  if (typeof payload === 'object' && payload.type === 'tag') return renderTag(payload, ctx);
  if (payload.html !== undefined) return sandboxFrame(asText(payload.html), text(payload.label, 'html'), { height: payload.height, css: asText(payload.css) });
  if (typeof payload === 'string' && /^\s*</.test(payload)) {
    ctx.warnings.push('raw html inside a nested payload was sandboxed rather than injected');
    return sandboxFrame(payload, 'html');
  }
  return `<div class="prose">${renderMarkdown(asText(payload))}</div>`;
}

function renderTag(block, ctx) {
  const key = HANDLERS[block.name] ? block.name : ALIASES[block.name.toLowerCase()];
  const handler = key && HANDLERS[key];
  if (!handler) return renderUnknown(block, ctx);
  return handler(block, ctx);
}

function renderBlocks(blocks, ctx) {
  const out = [];
  for (const block of blocks || []) {
    try {
      if (block.type === 'heading') out.push({ html: renderHeading(block, ctx) });
      else if (block.type === 'prose') {
        const html = renderMarkdown(block.text);
        collectProseHeadings(html, ctx);
        out.push({ html: `<div class="prose">${html}</div>` });
      }
      else if (block.type === 'tag') out.push({ html: renderTag(block, ctx) });
      else if (block.type === 'malformed') {
        ctx.warnings.push(block.message || 'malformed block');
        out.push({ html: errorCard(block.message || 'malformed block', block.raw || '') });
      } else out.push({ html: `<div class="prose">${renderMarkdown(asText(block))}</div>` });
    } catch (error) {
      // One bad block must not lose the rest of the document.
      ctx.warnings.push(`render failed for ${block && block.name ? '<' + block.name + '>' : 'a block'}: ${error.message}`);
      out.push({ html: errorCard('render failed', error.message) });
    }
  }
  return out.map((entry) => entry.html).join('\n');
}

function errorCard(message, detail) {
  return `<div class="card error-card"><div class="label">could not render</div>` +
    `<div>${esc(message)}</div>` +
    (detail ? `<pre><code>${esc(detail)}</code></pre>` : '') + '</div>';
}

function renderHeading(block, ctx) {
  const level = Math.min(Math.max(block.level, 2), 4);
  const id = uniqueId(slugify(block.text) || 'section', ctx);
  ctx.headings.push({ id, text: block.text, level });
  return `<h${level} class="sec" id="${esc(id)}">${esc(block.text)}</h${level}>`;
}

// Markdown headings inside a prose chunk already carry an id from
// lib/plan-canvas/markdown.js. Register them for the nav, and re-slug on a
// collision with a heading the block parser already took.
const PROSE_HEADING_RE = /<h([1-6]) id="([^"]*)">([\s\S]*?)<\/h\1>/g;

function collectProseHeadings(html, ctx) {
  return html.replace(PROSE_HEADING_RE, (match, level, id, inner) => {
    const next = uniqueId(id || 'section', ctx);
    const plain = inner.replace(/<[^>]*>/g, '').trim();
    ctx.headings.push({ id: next, text: plain || id, level: Math.max(Number(level), 2) });
    return match.replace(`id="${id}"`, `id="${next}"`);
  });
}

function uniqueId(base, ctx) {
  const id = base || 'section';
  const count = ctx.ids.get(id) || 0;
  ctx.ids.set(id, count + 1);
  return count ? id + '-' + count : id;
}

function navHtml(headings) {
  if (!headings.length) return '<div class="empty">no headings</div>';
  const items = headings.map((h) => `<li><a class="lvl${h.level}" href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('');
  return `<h2>on this page</h2><ol>${items}</ol>`;
}

function themeCss() {
  return fs.readFileSync(path.join(__dirname, 'theme.css'), 'utf8');
}

function page({ title, status, meta, headings, body, warnings, hasMermaid }) {
  const warningBlock = warnings.length
    ? `<div class="warnings"><span class="label">${warnings.length} rendering warning${warnings.length === 1 ? '' : 's'}</span><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${themeCss()}
</style>
</head>
<body>
<header class="topbar">
<span class="mark"></span>
<span class="title">${esc(title)}</span>
${status ? `<span class="status">${esc(status)}</span>` : ''}
${meta ? `<span class="meta">${esc(meta)}</span>` : ''}
</header>
<div class="shell">
<nav class="sidenav" aria-label="Sections">${navHtml(headings)}</nav>
<main>
${warningBlock}
<h1 class="doc-title">${esc(title)}</h1>
<div class="flow">${body}</div>
<footer class="footer">Built by BDB Plan Builder from the plan folder beside this file. Edit the MDX and re-run the build.</footer>
</main>
</div>
${hasMermaid ? mermaidLoaderScript(mermaidUrl()) : ''}
</body>
</html>`;
}

module.exports = { renderBlocks, renderTag, page, mermaidUrl, escapeHtml };