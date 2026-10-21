import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, '.claude/workflows/fabric-dispatch.mjs'), 'utf8');
const block = src.slice(src.indexOf('// BEGIN canvas-verdict'), src.indexOf('// END canvas-verdict'));
const { decideCanvasVerdict, lastJsonObject } = new Function(`${block}; return { decideCanvasVerdict, lastJsonObject };`)();

test('approve verdict approves', () => {
  assert.equal(decideCanvasVerdict({ status: 'feedback', items: [{ kind: 'verdict', verdict: 'approve' }] }).approved, true);
});

test('request-changes forwards every item text, comments included', () => {
  const d = decideCanvasVerdict({ status: 'feedback', items: [
    { kind: 'comment', text: 'rename X' }, { kind: 'verdict', verdict: 'request-changes', text: 'redo scope' }] });
  assert.equal(d.approved, false);
  assert.ok(!d.escalate);
  assert.match(d.feedback, /rename X/);
  assert.match(d.feedback, /redo scope/);
});

test('comments without verdict are request-changes with their text', () => {
  const d = decideCanvasVerdict({ status: 'feedback', items: [{ kind: 'comment', text: 'why?' }] });
  assert.ok(!d.escalate);
  assert.match(d.feedback, /why\?/);
});

test('ended, waiting, error and missing payload escalate', () => {
  for (const p of [{ status: 'ended', endedBy: 'user' }, { status: 'waiting' }, { error: 'x' }, null]) {
    assert.equal(decideCanvasVerdict(p).escalate, true);
  }
});

test('lastJsonObject skips log noise and takes the last top-level object', () => {
  const raw = 'warn {not json\n{\n  "a": 1\n}\n{\n  "status": "feedback",\n  "items": []\n}\n';
  assert.equal(lastJsonObject(raw).status, 'feedback');
});
