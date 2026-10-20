// Audit phonebook: the session title/name becomes the A2A label automatically. A manual label
// (AOS_A2A_LABEL env, `aos-a2a label`) always wins; a rename updates only auto labels.
// Registry + harness title derivation + ensureSidecar wiring, all against a temp HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AOS_SESSIONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-abel-'));
process.env.AOS_TEST_SANDBOX = '1';

const { register, setLabel, autoLabel } = await import('../lib/a2a-registry.mjs');
const { sessionTitleOf, ensureAutoLabel, ensureSidecar } = await import('../lib/a2a-session.mjs');
delete process.env.AOS_A2A_LABEL;
delete process.env.AOS_A2A_LABEL_SOURCE;

const readEntry = (name) => JSON.parse(fs.readFileSync(path.join(process.env.AOS_SESSIONS_DIR, `${name}.json`), 'utf8'));
const HOME = path.join(process.env.AOS_SESSIONS_DIR, 'home');

test('sessionTitleOf reads only what the payload or env actually carries', () => {
  const env = { AOS_A2A_SESSION_TITLE: 'from env' };
  assert.equal(sessionTitleOf({ harness: 'claude', payload: { title: 'Fix the gate' }, env }), 'from env');
  delete env.AOS_A2A_SESSION_TITLE;
  assert.equal(sessionTitleOf({ harness: 'claude', payload: { session_id: 's1', cwd: '/repo' }, env }), null);
  assert.equal(sessionTitleOf({ harness: 'claude', payload: { session_name: 'Renamed' }, env }), 'Renamed');
  // agy/codex: workspace folder name first, thread second; $HOME is never a project name
  assert.equal(sessionTitleOf({ harness: 'agy', payload: {}, env: {}, cwd: '/repo/demo' }), 'demo');
  assert.equal(sessionTitleOf({ harness: 'agy', payload: { thread: 'conv-1' }, env: {}, cwd: HOME, home: HOME }), 'conv-1');
  assert.equal(sessionTitleOf({ harness: 'codex', payload: { thread: 't-9' }, env: {}, cwd: HOME, home: HOME }), 't-9');
  assert.equal(sessionTitleOf({ harness: 'codex', payload: {}, env: {}, cwd: HOME, home: HOME }), null);
});

test('autoLabel labels an unlabeled session; a manual label wins forever; a rename updates the auto label', () => {
  register({ name: 'claude-aaaaaaaa', harness: 'claude', pid: 1, label: undefined, labelSource: undefined });
  const got = autoLabel('claude-aaaaaaaa', 'Fix the login flow');
  assert.ok(got, 'unlabeled session accepts the auto label');
  assert.equal(readEntry('claude-aaaaaaaa').label, 'Fix the login flow');
  assert.equal(readEntry('claude-aaaaaaaa').labelSource, 'auto');

  assert.ok(autoLabel('claude-aaaaaaaa', 'Renamed by the human'), 'renaming the session updates an auto label');
  assert.equal(readEntry('claude-aaaaaaaa').label, 'Renamed by the human');

  setLabel('claude-aaaaaaaa', 'my own label');
  assert.equal(autoLabel('claude-aaaaaaaa', 'auto again'), null, 'a manual label wins');
  assert.equal(readEntry('claude-aaaaaaaa').label, 'my own label');
  assert.equal(readEntry('claude-aaaaaaaa').labelSource, 'manual');
});

test('registration keeps an existing manual label even with an auto source in the env', () => {
  register({ name: 'agy-bbbbbbbb', harness: 'agy', pid: 1, label: 'hand set' });
  register({ name: 'agy-bbbbbbbb', harness: 'agy', pid: 1, label: 'auto title', labelSource: 'auto' });
  const e = readEntry('agy-bbbbbbbb');
  assert.equal(e.label, 'hand set');
  assert.equal(e.labelSource, 'manual');
  // a manual label-source re-register is deliberate and overwrites
  register({ name: 'agy-bbbbbbbb', harness: 'agy', pid: 1, label: 'relabelled', labelSource: 'manual' });
  assert.equal(readEntry('agy-bbbbbbbb').label, 'relabelled');
});

test('an auto label is truncated to the label limit and a blank title labels nothing', () => {
  register({ name: 'codex-cccccccc', harness: 'codex', pid: 1 });
  const long = 'x'.repeat(80);
  autoLabel('codex-cccccccc', long);
  assert.equal(readEntry('codex-cccccccc').label.length, 60);
  assert.equal(autoLabel('codex-cccccccc', '   '), null);
  assert.equal(autoLabel('codex-cccccccc', undefined), null);
});

test('ensureAutoLabel is a no-op (never throws) on a missing or corrupt entry', () => {
  assert.equal(ensureAutoLabel('does-not-exist', 'title'), null);
  fs.writeFileSync(path.join(process.env.AOS_SESSIONS_DIR, 'broken-dddddddd.json'), '{nope');
  assert.equal(ensureAutoLabel('broken-dddddddd', 'title'), null);
});

function mockSpawn() {
  const calls = [];
  const f = (...args) => { calls.push(args); return { unref() {}, pid: 4242 }; };
  f.calls = calls;
  return f;
}

test('ensureSidecar passes the auto title through serve; the manual env label wins', () => {
  const env = { PATH: '/usr/bin:/bin' };
  const sp = mockSpawn();
  const r = ensureSidecar({ harness: 'claude', sessionId: 'abcdefgh', parentPid: 1, env, spawnImpl: sp, binPath: '/bin/aos-a2a.mjs', title: 'Fix the canvas' });
  assert.ok(r.started);
  const args = sp.calls[0][1];
  const li = args.indexOf('--label');
  assert.ok(li > 0, JSON.stringify(args));
  assert.equal(args[li + 1], 'Fix the canvas');
  assert.equal(args[li + 2], '--label-source');
  assert.equal(args[li + 3], 'auto');

  const sp2 = mockSpawn();
  ensureSidecar({ harness: 'claude', sessionId: 'zzzzzzzz', parentPid: 1, env: { ...env, AOS_A2A_LABEL: 'mine' }, spawnImpl: sp2, binPath: '/bin/aos-a2a.mjs', title: 'auto ignored' });
  const a2 = sp2.calls[0][1];
  const l2 = a2.indexOf('--label');
  assert.equal(a2[l2 + 1], 'mine');
  assert.equal(a2[l2 + 3], 'manual');
});

test('a running sidecar seen with a new name gets its auto label updated (rename)', () => {
  const name = 'claude-rename00';
  register({ name, harness: 'claude', pid: 1 });
  autoLabel(name, 'first title');
  fs.writeFileSync(path.join(process.env.AOS_SESSIONS_DIR, `${name}.pid`), String(process.pid));
  const sp = mockSpawn();
  const r = ensureSidecar({ harness: 'claude', sessionId: 'rename00', parentPid: 1, env: {}, spawnImpl: sp, binPath: '/bin/aos-a2a.mjs', title: 'second title' });
  assert.equal(r.skipped, 'running', JSON.stringify(r));
  assert.equal(sp.calls.length, 0, 'a live sidecar is never spawned again');
  assert.equal(readEntry(name).label, 'second title');
  assert.equal(readEntry(name).labelSource, 'auto');
});
