// drive: next -> execute -> report until the run is terminal. In-process with a scripted executor, and through the CLI with
// a fake executor script (no harness, no network, no real model).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { drive } from '../lib/fabric/executors.mjs';
import { startRun } from '../lib/fabric/engine.mjs';
import { createStore, EXIT_CODES } from '../lib/fabric/store.mjs';
import { fakeEnv, reportFor, runCli, tmpProject, writeFakeExecutor } from './fixtures/fabric-helpers.mjs';

const GOAL = 'add a status page';
const withProject = (fn) => async () => { const p = tmpProject(); try { await fn(p); } finally { p.cleanup(); } };
const events = (p, run = 'r') => fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', run, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function runDrive(p, { scen = 'ok', stub, ...opts } = {}) {
  const out = [];
  const err = [];
  const calls = [];
  const executeStep = stub ?? (async (step) => { calls.push(step.step_id); return { report: reportFor(step, p.dir, scen), harness: 'stub', executor: 'stub', notes: [] }; });
  return drive({ root: p.dir, home: p.home, run: 'r', out: (s) => out.push(s), err: (s) => err.push(s), deps: { executeStep }, ...opts })
    .then((code) => ({ code, calls, lines: out.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)), errors: err.join('') }));
}
const begin = (p) => startRun({ root: p.dir, home: p.home, run: 'r', goal: GOAL });

test('drive runs a whole run and exits 0 at ready_to_ship, one JSON event per line', withProject(async (p) => {
  begin(p);
  const r = await runDrive(p);
  assert.equal(r.code, 0, r.errors);
  assert.deepEqual(r.calls, ['0-architect-1', '0-techlead-1', '0-human-1', '0-ui_ux-1', '0-engineering-1', '0-reviewer-1', '0-shipping-1']);
  const names = r.lines.map((l) => l.event);
  assert.deepEqual(names, [...Array(7).fill(['step_start', 'step_end']).flat(), 'done']);
  const end = r.lines.filter((l) => l.event === 'step_end');
  assert.deepEqual(end.map((l) => l.accepted_as), Array(7).fill('ok'));
  assert.equal(end[0].executor, 'stub');
  assert.equal(end.at(-1).kind, 'ready_to_ship');
  assert.deepEqual(r.lines.at(-1), { event: 'done', run: 'r', phase: 'ready_to_ship', iteration: 0 });
  assert.equal(r.errors, '');
  assert.equal(fs.existsSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'reports')), false, 'drive hands the report over directly, it writes nothing through the executor\'s report path');
}));

test('drive on a finished run runs nothing: 0 when it is ready to ship, 6 when a human is needed or it was cancelled', withProject(async (p) => {
  begin(p);
  await runDrive(p);
  const again = await runDrive(p);
  assert.equal(again.code, 0);
  assert.deepEqual(again.calls, []);

  const q = tmpProject();
  try {
    startRun({ root: q.dir, home: q.home, run: 'r', goal: GOAL });
    const esc = await runDrive(q, { scen: 'noprogress' });
    assert.equal(esc.code, EXIT_CODES.TERMINAL_PHASE);
    assert.equal(esc.lines.at(-1).phase, 'escalated');
    assert.match(esc.lines.at(-1).reason, /No progress/);
  } finally { q.cleanup(); }

  const c = tmpProject();
  try {
    startRun({ root: c.dir, home: c.home, run: 'r', goal: GOAL });
    const { cancelRun } = await import('../lib/fabric/engine.mjs');
    cancelRun({ root: c.dir, run: 'r', reason: 'stop' });
    const done = await runDrive(c);
    assert.equal(done.code, 6);
    assert.deepEqual(done.calls, []);
    assert.equal(done.lines.at(-1).phase, 'cancelled');
  } finally { c.cleanup(); }
}));

test('drive follows the repair loop and records a report that fails verification as failed', withProject(async (p) => {
  begin(p);
  let first = true;
  const r = await runDrive(p, {
    stub: async (step) => {
      const report = reportFor(step, p.dir, 'repair');
      if (first) { first = false; report.artifacts = { plan: 'production_artifacts/plan/gone.mdx' }; }
      return { report, harness: 'stub', executor: 'stub', notes: [] };
    },
  });
  assert.equal(r.code, 0, r.errors);
  const end = r.lines.filter((l) => l.event === 'step_end');
  assert.deepEqual(end.slice(0, 2).map((l) => [l.step_id, l.status, l.accepted_as]), [['0-architect-1', 'ok', 'fail'], ['0-architect-2', 'ok', 'ok']]);
  assert.ok(r.lines.some((l) => l.step_id === '1-engineering-1'), 'only the owner of the finding ran again');
  assert.ok(!r.lines.some((l) => l.step_id === '1-ui_ux-1'));
}));

test('an interrupted drive leaves the open step open, and the next drive resumes there', withProject(async (p) => {
  begin(p);
  let n = 0;
  const flaky = async (step) => {
    if (++n === 3) throw new Error('the machine went to sleep');
    return { report: reportFor(step, p.dir), harness: 'stub', executor: 'stub', notes: [] };
  };
  const first = await runDrive(p, { stub: flaky });
  assert.equal(first.code, 1);
  assert.deepEqual(JSON.parse(first.errors.trim()), { error: 'the machine went to sleep', code: 1 });
  const store = createStore('r', { root: p.dir });
  assert.equal(store.replay().openStep, '0-human-1');
  const second = await runDrive(p);
  assert.equal(second.code, 0);
  assert.deepEqual(second.calls.slice(0, 2), ['0-human-1', '0-ui_ux-1'], 'no step is run twice, none is skipped');
  assert.equal(events(p).filter((e) => e.kind === 'report_accepted').length, 7);
}));

test('notes of the executor (a fallback, an ignored hint) reach the event log', withProject(async (p) => {
  begin(p);
  const r = await runDrive(p, {
    stub: async (step) => ({ report: reportFor(step, p.dir), harness: 'stub', executor: 'aos-acp', notes: step.node === 'architect' ? ['AO was requested but the ao command is not on PATH; the step runs on aos-acp'] : [] }),
  });
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines.filter((l) => l.event === 'note').map((l) => l.text), ['AO was requested but the ao command is not on PATH; the step runs on aos-acp']);
  const note = events(p).find((e) => e.kind === 'note');
  assert.match(note.text, /AO was requested/);
}));

test('drive stops after maxSteps instead of running for ever', withProject(async (p) => {
  begin(p);
  const r = await runDrive(p, { maxSteps: 2 });
  assert.equal(r.code, 1);
  assert.deepEqual(r.calls, ['0-architect-1', '0-techlead-1']);
  assert.match(JSON.parse(r.errors.trim()).error, /stopped after 2 steps/);
}));

test('drive refuses bad options and unknown runs before running anything', withProject(async (p) => {
  begin(p);
  const bad = await runDrive(p, { executor: 'bogus' });
  assert.equal(bad.code, 2);
  assert.match(bad.errors, /--executor must be one of aos-acp, ao, auto, fake/);
  assert.equal((await runDrive(p, { sandbox: 'docker' })).code, 2);
  assert.equal((await runDrive(p, { env: { AOS_FABRIC_SANDBOX: 'vm' } })).code, 2);
  assert.equal((await runDrive(p, { run: 'ghost' })).code, 3);
  assert.equal((await runDrive(p, { run: '../x' })).code, 2);
  assert.deepEqual((await runDrive(p, { executor: 'bogus' })).calls, []);
}));

test('the options reach the executor: mode, sandbox, timeout and the step', withProject(async (p) => {
  begin(p);
  const seen = [];
  const r = await runDrive(p, {
    executor: 'auto', timeout: 77, sandbox: 'coop', maxSteps: 1,
    stub: async (step, opts) => { seen.push({ id: step.step_id, mode: opts.mode, sandbox: opts.sandbox, timeoutS: opts.timeoutS }); return { report: reportFor(step, p.dir), harness: 'h', executor: 'e', notes: [] }; },
  });
  assert.equal(r.code, 1);
  assert.deepEqual(seen, [{ id: '0-architect-1', mode: 'auto', sandbox: 'coop', timeoutS: 77 }]);
}));

test('a writer that holds the lock for a moment only delays drive; a lock that never goes ends it with exit 5', withProject(async (p) => {
  begin(p);
  const held = createStore('r', { root: p.dir }).lock();
  setTimeout(() => held.release(), 700);
  const ok = await runDrive(p, { maxSteps: 1 });
  assert.equal(ok.code, 1, 'it got past the lock and stopped only at maxSteps');
  assert.equal(events(p).filter((e) => e.kind === 'report_accepted').length, 1);

  const stuck = createStore('r', { root: p.dir }).lock();
  try {
    const r = await runDrive(p);
    assert.equal(r.code, EXIT_CODES.LOCK_BUSY);
    assert.match(r.errors, /locked by pid/);
  } finally { stuck.release(); }
}));

// ---- through the CLI, with a fake executor script ----

function viaCli(p, scen, extra = [], env = {}) {
  const script = writeFakeExecutor(p.base);
  const cli = (args, e = {}) => runCli(args, { cwd: p.dir, env: fakeEnv(p.home, { AOS_FABRIC_FAKE_EXECUTOR: script, FAKE_SCEN: scen, ...e }), timeout: 120000 });
  assert.equal(cli(['start', '--run', 'r', '--goal', GOAL]).code, 0);
  const d = cli(['drive', '--run', 'r', '--executor', 'fake', ...extra], env);
  return { d, cli, done: d.lines.map((l) => JSON.parse(l)).at(-1) };
}

test('CLI drive, fake executor: ok run ends with exit 0 and warns that no human approved', withProject((p) => {
  const { d, done } = viaCli(p, 'ok');
  assert.equal(d.code, 0, d.stderr);
  assert.equal(done.phase, 'ready_to_ship');
  assert.match(d.stderr, /AOS_PLAN_APPROVAL=auto/);
  assert.equal(d.lines.filter((l) => JSON.parse(l).event === 'step_end').length, 7);
}));

test('CLI drive, fake executor: the repair loop runs through the CLI too', withProject((p) => {
  const repair = viaCli(p, 'repair');
  assert.equal(repair.d.code, 0, repair.d.stderr);
  assert.equal(repair.done.iteration, 1);
}));

test('CLI drive, fake executor: a hopeless run escalates with exit 6 and the reason', withProject((p) => {
  const { d, done } = viaCli(p, 'noprogress');
  assert.equal(d.code, 6);
  assert.equal(done.phase, 'escalated');
  assert.match(done.reason, /No progress/);
}));

test('CLI drive, fake executor: crash, broken report and wrong step id are failed steps that escalate after two attempts', withProject((p) => {
  const { d, done } = viaCli(p, 'crash');
  assert.equal(d.code, 6);
  assert.match(done.reason, /architect gave no usable result in 2 attempts: the executor exited with code 3 and left no report/);
  const ends = d.lines.map((l) => JSON.parse(l)).filter((l) => l.event === 'step_end');
  assert.deepEqual(ends.map((l) => [l.step_id, l.accepted_as]), [['0-architect-1', 'fail'], ['0-architect-2', 'fail']]);
}));

test('CLI drive, fake executor: --timeout stops a hanging executor and the step counts as failed (exit code 124 in the log)', withProject((p) => {
  const started = Date.now();
  const { d, done } = viaCli(p, 'slow', ['--timeout', '1']);
  assert.equal(d.code, 6);
  assert.match(done.reason, /architect gave no usable result in 2 attempts: the executor did not finish within 1 s/);
  const ev = fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(ev.filter((e) => e.kind === 'report_accepted').map((e) => e.report.exit_code), [124, 124]);
  assert.ok(Date.now() - started < 60000);
}));

test('CLI drive, fake executor: a report printed to stdout instead of a file is accepted', withProject((p) => {
  const { d, done } = viaCli(p, 'stdout');
  assert.equal(d.code, 0, d.stderr);
  assert.equal(done.phase, 'ready_to_ship');
}));

test('CLI drive, fake executor: an out-of-scope change fails the step on both attempts', withProject((p) => {
  const { d, done } = viaCli(p, 'scope');
  assert.equal(d.code, 6);
  assert.match(done.reason, /src\/evil\.txt changed outside allowed_writes/);
}));

test('CLI drive, fake executor: an executor that links its report path to a user file cannot make the driver overwrite it', { skip: process.platform === 'win32' }, withProject((p) => {
  const victim = path.join(p.base, 'settings.json');
  fs.writeFileSync(victim, 'precious');
  const { d, done } = viaCli(p, 'symlink', [], { FAKE_VICTIM: victim });
  assert.equal(d.code, 6);
  assert.match(done.reason, /architect gave no usable result in 2 attempts: the report path is a link/);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
}));

test('CLI drive, fake executor: a driver that is not set up leaves the step open', withProject((p) => {
  assert.equal(runCli(['start', '--run', 'r', '--goal', GOAL], { cwd: p.dir, env: fakeEnv(p.home) }).code, 0);
  const d = runCli(['drive', '--run', 'r', '--executor', 'fake'], { cwd: p.dir, env: fakeEnv(p.home, { AOS_FABRIC_FAKE_EXECUTOR: '' }) });
  assert.equal(d.code, 2);
  assert.match(d.error.error, /AOS_FABRIC_FAKE_EXECUTOR/);
  assert.equal(runCli(['next', '--run', 'r'], { cwd: p.dir, env: fakeEnv(p.home) }).json.step.step_id, '0-architect-1');
  assert.equal(runCli(['drive', '--run', 'r', '--executor', 'bogus'], { cwd: p.dir, env: fakeEnv(p.home) }).code, 2);
}));
