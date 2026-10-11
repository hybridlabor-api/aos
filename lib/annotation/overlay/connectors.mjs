// WP6 pure geometry/state: no DOM access.
'use strict';

function num(v, d = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function normRect(r) {
  if (!r || typeof r !== 'object') return null;
  const left = num(r.left, NaN);
  const top = num(r.top, NaN);
  const width = num(r.width, NaN);
  const height = num(r.height, NaN);
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { left, top, width, height };
}

function selectorOf(note) {
  if (!note || typeof note !== 'object') return '';
  if (typeof note.selector === 'string') return note.selector;
  if (note.anchor && typeof note.anchor.selector === 'string') return note.anchor.selector;
  return '';
}

// queryFn(selector) -> rect-like or null. Invalid selectors must not throw.
export function resolveAnchor(note, queryFn) {
  const sel = selectorOf(note);
  if (!sel || typeof queryFn !== 'function') return { state: 'orphan', rect: null };
  let rect = null;
  try {
    rect = queryFn(sel);
  } catch {
    return { state: 'orphan', rect: null };
  }
  const n = normRect(rect);
  if (!n) return { state: 'orphan', rect: null };
  return { state: 'live', rect: n };
}

const r1 = (v) => Math.round(num(v) * 10) / 10;

function center(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// From note-card edge (point on noteRect nearest target center) to nearest
// point of targetRect (target edge nearest note center). Deterministic.
export function connectorPath(noteRect, targetRect) {
  const n = normRect(noteRect);
  const t = normRect(targetRect);
  if (!n || !t) return '';
  const tc = center(t);
  const nc = center(n);
  const sx = clamp(tc.x, n.left, n.left + n.width);
  const sy = clamp(tc.y, n.top, n.top + n.height);
  const ex = clamp(nc.x, t.left, t.left + t.width);
  const ey = clamp(nc.y, t.top, t.top + t.height);
  return `M ${r1(sx)} ${r1(sy)} L ${r1(ex)} ${r1(ey)}`;
}

function sortKey(note) {
  const c = typeof note?.createdAt === 'string' ? note.createdAt : '';
  const id = typeof note?.id === 'string' ? note.id : '';
  return c + '\u0000' + id;
}

// Numbering 1..n by creation order (createdAt, then id/ULID tiebreak).
// Returns a Map of note id -> number, stable across reloads.
export function nextNumber(notes) {
  const list = Array.isArray(notes) ? [...notes] : [];
  list.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  const out = new Map();
  list.forEach((note, i) => {
    if (note && typeof note.id === 'string') out.set(note.id, i + 1);
  });
  return out;
}

export function filterNotes(notes, filter) {
  const list = Array.isArray(notes) ? notes : [];
  switch (filter) {
    case 'open':
      return list.filter((n) => n && n.status !== 'resolved');
    case 'resolved':
      return list.filter((n) => n && n.status === 'resolved');
    case 'orphan':
      return list.filter((n) => n && (n.orphan === true || n._orphan === true));
    case 'all':
    default:
      return [...list];
  }
}

export function selectorUsable(selector, max = 500) {
  if (typeof selector !== 'string' || !selector) return false;
  if (selector.length > max) return false;
  if (/[#.:[\]]{2,}/.test(selector)) return false;
  return /[#.\w\[\]=\-"':()\s>+~*|]/.test(selector);
}

export function foreignMutation(records, isOwn) {
  if (!Array.isArray(records) || records.length === 0) return false;
  const own = typeof isOwn === 'function' ? isOwn : () => false;
  for (const rec of records) {
    let is = false;
    try { is = !!own(rec && rec.target); } catch { is = false; }
    if (!is) return true;
  }
  return false;
}
export function driftState(prevRect, nextRect, tolerancePx = 2) {
  const tol = Number.isFinite(Number(tolerancePx)) ? Number(tolerancePx) : 2;
  const p = normRect(prevRect);
  const q = normRect(nextRect);
  if (!p && !q) return 'same';
  if (!p || !q) return 'moved';
  const moved =
    Math.abs(p.left - q.left) > tol ||
    Math.abs(p.top - q.top) > tol ||
    Math.abs(p.width - q.width) > tol ||
    Math.abs(p.height - q.height) > tol;
  return moved ? 'moved' : 'same';
}
