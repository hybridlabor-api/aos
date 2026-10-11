import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSelector, initialToolState, toolReducer, undoPush, undoPop, buildAnnotationBody, newIdempotencyKey, TOOLS } from '../lib/annotation/overlay/logic.mjs';

test('selector prefers id', () => {
  assert.equal(buildSelector({ tag: 'div', id: 'main' }).selector, '#main');
});
test('selector falls back to tag+class+nth, selector-only', () => {
  const r = buildSelector({ tag: 'button', classes: ['a', 'b!'], nth: 2 });
  assert.equal(r.selector, 'button.a:nth-of-type(2)');
  assert.equal(r.fallback, false);
});
test('selector empty descriptor is fallback', () => {
  const r = buildSelector({});
  assert.equal(r.fallback, true);
});
test('tool reducer transitions, invalid tool ignored', () => {
  let s = initialToolState();
  s = toolReducer(s, { type: 'SELECT_TOOL', tool: 'box' });
  assert.equal(s.tool, 'box');
  s = toolReducer(s, { type: 'SELECT_TOOL', tool: 'nope' });
  assert.equal(s.tool, 'box');
  s = toolReducer(s, { type: 'SET_STROKE', width: 999 });
  assert.equal(s.strokeWidth, 64);
  s = toolReducer(s, { type: 'START_PICK' });
  assert.equal(s.picking, true);
  s = toolReducer(s, { type: 'END_DRAFT' });
  assert.equal(s.picking, false);
});
test('draft append caps at 512 and rejects bad points', () => {
  let s = toolReducer(initialToolState('freehand'), { type: 'START_DRAFT', points: [] });
  s = toolReducer({ ...s, tool: 'freehand' }, { type: 'APPEND_POINT', point: [1, 2] });
  assert.equal(s.draft.points.length, 1);
  s = toolReducer(s, { type: 'APPEND_POINT', point: [NaN, 1] });
  assert.equal(s.draft.points.length, 1);
});
test('undo stack LIFO with cap 50', () => {
  let st = [];
  for (let i = 0; i < 55; i++) st = undoPush(st, i);
  assert.equal(st.length, 50);
  const { stack, item } = undoPop(st);
  assert.equal(item, 54);
  assert.equal(stack.length, 49);
  assert.equal(undoPop([]).item, null);
});
test('annotation body shape has idempotency key and text only for text tool', () => {
  const b = buildAnnotationBody({ tool: 'text', anchor: { selector: '#a', x: 1, y: 2 }, markup: { color: 'red', strokeWidth: 5, text: 'hi' }, pageId: 'p1', idempotencyKey: 'k_1' });
  assert.equal(b.markup.text, 'hi');
  assert.equal(b.idempotencyKey, 'k_1');
  const p = buildAnnotationBody({ tool: 'pin', anchor: {}, markup: {}, pageId: 'p1', idempotencyKey: 'k_2' });
  assert.equal(p.markup.text, undefined);
});
test('idempotency key format', () => {
  assert.match(newIdempotencyKey('abc123'), /^k_[A-Za-z0-9]+$/);
  assert.equal(TOOLS.length, 5);
});
