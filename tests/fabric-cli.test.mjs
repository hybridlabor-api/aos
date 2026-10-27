// bin/aos-fabric.mjs as a user runs it: arguments, JSON on stdout, error JSON on stderr, exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createStore } from '../lib/fabric/store.mjs';
import { CLI, reportFor, runCli, tmpProject } from './fixtures/fabric-helpers.mjs';

const GOAL = 'add a status page';
const withProject = (fn) => async () => { const p = tmpProject(); try { await fn(p); } finally { p.cleanup(); } };
const cli = (p, args, env = {}) => runCli(args, { cwd: p.dir, env: { HOME: p.home, USERPROFILE: p.home, ...env } });

test('--help, -h and help print the usage from the spec and exit 0', withProject((p) => {
  for (const flag of ['--help', '-h', 'help']) {
    const r = cli(p, [flag]);
    assert.equal(r.code, 0, flag);
    assert.match(r.stdout, /aos-fabric/);
    assert.match(r.stdout, /start/);
    assert.match(r.stdout, /drive/);
  }
  assert.equal(fs.existsSync(path.join(p.dir, 'production_artifacts')), false, 'help writes nothing');
}));

test('a whole run by hand: start, next, report ... ends with next exiting 6', withProject((p) => {
  const started = cli(p, ['start', '--run', 'demo', '--goal', GOAL]);
  assert.equal(started.code, 0, started.stderr);
  assert.equal(started.lines.length, 1, 'exactly one JSON line on stdout');
  assert.equal(started.json.next.step.step_id, '0-architect-1');
  assert.equal(started.stderr, '');
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const n = cli(p, ['next', '--run', 'demo']);
    if (n.json.kind !== 'step') {
      assert.equal(n.code, 6);
      assert.equal(n.json.kind, 'ready_to_ship');
      break;
    }
    assert.equal(n.code, 0);
    const step = n.json.step;
    seen.push(step.step_id);
    const file = path.join(p.base, `${step.step_id}.json`);
    fs.writeFileSync(file, JSON.stringify(reportFor(step, p.dir)));
    const rep = cli(p, ['report', '--run', 'demo', '--step', step.step_id, '--file', file]);
    assert.equal(rep.code, 0, rep.stderr);
    assert.equal(rep.json.schema, 'aos.fabric.response/1');
  }
  assert.equal(seen.length, 7);
  const status = cli(p, ['status', '--run', 'demo']);
  assert.equal(status.code, 0);
  assert.equal(status.json.phase, 'ready_to_ship');
  assert.equal(status.json.open_step, null);
}));

test('start: --goal-file, --skill=name and --skill name, idempotent repeat, conflict', withProject((p) => {
  fs.mkdirSync(path.join(p.home, '.agents', 'skills', 'my-skill'), { recursive: true });
  fs.writeFileSync(path.join(p.home, '.agents', 'skills', 'my-skill', 'SKILL.md'), 'x');
  fs.mkdirSync(path.join(p.home, '.agents', 'skills', 'other'), { recursive: true });
  fs.writeFileSync(path.join(p.home, '.agents', 'skills', 'other', 'SKILL.md'), 'x');
  const goalFile = path.join(p.base, 'goal.md');
  fs.writeFileSync(goalFile, '# Goal\n\nadd a status page\n');
  const a = cli(p, ['start', '--run', 'g', '--goal-file', goalFile, '--skill=my-skill', '--skill', 'other']);
  assert.equal(a.code, 0, a.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'state.json'), 'utf8'));
  assert.deepEqual(state.mandatory_skills, ['my-skill', 'other']);
  assert.equal(state.goal, '# Goal\n\nadd a status page');
  const again = cli(p, ['start', '--run', 'g', '--goal-file', goalFile, '--skill=my-skill', '--skill', 'other']);
  assert.equal(again.code, 0);
  assert.deepEqual(again.json.next.step, a.json.next.step);
  assert.equal(cli(p, ['start', '--run', 'g', '--goal', 'another goal']).code, 4);
  assert.equal(cli(p, ['start', '--run', 'h', '--goal', GOAL, '--skill=nonexistent-skill']).code, 2);
}));

test('usage errors are exit 2 with one JSON line on stderr and nothing on stdout', withProject((p) => {
  const cases = [
    [[], /unknown command/], [['launch'], /unknown command/], [['start', '--bogus'], /unknown argument/], [['start', '--run'], /needs a value/],
    [['start', '--run', 'x'], /--goal or --goal-file is required/], [['start', '--run', 'x', '--goal-file', path.join(p.base, 'nope.md')], /cannot read --goal-file/],
    [['start', '--run', '../x', '--goal', GOAL], /invalid run id/], [['start', '--run', 'x', '--goal', GOAL, '--max-iterations', 'abc'], /positive integer/],
    [['start', '--run', 'x', '--goal', GOAL, '--max-iterations', '0'], /positive integer/], [['start', '--run', 'x', '--goal', GOAL, '--max-iterations', '99'], /1 to 20/],
    [['next'], /--run is required/], [['status'], /--run is required/], [['drive'], /--run is required/],
    [['report', '--run', 'x'], /--step is required/], [['report', '--run', 'x', '--step', 's'], /exactly one of --file and --fail/],
    [['report', '--run', 'x', '--step', 's', '--file', 'f', '--fail', 'why'], /exactly one of --file and --fail/],
  ];
  for (const [args, re] of cases) {
    const r = cli(p, args);
    assert.equal(r.code, 2, `${args.join(' ')} -> ${r.code} ${r.stderr}`);
    assert.equal(r.stdout, '', args.join(' '));
    assert.equal(r.error.code, 2);
    assert.match(r.error.error, re, args.join(' '));
  }
  assert.equal(fs.existsSync(path.join(p.dir, 'production_artifacts')), false, 'a refused command leaves no run folder');
}));

test('exit codes: 3 for an unknown run, 4 for a conflicting report, 6 for a finished run, 7 for a corrupt log', withProject((p) => {
  for (const args of [['next', '--run', 'ghost'], ['status', '--run', 'ghost'], ['cancel', '--run', 'ghost'], ['report', '--run', 'ghost', '--step', '0-a-1', '--fail', 'x'], ['drive', '--run', 'ghost']]) {
    const r = cli(p, args);
    assert.equal(r.code, 3, args.join(' '));
    assert.equal(r.error.code, 3);
  }
  assert.equal(fs.existsSync(path.join(p.dir, 'production_artifacts')), false, 'a mistyped run id creates no folder');

  assert.equal(cli(p, ['start', '--run', 'r', '--goal', GOAL]).code, 0);
  assert.equal(cli(p, ['report', '--run', 'r', '--step', '0-techlead-1', '--fail', 'x']).code, 3, 'a step that is not open');
  assert.equal(cli(p, ['report', '--run', 'r', '--step', '0-architect-1', '--fail', 'first']).code, 0);
  assert.equal(cli(p, ['report', '--run', 'r', '--step', '0-architect-1', '--fail', 'first']).code, 0, 'same report: no-op');
  assert.equal(cli(p, ['report', '--run', 'r', '--step', '0-architect-1', '--fail', 'second']).code, 4);
  const bad = path.join(p.base, 'bad.json');
  fs.writeFileSync(bad, '{ nope');
  assert.equal(cli(p, ['report', '--run', 'r', '--step', '0-architect-2', '--file', bad]).code, 2);

  const cancelled = cli(p, ['cancel', '--run', 'r', '--reason', 'done here']);
  assert.equal(cancelled.code, 0);
  assert.equal(cancelled.json.phase, 'cancelled');
  assert.equal(cli(p, ['cancel', '--run', 'r']).code, 0, 'cancelled twice is a no-op');
  const next = cli(p, ['next', '--run', 'r']);
  assert.equal(next.code, 6);
  assert.equal(next.json.kind, 'cancelled');
  assert.equal(cli(p, ['report', '--run', 'r', '--step', '0-architect-2', '--fail', 'late']).code, 6);

  assert.equal(cli(p, ['start', '--run', 'c', '--goal', GOAL]).code, 0);
  fs.appendFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'c', 'events.jsonl'), 'garbage\n{"kind":"note"}\n');
  const corrupt = cli(p, ['next', '--run', 'c']);
  assert.equal(corrupt.code, 7);
  assert.match(corrupt.error.error, /corrupt/);
}));

test('report exits 5 while another process holds the run lock', withProject((p) => {
  assert.equal(cli(p, ['start', '--run', 'r', '--goal', GOAL]).code, 0);
  const held = createStore('r', { root: p.dir }).lock();
  try {
    const r = cli(p, ['report', '--run', 'r', '--step', '0-architect-1', '--fail', 'x']);
    assert.equal(r.code, 5);
    assert.match(r.error.error, /locked by pid/);
    assert.equal(cli(p, ['next', '--run', 'r']).code, 0, 'next does not need the lock');
  } finally { held.release(); }
  assert.equal(cli(p, ['report', '--run', 'r', '--step', '0-architect-1', '--fail', 'x']).code, 0);
}));

test('the CLI works when started through a symlink, as an npm bin does', { skip: process.platform === 'win32' }, withProject((p) => {
  const link = path.join(p.base, 'aos-fabric');
  fs.symlinkSync(CLI, link);
  const run = (args) => spawnSync(process.execPath, [link, ...args], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, HOME: p.home } });
  const started = run(['start', '--run', 'l', '--goal', GOAL]);
  assert.equal(started.status, 0, started.stderr);
  const next = run(['next', '--run', 'l']);
  assert.equal(next.status, 0, next.stderr);
  assert.equal(JSON.parse(next.stdout).step.step_id, '0-architect-1');
}));
