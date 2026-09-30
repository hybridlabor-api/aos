'use strict';

/**
 * Low-fidelity wireframe kit: the layout tags authored inside <Screen> /
 * <FrameScreen> (<Col>, <Row>, <Box>, <Lines>, ...) rendered as plain,
 * escaped HTML. Only numbers that were parsed and clamped reach a style
 * attribute; every string goes through escapeHtml.
 */

const { escapeHtml: esc } = require('../plan-canvas/markdown');

const DEFAULT_WIDTHS = [92, 78, 86, 64, 72];

function str(value) {
  if (value === undefined || value === null || value === true || value === false) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function flag(value) {
  return value === true || value === 'true';
}

function plainChildren(block) {
  return (block.childrenRaw || '').trim();
}

// Inline text for a kit node: explicit props first, then literal children.
function labelOf(block, ...keys) {
  for (const key of keys) {
    const value = str(block.props[key]);
    if (value) return value;
  }
  return plainChildren(block);
}

function cls(base, ...extra) {
  return [base, ...extra.filter(Boolean)].join(' ');
}

function chips(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => {
    const obj = item && typeof item === 'object' ? item : { label: str(item) };
    return `<span class="${cls('k-chip', flag(obj.active) && 'on')}">${esc(str(obj.label || obj.text))}</span>`;
  }).join('');
}

const TAGS = {
  FrameScreen: (b, inner) => `<div class="k-frame">${inner}</div>`,
  Main: (b, inner) => `<div class="k-col k-main">${inner}</div>`,
  Col: (b, inner) => `<div class="${cls('k-col', flag(b.props.full) && 'full')}">${inner}</div>`,
  Row: (b, inner) => `<div class="${cls('k-row', flag(b.props.full) && 'full')}">${inner}</div>`,
  Box: (b, inner) => `<div class="${cls('k-box', flag(b.props.dashed) && 'dashed', flag(b.props.full) && 'full')}">${inner}</div>`,
  Card: (b, inner) => `<div class="k-box k-card">${inner}</div>`,
  Lines: (b) => {
    const count = clamp(b.props.n, 1, 40, 3);
    const widths = Array.isArray(b.props.widths) ? b.props.widths : [];
    let html = '';
    for (let i = 0; i < count; i++) {
      const width = clamp(widths[i], 4, 100, DEFAULT_WIDTHS[i % DEFAULT_WIDTHS.length]);
      html += `<i class="k-bar" style="width:${width}%"></i>`;
    }
    return `<div class="k-lines">${html}</div>`;
  },
  IconSquare: (b) => `<i class="${cls('k-icon', flag(b.props.active) && 'on')}"></i>`,
  Divider: () => '<hr class="k-div">',
  StatusBar: () => '<div class="k-status"><i></i><i></i><i></i><b></b></div>',
  TaskRow: (b) => {
    const done = flag(b.props.done);
    const note = str(b.props.note);
    return `<div class="${cls('k-task', done && 'done')}"><i class="k-check"></i>` +
      `<span class="k-text">${esc(labelOf(b, 'title', 'label', 'text'))}</span>` +
      (note ? `<span class="k-text k-muted">${esc(note)}</span>` : '') + '</div>';
  },
  Text: (b) => {
    const tone = str(b.props.tone) === 'muted' ? 'k-muted' : '';
    const weight = str(b.props.weight) === 'bold' ? 'k-bold' : '';
    return `<span class="${cls('k-text', tone, weight)}">${esc(labelOf(b, 'value', 'text', 'label'))}</span>`;
  },
  Title: (b) => `<div class="k-title">${esc(labelOf(b, 'text', 'value', 'label'))}</div>`,
  SectionLabel: (b) => `<div class="k-section-label">${esc(labelOf(b, 'label', 'text', 'value'))}</div>`,
  Btn: (b) => `<span class="${cls('k-btn', flag(b.props.primary) && 'on')}">${esc(labelOf(b, 'label', 'text'))}</span>`,
  Chips: (b) => `<div class="k-chips">${chips(b.props.items)}</div>`,
  Skeleton: (b) => {
    const lines = clamp(b.props.lines, 0, 20, 0);
    if (lines) return TAGS.Lines({ props: { n: lines, widths: b.props.widths } });
    const width = clamp(b.props.width ?? b.props.w, 4, 100, 100);
    const height = clamp(b.props.height ?? b.props.h, 4, 600, 14);
    return `<i class="k-skel" style="width:${width}%;height:${height}px"></i>`;
  }
};

const KIT_TAGS = new Set(Object.keys(TAGS));

function renderKit(blocks, ctx) {
  const out = [];
  for (const block of blocks || []) {
    if (block.type === 'tag') {
      const handler = Object.hasOwn(TAGS, block.name) ? TAGS[block.name] : null;
      if (handler) {
        out.push(handler(block, renderKit(block.children, ctx)));
      } else {
        ctx.warnings.push(`unknown wireframe kit tag <${block.name}>`);
        out.push(`<div class="k-unknown">&lt;${esc(block.name)}&gt;</div>`);
      }
    } else if (block.type === 'heading') {
      out.push(`<div class="k-title">${esc(block.text)}</div>`);
    } else if (block.type === 'prose') {
      out.push(`<span class="k-text">${esc(block.text)}</span>`);
    } else if (block.type === 'malformed') {
      ctx.warnings.push(block.message || 'malformed wireframe kit markup');
      out.push(`<div class="k-unknown">${esc(block.message || 'malformed')}</div>`);
    }
  }
  return out.join('');
}

module.exports = { renderKit, KIT_TAGS };
