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

const { escapeHtml, renderMarkdown, renderInline, slugify } = require('../plan-canvas/markdown');
// Same pinned Mermaid ESM build (and AOS_PLAN_CANVAS_MERMAID_URL override) as
// lib/plan-canvas/ui.js — one CDN, one pin, no second URL to invent.
const { mermaidUrl } = require('../plan-canvas/ui');
const { renderKit } = require('./kit');

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

function sandboxFrame(html, label, { height = 420, css = '', bare = false } = {}) {
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:16px;background:var(--wf-paper);color:var(--wf-ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;box-sizing:border-box}
*{box-sizing:border-box}
img{max-width:100%}
${WF_TOKENS}
${css}
</style></head><body>${String(html == null ? '' : html)}</body></html>`;
  const iframe = `<iframe class="frame" sandbox loading="lazy" title="${esc(label)}" height="${Number(height) || 420}" srcdoc="${esc(doc)}"></iframe>`;
  if (bare) return iframe;
  return `<div class="frame-wrap"><div class="label">${esc(label)}</div>${iframe}</div>`;
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
  const label = text(block.props.label || block.props.title, 'custom html');
  return card(label, sandboxFrame(asText(html), label, { height: block.props.height, css: asText(block.props.css) }));
}

const ARCHIFY_MAX_BYTES = 5 * 1024 * 1024;

// Returns { file } or { reason } for an <Archify src>; src must stay inside the plan folder.
function resolveArchifySrc(dir, src) {
  if (!src) return { reason: 'src is required' };
  if (!dir) return { reason: 'needs a plan folder on disk to resolve src' };
  if (src.includes('\0') || path.isAbsolute(src) || /^[a-z][a-z0-9+.-]*:|^[\\/]/i.test(src)) return { reason: 'src must be a relative path inside the plan folder' };
  if (src.split(/[\\/]/).includes('..')) return { reason: 'src must not contain ".."' };
  if (!/\.html?$/i.test(src)) return { reason: 'src must be an .html file' };
  let root;
  let real;
  try {
    root = fs.realpathSync(dir);
    real = fs.realpathSync(path.resolve(root, src));
  } catch {
    return { missing: true };
  }
  const rel = path.relative(root, real);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { reason: 'src resolves outside the plan folder' };
  let stat;
  try { stat = fs.statSync(real); } catch { return { missing: true }; }
  if (!stat.isFile()) return { missing: true };
  if (stat.size > ARCHIFY_MAX_BYTES) return { reason: `file is ${stat.size} bytes; the limit is ${ARCHIFY_MAX_BYTES}` };
  return { file: real };
}

// allow-scripts only, never allow-same-origin: the diagram runs, but cannot reach the page or its origin.
// Archify's "Present" is an in-page stage, so inside this frame it stays in the frame.
// The bridge mirrors that stage onto real browser fullscreen (the iframe has allow="fullscreen").
const FULLSCREEN_BRIDGE = `<script>(function(){var b=document.getElementById('btn-present');if(!b||!document.documentElement.requestFullscreen)return;
function presenting(){var l=document.getElementById('present-label');return /^exit/i.test((l?l.textContent:'')||b.getAttribute('aria-label')||'');}
function sync(){var on=presenting();
if(on&&!document.fullscreenElement){document.documentElement.requestFullscreen().catch(function(){});}
else if(!on&&document.fullscreenElement){document.exitFullscreen().catch(function(){});}}
new MutationObserver(sync).observe(b,{attributes:true,childList:true,characterData:true,subtree:true});})();</script>`;

function withFullscreenBridge(html) {
  const at = html.lastIndexOf('</body>');
  return at === -1 ? html + FULLSCREEN_BRIDGE : html.slice(0, at) + FULLSCREEN_BRIDGE + html.slice(at);
}

function renderArchify(block, ctx) {
  const src = text(block.props.src);
  const label = text(block.props.label || block.props.title, 'architecture diagram');
  const found = resolveArchifySrc(ctx.dir, src);
  if (found.missing || found.reason) {
    const message = found.missing ? 'file not found' : found.reason;
    ctx.warnings.push(`<Archify src="${src}"> ${message}`);
    return errorCard(`Archify diagram: ${message}`, src);
  }
  let html;
  try {
    html = fs.readFileSync(found.file, 'utf8');
  } catch (error) {
    ctx.warnings.push(`<Archify src="${src}"> could not read file: ${error.message}`);
    return errorCard('Archify diagram: could not read file', src);
  }
  // No card and no fixed inner box: the diagram sits on the page background and
  // takes the viewport height by default so its toolbar and legend stay reachable.
  html = withFullscreenBridge(html);
  const explicit = numProp(block.props.height);
  const style = explicit ? ` style="height:${within(explicit, 200, 2400)}px"` : '';
  const href = src.split(/[\\/]/).map(encodeURIComponent).join('/');
  return `<figure class="archify-block"><figcaption class="label">${esc(label)}</figcaption>` +
    `<iframe class="archify-frame" sandbox="allow-scripts" allow="fullscreen" loading="lazy" title="${esc(label)}"${style} srcdoc="${esc(html)}"></iframe>` +
    `<div class="links"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">open standalone</a> <span class="path">${esc(src)}</span></div></figure>`;
}

const PROTOTYPE_SURFACES = new Set(['web', 'desktop']);

function screenNames(blocks, found = []) {
  for (const block of blocks || []) {
    if (block.type !== 'tag') continue;
    const isBoard = block.name === 'Artboard';
    if (isBoard || isScreenTag(block)) {
      if (PROTOTYPE_SURFACES.has(surfaceOf(block).toLowerCase())) {
        const name = text(block.props.label || block.props.title || block.props.id, 'screen');
        if (!found.includes(name)) found.push(name);
      }
      if (isBoard) continue;
    }
    screenNames(block.children, found);
  }
  return found;
}

// A hint only: plain escaped text, nothing is started.
function prototypeHint(blocks, frontmatter = {}) {
  const mode = text(frontmatter.prototype).toLowerCase();
  if (mode === 'skip') return '';
  const names = screenNames(blocks);
  if (!names.length && mode !== 'suggest') return '';
  const which = names.length ? `Screens with a web or desktop surface: ${names.join(', ')}. ` : '';
  return '<div class="card prototype-hint"><div class="label">Suggested next step</div>' +
    `<div class="prose"><p>${esc(which)}A throwaway prototype can be built with the <code>prototype</code> skill. Nothing is started automatically.</p></div></div>`;
}

const SURFACE_SIZE = { mobile: [320, 580], popover: [360, 420], panel: [360, 480], tablet: [600, 700], browser: [720, 520], desktop: [960, 640] };

function numProp(value) {
  if (value === undefined || value === null || value === true || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function within(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isScreenTag(child) {
  return child.type === 'tag' && /^(screen|wireframeblock)$/i.test(child.name);
}

function renderScreen(block, ctx) {
  const label = text(block.props.label || block.props.title, text(block.props.surface, 'screen'));
  const ab = ctx.ab || {};
  const height = block.props.height != null ? block.props.height : ab.height;
  const caption = text(block.props.caption);
  const captionHtml = caption ? `<div class="screen-caption">${esc(caption)}</div>` : '';
  const kids = block.children || [];

  if (block.props.html != null) {
    return sandboxFrame(asText(block.props.html), label, { height, css: asText(block.props.css), bare: ab.abs }) + captionHtml;
  }
  // A WireframeBlock body is normally a single <Screen>.
  if (kids.some(isScreenTag)) return renderPayload(kids, ctx);
  if (kids.length && !kids.some((c) => c.type === 'tag')) {
    return sandboxFrame(childRaw(block), label, { height, css: asText(block.props.css), bare: ab.abs }) + captionHtml;
  }

  const surface = Object.hasOwn(WIDTHS, text(block.props.surface).toLowerCase()) ? text(block.props.surface).toLowerCase() : '';
  const minHeight = ab.abs ? '' : ` style="min-height:${within(numProp(height) || 300, 120, 2400)}px"`;
  const screen = `<div class="kit-screen${surface ? ' s-' + surface : ''}"${minHeight}>${renderKit(kids, ctx)}</div>`;
  if (ab.abs || ctx.ab) return screen + captionHtml;
  return `<div class="frame-wrap"><div class="label">${esc(label)}</div>${screen}</div>${captionHtml}`;
}

function withArtboard(block, ctx, abs, fn) {
  const previous = ctx.ab;
  ctx.ab = { abs, height: numProp(block.props.height), surface: surfaceOf(block) };
  try {
    return fn();
  } finally {
    ctx.ab = previous;
  }
}

function renderRichText(block) {
  const title = text(block.props.title);
  return `<div class="prose">${title ? `<h3 class="rt-title">${esc(title)}</h3>` : ''}${renderMarkdown(childText(block))}</div>`;
}

function renderCallout(block) {
  const tone = text(block.props.tone, 'note');
  const title = text(block.props.title);
  return card(`callout · ${tone}`, (title ? `<div class="callout-title">${esc(title)}</div>` : '') +
    `<div class="prose">${renderMarkdown(childText(block))}</div>`);
}

function annotationHtml(block) {
  const title = text(block.props.title);
  const body = childText(block) || text(block.props.text) || text(block.props.body);
  return '<div class="annot">' +
    (title ? `<div class="annot-title"><span class="glyph" aria-hidden="true">&#8599;</span>${esc(title)}</div>` : '') +
    `<div class="annot-body${title ? '' : ' glyphed'}">${renderMarkdown(body)}</div></div>`;
}

// --- checklist, table, code tabs, decision, html, implementation map, compare

const CHECK_LINE_RE = /^\s*(?:[-*]\s+)?(?:\[([ xX])\]\s+)?(.+?)\s*$/;

function checklistItems(block) {
  const items = [];
  for (const raw of asArray(block.props.items)) {
    if (raw && typeof raw === 'object') {
      items.push({ label: asText(raw.label ?? raw.text ?? raw.title), checked: Boolean(raw.checked ?? raw.done), note: asText(raw.note ?? raw.detail) });
    } else if (asText(raw).trim()) items.push({ label: asText(raw).trim(), checked: false, note: '' });
  }
  for (const child of block.children || []) {
    if (child.type === 'tag') {
      const label = asText(child.props.label ?? child.props.text) || childRaw(child);
      items.push({ label, checked: Boolean(child.props.checked ?? child.props.done), note: '' });
    } else if (child.type === 'prose') {
      for (const line of child.text.split('\n')) {
        const m = CHECK_LINE_RE.exec(line);
        if (m && m[2]) items.push({ label: m[2], checked: m[1] === 'x' || m[1] === 'X', note: '' });
      }
    }
  }
  return items;
}

function renderChecklist(block) {
  const items = checklistItems(block);
  const label = text(block.props.title || block.props.label, 'checklist');
  if (!items.length) return card(label, '<div class="note">no items</div>');
  const rows = items.map((item) => `<li class="${item.checked ? 'done' : ''}"><span class="cbox" aria-hidden="true"></span>` +
    `<span class="ctext">${renderInline(item.label)}${item.note ? ` <span class="detail">${esc(item.note)}</span>` : ''}</span>` +
    `<span class="sr-only">${item.checked ? 'done' : 'open'}</span></li>`).join('');
  return card(label, `<ul class="checklist">${rows}</ul>`);
}

function renderDataTable(block) {
  const label = text(block.props.title || block.props.label, 'table');
  const columns = asArray(block.props.columns).map((c) => (c && typeof c === 'object'
    ? { key: asText(c.key ?? c.id ?? c.label), label: asText(c.label ?? c.title ?? c.key) }
    : { key: asText(c), label: asText(c) }));
  let rows = asArray(block.props.rows);
  if (!columns.length && rows.length && rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
    for (const key of Object.keys(rows[0])) columns.push({ key, label: key });
  }
  if (!rows.length) {
    const md = childText(block);
    return card(label, md ? `<div class="prose">${renderMarkdown(md)}</div>` : '<div class="note">no rows</div>');
  }
  rows = rows.map((row) => {
    if (Array.isArray(row)) return row;
    if (row && typeof row === 'object') {
      return columns.length ? columns.map((c) => row[c.key] ?? row[c.label] ?? '') : Object.values(row);
    }
    return [row];
  });
  const head = columns.length ? `<thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>` : '';
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(asText(cell))}</td>`).join('')}</tr>`).join('');
  return card(label, `<div class="table-wrap"><table class="data">${head}<tbody>${body}</tbody></table></div>`);
}

function renderCodeTabs(block) {
  const tabs = asArray(block.props.tabs);
  if (!tabs.length) return card(text(block.props.title || block.props.label, 'code tabs'), '<div class="note">no tabs</div>');
  const panes = tabs.map((tab, idx) => {
    const t = tab && typeof tab === 'object' ? tab : { code: asText(tab) };
    const label = text(t.label || t.title || t.filename, `tab ${idx + 1}`);
    return `<div class="tab-pane"><div class="filename">${esc(label)}${t.language ? ' · ' + esc(text(t.language)) : ''}</div>` +
      codeBlock(t.code != null ? t.code : t.body, text(t.language)) + '</div>';
  }).join('');
  return `<div class="card flush code-tabs">${panes}</div>`;
}

function isRecommended(option, index, props) {
  if (option.recommended) return true;
  const mark = props.recommended ?? props.chosen ?? props.selected;
  if (mark === undefined || mark === true) return false;
  return String(mark) === String(option.id) || String(mark) === String(option.label) || (typeof mark === 'number' && mark === index);
}

function renderDecision(block) {
  const title = text(block.props.title);
  const question = text(block.props.question || block.props.title);
  const options = asArray(block.props.options).map((raw) => (raw && typeof raw === 'object' ? raw : { label: asText(raw) }));
  const rows = options.map((o, i) => {
    const rec = isRecommended(o, i, block.props);
    return `<li class="opt${rec ? ' rec' : ''}"><div class="opt-label">${esc(asText(o.label ?? o.title ?? o.id))}` +
      (rec ? ' <span class="badge">recommended</span>' : '') + '</div>' +
      (o.detail || o.description ? `<div class="detail">${esc(asText(o.detail ?? o.description))}</div>` : '') + '</li>';
  }).join('');
  const rationale = childText(block) || text(block.props.rationale);
  return card(title && title !== question ? title : 'decision',
    (question ? `<div class="q">${esc(question)}</div>` : '') +
    (rows ? `<ul class="options">${rows}</ul>` : '<div class="note">no options</div>') +
    (rationale ? `<div class="rationale"><div class="label">rationale</div><div class="prose">${renderMarkdown(rationale)}</div></div>` : ''));
}

function renderImplementationMap(block, ctx) {
  const label = text(block.props.title || block.props.label, 'implementation map');
  const raw = block.props.files;
  if ((block.props._unparsed || []).includes('files')) {
    ctx.warnings.push('<ImplementationMap> files could not be parsed; raw text shown');
    return card(label, '<div class="note">The files list could not be parsed. The raw text is shown so nothing is lost.</div>' +
      `<pre><code>${esc(asText(raw))}</code></pre>`, 'unsupported');
  }
  let entries;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) entries = Object.entries(raw).map(([k, v]) => (v && typeof v === 'object' ? { path: k, ...v } : { path: k, note: v }));
  else entries = asArray(raw);
  if (!entries.length) {
    entries = (block.children || []).filter((c) => c.type === 'prose')
      .flatMap((c) => c.text.split('\n')).map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);
  }
  if (!entries.length) return card(label, '<div class="note">no files</div>');
  const items = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return `<li><span class="path">${esc(asText(entry))}</span></li>`;
    const change = text(entry.change ?? entry.status ?? entry.kind);
    return '<li>' + (change ? `<span class="badge ${esc(change)}">${esc(change)}</span>` : '') +
      `<span class="path">${esc(asText(entry.path ?? entry.file ?? entry.name))}</span>` +
      (entry.title ? `<div class="impl-title">${esc(asText(entry.title))}</div>` : '') +
      (entry.note ?? entry.description ? `<div class="impl-note">${esc(asText(entry.note ?? entry.description))}</div>` : '') +
      (entry.snippet ? codeBlock(entry.snippet) : '') + '</li>';
  });
  return card(label, `<ul class="tree impl">${items.join('')}</ul>`);
}

function compareSide(block, name, ctx) {
  const child = (block.children || []).find((c) => c.type === 'tag' && c.name.toLowerCase() === name);
  if (child) return child.props.html != null ? renderPayload({ html: child.props.html }, ctx) : renderBlocks(child.children, ctx);
  return null;
}

function renderCompare(block, ctx) {
  let before = compareSide(block, 'before', ctx);
  let after = compareSide(block, 'after', ctx);
  if (before === null && after === null) {
    const paired = (block.children || [])
      .flatMap((c) => (c.type === 'prose' ? c.text.split(/\n\s*\n/).map((t) => ({ type: 'prose', text: t })) : [c]))
      .filter((c) => c.type === 'tag' || c.type === 'prose');
    if (paired.length === 2) {
      before = renderBlocks([paired[0]], ctx);
      after = renderBlocks([paired[1]], ctx);
    }
  }
  if (before === null) before = block.props.before !== undefined ? renderPayload(block.props.before, ctx) : '<div class="note">empty</div>';
  if (after === null) after = block.props.after !== undefined ? renderPayload(block.props.after, ctx) : '<div class="note">empty</div>';
  const side = (cls, title, body) => `<div class="cmp-side ${cls}"><div class="cmp-label">${esc(title)}</div><div class="cmp-body">${body}</div></div>`;
  return '<div class="compare">' +
    side('before', text(block.props.beforeLabel, 'Before'), before) +
    side('after', text(block.props.afterLabel, 'After'), after) + '</div>';
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
  Archify: renderArchify,
  AgentTrail: (block, ctx) => require('./agent-trail').renderAgentTrail(block, ctx),
  RichText: renderRichText,
  Callout: renderCallout,
  Json: (block) => card('json', codeBlock(block.props.code != null ? block.props.code : block.props.data, 'json')),
  OpenApiSpec: (block) => card('openapi spec', codeBlock(block.props.code != null ? block.props.code : block.props.spec, 'yaml')),
  Checklist: renderChecklist,
  Table: renderDataTable,
  CodeTabs: renderCodeTabs,
  Decision: renderDecision,
  HtmlBlock: renderCustomHtml,
  ImplementationMap: renderImplementationMap,
  Compare: renderCompare,
  // canvas.mdx containers: pass-through so artboards and their Screen bodies
  // still render instead of collapsing into one unsupported card.
  DesignBoard: (block, ctx) => renderPayload(block.children, ctx),
  Section: (block, ctx) => renderPayload(block.children, ctx),
  Artboard: (block, ctx) => card(text(block.props.title || block.props.label, 'artboard'), withArtboard(block, ctx, false, () => renderPayload(block.children, ctx))),
  Annotation: annotationHtml,
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
  archify: 'Archify',
  'agent-trail': 'AgentTrail',
  'rich-text': 'RichText',
  callout: 'Callout',
  json: 'Json',
  checklist: 'Checklist',
  table: 'Table',
  'code-tabs': 'CodeTabs',
  decision: 'Decision',
  'html-block': 'HtmlBlock',
  'implementation-map': 'ImplementationMap',
  compare: 'Compare',
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

const ID_TAG_RE = /\s*\{#[A-Za-z0-9-]+\}\s*$/;

function renderHeading(block, ctx) {
  const level = Math.min(Math.max(block.level, 2), 4);
  const shown = block.text.replace(ID_TAG_RE, '') || block.text;
  const id = uniqueId(slugify(shown) || 'section', ctx);
  ctx.headings.push({ id, text: shown, level });
  return `<h${level} class="sec" id="${esc(id)}">${esc(shown)}</h${level}>`;
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


// --- board ---------------------------------------------------------------
// Visual blocks laid out as numbered rows of cards. Arrows come only from
// relations the plan states (transitions / Connector / data.edges); nothing is
// inferred. Positions are measured in the browser (board-client.js).

const BOARD_HEADING_RE = /\s*\{#board\}\s*$/;
const WIDTHS = { mobile: 'mobile', popover: 'narrow', panel: 'narrow', tablet: 'tablet', browser: 'wide', desktop: 'wide' };
const WIDE_TAGS = new Set(['Mermaid', 'Diagram', 'Diff', 'Code', 'AnnotatedCode', 'FileTree', 'DataModel', 'Endpoint']);

function surfaceOf(block) {
  if (block.props && block.props.surface) return String(block.props.surface);
  for (const child of block.children || []) {
    const found = child && child.type === 'tag' ? surfaceOf(child) : '';
    if (found) return found;
  }
  return '';
}

function widthClass(block) {
  const surface = WIDTHS[surfaceOf(block).toLowerCase()];
  if (surface) return 'w-' + surface;
  return WIDE_TAGS.has(block.name) ? 'w-wide' : '';
}

function relationOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const from = raw.from ?? raw.fromId ?? raw.source ?? raw.sourceId;
  const to = raw.to ?? raw.toId ?? raw.target ?? raw.targetId;
  if (from === undefined || to === undefined) return null;
  return { from: String(from), to: String(to), label: text(raw.label ?? raw.text) };
}

function isNodeDiagram(block) {
  if (block.name !== 'Diagram') return false;
  const data = block.props.data && typeof block.props.data === 'object' ? block.props.data : {};
  return !(data.html || block.props.html || data.source || block.props.source) && asArray(data.nodes).length > 0;
}

function resolveEdges(relations, known, ctx) {
  const edges = [];
  for (const rel of relations) {
    const from = known.get(rel.from);
    const to = known.get(rel.to);
    if (!from || !to) {
      ctx.warnings.push(`board relation ${rel.from} -> ${rel.to} names an unknown card; no arrow drawn`);
      continue;
    }
    edges.push({ from, to, label: rel.label, names: `${rel.from} to ${rel.to}` });
  }
  return edges;
}

function edgeSvg(edges, index) {
  if (!edges.length) return '';
  return `<svg class="board-edges" aria-hidden="true" focusable="false"><defs>` +
    `<marker id="bm-arrow-${index}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="edge-head" d="M0 0L10 5L0 10z"/></marker></defs>` +
    edges.map((e) => `<g class="edge" data-from="${e.from}" data-to="${e.to}"><path class="edge-line" d="" marker-end="url(#bm-arrow-${index})"/>` +
      `<text class="edge-label" text-anchor="middle">${esc(e.label)}</text></g>`).join('') +
    '</svg>' +
    `<ul class="sr-only">${edges.map((e) => `<li>${esc(e.names)}${e.label ? ': ' + esc(e.label) : ''}</li>`).join('')}</ul>`;
}

function boardShell(index, canvasInner, { abs = false, canvasStyle = '' } = {}) {
  return `<section class="board${abs ? ' board-abs' : ''}" aria-label="Visual board ${index}">` +
    `<div class="board-viewport"><div class="board-stage"><div class="board-canvas${abs ? ' abs' : ''}"${canvasStyle ? ` style="${canvasStyle}"` : ''}>${canvasInner}</div></div></div>` +
    '<div class="board-zoom" role="group" aria-label="Board zoom">' +
    '<button type="button" data-zoom="out" aria-label="Zoom out">&minus;</button>' +
    '<output class="zoom-readout" aria-live="polite">100%</output>' +
    '<button type="button" data-zoom="in" aria-label="Zoom in">+</button>' +
    '<button type="button" data-zoom="fit" aria-label="Fit board to view">fit</button>' +
    '<button type="button" data-zoom="reset" aria-label="Reset zoom to 100 percent">1:1</button>' +
    '</div></section>';
}

// --- absolute layout ------------------------------------------------------
// Artboards that carry x/y are placed on a canvas sized to their bounding box.
// Only numbers computed here reach a style attribute.

const ABS_MARGIN = 72;

function isAbsoluteArtboard(block) {
  return block.type === 'tag' && block.name === 'Artboard' && numProp(block.props.x) !== null && numProp(block.props.y) !== null;
}

function hasAbsolute(blocks) {
  return (blocks || []).some((b) => isAbsoluteArtboard(b) || (b.type === 'tag' && (b.name === 'DesignBoard' || b.name === 'Section') && hasAbsolute(b.children)));
}

function artboardBox(block) {
  const [dw, dh] = SURFACE_SIZE[surfaceOf(block).toLowerCase()] || [420, 520];
  return {
    x: within(numProp(block.props.x), -20000, 20000),
    y: within(numProp(block.props.y), -20000, 20000),
    width: within(numProp(block.props.width) ?? dw, 40, 6000),
    height: within(numProp(block.props.height) ?? dh, 40, 6000)
  };
}

function hasCaption(block) {
  return (block.children || []).some((c) => c.type === 'tag' && text(c.props.caption));
}

function estimateNoteHeight(block, width) {
  const body = childText(block) || text(block.props.text) || text(block.props.body);
  const lines = body.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(12, width / 6.6))), 0);
  return (text(block.props.title) ? 22 : 0) + lines * 19 + 8;
}

function renderAbsoluteBoard(blocks, ctx, index) {
  const relations = [];
  const known = new Map();
  const sections = [];
  const artboards = [];
  const notes = [];
  const tray = [];
  let section = null;
  let count = 0;
  const nextId = () => `bc-${index}-${++count}`;
  const collect = (list) => {
    for (const raw of asArray(list)) {
      const rel = relationOf(raw);
      if (rel) relations.push(rel);
    }
  };
  const register = (id, block, extra = []) => {
    for (const key of [block.props && block.props.id, block.props && block.props.blockId, ...extra]) if (key) known.set(String(key), id);
  };

  const walk = (list) => {
    for (const block of list || []) {
      try {
        if (block.type === 'heading') tray.push(`<h3 class="btitle">${esc(block.text)}</h3>`);
        else if (block.type === 'prose') tray.push(`<div class="bcard w-wide">${card('', `<div class="prose">${renderMarkdown(block.text)}</div>`)}</div>`);
        else if (block.type === 'tag') walkTag(block);
        else tray.push(`<div class="bcard">${renderBlocks([block], ctx)}</div>`);
      } catch (error) {
        ctx.warnings.push(`render failed for ${block && block.name ? '<' + block.name + '>' : 'a block'}: ${error.message}`);
        tray.push(`<div class="bcard">${errorCard('render failed', error.message)}</div>`);
      }
    }
  };

  const walkTag = (block) => {
    collect(block.props.transitions);
    if (block.name === 'DesignBoard') return walk(block.children);
    if (block.name === 'Section') {
      const previous = section;
      section = { title: text(block.props.title || block.props.label), subtitle: text(block.props.subtitle), boxes: [] };
      sections.push(section);
      walk(block.children);
      section = previous;
      return undefined;
    }
    if (block.name === 'Connector') {
      const rel = relationOf(block.props);
      if (rel) relations.push(rel);
      return undefined;
    }
    if (block.name === 'Annotation') {
      notes.push(block);
      return undefined;
    }
    if (isAbsoluteArtboard(block)) {
      const box = artboardBox(block);
      const item = { block, box, id: nextId(), order: numProp(block.props.order), seq: artboards.length, caption: hasCaption(block) };
      artboards.push(item);
      if (section) section.boxes.push(box);
      register(item.id, block, [slugify(text(block.props.label || block.props.title))]);
      return undefined;
    }
    const id = nextId();
    register(id, block, [slugify(text(block.props.title || block.props.label))]);
    tray.push(`<div class="bcard ${widthClass(block)}" id="${id}">${renderTag(block, ctx)}</div>`);
    return undefined;
  };

  walk(blocks);
  artboards.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.seq - b.seq);

  const byKey = new Map();
  for (const item of artboards) {
    for (const key of [item.block.props.id, item.block.props.blockId, slugify(text(item.block.props.label || item.block.props.title))]) {
      if (key && !byKey.has(String(key))) byKey.set(String(key), item);
    }
  }

  const rects = artboards.map((a) => ({ x: a.box.x, y: a.box.y - 28, w: a.box.width, h: a.box.height + 28 + (a.caption ? 30 : 0) }));

  const sectionLabels = [];
  let number = 0;
  for (const s of sections.filter((sec) => sec.title && sec.boxes.length)) {
    const x = Math.min(...s.boxes.map((b) => b.x));
    const y = Math.min(...s.boxes.map((b) => b.y));
    const right = Math.max(...s.boxes.map((b) => b.x + b.width));
    const width = within(right - x, 300, 640);
    const height = 22 + (s.subtitle ? Math.ceil(s.subtitle.length / (width / 6.4)) * 17 + 4 : 0);
    const top = y - 46;
    rects.push({ x, y: top - height, w: width, h: height });
    sectionLabels.push({ html: (n) => `<div class="sec-label pos" style="left:${n.x(x)}px;top:${n.y(top)}px;width:${width}px">` +
      `<div class="sec-title">${esc(`${++number} · ${s.title}`)}</div>` +
      (s.subtitle ? `<div class="sec-sub">${esc(s.subtitle)}</div>` : '') + '</div>' });
  }

  const stacks = new Map();
  const placedNotes = [];
  for (const note of notes) {
    const target = byKey.get(text(note.props.targetId));
    const nx = numProp(note.props.x);
    const ny = numProp(note.props.y);
    let place = null;
    if (target) {
      const placement = ['top', 'right', 'bottom', 'left'].includes(text(note.props.placement)) ? text(note.props.placement) : 'bottom';
      const t = target.box;
      const width = within(numProp(note.props.width) ?? (placement === 'top' || placement === 'bottom' ? Math.min(t.width, 320) : 240), 120, 640);
      const height = estimateNoteHeight(note, width);
      const key = `${target.id}:${placement}`;
      const used = stacks.get(key) || 0;
      stacks.set(key, used + height + 14);
      if (placement === 'bottom') place = { x: t.x, y: t.y + t.height + 16 + (target.caption ? 30 : 0) + used, width, height };
      else if (placement === 'top') place = { x: t.x, y: t.y - 40 - used - height, width, height };
      else if (placement === 'right') place = { x: t.x + t.width + 32, y: t.y + used, width, height };
      else place = { x: t.x - 32 - width, y: t.y + used, width, height };
    } else if (nx !== null && ny !== null) {
      const width = within(numProp(note.props.width) ?? 260, 120, 640);
      place = { x: within(nx, -20000, 20000), y: within(ny, -20000, 20000), width, height: estimateNoteHeight(note, width) };
    }
    if (place) {
      rects.push({ x: place.x, y: place.y, w: place.width, h: place.height });
      placedNotes.push({ note, place, id: nextId() });
    } else {
      tray.push(`<div class="bcard bnote" id="${nextId()}" style="width:260px">${annotationHtml(note)}</div>`);
    }
  }

  const minX = rects.length ? Math.min(...rects.map((r) => r.x)) : 0;
  const minY = rects.length ? Math.min(...rects.map((r) => r.y)) : 0;
  const maxX = rects.length ? Math.max(...rects.map((r) => r.x + r.w)) : 0;
  const maxY = rects.length ? Math.max(...rects.map((r) => r.y + r.h)) : 0;
  const off = { x: (v) => Math.round(v + ABS_MARGIN - minX), y: (v) => Math.round(v + ABS_MARGIN - minY) };
  const width = Math.round(maxX - minX + ABS_MARGIN * 2);
  const height = Math.round(maxY - minY + ABS_MARGIN * 2);

  const abHtml = artboards.map((a) => {
    const label = text(a.block.props.label || a.block.props.title || a.block.props.id, 'artboard');
    const inner = withArtboard(a.block, ctx, true, () => renderPayload(a.block.children, ctx));
    return `<div class="bcard ab pos" id="${a.id}" style="left:${off.x(a.box.x)}px;top:${off.y(a.box.y)}px;width:${a.box.width}px;height:${a.box.height}px">` +
      `<div class="ab-label">${a.order !== null ? `<span class="ab-n">${esc(String(a.order))}</span>` : ''}${esc(label)}</div>` +
      `<div class="ab-frame">${inner}</div></div>`;
  }).join('');

  const noteHtml = placedNotes.map(({ note, place, id }) => `<div class="bcard bnote pos" id="${id}" style="left:${off.x(place.x)}px;top:${off.y(place.y)}px;width:${place.width}px">${annotationHtml(note)}</div>`).join('');

  const trayHtml = tray.length ? `<div class="abs-tray" style="padding-top:${height - ABS_MARGIN + 40}px">${tray.join('')}</div>` : '';
  const edges = resolveEdges(relations, known, ctx);
  const inner = edgeSvg(edges, index) + sectionLabels.map((s) => s.html(off)).join('') + abHtml + noteHtml + trayHtml;
  return boardShell(index, inner, { abs: true, canvasStyle: `width:${width}px;min-height:${height}px` });
}

function renderBoard(blocks, ctx) {
  const index = ctx.boards = (ctx.boards || 0) + 1;
  if (hasAbsolute(blocks)) return renderAbsoluteBoard(blocks, ctx, index);
  const rows = [];
  const relations = [];
  const known = new Map();
  let cardCount = 0;
  let row = null;

  const startRow = (title) => { row = { title, cards: [] }; rows.push(row); };
  const addCard = (html, cls, keys) => {
    if (!row) startRow('');
    cardCount += 1;
    const id = `bc-${index}-${cardCount}`;
    for (const key of keys) if (key) known.set(String(key), id);
    row.cards.push(`<div class="bcard${cls ? ' ' + cls : ''}" id="${id}">${html}</div>`);
  };
  const collect = (list) => {
    for (const raw of asArray(list)) {
      const rel = relationOf(raw);
      if (rel) relations.push(rel);
    }
  };

  const walk = (list) => {
    for (const block of list || []) {
      try {
        if (block.type === 'heading') startRow(block.text);
        else if (block.type === 'prose') addCard(card('', `<div class="prose">${renderMarkdown(block.text)}</div>`), 'w-wide', []);
        else if (block.type === 'tag') walkTag(block);
        else addCard(renderBlocks([block], ctx), '', []);
      } catch (error) {
        ctx.warnings.push(`render failed for ${block && block.name ? '<' + block.name + '>' : 'a block'}: ${error.message}`);
        addCard(errorCard('render failed', error.message), '', []);
      }
    }
  };

  const walkTag = (block) => {
    collect(block.props.transitions);
    if (block.name === 'DesignBoard') return walk(block.children);
    if (block.name === 'Section') {
      startRow(text(block.props.title || block.props.label));
      return walk(block.children);
    }
    if (block.name === 'Connector') {
      const rel = relationOf(block.props);
      if (rel) relations.push(rel);
      return undefined;
    }
    if (isNodeDiagram(block)) {
      const data = block.props.data;
      asArray(data.nodes).forEach((node, i) => {
        const obj = node && typeof node === 'object' ? node : { label: asText(node) };
        const id = text(obj.id, String(i));
        const label = text(obj.label || obj.text || obj.id, 'node');
        addCard(card(label, obj.description ? `<div class="note">${esc(asText(obj.description))}</div>` : ''), 'bnode', [id]);
      });
      collect(data.edges);
      return undefined;
    }
    const keys = [block.props.id, block.props.blockId, slugify(text(block.props.title || block.props.label))];
    addCard(renderTag(block, ctx), widthClass(block), keys);
    return undefined;
  };

  walk(blocks);

  const edges = resolveEdges(relations, known, ctx);

  let number = 0;
  const rowHtml = rows.filter((r) => r.cards.length).map((r) => {
    const title = r.title ? `<h3 class="btitle">${esc(`${++number} · ${r.title}`)}</h3>` : '';
    return `<div class="brow">${title}<div class="bcards">${r.cards.join('')}</div></div>`;
  }).join('');

  return boardShell(index, edgeSvg(edges, index) + rowHtml);
}

// Document blocks with board islands: a heading tagged {#board} hands its
// section (up to the next heading of the same or a higher level) to the board,
// and a run of blocks carrying a `board` prop becomes one board.
function renderDocument(blocks, ctx) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length) ctx.docBlocks = (ctx.docBlocks || 0) + run.filter((b) => b.type !== 'heading').length;
    if (run.length) out.push(renderBlocks(run, ctx));
    run = [];
  };
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'heading' && BOARD_HEADING_RE.test(block.text)) {
      flush();
      out.push(renderBlocks([{ ...block, text: block.text.replace(BOARD_HEADING_RE, '') }], ctx));
      const group = [];
      while (i + 1 < blocks.length && !(blocks[i + 1].type === 'heading' && blocks[i + 1].level <= block.level)) group.push(blocks[++i]);
      out.push(renderBoard(group, ctx));
    } else if (block.type === 'tag' && block.props.board) {
      flush();
      const group = [block];
      while (i + 1 < blocks.length && blocks[i + 1].type === 'tag' && blocks[i + 1].props.board) group.push(blocks[++i]);
      out.push(renderBoard(group, ctx));
    } else run.push(block);
  }
  flush();
  return out.join('\n');
}

function themeCss() {
  return fs.readFileSync(path.join(__dirname, 'theme.css'), 'utf8');
}

function boardScript() {
  return `<script>\n${fs.readFileSync(path.join(__dirname, 'board-client.js'), 'utf8')}</script>`;
}

const RECAP_CHIPS = [
  ['pr', 'PR', (v) => v],
  ['branch', 'branch', (v, fm) => (fm.base ? `${v} \u2192 ${fm.base}` : v)],
  ['commit', 'commit', (v) => v],
  ['files', 'files', (v) => `${v} file${Number(v) === 1 ? '' : 's'}`],
  ['additions', '', (v) => `+${v}`, 'add'],
  ['deletions', '', (v) => `\u2212${v}`, 'del'],
  ['author', 'by', (v) => v],
  ['date', '', (v) => v]
];

function recapHeader(title, frontmatter) {
  const chips = RECAP_CHIPS
    .filter(([key]) => frontmatter[key] !== undefined && frontmatter[key] !== '' && frontmatter[key] !== true)
    .map(([key, label, format, tone]) => `<li class="${tone || ''}">${label ? `<span class="k">${esc(label)}</span>` : ''}${esc(format(String(frontmatter[key]), frontmatter))}</li>`);
  const subtitle = text(frontmatter.subtitle || frontmatter.summary);
  return '<header class="recap-head"><div class="recap-eyebrow">VISUAL RECAP</div>' +
    `<h1 class="doc-title recap-title">${esc(title)}</h1>` +
    (subtitle ? `<p class="recap-sub">${esc(subtitle)}</p>` : '') +
    (chips.length ? `<ul class="recap-chips">${chips.join('')}</ul>` : '') + '</header>';
}

function page({ title, status, meta, headings, body, warnings, hasMermaid, hasBoard, boardOnly, recap }) {
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
<body${boardOnly ? ' class="board-only"' : ''}>
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
${recap ? recapHeader(title, recap) : `<h1 class="doc-title">${esc(title)}</h1>`}
<div class="flow">${body}</div>
<footer class="footer">Built by BDB Plan Builder from the plan folder beside this file. Edit the MDX and re-run the build.<span class="vp-mark">VISUAL PLAN</span></footer>
</main>
</div>
${hasMermaid ? mermaidLoaderScript(mermaidUrl()) : ''}
${hasBoard ? boardScript() : ''}
</body>
</html>`;
}

module.exports = { checklistItems, prototypeHint, renderBlocks, renderBoard, renderDocument, renderTag, page, mermaidUrl, escapeHtml };