'use strict';

/**
 * Annotation v2 WP1 tests: annotation-model.js (spec S5 data model, S6 caps
 * and redaction, S7 data-model test list). Uses os.tmpdir() state dirs; no
 * network, no host changes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  SCHEMA_VERSION,
  MAX_FILE_BYTES,
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
} = require('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/annotation-model.js');

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aos-annot-' + label + '-'));
}

const baseAnnotation = {
  type: 'pin',
  authorKind: 'human',
  anchor: {
    selector: '#submit-button',
    fingerprint: { text: 'Send', class0: 'btn', class1: 'primary', tagName: 'button' },
    coordinates: { x: 100, y: 200, w: 10, h: 10 }
  },
  scrollSnapshot: { x: 0, y: 40 }
};

// ---------------------------------------------------------------------------

test('round-trip: annotate, resolve, reply, reload', () => {
  const dir = tmpDir('roundtrip');
  const add = addAnnotation(dir, 'page-a', baseAnnotation);
  assert.equal(add.ok, true);
  assert.ok(add.id.startsWith('a_'));
  const reply = appendReply(dir, 'page-a', {
    annotationId: add.id,
    body: 'fixed the color',
    authorKind: 'agent',
    authorName: 'helper',
    idempotencyKey: 'key-0001-xyz'
  });
  assert.equal(reply.ok, true);
  assert.equal(reply.duplicate, false);
  const st = setStatus(dir, 'page-a', add.id, 'resolved');
  assert.equal(st.ok, true);
  const { threads, corrupt, missing } = loadThreads(dir, 'page-a');
  assert.equal(corrupt, 0);
  assert.equal(missing, false);
  assert.equal(threads.length, 1);
  const t = threads[0];
  assert.equal(t.id, add.id);
  assert.equal(t.status, 'resolved');
  assert.ok(t.resolvedAt);
  assert.equal(t.anchor.selector, '#submit-button');
  assert.equal(t.anchor.fingerprint.class0, 'btn');
  assert.equal(t.replies.length, 1);
  assert.equal(t.replies[0].body, 'fixed the color');
  assert.equal(t.replies[0].authorKind, 'agent');
});

test('ULID shape, uniqueness, and lexicographic sort', () => {
  const a = ulid();
  const b = ulid();
  assert.equal(a.length, 26);
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.notEqual(a, b);
  assert.ok(a < b); // monotonic in-process
  const many = new Set(Array.from({ length: 500 }, () => ulid()));
  assert.equal(many.size, 500);
});

test('reopened status event appends a system reply marker, not an in-place edit', () => {
  const dir = tmpDir('reopen');
  const add = addAnnotation(dir, 'page-b', baseAnnotation);
  setStatus(dir, 'page-b', add.id, 'resolved');
  setStatus(dir, 'page-b', add.id, 'open');
  const { threads } = loadThreads(dir, 'page-b');
  assert.equal(threads[0].status, 'open');
  assert.equal(threads[0].resolvedAt, undefined);
  assert.equal(threads[0].replies.length, 1);
  assert.equal(threads[0].replies[0].system, true);
  // history intact: original annotation line still says status open,
  // resolved lives in the appended status events
  const raw = fs.readFileSync(pageFilePath(dir, 'page-b'), 'utf8').trim().split('\n');
  assert.equal(raw.length, 3);
  assert.equal(JSON.parse(raw[0]).status, 'open');
});

test('tombstone filters the note from readers', () => {
  const dir = tmpDir('tombstone');
  const add = addAnnotation(dir, 'page-c', baseAnnotation);
  assert.equal(deleteAnnotation(dir, 'page-c', add.id).ok, true);
  const { threads } = loadThreads(dir, 'page-c');
  assert.equal(threads.length, 0);
  // the file kept both lines (no deletion of history)
  const raw = fs.readFileSync(pageFilePath(dir, 'page-c'), 'utf8').trim().split('\n');
  assert.equal(raw.length, 2);
});

test('corrupt lines are skipped and counted, valid neighbors survive', () => {
  const dir = tmpDir('corrupt');
  const add = addAnnotation(dir, 'page-d', baseAnnotation);
  const file = pageFilePath(dir, 'page-d');
  fs.appendFileSync(file, '{not json\n', 'utf8');
  fs.appendFileSync(file, '42\n', 'utf8'); // JSON but not an object
  fs.appendFileSync(file, '\n', 'utf8'); // blank line: ignored, not corrupt
  const reply = appendReply(dir, 'page-d', {
    annotationId: add.id,
    body: 'ok',
    authorKind: 'agent',
    authorName: '',
    idempotencyKey: 'key-0002-xyz'
  });
  assert.equal(reply.ok, true);
  const { threads, corrupt } = loadThreads(dir, 'page-d');
  assert.equal(corrupt, 2);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].replies.length, 1);
});

test('unknown schema_version and unknown fields are tolerated on read', () => {
  const dir = tmpDir('forward');
  fs.mkdirSync(path.dirname(pageFilePath(dir, 'page-e')), { recursive: true });
  fs.appendFileSync(
    pageFilePath(dir, 'page-e'),
    JSON.stringify({
      schema_version: 'annotation/9',
      kind: 'annotation',
      id: 'a_ZZZZZZZZZZZZZZZZZZZZZZZZZZ',
      type: 'pin',
      futureField: { nested: true },
      authorKind: 'human',
      authorName: 'x',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }) + '\n'
  );
  const { threads, corrupt } = loadThreads(dir, 'page-e');
  assert.equal(corrupt, 0);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, 'a_ZZZZZZZZZZZZZZZZZZZZZZZZZZ');
  assert.equal(threads[0].status, 'open');
});

test('idempotent reply: same key twice appends exactly one reply line', () => {
  const dir = tmpDir('idempotent');
  const add = addAnnotation(dir, 'page-f', baseAnnotation);
  const first = appendReply(dir, 'page-f', {
    annotationId: add.id,
    body: 'first',
    authorKind: 'agent',
    authorName: 'a',
    idempotencyKey: 'idem-aaaa-1'
  });
  const second = appendReply(dir, 'page-f', {
    annotationId: add.id,
    body: 'first resale',
    authorKind: 'agent',
    authorName: 'a',
    idempotencyKey: 'idem-aaaa-1'
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.existingId, first.id);
  const raw = fs.readFileSync(pageFilePath(dir, 'page-f'), 'utf8').trim().split('\n');
  assert.equal(raw.length, 2); // annotation + exactly one reply
  const { threads } = loadThreads(dir, 'page-f');
  assert.equal(threads[0].replies.length, 1);
  assert.equal(threads[0].replies[0].idempotencyKey, 'idem-aaaa-1');
});

test('reply without a valid idempotencyKey or annotationId is rejected', () => {
  const dir = tmpDir('idemreject');
  const add = addAnnotation(dir, 'page-g', baseAnnotation);
  assert.equal(appendReply(dir, 'page-g', { annotationId: add.id, body: 'x', authorKind: 'agent', idempotencyKey: 'short' }).ok, false);
  assert.equal(appendReply(dir, 'page-g', { body: 'x', authorKind: 'agent', idempotencyKey: 'okkey-1234' }).ok, false);
  assert.equal(appendReply(dir, 'page-g', { annotationId: add.id, body: 'x', authorKind: 'robot', idempotencyKey: 'okkey-1235' }).ok, false);
  const { threads } = loadThreads(dir, 'page-g');
  assert.equal(threads[0].replies.length, 0);
});

test('crop caps: oversized crop fails closed with a warning, small crop is stored', () => {
  const dir = tmpDir('cropcap');
  const tiny = crypto.randomBytes(64).toString('base64');
  const small = {
    ...baseAnnotation,
    type: 'pick',
    anchor: { ...baseAnnotation.anchor, screenshotCrop: { mime: 'image/png', width: 40, height: 20, dataUrl: 'data:image/png;base64,' + tiny } }
  };
  const okAdd = addAnnotation(dir, 'page-h', small);
  assert.equal(okAdd.ok, true);
  assert.deepEqual(okAdd.warnings, []);

  const oversized = {
    ...baseAnnotation,
    type: 'pick',
    anchor: {
      ...baseAnnotation.anchor,
      screenshotCrop: {
        mime: 'image/png',
        width: CROP_MAX_WIDTH + 1,
        height: CROP_MAX_HEIGHT + 1,
        dataUrl: 'data:image/png;base64,' + 'A'.repeat(1024)
      }
    }
  };
  const rej = addAnnotation(dir, 'page-h', oversized);
  assert.equal(rej.ok, true); // note survives, crop does not
  assert.equal(rej.warnings.length, 1);
  assert.match(rej.warnings[0], /over 1280x800(px)?/);

  const hugeBase64 = 'B'.repeat(Math.ceil((CROP_MAX_BYTES * 4) / 3) + 16); // > 400 KB decoded
  const rejBytes = addAnnotation(dir, 'page-h', {
    ...baseAnnotation,
    type: 'pick',
    anchor: { ...baseAnnotation.anchor, screenshotCrop: { mime: 'image/png', width: 10, height: 10, dataUrl: 'data:image/png;base64,' + hugeBase64 } }
  });
  assert.equal(rejBytes.ok, true);
  assert.match(rejBytes.warnings[0], /over \d+ bytes/);

  const { threads } = loadThreads(dir, 'page-h');
  const withCrop = threads.find(t => t.screenshotCrop);
  assert.ok(withCrop);
  assert.equal(threads.filter(t => t.type === 'pick').length, 3);
  assert.equal(threads.filter(t => t.screenshotCrop).length, 1); // two failed closed
  assert.ok(threads.some(t => (t.warnings || []).length === 1));
});

test('identical crops are deduplicated (second stores dedupeOf only)', () => {
  const dir = tmpDir('cropdup');
  const tiny = crypto.randomBytes(32).toString('base64');
  const crop = { mime: 'image/png', width: 30, height: 30, dataUrl: 'data:image/png;base64,' + tiny };
  const a1 = addAnnotation(dir, 'page-i', { ...baseAnnotation, type: 'pick', anchor: { ...baseAnnotation.anchor, screenshotCrop: crop } });
  const a2 = addAnnotation(dir, 'page-i', { ...baseAnnotation, type: 'pick', anchor: { ...baseAnnotation.anchor, screenshotCrop: crop } });
  assert.equal(a1.ok, true);
  assert.equal(a2.ok, true);
  const { threads } = loadThreads(dir, 'page-i');
  const first = threads.find(t => t.id === a1.id);
  const second = threads.find(t => t.id === a2.id);
  assert.equal(first.screenshotCrop.dedupeOf, undefined);
  assert.equal(second.screenshotCrop.dedupeOf, first.screenshotCrop.sha256);
  assert.equal(second.screenshotCrop.dataUrl, undefined);
  // the raw base64 body appears exactly once in the file
  const raw = fs.readFileSync(pageFilePath(dir, 'page-i'), 'utf8');
  assert.equal(raw.split(tiny).length - 1, 1);
});

test('per-page JSONL size cap fails closed, never truncates', () => {
  const dir = tmpDir('sizecap');
  fs.mkdirSync(path.dirname(pageFilePath(dir, 'page-j')), { recursive: true });
  fs.writeFileSync(pageFilePath(dir, 'page-j'), 'x'.repeat(MAX_FILE_BYTES + 1), 'utf8');
  const add = addAnnotation(dir, 'page-j', baseAnnotation);
  assert.equal(add.ok, false);
  assert.equal(add.reason, 'file-size-cap');
  assert.equal(fs.readFileSync(pageFilePath(dir, 'page-j'), 'utf8').length, MAX_FILE_BYTES + 1);
});

test('redaction: bearer, tokens, provider prefixes, hex/base64, userinfo URLs', () => {
  assert.equal(redactText('use Bearer abc.def-ghi/p_q'), 'use Bearer [redacted]');
  assert.ok(!redactText('my sk-proj-abcd1234efgh here').includes('sk-proj-abcd1234efgh'));
  assert.ok(!redactText('key ghp_0123456789abcdefABCD here').includes('ghp_0123456789'));
  assert.ok(!redactText('AKIAIOSFODNN7EXAMPLE key').includes('AKIAIOSFODNN7'));
  const hex = 'dead'.repeat(16); // 64 hex chars
  assert.ok(!redactText('run ' + hex + ' now').includes(hex));
  const b64 = Buffer.alloc(48, 'z').toString('base64');
  assert.ok(!redactText('blob ' + b64 + ' end').includes(b64.slice(0, 20)));
  assert.ok(!redactText('see https://user:secretpw@example.com/path now').includes('secretpw'));
  assert.ok(redactText('"api_key": "supersecretvalue"').endsWith('[redacted]'));
  // ordinary text passes through untouched
  assert.equal(redactText('hello world'), 'hello world');
  // non-string input passes empty
  assert.equal(redactText(undefined), '');
});

test('64 KB hostile line redacts well under 500 ms', () => {
  const hostile =
    'payload ' + '0102030405060708090a0b0c0d0e0f10'.repeat(2048) + ' ' + 'Aa1!'.repeat(16000) + ' https://u:p@h/x ' + 'Bearer ' + 'k'.repeat(30000);
  const t0 = Date.now();
  const out = redactText(hostile);
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `redaction took ${ms} ms`);
  assert.ok(out.length >= 0);
  assert.ok(!out.includes('https://u:p@'));
});

test('ETag is stable on re-read and changes only when the log is appended', () => {
  const dir = tmpDir('etag');
  const p1 = computeEtag(dir, 'page-k');
  assert.equal(computeEtag(dir, 'page-k'), p1, 're-read: identical ETag');
  const add = addAnnotation(dir, 'page-k', baseAnnotation);
  const p2 = computeEtag(dir, 'page-k');
  assert.notEqual(p2, p1);
  appendReply(dir, 'page-k', {
    annotationId: add.id,
    body: 'r',
    authorKind: 'agent',
    authorName: '',
    idempotencyKey: 'etag-key-01'
  });
  const p3 = computeEtag(dir, 'page-k');
  assert.notEqual(p3, p2);
  assert.equal(computeEtag(dir, 'page-k'), p3);
  assert.equal(collectPayload(dir, 'page-k').etag, p3);
});

test('no path traversal: hostile page keys never escape the annotations dir', () => {
  const dir = tmpDir('traversal');
  for (const bad of ['../evil', 'a/../b', '..', '.hidden', 'has space', 'a/b', '', undefined, 123]) {
    assert.equal(normalizePageId(bad), null, String(bad));
  }
  assert.equal(pageFilePath(dir, '../evil'), null);
  assert.equal(pageFilePath(dir, 'a/../b'), null);
  // a normal slug lands inside <stateDir>/annotations only
  const good = pageFilePath(dir, 'my-page_1.2-3');
  assert.ok(good.startsWith(path.join(dir, 'annotations') + path.sep));
  assert.ok(good.endsWith('my-page_1.2-3.jsonl'));
  // writes with a hostile key fail closed and create no file anywhere
  const add = addAnnotation(dir, '../escape', baseAnnotation);
  assert.equal(add.ok, false);
  assert.ok(['invalid-pageId', 'io'].includes(add.reason));
  assert.equal(fs.existsSync(path.join(dir, 'escape.jsonl')), false);
  assert.equal(fs.existsSync(path.join(dir, 'evil.jsonl')), false);
});

test('whitelist normalisation: unknown keys dropped, limits enforced', () => {
  const dir = tmpDir('whitelist');
  const add = addAnnotation(dir, 'page-l', {
    ...baseAnnotation,
    hostileField: '<script>alert(1)</script>',
    markup: { color: 'blue', text: 'A'.repeat(9000) }, // text type: keep cap
    type: 'text',
    anchor: { ...baseAnnotation.anchor, fingerprint: { ...baseAnnotation.anchor.fingerprint, text: 'F'.repeat(900) } }
  });
  assert.equal(add.ok, true);
  const raw = JSON.parse(fs.readFileSync(pageFilePath(dir, 'page-l'), 'utf8').trim());
  assert.equal(raw.hostileField, undefined);
  assert.ok(raw.markup.text.length <= 4000);
  assert.ok(raw.anchor.fingerprint.text.length <= 40);
});

test('freehand without points is rejected; points are bounded', () => {
  const dir = tmpDir('freehand');
  const bad = addAnnotation(dir, 'page-m', { type: 'freehand', authorKind: 'human' });
  assert.equal(bad.ok, false);
  const ok = addAnnotation(dir, 'page-m', {
    type: 'freehand',
    authorKind: 'human',
    markup: { points: Array.from({ length: 2000 }, (_, i) => [i, i * 2]) }
  });
  assert.equal(ok.ok, true);
  const { events } = readEvents(dir, 'page-m');
  assert.ok(events[0].markup.points.length <= 512);
});

test('collectPayload labels text as unverified and redacts at the boundary', () => {
  const dir = tmpDir('collect');
  addAnnotation(dir, 'page-n', { ...baseAnnotation, type: 'text', markup: { text: 'Bearer zzz-token-999 and ghp_secrettoken123456' } });
  const payload = collectPayload(dir, 'page-n');
  assert.equal(payload.text_source, 'app-page (unverified)');
  const t = payload.threads[0];
  assert.ok(!t.markupText.includes('zzz-token-999'));
  assert.equal(t.screenshotCrop, undefined);
  // the true text still sits in the local JSONL
  assert.ok(fs.readFileSync(pageFilePath(dir, 'page-n'), 'utf8').includes('zzz-token-999'));
});

test('collectPayload ETag: polling twice with no writes yields the same ETag', () => {
  const dir = tmpDir('poll');
  addAnnotation(dir, 'page-o', baseAnnotation);
  const a = collectPayload(dir, 'page-o');
  const b = collectPayload(dir, 'page-o');
  assert.equal(b.etag, a.etag);
  assert.equal(b.threads.length, a.threads.length);
});

test('schema_version on every written line is annotation/1', () => {
  const dir = tmpDir('schema');
  const add = addAnnotation(dir, 'page-p', baseAnnotation);
  appendReply(dir, 'page-p', { annotationId: add.id, body: 'x', authorKind: 'agent', authorName: '', idempotencyKey: 'schema-key1' });
  setStatus(dir, 'page-p', add.id, 'resolved');
  const { events } = readEvents(dir, 'page-p');
  assert.ok(events.length >= 3);
  for (const ev of events) assert.equal(ev.schema_version, SCHEMA_VERSION);
});

test('foldThreads is pure and tolerant of junk inputs', () => {
  assert.deepEqual(foldThreads([]), []);
  assert.deepEqual(
    foldThreads([{ kind: 'mystery' }, { kind: 'reply' }, 'junk-string-is-Unable-here-if-callers-filter']).filter(
      t => typeof t === 'object'
    ),
    []
  );
  const one = foldThreads([{ schema_version: 'annotation/1', kind: 'annotation', id: 'a_AAAAAAAAAAAAAAAAAAAAAAAA', type: 'box', authorKind: 'human', createdAt: '2026-01-01T00:00:00.000Z' }]);
  assert.equal(one.length, 1);
  assert.equal(one[0].status, 'open');
});
