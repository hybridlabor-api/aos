'use strict';

/**
 * Plan Canvas annotation schema: whitelist normaliser for browser-submitted
 * annotations. Output is rebuilt field by field; nothing from the input object
 * is copied through, unknown keys are dropped, types are never coerced.
 */

const MAX_TEXT = 4000;
const MAX_SHAPES = 16;
const MAX_POINTS_TOTAL = 2048;
const MAX_FREEHAND_POINTS = 512;
const MAX_CLASSES = 12;
const MAX_CLASS_SCAN = 200;
const BBOX_LIMIT = 100000;
const POINT_MIN = -4;
const POINT_MAX = 5;

const SHAPE_POINTS = {
  element: [0, 0],
  text: [0, 0],
  rect: [2, 2],
  arrow: [2, 2],
  freehand: [2, MAX_FREEHAND_POINTS],
  blur: [2, 2],
  comment: [1, 1]
};
const COLORS = new Set(['red', 'yellow', 'blue', 'green']);
const TAG_RE = /^[a-z][a-z0-9-]{0,59}$/;
const CLASS_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SRC_RE = /^[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z0-9]{1,8}:\d{1,6}(?::\d{1,5})?$/;
const ORIGIN_RE = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/i;
const LOOPBACK_URL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;
const WHITESPACE_CONTROL_RE = /[\t\n\r]+/g;

const own = (obj, key) => (obj !== null && typeof obj === 'object' && Object.hasOwn(obj, key) ? obj[key] : undefined);
const isNum = value => typeof value === 'number' && Number.isFinite(value);

// Tabs and line breaks become one space so multi-line comments stay readable;
// every other control, bidi and zero-width character is removed.
function cleanText(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return '';
  let out = value.replace(WHITESPACE_CONTROL_RE, ' ').replace(CONTROL_RE, '').slice(0, max);
  if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1);
  return out;
}

// Returns the canonical `http://host:port` for a loopback app origin, else null.
function normalizeOrigin(value) {
  if (typeof value !== 'string') return null;
  const match = ORIGIN_RE.exec(value);
  if (!match) return null;
  const port = Number(match[2]);
  if (port < 1024 || port > 65535) return null;
  return `http://${match[1].toLowerCase()}:${port}`;
}

function cleanSrcLoc(value) {
  if (typeof value !== 'string' || value.length > 240 || !SRC_RE.test(value)) return null;
  const file = value.slice(0, value.search(/:\d/));
  if (file.split('/').some(s => s.startsWith('.') || s === 'node_modules')) return null;
  return value;
}

function cleanAppUrl(value, boundOrigin) {
  const fallback = boundOrigin || null;
  if (typeof value !== 'string' || value.length > 2000) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !LOOPBACK_URL_HOSTS.has(url.hostname) || url.port === '') return fallback;
    if (!boundOrigin || normalizeOrigin(url.origin) !== boundOrigin) return fallback;
    const clean = `${url.origin}${url.pathname}`;
    return clean.length <= 300 ? clean : fallback;
  } catch {
    return fallback;
  }
}

function cleanTarget(raw, origin, boundOrigin) {
  if (origin !== 'app') return { origin: 'canvas', url: null };
  const target = { origin: 'app', url: cleanAppUrl(own(own(raw, 'target'), 'url'), boundOrigin) };
  const srcLoc = cleanSrcLoc(own(own(raw, 'target'), 'srcLoc'));
  if (srcLoc) target.srcLoc = srcLoc;
  return target;
}

function cleanClasses(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (let i = 0; i < Math.min(value.length, MAX_CLASS_SCAN) && out.length < MAX_CLASSES; i++) {
    const c = value[i];
    if (typeof c === 'string' && CLASS_RE.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

function cleanAnchor(raw) {
  const selector = own(raw, 'selector');
  if (typeof selector !== 'string') return null;
  const tag = own(raw, 'tag');
  const anchor = {
    selector: cleanText(selector, 500),
    tag: typeof tag === 'string' && (TAG_RE.test(tag) || tag === 'text') ? tag : '',
    snippet: cleanText(own(raw, 'snippet'), 400)
  };
  const classes = cleanClasses(own(raw, 'classes'));
  if (classes.length) anchor.classes = classes;
  const range = own(raw, 'textRange');
  if (range !== null && typeof range === 'object') {
    anchor.textRange = { text: cleanText(own(range, 'text'), 1000) };
  }
  return anchor;
}

const roundTo = (n, digits) => Number(n.toFixed(digits));
const clampPoint = n => roundTo(Math.min(POINT_MAX, Math.max(POINT_MIN, n)), 4);

// Any malformed shape rejects the whole item: a half-drawn annotation would
// mislead the agent about what the human marked.
function cleanShapes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SHAPES) return null;
  const shapes = [];
  let total = 0;
  for (const rawShape of value) {
    const type = own(rawShape, 'type');
    const limits = typeof type === 'string' && Object.hasOwn(SHAPE_POINTS, type) ? SHAPE_POINTS[type] : null;
    if (!limits) return null;
    const shape = { type };
    if (limits[1] > 0) {
      const points = own(rawShape, 'points');
      if (!Array.isArray(points) || points.length < limits[0] || points.length > limits[1]) return null;
      total += points.length;
      if (total > MAX_POINTS_TOTAL) return null;
      shape.points = [];
      for (const p of points) {
        if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return null;
        shape.points.push([clampPoint(p[0]), clampPoint(p[1])]);
      }
    }
    const color = own(rawShape, 'color');
    if (typeof color === 'string' && COLORS.has(color)) shape.color = color;
    shapes.push(shape);
  }
  return shapes;
}

function cleanViewport(raw) {
  const w = own(raw, 'w');
  const h = own(raw, 'h');
  const dpr = own(raw, 'dpr');
  if (!isNum(w) || !isNum(h) || !isNum(dpr)) return null;
  const out = { w: Math.round(w), h: Math.round(h), dpr: roundTo(dpr, 2) };
  if (out.w < 1 || out.w > BBOX_LIMIT || out.h < 1 || out.h > BBOX_LIMIT || out.dpr < 0.5 || out.dpr > 8) return null;
  return out;
}

function cleanPage(raw) {
  const out = {};
  for (const k of ['x', 'y', 'w', 'h']) {
    const n = own(raw, k);
    if (!isNum(n)) return null;
    out[k] = Math.round(Math.min(BBOX_LIMIT, Math.max(0, n)));
  }
  return out;
}

/**
 * @param raw       untrusted annotation object
 * @param origin    'canvas' | 'app', set by the endpoint, never by the body
 * @param boundOrigin  the token's bound app origin (app only)
 * @returns the validated item fields (without id/at/kind) or null
 */
function normalizeAnnotation(raw, { origin = 'canvas', boundOrigin = null } = {}) {
  if (raw === null || typeof raw !== 'object') return null;
  const text = cleanText(own(raw, 'text'));
  if (!text) return null;
  const anchor = cleanAnchor(own(raw, 'anchor'));
  if (!anchor) return null;
  const fields = { text, anchor, target: cleanTarget(raw, origin === 'app' ? 'app' : 'canvas', boundOrigin) };
  if (own(raw, 'shapes') !== undefined) {
    const shapes = cleanShapes(own(raw, 'shapes'));
    if (!shapes) return null;
    fields.shapes = shapes;
  }
  const viewport = cleanViewport(own(raw, 'viewport'));
  if (viewport) fields.viewport = viewport;
  const page = cleanPage(own(raw, 'page'));
  if (page) fields.page = page;
  return fields;
}

module.exports = { cleanSrcLoc, cleanText, normalizeAnnotation, normalizeOrigin };
