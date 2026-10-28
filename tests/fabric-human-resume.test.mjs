// drive resumes an open human step from the verdict record: an approve given while drive was away lets the run go on,
// and a record from before the step never does. The plan-canvas CLI is a fake on PATH that only counts its calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { drive, executeStep } from '../lib/fabric/executors.mjs';
import { startRun } from '../lib/fabric/engine.mjs';
import { createStore, EXIT_CODES } from '../lib/fabric/store.mjs';
import { reportFor, tmpProject } from './fixtures/fabric-helpers.mjs';

const { sessionKeyFor, canonicalizeArtifactPath } = createRequire(import.meta.url)('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/sessions.js');
const URL_OF = 'http://127.0.0.1:4519/s/abc';
const posix = { skip: process.platform === 'win32' ? 'the fake plan-canvas is a POSIX script' : false };

function setup(p) {
  const bin = path.join(p.base, 'bin');
  const log = path.join(p.base, 'canvas-calls.log');
  fs.mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, 'aos-plan-canvas');
  fs.writeFileSync(shim, `#!/bin/sh\necho "$@" >> "$FAKE_CANVAS_LOG"\necho "[plan-canvas] open: ${URL_OF}" >&2\necho '{"status":"waiting","url":"${URL_OF}"}'\n`);
  fs.chmodSync(shim, 0o755);
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: p.home, CI: '1', FAKE_CANVAS_LOG: log };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0);
  return { env, calls };
}

// What the plan-canvas server writes when the human approves: the same record addRoutes writes.
function approve(p, { timestamp = new Date(Date.now() + 1000).toISOString(), verdict = 'approve' } = {}) {
  const plan = canonicalizeArtifactPath(path.join(p.dir, 'production_artifacts/plan/plan.mdx'));
  fs.writeFileSync(path.join(path.dirname(plan), 'plan.approval.json'), JSON.stringify({
    schema: 'aos.plan-approval/1', verdict, contentHash: createHash('sha256').update(fs.readFileSync(plan, 'utf8')).digest('hex'),
    timestamp, source: 'plan-canvas', plan, session: sessionKeyFor(plan),
    items: [{ kind: 'verdict', verdict, text: '' }],
  }, null, 2));
}

function runDrive(p, env) {
  const out = [];
  const err = [];
  const stub = (step, opts) => (step.kind === 'human' ? executeStep(step, opts)
    : Promise.resolve({ report: reportFor(step, p.dir, 'ok'), harness: 'stub', executor: 'stub', notes: [] }));
  return drive({ root: p.dir, home: p.home, run: 'r', env, out: (s) => out.push(s), err: (s) => err.push(s), deps: { executeStep: stub } })
    .then((code) => ({ code, lines: out.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)), errors: err.join('') }));
}

const withProject = (fn) => async () => {
  const p = tmpProject();
  try { await fn(p); } finally { p.cleanup(); }
};

test('an approve given while drive was away lets the resumed run go on, without asking the canvas again', { ...posix }, withProject(async (p) => {
  startRun({ root: p.dir, home: p.home, run: 'r', goal: 'create hello.txt containing hi' });
  const { env, calls } = setup(p);
  const first = await runDrive(p, env);
  assert.equal(first.code, EXIT_CODES.TERMINAL_PHASE);
  const waiting = first.lines.at(-1);
  assert.equal(waiting.event, 'waiting_for_human');
  assert.equal(waiting.message, `waiting for human approval: open ${URL_OF}`);
  assert.equal(calls(), 1);

  approve(p);
  const second = await runDrive(p, env);
  assert.equal(second.code, 0, second.errors);
  assert.equal(calls(), 1, 'the verdict record answered the human step; no second canvas wait');
  assert.equal(createStore('r', { root: p.dir }).replay().terminal, true);
}));

test('a verdict record from before the human step never resumes the run', { ...posix }, withProject(async (p) => {
  startRun({ root: p.dir, home: p.home, run: 'r', goal: 'create hello.txt containing hi' });
  const { env, calls } = setup(p);
  await runDrive(p, env);
  approve(p, { timestamp: '2020-01-01T00:00:00.000Z' });
  const again = await runDrive(p, env);
  assert.equal(again.code, EXIT_CODES.TERMINAL_PHASE);
  assert.equal(again.lines.at(-1).event, 'waiting_for_human');
  assert.equal(calls(), 2);
}));
