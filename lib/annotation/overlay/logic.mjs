// WP4+WP5 pure logic: no DOM access. Selector builder, tool state machine, undo stack.
'use strict';

export const TOOLS = Object.freeze(['pin', 'box', 'freehand', 'text', 'pick']);
export const COLORS = Object.freeze(['#e5484d', '#f5a524', '#46a758', '#3e63dd', '#8e4ec6', '#ffffff']);
const MAX_UNDO = 50;
const MAX_POINTS = 512;
const MAX_SELECTOR = 512;

function escClass(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}

// Pure selector builder from element descriptor {tag,id,classes[],nth,parent?}.
// Returns {selector, fallback:true} — selector-only, never throws.
export function buildSelector(desc) {
  const d = desc && typeof desc === 'object' ? desc : {};
  const tag = /^[a-zA-Z][a-zA-Z0-9-]*$/.test(String(d.tag || '')) ? String(d.tag).toLowerCase() : null;
  if (typeof d.id === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(d.id)) {
    return { selector: `#${d.id}`, fallback: false };
  }
  let base = tag || '*';
  const classes = Array.isArray(d.classes) ? d.classes.filter((c) => /^[A-Za-z0-9_-]+$/.test(c)).slice(0, 2) : [];
  if (classes.length) base += classes.map((c) => '.' + escClass(c)).join('');
  if (Number.isInteger(d.nth) && d.nth >= 1 && d.nth <= 9999) base += `:nth-of-type(${d.nth})`;
  let sel = base;
  if (typeof d.parent === 'string' && d.parent.length > 0 && d.parent.length < 200) sel = d.parent + ' > ' + sel;
  if (sel.length > MAX_SELECTOR) sel = sel.slice(0, MAX_SELECTOR);
  return { selector: sel, fallback: !tag && classes.length === 0 };
}

export function initialToolState(tool = 'pin') {
  return {
    tool: TOOLS.includes(tool) ? tool : 'pin',
    color: COLORS[0],
    strokeWidth: 3,
    picking: false,
    draft: null,
  };
}

// Reducer: (state, action) -> state. Actions: SELECT_TOOL, SET_COLOR, SET_STROKE,
// START_PICK, CANCEL_PICK, START_DRAFT, APPEND_POINT, END_DRAFT, CLEAR_DRAFT.
export function toolReducer(state, action) {
  const s = { ...state };
  const a = action || {};
  switch (a.type) {
    case 'SELECT_TOOL':
      if (TOOLS.includes(a.tool)) { s.tool = a.tool; s.picking = a.tool === 'pick' ? s.picking : false; s.draft = null; }
      return s;
    case 'SET_COLOR':
      if (typeof a.color === 'string' && a.color.length <= 16) s.color = a.color;
      return s;
    case 'SET_STROKE': {
      const n = Math.round(Number(a.width));
      if (Number.isFinite(n)) s.strokeWidth = Math.max(1, Math.min(64, n));
      return s;
    }
    case 'START_PICK':
      s.picking = true; s.tool = 'pick'; return s;
    case 'CANCEL_PICK':
      s.picking = false; return s;
    case 'START_DRAFT':
      s.draft = { kind: s.tool, points: Array.isArray(a.points) ? normPoints(a.points) : [], note: '' };
      return s;
    case 'APPEND_POINT':
      if (!s.draft) return s;
      if (s.draft.points.length >= MAX_POINTS) return s;
      if (!pointOk(a.point)) return s;
      s.draft = { ...s.draft, points: [...s.draft.points, roundPoint(a.point)] };
      return s;
    case 'END_DRAFT':
      s.draft = null; s.picking = false; return s;
    case 'CLEAR_DRAFT':
      s.draft = null; return s;
    default:
      return s;
  }
}

function pointOk(p) {
  return Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000);
}
function roundPoint(p) { return [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]; }
function normPoints(pts) { return pts.filter(pointOk).slice(0, MAX_POINTS).map(roundPoint); }

// Undo stack: array of annotation payloads, max 50. Pure push/pop.
export function undoPush(stack, item) {
  const next = [...(Array.isArray(stack) ? stack : []), item];
  return next.length > MAX_UNDO ? next.slice(next.length - MAX_UNDO) : next;
}
export function undoPop(stack) {
  const arr = Array.isArray(stack) ? [...stack] : [];
  const item = arr.pop();
  return { stack: arr, item: item === undefined ? null : item };
}

// Build annotation POST body per ref/annotation-model.md, plus idempotencyKey.
export function buildAnnotationBody({ tool, anchor, markup, pageId, authorName, idempotencyKey, crop }) {
  const a = anchor && typeof anchor === 'object' ? anchor : {};
  const m = markup && typeof markup === 'object' ? markup : {};
  const body = {
    type: TOOLS.includes(tool) ? tool : 'pin',
    pageId: String(pageId || ''),
    authorKind: 'human',
    authorName: String(authorName || '').slice(0, 80),
    idempotencyKey: String(idempotencyKey || ''),
    scrollSnapshot: { x: num(a.scrollX, 0), y: num(a.scrollY, 0) },
    anchor: {
      selector: String(a.selector || '').slice(0, MAX_SELECTOR),
      fingerprint: {
        text: String(a.fpText || '').slice(0, 40),
        class0: String(a.fpClass0 || '').slice(0, 64),
        class1: String(a.fpClass1 || '').slice(0, 64),
        tagName: String(a.fpTag || '').slice(0, 60),
      },
      coordinates: { x: num(a.x, 0), y: num(a.y, 0), w: num(a.w, 0), h: num(a.h, 0) },
    },
    markup: {
      color: typeof m.color === 'string' ? m.color.slice(0, 16) : '#e5484d',
      strokeWidth: Math.max(1, Math.min(64, Math.round(Number(m.strokeWidth) || 3))),
      ...(Array.isArray(m.points) ? { points: normPoints(m.points) } : {}),
      ...(tool === 'text' ? { text: String(m.text || '').slice(0, 4000) } : {}),
    },
  };
  if (crop && typeof crop === 'object' && crop.dataUrl) {
    body.anchor.screenshotCrop = {
      mime: 'image/png', width: num(crop.width, 0), height: num(crop.height, 0), dataUrl: String(crop.dataUrl),
    };
  }
  return body;
}

function num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

export function newIdempotencyKey(random16) {
  return 'k_' + String(random16 || '0000000000000000').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
}
