'use strict';

/**
 * <AgentTrail /> — static, embeddable view of the plan's multi-agent workflow.
 * Components, needs and tasks come from derive() in trail.js (same plan folder);
 * nothing is parsed twice. The live `aos-trail` app stays the standard; `live`
 * only links to it, and `embed` additionally frames it.
 */

const { escapeHtml: esc } = require('../plan-canvas/markdown');

const COL_W = 210;
const COL_GAP = 60;
const ROW_H = 80;
const ROW_GAP = 16;
const PAD = 8;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function localUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (!/^https?:$/.test(u.protocol) || !LOCAL_HOSTS.has(u.hostname) || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

// Level = longest chain of stated needs; a cycle edge is ignored rather than looping.
function levels(components) {
  const byId = new Map(components.map((c) => [c.id, c]));
  const memo = new Map();
  const walking = new Set();
  const level = (c) => {
    if (memo.has(c.id)) return memo.get(c.id);
    walking.add(c.id);
    let n = 0;
    for (const need of c.needs) {
      const dep = byId.get(need);
      if (dep && !walking.has(dep.id)) n = Math.max(n, level(dep) + 1);
    }
    walking.delete(c.id);
    memo.set(c.id, n);
    return n;
  };
  components.forEach(level);
  return memo;
}

const pct4 = (f) => Number((f * 100).toFixed(3));

function note(message) {
  return `<div class="card trail-empty"><div class="label">AgentTrail</div><div>${esc(message)}</div></div>`;
}

function renderAgentTrail(block, ctx) {
  const props = block.props || {};
  let model = [];
  try {
    if (!ctx.dir) throw new Error('needs a plan folder on disk');
    model = require('./trail').derive(ctx.dir).graph;
  } catch (error) {
    ctx.warnings.push(`<AgentTrail> could not read the plan folder: ${error.message}`);
  }
  if (!model.length) {
    ctx.warnings.push('<AgentTrail> no components found; add {#id} headings and needs: lines');
    return note('AgentTrail: no components found - add {#id} headings and needs: lines');
  }

  const level = levels(model);
  const rowOf = new Map();
  const pos = new Map();
  for (const c of model) {
    const col = level.get(c.id);
    const row = rowOf.get(col) || 0;
    rowOf.set(col, row + 1);
    pos.set(c.id, { x: PAD + col * (COL_W + COL_GAP), y: PAD + row * (ROW_H + ROW_GAP) });
  }
  const width = PAD * 2 + (Math.max(...level.values()) + 1) * COL_W + Math.max(...level.values()) * COL_GAP;
  const height = PAD * 2 + Math.max(...rowOf.values()) * ROW_H + (Math.max(...rowOf.values()) - 1) * ROW_GAP;

  const edges = [];
  for (const c of model) {
    for (const need of c.needs) {
      const a = pos.get(need);
      const b = pos.get(c.id);
      if (!a || !b) continue;
      const x1 = a.x + COL_W;
      const y1 = a.y + ROW_H / 2;
      const x2 = b.x;
      const y2 = b.y + ROW_H / 2;
      const mid = (x1 + x2) / 2;
      edges.push(`<path class="trail-edge" data-from="${esc(need)}" data-to="${esc(c.id)}" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}"/>`);
    }
  }

  const cards = model.map((c) => {
    const done = c.tasks.filter((t) => t.checked).length;
    const total = c.tasks.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const tasks = total
      ? `<ul class="trail-tasks">${c.tasks.map((t) => `<li class="${t.checked ? 'done' : ''}"><span class="mark" aria-hidden="true">${t.checked ? '&#10003;' : '&#9675;'}</span>${esc(t.label)}</li>`).join('')}</ul>`
      : '<div class="trail-tasks note">no tasks</div>';
    const p = pos.get(c.id);
    return `<details class="trail-node" data-id="${esc(c.id)}" style="left:${pct4(p.x / width)}%;top:${p.y}px;width:${pct4(COL_W / width)}%;min-height:${ROW_H}px">` +
      `<summary><span class="trail-id">${esc(c.id)}</span><span class="trail-title" title="${esc(c.title)}">${esc(c.title)}</span>` +
      `<span class="trail-count">${done} of ${total} tasks</span>` +
      `<span class="trail-bar"><span style="width:${pct}%"></span></span></summary>${tasks}</details>`;
  }).join('');

  let live = '';
  if (props.live !== undefined && props.live !== true) {
    const href = localUrl(props.live);
    if (!href) {
      ctx.warnings.push(`<AgentTrail live="${String(props.live)}"> must be an http(s) URL on localhost or 127.0.0.1; link and iframe omitted`);
    } else {
      live = `<div class="trail-live"><a href="${esc(href)}" target="_blank" rel="noopener">Open live agent trail</a></div>`;
      if (props.embed !== undefined && props.embed !== false) {
        live += `<iframe class="trail-frame" sandbox="allow-scripts allow-same-origin" loading="lazy" title="Live agent trail" src="${esc(href)}"></iframe>`;
      }
    }
  }

  return '<div class="card trail"><div class="label">agent trail</div>' +
    `<div class="trail-scroll"><div class="trail-stage" style="height:${height}px">` +
    `<svg class="trail-edges" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${edges.join('')}</svg>${cards}</div></div>${live}</div>`;
}

module.exports = { renderAgentTrail, localUrl };
