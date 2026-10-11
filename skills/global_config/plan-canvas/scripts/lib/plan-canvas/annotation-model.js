'use strict';

/**
 * Annotation v2 WP1: data model + storage for schema `annotation/1` (spec S5).
 * Storage: `<stateDir>/annotations/<pageId>.jsonl`, one JSON event per line,
 * append-only (S5: lines never rewritten; resolve/reopen/tombstone are
 * appended as events, not in-place edits). Pure Node stdlib, CommonJS, same
 * style as annotation-schema.js in this directory.
 *
 * Untrusted-data rule (S6): page text and note bodies are stored verbatim
 * locally, but everything leaving through collectPayload()/redactText() is
 * redacted at the agent boundary. Annotation text is never parsed as a
 * command and never grants GO.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 'annotation/1';

const MAX_TEXT = 4000;
const MAX_REPLY_BODY = 2000;
const MAX_NAME = 80;
const MAX_SELECTOR = 512;
const MAX_FINGERPRINT_TEXT = 40; // S3: cached element text snippet
const MAX_CLASS = 64;
const MAX_TAG_NAME = 60;
const MAX_POINTS = 512;
const MAX_COORD = 100000;
const MAX_LINE_BYTES = 4096; // redactor input cap per string
const MAX_FILE_BYTES = 5 * 1024 * 1024; // S6 per-page JSONL cap; append fails closed
const CROP_MAX_WIDTH = 1280; // decision 3
const CROP_MAX_HEIGHT = 800; // decision 3
const CROP_MAX_BYTES = 400 * 1024; // decision 3

const ANNOTATION_TYPES = new Set(['pin', 'box', 'freehand', 'text', 'pick']);
const AUTHOR_KINDS = new Set(['human', 'agent']);
const STATUSES = new Set(['open', 'resolved']);

const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const own = (obj, key) =>
  obj !== null && typeof obj === 'object' && Object.hasOwn(obj, key) ? obj[key] : undefined;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isStr = v => typeof v === 'string';
const isoNow = () => new Date().toISOString();
const isoOf = v => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : isoNow();
};

// ---------------------------------------------------------------------------
// ULID (S5: sortable, no coordination). 48-bit time + crypto-random suffix.
// Monotonic within a process so two calls in the same ms still sort plainly.
// ---------------------------------------------------------------------------

let lastTime = -1;
let lastRand = null;

function ulid(now = Date.now()) {
  let time = now;
  if (time <= lastTime) {
    // Same ms (or clock regression): bump the timestamp forward. An
    // increment-in-place on lastRand would not help: the encoder only reads
    // bytes 0..7, so bumping the low-index bytes can leave the id unchanged.
    time = lastTime + 1;
    lastTime = time;
  } else {
    lastRand = crypto.randomBytes(10);
    lastTime = time;
  }
  let out = '';
  let t = time;
  for (let i = 0; i < 10; i++) {
    out = ULID_CHARS[t % 32] + out;
    t = Math.floor(t / 32);
  }
  // 80 random bits as 16 groups of 5: high nibble then low nibble per byte.
  for (let i = 0; i < 16; i++) {
    const byte = lastRand[i >> 1];
    out += ULID_CHARS[(i % 2 === 0 ? byte >>> 3 : byte & 0x1f) & 0x1f];
  }
  return out;
}

// ---------------------------------------------------------------------------
// pageId is a slug only (S5). No separators that enable traversal, bounded.
// ---------------------------------------------------------------------------

const PAGE_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?$/;

function normalizePageId(pageId) {
  if (!isStr(pageId) || !PAGE_ID_RE.test(pageId) || pageId.includes('..')) return null;
  return pageId;
}

function pageFilePath(stateDir, pageId) {
  const safe = normalizePageId(pageId);
  if (safe === null) return null;
  return path.join(stateDir, 'annotations', safe + '.jsonl');
}

// ---------------------------------------------------------------------------
// Raw JSONL I/O. appendLine enforces the S6 per-file cap by refusing to
// append (fail closed); it never truncates or deletes.
// ---------------------------------------------------------------------------

function appendLine(stateDir, pageId, event) {
  const file = pageFilePath(stateDir, pageId);
  if (file === null) return { ok: false, reason: 'invalid-pageId' };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch (err) {
    return { ok: false, reason: 'io', error: String(err.code || err) };
  }
  try {
    const st = fs.statSync(file);
    if (st.size > MAX_FILE_BYTES) return { ok: false, reason: 'file-size-cap' };
  } catch {
    // file missing on first append: fine
  }
  try {
    fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
    return { ok: true, file };
  } catch (err) {
    return { ok: false, reason: 'io', error: String(err.code || err) };
  }
}

// readEvents never throws on bad content: malformed lines are skipped and
// counted (S7 corruption tolerance). Returns { events, corrupt, missing }.
function readEvents(stateDir, pageId) {
  const file = pageFilePath(stateDir, pageId);
  if (file === null) return { events: [], corrupt: 0, missing: true };
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { events: [], corrupt: 0, missing: true };
  }
  const events = [];
  let corrupt = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object') events.push(parsed);
      else corrupt += 1;
    } catch {
      corrupt += 1;
    }
  }
  return { events, corrupt, missing: false };
}

// ---------------------------------------------------------------------------
// Whitelist normalisers (annotation-schema.js contract: rebuild field by
// field, no key copied through, no type coercion).
// ---------------------------------------------------------------------------

function normText(value, max) {
  if (!isStr(value)) return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, max).trimEnd();
}

function normPoints(value) {
  if (!Array.isArray(value)) return undefined;
  const out = [];
  // freehand traces are bounded (S2/S6): first MAX_POINTS coordinates kept.
  for (let i = 0; i < Math.min(value.length, MAX_POINTS); i++) {
    const p = value[i];
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) continue;
    if (Math.abs(p[0]) > MAX_COORD || Math.abs(p[1]) > MAX_COORD) continue;
    out.push([Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
  }
  return out.length ? out : undefined;
}

function normFingerprint(value) {
  const fp = value === null || typeof value !== 'object' ? {} : value;
  return {
    text: normText(own(fp, 'text'), MAX_FINGERPRINT_TEXT),
    class0: normText(own(fp, 'class0'), MAX_CLASS),
    class1: normText(own(fp, 'class1'), MAX_CLASS),
    tagName: normText(own(fp, 'tagName'), MAX_TAG_NAME)
  };
}

function normAnchor(value) {
  const inA = value === null || typeof value !== 'object' ? {} : value;
  const selector = normText(own(inA, 'selector'), MAX_SELECTOR);
  const c = own(inA, 'coordinates');
  return {
    selector: selector || undefined,
    fingerprint: normFingerprint(own(inA, 'fingerprint')),
    coordinates:
      c && isNum(c.x) && isNum(c.y)
        ? {
            x: Math.max(-MAX_COORD, Math.min(MAX_COORD, c.x)),
            y: Math.max(-MAX_COORD, Math.min(MAX_COORD, c.y)),
            w: isNum(c.w) ? Math.max(0, Math.min(MAX_COORD, c.w)) : 0,
            h: isNum(c.h) ? Math.max(0, Math.min(MAX_COORD, c.h)) : 0
          }
        : undefined
  };
}

function normColor(value) {
  return isStr(value) ? value.slice(0, 16) : undefined;
}

// Crop caps per decision 3, fail closed with a warning; dedupe identical
// crops via sha256 over the base64 body (a duplicate stores only the digest).
// cropSeen: Map built by the caller (existingCropDigests) for one write.
function normCrop(value, cropSeen) {
  const v = value === null || typeof value !== 'object' ? {} : value;
  if (own(v, 'mime') !== 'image/png') return { warn: 'crop dropped: wrong mime' };
  const width = own(v, 'width');
  const height = own(v, 'height');
  if (!isNum(width) || !isNum(height) || width < 1 || height < 1)
    return { warn: 'crop dropped: bad size' };
  if (width > CROP_MAX_WIDTH || height > CROP_MAX_HEIGHT)
    return { warn: `crop dropped: over ${CROP_MAX_WIDTH}x${CROP_MAX_HEIGHT}px` };
  if (!isStr(v.dataUrl)) return { warn: 'crop dropped: no data' };
  const comma = v.dataUrl.indexOf(',');
  const base64 = comma >= 0 ? v.dataUrl.slice(comma + 1) : v.dataUrl;
  if (base64.length < 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    return { warn: 'crop dropped: bad payload' };
  const decoded = Math.floor((base64.length * 3) / 4);
  if (decoded > CROP_MAX_BYTES) return { warn: `crop dropped: over ${CROP_MAX_BYTES} bytes` };
  const digest = crypto.createHash('sha256').update(base64).digest('hex');
  const seen = cropSeen.has(digest);
  if (!seen) cropSeen.set(digest, true);
  return {
    crop: seen
      ? { mime: 'image/png', width, height, dedupeOf: digest }
      : { dataUrl: 'data:image/png;base64,' + base64, mime: 'image/png', width, height, sha256: digest }
  };
}

// ---------------------------------------------------------------------------
// Redactor at the agent boundary (S6). Input capped at 4 KB first; each rule
// is a bounded, linear regex (no nested quantifiers that backtrack), so a
// 64 KB hostile line finishes in low milliseconds.
// ---------------------------------------------------------------------------

const REDACT_RULES = [
  { source: 'bearer\\s+\\S{6,}', flags: 'gi', to: 'Bearer [redacted]' },
  { source: '"(?:api[-_]?key|token|secret|password)"\\s*:\\s*"[^"]{4,}"', flags: 'gi', to: '[redacted]' },
  { source: 'sk-[A-Za-z0-9_-]{8,}', flags: 'g', to: '[redacted]' },
  { source: 'gh[pousr]_[A-Za-z0-9]{12,}', flags: 'g', to: '[redacted]' },
  { source: 'AKIA[A-Z0-9]{12,}', flags: 'g', to: '[redacted]' },
  { source: '(?<![a-fA-F0-9])[a-fA-F0-9]{32,}(?![a-fA-F0-9])', flags: 'g', to: '[redacted-hex]' },
  { source: '(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{48,}={0,2}(?![A-Za-z0-9+/=])', flags: 'g', to: '[redacted-b64]' },
  { source: 'https?://[^\\s/]+:[^\\s/@]+@', flags: 'g', to: '[redacted-url]' }
].map(r => ({ re: new RegExp(r.source, r.flags), to: r.to }));

function redactText(value) {
  if (!isStr(value)) return '';
  return REDACT_RULES.reduce(
    (out, rule) => out.replace(rule.re, rule.to),
    value.length > MAX_LINE_BYTES ? value.slice(0, MAX_LINE_BYTES) : value
  );
}

// ---------------------------------------------------------------------------
// Write operations (all append-only; status/delete are system events, S5).
// ---------------------------------------------------------------------------

// addAnnotation: whitelist-validate a submitted annotation, append the first
// 'annotation' event. Returns { ok, id, warnings } or { ok: false, reason }.
function addAnnotation(stateDir, pageId, input, now) {
  const ts = typeof now === 'string' ? isoOf(now) : isoNow();
  const inObj = input === null || typeof input !== 'object' ? {} : input;
  const type = own(inObj, 'type');
  if (!ANNOTATION_TYPES.has(type)) return { ok: false, reason: 'invalid' };
  const authorKind = own(inObj, 'authorKind');
  if (!AUTHOR_KINDS.has(authorKind)) return { ok: false, reason: 'invalid' };

  const markupIn = own(inObj, 'markup');
  const points = type === 'freehand' ? normPoints(own(markupIn, 'points')) : undefined;
  if (type === 'freehand' && !points) return { ok: false, reason: 'invalid' };
  const markup = {
    color: normColor(own(markupIn, 'color')),
    strokeWidth: isNum(own(markupIn, 'strokeWidth'))
      ? Math.round(Math.max(1, Math.min(64, markupIn.strokeWidth)))
      : undefined,
    points,
    text: type === 'text' ? normText(own(markupIn, 'text'), MAX_TEXT) : undefined
  };
  for (const k of Object.keys(markup)) if (markup[k] === undefined) delete markup[k];

  const scroll = own(inObj, 'scrollSnapshot');
  const event = {
    schema_version: SCHEMA_VERSION,
    kind: 'annotation',
    id: 'a_' + ulid(),
    type,
    pageId: normalizePageId(own(inObj, 'pageId')) || undefined,
    scrollSnapshot:
      scroll && isNum(scroll.x) && isNum(scroll.y)
        ? { x: Math.round(scroll.x), y: Math.round(scroll.y) }
        : undefined,
    anchor: normAnchor(own(inObj, 'anchor')),
    markup: Object.keys(markup).length ? markup : undefined,
    status: 'open',
    authorKind,
    authorName: normText(own(inObj, 'authorName'), MAX_NAME),
    createdAt: ts,
    updatedAt: ts
  };

  const warnings = [];
  if (type === 'pick') {
    // dedupe against crops already in this page's JSONL (same-session scan)
    const known = existingCropDigests(stateDir, pageId);
    const crop = normCrop(own(own(inObj, 'anchor'), 'screenshotCrop'), known);
    if (crop.warn) warnings.push(crop.warn);
    else event.screenshotCrop = crop.crop;
  }
  if (warnings.length) event.warnings = warnings;
  const res = appendLine(stateDir, pageId, event);
  return res.ok ? { ok: true, id: event.id, warnings } : res;
}

// sha256 digests of crops already stored for this page, so an identical
// re-submitted crop dedupes into `dedupeOf` instead of re-storing bytes.
function existingCropDigests(stateDir, pageId) {
  const { events } = readEvents(stateDir, pageId);
  const set = new Map();
  for (const ev of events) {
    const crop = ev.screenshotCrop;
    if (crop && isStr(crop.sha256)) set.set(crop.sha256, true);
  }
  return set;
}

// appendReply (S4): idempotent append keyed on idempotencyKey. A replay
// returns { ok, duplicate: true } with the existing reply id and writes nothing.
function appendReply(stateDir, pageId, input) {
  const inObj = input === null || typeof input !== 'object' ? {} : input;
  const annotationId = own(inObj, 'annotationId');
  if (!isStr(annotationId) || annotationId.length < 8 || !annotationId.startsWith('a_'))
    return { ok: false, reason: 'invalid' };
  const idempotencyKey = own(inObj, 'idempotencyKey');
  if (!isStr(idempotencyKey) || idempotencyKey.length < 8 || idempotencyKey.length > 256)
    return { ok: false, reason: 'invalid' };
  const authorKind = own(inObj, 'authorKind');
  if (!AUTHOR_KINDS.has(authorKind)) return { ok: false, reason: 'invalid' };

  const existing = findReplyByKey(stateDir, pageId, idempotencyKey);
  if (existing) return { ok: true, duplicate: true, existingId: existing.id };

  const event = {
    schema_version: SCHEMA_VERSION,
    kind: 'reply',
    id: 'r_' + ulid(),
    annotationId,
    body: normText(own(inObj, 'body'), MAX_REPLY_BODY),
    authorKind,
    authorName: normText(own(inObj, 'authorName'), MAX_NAME),
    idempotencyKey,
    createdAt: isoNow()
  };
  const res = appendLine(stateDir, pageId, event);
  return res.ok ? { ok: true, duplicate: false, id: event.id } : res;
}

// findReplyByKey scans the JSONL backwards; O(lines) per append is fine at
// Phase-1 scale (S4: "a keyed scan of the JSONL is fine").
function findReplyByKey(stateDir, pageId, idempotencyKey) {
  const { events } = readEvents(stateDir, pageId);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === 'reply' && ev.idempotencyKey === idempotencyKey) return ev;
  }
  return null;
}

// setStatus appends a system status event (resolve or reopen), never in-place.
function setStatus(stateDir, pageId, annotationId, status) {
  if (!STATUSES.has(status)) return { ok: false, reason: 'invalid' };
  if (!isStr(annotationId) || !annotationId.startsWith('a_')) return { ok: false, reason: 'invalid' };
  return appendLine(stateDir, pageId, {
    schema_version: SCHEMA_VERSION,
    kind: 'status',
    annotationId,
    status,
    createdAt: isoNow()
  });
}

// deleteAnnotation appends a tombstone; readers filter tombstoned notes (S5).
function deleteAnnotation(stateDir, pageId, annotationId) {
  if (!isStr(annotationId) || !annotationId.startsWith('a_')) return { ok: false, reason: 'invalid' };
  return appendLine(stateDir, pageId, {
    schema_version: SCHEMA_VERSION,
    kind: 'tombstone',
    annotationId,
    createdAt: isoNow()
  });
}

// ---------------------------------------------------------------------------
// Fold the event log into thread state (pure over parsed events; unknown
// kinds and unknown fields are tolerated for forward compatibility, S5).
// ---------------------------------------------------------------------------

function foldThreads(events) {
  const threads = new Map();
  for (const ev of events) {
    if (ev.kind === 'annotation') {
      threads.set(ev.id, {
        id: ev.id,
        type: ANNOTATION_TYPES.has(ev.type) ? ev.type : 'pin',
        pageId: isStr(ev.pageId) ? ev.pageId : '',
        scrollSnapshot:
          ev.scrollSnapshot && isNum(ev.scrollSnapshot.x) && isNum(ev.scrollSnapshot.y)
            ? { x: ev.scrollSnapshot.x, y: ev.scrollSnapshot.y }
            : undefined,
        anchor: ev.anchor,
        markup: ev.markup,
        screenshotCrop: ev.screenshotCrop,
        warnings: Array.isArray(ev.warnings) ? ev.warnings : [],
        status: 'open',
        resolvedAt: undefined,
        authorKind: AUTHOR_KINDS.has(ev.authorKind) ? ev.authorKind : undefined,
        authorName: isStr(ev.authorName) ? ev.authorName : '',
        markupText: ev.markup && isStr(ev.markup.text) ? ev.markup.text : '',
        createdAt: ev.createdAt,
        updatedAt: ev.updatedAt || ev.createdAt,
        replies: []
      });
      continue;
    }
    if (ev.kind === 'status') {
      const t = threads.get(ev.annotationId);
      if (!t) continue;
      if (ev.status === 'resolved') {
        t.status = 'resolved';
        t.resolvedAt = isoOf(ev.createdAt);
      } else {
        t.status = 'open';
        t.resolvedAt = undefined;
        t.replies.push({
          system: true,
          body: 'reopened',
          authorKind: AUTHOR_KINDS.has(ev.authorKind) ? ev.authorKind : 'human',
          authorName: '',
          createdAt: isoOf(ev.createdAt)
        });
      }
      t.updatedAt = isoOf(ev.createdAt);
      continue;
    }
    if (ev.kind === 'reply') {
      const t = threads.get(ev.annotationId);
      if (t) {
        t.replies.push({
          id: ev.id,
          body: isStr(ev.body) ? ev.body : '',
          authorKind: AUTHOR_KINDS.has(ev.authorKind) ? ev.authorKind : 'agent',
          authorName: isStr(ev.authorName) ? ev.authorName : '',
          idempotencyKey: ev.idempotencyKey,
          createdAt: isoOf(ev.createdAt)
        });
        t.updatedAt = isoOf(ev.createdAt);
      }
      continue;
    }
    if (ev.kind === 'tombstone') {
      threads.delete(ev.annotationId);
      continue;
    }
    // unknown kind: tolerated, ignored
  }
  return [...threads.values()];
}

function loadThreads(stateDir, pageId) {
  const { events, corrupt, missing } = readEvents(stateDir, pageId);
  return { threads: foldThreads(events), corrupt, missing };
}

// ---------------------------------------------------------------------------
// S4 protocol helpers: collect with a weak ETag over the JSONL bytes, plus
// the redacted agent payload and "copy for AI" Markdown blocks.
// ---------------------------------------------------------------------------

// ETag is a sha256 of the raw file bytes: changes only when the log changes,
// not on re-reads or empty-file creations. Returns null without a page key.
function computeEtag(stateDir, pageId) {
  const file = pageFilePath(stateDir, pageId);
  if (file === null) return null;
  try {
    const buf = fs.readFileSync(file);
    return '"' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32) + '"';
  } catch {
    return '""'; // no file yet: stable weak ETag
  }
}

// collectPayload: threads redacted at the agent boundary. Text fields are
// redacted; markup/crop payloads are not exported here at all (S6: crops
// stay in the local JSONL and are never uploaded), body is data only.
function collectPayload(stateDir, pageId) {
  const { threads, corrupt, missing } = loadThreads(stateDir, pageId);
  const redacted = threads.map(t => ({
    ...t,
    screenshotCrop: undefined, // S6: crops stay in the local JSONL, never exported
    markupText: redactText(t.markupText),
    replies: t.replies.map(r => ({ ...r, body: redactText(r.body) }))
  }));
  return { etag: computeEtag(stateDir, pageId), corrupt, missing, threads: redacted, text_source: 'app-page (unverified)' };
}

// aiBlocks: S4 "Copy for AI" Markdown, one block per note, selector and
// classes included, reply bodies indented. Text stays data, labeled
// unverified; nothing here executes or approves anything (S6).
function aiMarkdownBlock(t) {
  const anchor = t.anchor || {};
  const fp = anchor.fingerprint || {};
  const lines = [
    `note ${t.id} (${t.status}, author ${t.authorKind || 'unknown'}, text_source: app-page (unverified))`,
    anchor.selector ? `selector: ${anchor.selector}` : '',
    fp.class0 || fp.class1 ? `classes: ${[fp.class0, fp.class1].filter(Boolean).join(' ')}` : '',
    fp.tagName ? `tag: ${fp.tagName}` : '',
    `note: ${t.markupText}`,
    ...t.replies.map(r => `  reply (${r.authorKind}${r.system ? ', system' : ''}): ${redactText(r.body)}`)
  ];
  return lines.filter(l => l.length > 0).join('\n');
}

function aiBlocks(stateDir, pageId) {
  const { threads } = loadThreads(stateDir, pageId);
  return threads.map(aiMarkdownBlock);
}

module.exports = {
  SCHEMA_VERSION,
  MAX_FILE_BYTES,
  MAX_LINE_BYTES,
  CROP_MAX_WIDTH,
  CROP_MAX_HEIGHT,
  CROP_MAX_BYTES,
  ulid,
  normalizePageId,
  pageFilePath,
  readEvents,
  addAnnotation,
  appendReply,
  setStatus,
  deleteAnnotation,
  foldThreads,
  loadThreads,
  computeEtag,
  collectPayload,
  aiBlocks,
  redactText
};
