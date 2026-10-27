import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertRunId, canonical, createStore, digest, EXIT_CODES, FabricError, LOCK_STALE_MS, MAX_REPORT_BYTES, readTextCapped, TERMINAL_PHASES } from '../lib/fabric/store.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-store-'));
const state = (over = {}) => ({ run_id: 'r', goal: 'g', phase: 'define', iteration: 0, max_iterations: 3, gate: {}, findings: [], approvals: [], ...over });
const start = (store, s = state()) => store.commit({ kind: 'start', run_id: store.runId, goal: s.goal, config: { cwd: store.root }, state: s, open_step: '0-architect-1' });
const withDir = (fn) => async () => { const root = tmp(); try { await fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); } };

test('run ids that could leave the run folder are rejected with exit code 2', () => {
  for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', '-x', 'x'.repeat(65), 'a b', 'ä', null, 5]) {
    assert.throws(() => assertRunId(bad), (e) => e instanceof FabricError && e.code === EXIT_CODES.INVALID_INPUT, String(bad));
  }
  for (const ok of ['a', 'run-1', 'Run_2.x', '0abc', 'x'.repeat(64)]) assert.equal(assertRunId(ok), ok);
});

test('canonical JSON ignores key order, so equal reports have equal digests', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.notEqual(digest({ a: 1 }), digest({ a: 2 }));
  assert.match(digest({}), /^[0-9a-f]{64}$/);
  assert.equal(canonical({ a: undefined, b: 1 }), '{"b":1}');
});

test('the terminal phases are the ones the CLI contract names', () => {
  assert.deepEqual([...TERMINAL_PHASES].sort(), ['cancelled', 'done', 'escalated', 'ready_to_ship']);
});

test('lock is exclusive and released by its owner', withDir((root) => {
  const a = createStore('r', { root });
  const b = createStore('r', { root });
  const l1 = a.lock();
  assert.equal(l1.ok, true);
  const l2 = b.lock();
  assert.equal(l2.ok, false);
  assert.equal(l2.code, EXIT_CODES.LOCK_BUSY);
  assert.equal(l2.holder.pid, process.pid);
  l1.release();
  const l3 = b.lock();
  assert.equal(l3.ok, true);
  l3.release();
  assert.equal(fs.existsSync(path.join(a.runDir, 'state.lock')), false, 'release removes the lock file');
}));

test('a stale lock (older than 60 s, dead pid) is taken over; younger or live ones are not', withDir((root) => {
  const t = 1_000_000_000_000;
  const mk = (alive, now) => createStore('r', { root, now: () => now, isAlive: () => alive });
  const seed = (pid, at) => { fs.mkdirSync(path.join(root, 'production_artifacts', 'runs', 'r'), { recursive: true }); fs.writeFileSync(path.join(root, 'production_artifacts', 'runs', 'r', 'state.lock'), JSON.stringify({ pid, at })); };

  seed(99999991, t);
  assert.equal(mk(false, t + LOCK_STALE_MS - 1).lock().ok, false, 'dead pid but younger than 60 s: still busy');
  assert.equal(mk(true, t + 10 * LOCK_STALE_MS).lock().ok, false, 'old but the pid is alive: busy');
  const took = mk(false, t + LOCK_STALE_MS + 1).lock();
  assert.equal(took.ok, true, 'old and dead: taken over');
  took.release();
  assert.equal(fs.readdirSync(path.join(root, 'production_artifacts', 'runs', 'r')).filter((f) => f.startsWith('state.lock')).length, 0, 'no tombstone is left behind');
}));

test('a half-written lock file is judged by its age', withDir((root) => {
  const dir = path.join(root, 'production_artifacts', 'runs', 'r');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.lock'), '');
  const fresh = createStore('r', { root });
  assert.equal(fresh.lock().ok, false);
  const later = createStore('r', { root, now: () => Date.now() + 2 * LOCK_STALE_MS });
  const l = later.lock();
  assert.equal(l.ok, true);
  l.release();
}));

test('lockInfo reports holder, age and liveness', withDir((root) => {
  const s = createStore('r', { root });
  assert.equal(s.lockInfo(), null);
  const l = s.lock();
  const info = s.lockInfo();
  assert.equal(info.held, true);
  assert.equal(info.pid, process.pid);
  assert.equal(info.alive, true);
  l.release();
}));

test('commit writes the event, the projection and the graph-gate mirror', withDir((root) => {
  const s = createStore('r', { root });
  start(s);
  const proj = JSON.parse(fs.readFileSync(s.state, 'utf8'));
  const mirror = JSON.parse(fs.readFileSync(path.join(root, 'production_artifacts', 'state.json'), 'utf8'));
  assert.deepEqual(proj, state());
  assert.deepEqual(mirror, proj);
  const r = s.replay();
  assert.equal(r.found, true);
  assert.equal(r.openStep, '0-architect-1');
  assert.equal(r.terminal, false);
  assert.equal(s.projectionStale(r.state), false);
  fs.rmSync(s.state);
  assert.equal(s.projectionStale(r.state), true, 'a missing projection is stale: the log wins');
}));

test('a second write replaces the projection and the mirror (rename over an existing file, on Windows too)', withDir((root) => {
  const s = createStore('r', { root });
  start(s);
  for (let i = 1; i <= 3; i++) s.commit({ kind: 'report_accepted', step_id: `0-a-${i}`, digest: `d${i}`, state: state({ iteration: i }), open_step: null });
  assert.equal(JSON.parse(fs.readFileSync(s.state, 'utf8')).iteration, 3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'production_artifacts', 'state.json'), 'utf8')).iteration, 3);
  assert.equal(s.replay().events.length, 4);
}));

test('replay folds start, accepted reports and cancel into the last state', withDir((root) => {
  const s = createStore('r', { root });
  start(s);
  s.commit({ kind: 'report_accepted', step_id: '0-architect-1', digest: 'd1', state: state({ phase: 'plan' }), open_step: '0-techlead-1', reason: null });
  s.note('a note', { x: 1 });
  s.commit({ kind: 'report_accepted', step_id: '0-techlead-1', digest: 'd2', state: state({ phase: 'escalated', needs_human: true }), open_step: null, reason: 'why' });
  let r = s.replay();
  assert.equal(r.state.phase, 'escalated');
  assert.equal(r.terminal, true);
  assert.equal(r.reason, 'why');
  assert.equal(r.openStep, null);
  assert.equal(r.accepted.get('0-techlead-1'), 'd2');
  assert.equal(r.events.length, 4);
  s.commit({ kind: 'cancelled', reason: 'stop', state: state({ phase: 'cancelled' }) });
  r = s.replay();
  assert.equal(r.state.phase, 'cancelled');
  assert.equal(r.reason, 'stop');
}));

test('replay of a missing run is found:false', withDir((root) => {
  assert.deepEqual(createStore('nope', { root }).replay(), { found: false });
}));

test('a torn last line is dropped, and the next append repairs the tail', withDir((root) => {
  const s = createStore('r', { root });
  start(s);
  fs.appendFileSync(s.events, '{"kind":"report_accepted","step_id":"0-arch');
  const r = s.replay();
  assert.equal(r.events.length, 1);
  assert.equal(r.state.phase, 'define');
  s.commit({ kind: 'report_accepted', step_id: '0-architect-1', digest: 'd', state: state({ phase: 'plan' }), open_step: '0-techlead-1' });
  const again = s.replay();
  assert.equal(again.events.length, 2, 'the new event is a clean line, not glued to the torn one');
  assert.equal(again.state.phase, 'plan');
  assert.equal(fs.readFileSync(s.events, 'utf8').split('\n').filter(Boolean).every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), true);
}));

test('a broken line in the middle is corruption (exit 7), not silently skipped', withDir((root) => {
  const s = createStore('r', { root });
  start(s);
  fs.appendFileSync(s.events, 'garbage\n');
  fs.appendFileSync(s.events, `${JSON.stringify({ kind: 'note', text: 'x' })}\n`);
  assert.throws(() => s.replay(), (e) => e instanceof FabricError && e.code === EXIT_CODES.CORRUPTED_STATE && /line 2/.test(e.message));
}));

test('a log that does not begin with a start event is corruption', withDir((root) => {
  const s = createStore('r', { root });
  fs.mkdirSync(s.runDir, { recursive: true });
  fs.writeFileSync(s.events, `${JSON.stringify({ kind: 'note', text: 'x' })}\n`);
  assert.throws(() => s.replay(), (e) => e.code === EXIT_CODES.CORRUPTED_STATE);
  fs.writeFileSync(s.events, '[1,2]\n');
  assert.throws(() => s.replay(), (e) => e.code === EXIT_CODES.CORRUPTED_STATE);
}));

test('steps, briefs and baselines are written next to the log and read back', withDir((root) => {
  const s = createStore('r', { root });
  s.writeStep({ step_id: '0-architect-1', node: 'architect' }, '# brief\n', { ok: true, files: { 'a.txt': 'h' } });
  assert.equal(s.readStep('0-architect-1').node, 'architect');
  assert.equal(fs.readFileSync(path.join(s.briefs, '0-architect-1.md'), 'utf8'), '# brief\n');
  assert.deepEqual(s.readBaseline('0-architect-1'), { ok: true, files: { 'a.txt': 'h' } });
  assert.equal(s.readBaseline('0-nothing-1'), null);
  assert.throws(() => s.readStep('0-nothing-1'), (e) => e.code === EXIT_CODES.CORRUPTED_STATE);
}));

test('atomic writes leave no temp file behind', withDir((root) => {
  const s = createStore('r', { root });
  start(s);
  s.writeStep({ step_id: '0-a-1' }, 'b', null);
  const leftovers = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.tmp')) leftovers.push(p); } };
  walk(root);
  assert.deepEqual(leftovers, []);
}));

test('a report file is read only up to the cap, so a runaway executor cannot fill the memory of the driver', withDir((root) => {
  const small = path.join(root, 'small.json');
  const big = path.join(root, 'big.json');
  fs.writeFileSync(small, '{"a":1}');
  fs.writeFileSync(big, 'x'.repeat(MAX_REPORT_BYTES + 1));
  assert.equal(readTextCapped(small), '{"a":1}');
  assert.throws(() => readTextCapped(big), (e) => e.code === 'E2BIG' && /more than the \d+ allowed/.test(e.message));
  assert.equal(readTextCapped(big, MAX_REPORT_BYTES + 5).length, MAX_REPORT_BYTES + 1);
  assert.throws(() => readTextCapped(path.join(root, 'missing.json')), (e) => e.code === 'ENOENT');
}));
