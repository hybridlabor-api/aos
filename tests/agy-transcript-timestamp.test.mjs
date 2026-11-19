import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-home-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const mod = await import(pathToFileURL(path.resolve('.claude/hooks/go-gate.mjs')).href);
const { agyGogateCommands, effectiveGate } = mod;

function writeTmp(lines) {
  const f = path.join(os.tmpdir(), 'agy-' + Date.now() + '-' + Math.random() + '.jsonl');
  fs.writeFileSync(f, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return f;
}

test('agyGogateCommands finds off entry with finite ts', () => {
  const now = 1000000000000;
  const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();
  const f = writeTmp([
    { step_index: 4, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: fiveMinAgo, content: '<USER_REQUEST>\ngogate off\n</USER_REQUEST>' },
  ]);
  const cmds = agyGogateCommands(f, 'k', now);
  const off = cmds.find(c => c.parsed && c.parsed.cmd === 'off');
  assert.ok(off, 'off entry found');
  assert.ok(Number.isFinite(off.ts), 'off has finite ts');
  fs.unlinkSync(f);
});

test('off in turn 4 followed by turns 5 and 6 still gives mode off', () => {
  const now = 1000000000000;
  const f = writeTmp([
    { step_index: 4, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(now - 5 * 60 * 1000).toISOString(), content: '<USER_REQUEST>\ngogate off\n</USER_REQUEST>' },
    { step_index: 5, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(now - 4 * 60 * 1000).toISOString(), content: '<USER_REQUEST>\nhello\n</USER_REQUEST>' },
    { step_index: 6, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(now - 3 * 60 * 1000).toISOString(), content: '<USER_REQUEST>\nrun push\n</USER_REQUEST>' },
  ]);
  const cmds = agyGogateCommands(f, 'k2', now);
  const eff = effectiveGate('k2', { source: f, cmds, transcriptOnly: true }, now);
  assert.equal(eff.mode, 'off');
  fs.unlinkSync(f);
});

test('created_at older than 25 hours gives mode hard', () => {
  const now = 1000000000000;
  const old = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  const f = writeTmp([
    { step_index: 4, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: old, content: '<USER_REQUEST>\ngogate off\n</USER_REQUEST>' },
    { step_index: 5, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(now - 1000).toISOString(), content: '<USER_REQUEST>\nrun push\n</USER_REQUEST>' },
  ]);
  const cmds = agyGogateCommands(f, 'k3', now);
  const eff = effectiveGate('k3', { source: f, cmds, transcriptOnly: true }, now);
  assert.equal(eff.mode, 'hard');
  fs.unlinkSync(f);
});

test('line without created_at behaves as before', () => {
  const now = 1000000000000;
  const f = writeTmp([
    { step_index: 4, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: '<USER_REQUEST>\ngogate off\n</USER_REQUEST>' },
  ]);
  const cmds = agyGogateCommands(f, 'k4', now);
  assert.ok(Array.isArray(cmds));
  fs.unlinkSync(f);
});
