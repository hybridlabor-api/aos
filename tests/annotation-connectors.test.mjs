import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAnchor,
  connectorPath,
  nextNumber,
  filterNotes,
  driftState,
} from '../lib/annotation/overlay/connectors.mjs';

const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h });

test('resolveAnchor live', () => {
  const r = resolveAnchor({ anchor: { selector: '#a' } }, () => rect(0, 0, 10, 10));
  assert.equal(r.state, 'live');
});

test('resolveAnchor orphan on null', () => {
  const r = resolveAnchor({ anchor: { selector: '#a' } }, () => null);
  assert.deepEqual(r, { state: 'orphan', rect: null });
});

test('resolveAnchor invalid selector does not throw', () => {
  const r = resolveAnchor({ anchor: { selector: '###' } }, () => {
    throw new Error('bad selector');
  });
  assert.equal(r.state, 'orphan');
});

test('connectorPath 4 relative positions', () => {
  const note = rect(100, 100, 40, 20);
  // target right
  assert.equal(connectorPath(note, rect(200, 100, 40, 20)), 'M 140 110 L 200 110');
  // target left
  assert.equal(connectorPath(note, rect(0, 100, 40, 20)), 'M 100 110 L 40 110');
  // target below
  assert.equal(connectorPath(note, rect(100, 200, 40, 20)), 'M 120 120 L 120 200');
  // target above
  assert.equal(connectorPath(note, rect(100, 0, 40, 20)), 'M 120 100 L 120 40');
});

test('connectorPath rounds to 1 decimal', () => {
  const d = connectorPath(rect(0, 0, 10.05, 10), rect(20.06, 0, 10, 10));
  assert.match(d, /^M -?\d+(\.\d)? -?\d+(\.\d)? L -?\d+(\.\d)? -?\d+(\.\d)?$/);
});

test('numbering stability by creation order', () => {
  const notes = [
    { id: 'c', createdAt: '2026-01-03T00:00:00.000Z' },
    { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', createdAt: '2026-01-02T00:00:00.000Z' },
  ];
  const m = nextNumber(notes);
  assert.equal(m.get('a'), 1);
  assert.equal(m.get('b'), 2);
  assert.equal(m.get('c'), 3);
  // renumber after delete: no gaps
  const m2 = nextNumber([notes[1], notes[2]]);
  assert.equal(m2.get('a'), 1);
  assert.equal(m2.get('b'), 2);
});

test('filterNotes', () => {
  const notes = [
    { id: '1', status: 'open' },
    { id: '2', status: 'resolved' },
    { id: '3', status: 'open', orphan: true },
  ];
  assert.equal(filterNotes(notes, 'all').length, 3);
  assert.equal(filterNotes(notes, 'open').length, 2);
  assert.deepEqual(filterNotes(notes, 'resolved').map((n) => n.id), ['2']);
  assert.deepEqual(filterNotes(notes, 'orphan').map((n) => n.id), ['3']);
});

test('driftState', () => {
  assert.equal(driftState(rect(0, 0, 10, 10), rect(1, 0, 10, 10), 2), 'same');
  assert.equal(driftState(rect(0, 0, 10, 10), rect(5, 0, 10, 10), 2), 'moved');
  assert.equal(driftState(null, null), 'same');
  assert.equal(driftState(null, rect(0, 0, 1, 1)), 'moved');
});
