'use strict';

const { roundPoint, clampPoint, fromAnchorUnits, simplify } = require('./geometry');

// Inlined into the browser bundle (see index.js): CAPS and the two regexes
// are emitted as constants, the functions with fn.toString().
const CAPS = {
  maxItemsPerPost: 20,
  maxBodyBytes: 200000,
  maxShapes: 16,
  maxPointsTotal: 2048,
  maxFreehand: 512,
  text: 4000,
  snippet: 200,
  selector: 500,
  textRange: 1000,
  classes: 12,
  url: 300,
  bbox: 100000
};
const SHAPE_COLORS = ['red', 'yellow', 'blue', 'green'];
const POINT_RULES = { rect: [2, 2], arrow: [2, 2], blur: [2, 2], comment: [1, 1], freehand: [2, 512] };
const STRIP_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;
const CLASS_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SRC_RE = /^[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z0-9]{1,8}:\d{1,6}(?::\d{1,5})?$/;
const TAG_RE = /^[a-z][a-z0-9-]{0,59}$/;

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(STRIP_RE, '').slice(0, max);
}

function cleanClasses(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < Math.min(list.length, 200) && out.length < CAPS.classes; i++) {
    const c = list[i];
    if (typeof c === 'string' && CLASS_RE.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

function cleanSrcLoc(value) {
  if (typeof value !== 'string' || value.length > 240 || !SRC_RE.test(value)) return null;
  const file = value.slice(0, value.search(/:\d/));
  return file.split('/').some(s => s.startsWith('.') || s === 'node_modules') ? null : value;
}

function makeShape(type, points, color) {
  const rule = POINT_RULES[Object.prototype.hasOwnProperty.call(POINT_RULES, type) ? type : ''];
  if (!rule || !Array.isArray(points)) return null;
  if (!points.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null;
  const pts = (type === 'freehand' ? simplify(points, 0.002, CAPS.maxFreehand) : points)
    .map(p => roundPoint(clampPoint(p)));
  if (pts.length < rule[0] || pts.length > rule[1]) return null;
  const shape = { type, points: pts };
  if (SHAPE_COLORS.includes(color)) shape.color = color;
  return shape;
}

function createDraft() {
  return { shapes: [], redo: [] };
}

function draftPointCount(draft) {
  return draft.shapes.reduce((n, s) => n + s.points.length, 0);
}

// Returns '' when added, otherwise the reason it was refused.
function draftAdd(draft, shape) {
  if (!shape) return 'invalid';
  if (draft.shapes.length >= CAPS.maxShapes) return 'max-shapes';
  if (draftPointCount(draft) + shape.points.length > CAPS.maxPointsTotal) return 'max-points';
  draft.shapes.push(shape);
  draft.redo.length = 0;
  return '';
}

function draftUndo(draft) {
  const s = draft.shapes.pop();
  if (s) draft.redo.push(s);
  return Boolean(s);
}

function draftRedo(draft) {
  const s = draft.redo.pop();
  if (s) draft.shapes.push(s);
  return Boolean(s);
}

function draftClear(draft) {
  draft.shapes.length = 0;
  draft.redo.length = 0;
}

function shapeSummary(shapes) {
  return Array.isArray(shapes) ? shapes.map(s => s.type).join(', ') : '';
}

function pageBBox(shapes, box) {
  const xs = [];
  const ys = [];
  for (const s of shapes) for (const p of s.points) {
    const pt = fromAnchorUnits(p, box);
    xs.push(pt[0]);
    ys.push(pt[1]);
  }
  if (!xs.length) return null;
  const c = v => Math.round(Math.min(CAPS.bbox, Math.max(0, v)));
  const x = c(Math.min(...xs));
  const y = c(Math.min(...ys));
  return { x, y, w: c(Math.max(...xs)) - x, h: c(Math.max(...ys)) - y };
}

function buildItem(input) {
  const text = cleanText(input.text, CAPS.text).trim();
  if (!text || !input.anchor) return null;
  const shapes = (input.shapes || []).slice(0, CAPS.maxShapes);
  const blurred = shapes.some(s => s.type === 'blur');
  const a = input.anchor;
  const tag = a.tag === 'text' || TAG_RE.test(a.tag || '') ? a.tag : 'div';
  const anchor = {
    selector: cleanText(a.selector, CAPS.selector) || 'body',
    tag,
    snippet: blurred ? '' : cleanText(a.snippet, CAPS.snippet)
  };
  const classes = cleanClasses(a.classes);
  if (classes.length) anchor.classes = classes;
  if (a.textRange && !blurred) {
    const t = cleanText(a.textRange.text, CAPS.textRange);
    if (t) anchor.textRange = { text: t };
  }
  const item = { kind: 'annotation', text, anchor };
  let points = 0;
  const kept = [];
  for (const s of shapes) {
    if (points + s.points.length > CAPS.maxPointsTotal) break;
    points += s.points.length;
    const out = { type: s.type, points: s.points.map(p => [p[0], p[1]]) };
    if (SHAPE_COLORS.includes(s.color)) out.color = s.color;
    kept.push(out);
  }
  if (kept.length) item.shapes = kept;
  const v = input.viewport;
  if (v && Number.isFinite(v.w) && Number.isFinite(v.h)) {
    const int = n => Math.min(100000, Math.max(1, Math.round(n)));
    const dpr = Number.isFinite(v.dpr) ? Math.min(8, Math.max(0.5, v.dpr)) : 1;
    item.viewport = { w: int(v.w), h: int(v.h), dpr: Math.round(dpr * 100) / 100 };
  }
  if (input.box) {
    const b = input.box;
    const c = n => (Number.isFinite(n) ? Math.round(Math.min(CAPS.bbox, Math.max(0, n))) : 0);
    const page = kept.length ? pageBBox(kept, b) : { x: c(b.left), y: c(b.top), w: c(b.width), h: c(b.height) };
    if (page) item.page = page;
  }
  if (input.target) {
    const target = { url: cleanText(input.target.url, CAPS.url) };
    const src = cleanSrcLoc(input.target.srcLoc);
    if (src) target.srcLoc = src;
    item.target = target;
  }
  return item;
}

function chunkItems(items) {
  const chunks = [];
  let cur = [];
  let bytes = 0;
  for (const item of items) {
    const size = JSON.stringify(item).length;
    if (cur.length && (cur.length >= CAPS.maxItemsPerPost || bytes + size > CAPS.maxBodyBytes)) {
      chunks.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(item);
    bytes += size;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const PURE_FUNCTIONS = [
  cleanText, cleanClasses, cleanSrcLoc, makeShape, createDraft, draftPointCount, draftAdd, draftUndo,
  draftRedo, draftClear, shapeSummary, pageBBox, buildItem, chunkItems
];

module.exports = {
  CAPS, SHAPE_COLORS, POINT_RULES, STRIP_RE, CLASS_RE, SRC_RE, TAG_RE, PURE_FUNCTIONS,
  cleanText, cleanClasses, cleanSrcLoc, makeShape, createDraft, draftPointCount, draftAdd, draftUndo,
  draftRedo, draftClear, shapeSummary, pageBBox, buildItem, chunkItems
};
