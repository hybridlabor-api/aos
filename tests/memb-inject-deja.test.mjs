// memb-inject v6 appends `deja wip` (what the last session here was doing)
// to the SessionStart block. deja is optional: any failure must yield [].
import { test } from 'node:test';
import assert from 'node:assert';
import { dejaWip } from '../.claude/hooks/memb-inject.mjs';

const fake = (out) => (cmd, args, opts) => {
  assert.strictEqual(cmd, 'deja');
  assert.deepStrictEqual(args, ['wip', '--json']);
  assert.strictEqual(opts.cwd, '/proj');
  if (out instanceof Error) throw out;
  return out;
};

// dejaWip is async since 5.4.0-beta.2: deja runs as a bounded async child, so the hook budget can fire meanwhile.
test('renders wip lines under a session header', async () => {
  const out = JSON.stringify({ harness: 'claude', session: '3593156a-43b1', lines: ['working on: x', 'settled:  y\n z'] });
  assert.deepStrictEqual(await dejaWip('/proj', fake(out)), [
    '- Last session here (claude deja:3593156a):',
    '  - working on: x',
    '  - settled: y z',
  ]);
});

test('caps at four lines of 220 chars', async () => {
  const out = JSON.stringify({ lines: Array(6).fill('a'.repeat(300)) });
  const r = await dejaWip('/proj', fake(out));
  assert.strictEqual(r.length, 5);
  assert.strictEqual(r[0], '- Last session here:');
  assert.strictEqual(r[1].length, 4 + 220);
});

test('fails open: missing deja, bad json, no lines', async () => {
  assert.deepStrictEqual(await dejaWip('/proj', fake(new Error('ENOENT'))), []);
  assert.deepStrictEqual(await dejaWip('/proj', fake('not json')), []);
  assert.deepStrictEqual(await dejaWip('/proj', fake('{}')), []);
});
