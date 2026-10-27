// The commands as functions (start, next, report, status, cancel), against a throwaway git project.
// Also dispatcher scenarios 6 (missing goal) and 9 (cancel), see fabric-edges.test.mjs for the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acceptReport, cancelRun, loadRegistry, modelHint, nextView, noteRun, startRun, statusView, validateSkills } from '../lib/fabric/engine.mjs';
import { createStore, EXIT_CODES, FabricError } from '../lib/fabric/store.mjs';
import { validateStep } from '../lib/fabric/schema.mjs';
import { reportFor, ROOT, tmpProject } from './fixtures/fabric-helpers.mjs';

const GOAL = 'add a status page';
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'state.schema.json'), 'utf8'));

const withProject = (fn, opts) => async () => { const p = tmpProject(opts); try { await fn(p); } finally { p.cleanup(); } };
const start = (p, over = {}) => startRun({ root: p.dir, home: p.home, run: 'r', goal: GOAL, ...over });
const next = (p, run = 'r') => nextView({ root: p.dir, run });
const codeOf = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof FabricError, `not a FabricError: ${e.stack}`); return e.code; } return 'no error'; };
const events = (p, run = 'r') => fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', run, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const stateOf = (p) => JSON.parse(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'state.json'), 'utf8'));

function accept(p, step, scen = 'ok', over = {}, run = 'r') {
  const rep = { ...reportFor(step, p.dir, scen), ...over };
  const file = path.join(p.base, `${step.step_id}.report.json`);
  fs.writeFileSync(file, JSON.stringify(rep));
  return acceptReport({ root: p.dir, home: p.home, run, step: step.step_id, file });
}

// Answers every open step with the scripted reports until the run is terminal (or `stop(step)` says so).
function play(p, scen = 'ok', { stop, run = 'r' } = {}) {
  const trace = [];
  for (let i = 0; i < 60; i++) {
    const v = next(p, run).out;
    if (v.kind !== 'step' || stop?.(v.step)) return { view: v, trace };
    trace.push(v.step.step_id);
    assertStateShape(stateOf(p));
    accept(p, v.step, scen, {}, run);
  }
  throw new Error('run did not end');
}

// The mirror must stay valid against .agents/state.schema.json (additionalProperties is false there).
function assertStateShape(s) {
  for (const k of SCHEMA.required) assert.ok(k in s, `state lacks ${k}`);
  for (const k of Object.keys(s)) assert.ok(k in SCHEMA.properties, `state has ${k}, which the state schema does not allow`);
  assert.ok(SCHEMA.properties.phase.enum.includes(s.phase), `phase ${s.phase}`);
  for (const f of s.findings) assert.deepEqual(Object.keys(f).sort(), ['id', 'node', 'severity', 'status', 'summary'].sort());
  for (const v of Object.values(s.gate)) assert.ok(['pass', 'fail', 'skip'].includes(v));
  for (const v of Object.values(s.attempts ?? {})) assert.ok(Number.isInteger(v) && v >= 0);
  for (const v of Object.values(s.artifacts ?? {})) assert.ok(typeof v === 'string' || v === null);
}

test('start writes the run store, the mirror and a valid first step', withProject((p) => {
  const res = start(p);
  assert.equal(res.code, 0);
  assert.equal(res.out.schema, 'aos.fabric.response/1');
  assert.equal(res.out.run, 'r');
  assert.equal(res.out.phase, 'define');
  const step = res.out.next.step;
  assert.equal(res.out.next.kind, 'step');
  assert.deepEqual(validateStep(step), { ok: true, errors: [] });
  assert.equal(step.step_id, '0-architect-1');
  assert.equal(step.role, 'architect');
  assert.equal(step.kind, 'plan');
  assert.equal(step.cwd, p.dir);
  assert.equal(step.timeout_s, 900);
  assert.equal(step.scope, 'read-only');
  assert.deepEqual(step.allowed_writes, ['production_artifacts/**']);
  assert.equal(step.attempt, 1);
  assert.equal(step.max_attempts, 2);
  assert.ok(path.isAbsolute(step.brief) && path.isAbsolute(step.expected_report));
  const brief = fs.readFileSync(step.brief, 'utf8');
  assert.ok(brief.includes(`Report file: ${step.expected_report}`));
  assert.ok(brief.includes(JSON.stringify(GOAL)), 'the Architect brief carries the goal');
  assert.match(brief, /aos-plan-canvas new/);
  assertStateShape(stateOf(p));
  assert.deepEqual(stateOf(p), JSON.parse(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'state.json'), 'utf8')));
  assert.equal(events(p).length, 1);
  assert.equal(events(p)[0].kind, 'start');
}));

test('start with the same run id and goal returns the state and writes nothing', withProject((p) => {
  const a = start(p);
  const before = fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'events.jsonl'), 'utf8');
  const b = start(p);
  assert.deepEqual(b.out.next.step, a.out.next.step);
  assert.equal(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'events.jsonl'), 'utf8'), before);
}));

test('start with the same run id and another goal is a conflict (4)', withProject((p) => {
  start(p);
  assert.equal(codeOf(() => start(p, { goal: 'something else' })), EXIT_CODES.CONFLICT);
}));

test('scenario 6, missing goal: exit 2 and nothing is written', withProject((p) => {
  for (const goal of ['', '   ', undefined]) assert.equal(codeOf(() => start(p, { goal })), EXIT_CODES.INVALID_INPUT);
  assert.equal(fs.existsSync(path.join(p.dir, 'production_artifacts')), false);
}));

test('start validates run id, max iterations, skill names and the registry', withProject((p) => {
  assert.equal(codeOf(() => start(p, { run: '../evil' })), 2);
  assert.equal(codeOf(() => start(p, { run: 'a/b' })), 2);
  for (const maxIterations of [0, 21, 1.5, -1]) assert.equal(codeOf(() => start(p, { maxIterations })), 2, String(maxIterations));
  assert.equal(codeOf(() => start(p, { skills: ['bad name!'] })), 2);
  assert.equal(codeOf(() => start(p, { skills: ['no-such-skill-anywhere'] })), 2);
  assert.equal(fs.existsSync(path.join(p.dir, 'production_artifacts')), false, 'a refused start leaves no run behind');
  fs.mkdirSync(path.join(p.dir, '.agents'));
  fs.writeFileSync(path.join(p.dir, '.agents', 'nodes.json'), '{ nope');
  assert.equal(codeOf(() => start(p)), 2);
  fs.writeFileSync(path.join(p.dir, '.agents', 'nodes.json'), JSON.stringify({ nodes: { architect: {} } }));
  assert.match((() => { try { start(p); } catch (e) { return e.message; } })(), /lacks required node id/);
}));

test('an installed skill can be required; the Architect and build briefs make it a hard requirement', withProject((p) => {
  fs.mkdirSync(path.join(p.home, '.agents', 'skills', 'my-skill'), { recursive: true });
  fs.writeFileSync(path.join(p.home, '.agents', 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\n');
  const res = start(p, { skills: ['my-skill', 'my-skill'] });
  assert.deepEqual(stateOf(p).mandatory_skills, ['my-skill']);
  assert.match(fs.readFileSync(res.out.next.step.brief, 'utf8'), /required these skills for this run: my-skill\. This is a hard requirement/);
  const { trace } = play(p);
  assert.ok(trace.includes('0-ui_ux-1'));
  assert.match(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'briefs', '0-ui_ux-1.md'), 'utf8'), /hard requirement/);
  assert.match(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'briefs', '0-reviewer-1.md'), 'utf8'), /contract misread/);
  assert.match(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'briefs', '0-techlead-1.md'), 'utf8'), /Reject the plan if it does not account for them/);
}));

test('validateSkills names near-misses', withProject((p) => {
  fs.mkdirSync(path.join(p.home, '.claude', 'skills', 'senior-frontend'), { recursive: true });
  fs.writeFileSync(path.join(p.home, '.claude', 'skills', 'senior-frontend', 'SKILL.md'), 'x');
  assert.throws(() => validateSkills(['frontend'], { root: p.dir, home: p.home }), /Did you mean: senior-frontend/);
  validateSkills(['senior-frontend'], { root: p.dir, home: p.home });
}));

test('without --run the id comes from the goal', withProject((p) => {
  const a = startRun({ root: p.dir, home: p.home, goal: GOAL });
  assert.match(a.out.run, /^run-[0-9a-f]{10}$/);
  assert.equal(startRun({ root: p.dir, home: p.home, goal: GOAL }).out.run, a.out.run);
  assert.notEqual(startRun({ root: p.dir, home: p.home, goal: 'another goal' }).out.run, a.out.run);
}));

test('next hands out the same step again and never changes the run', withProject((p) => {
  start(p);
  const file = path.join(p.dir, 'production_artifacts', 'runs', 'r', 'events.jsonl');
  const before = fs.readFileSync(file, 'utf8');
  const a = next(p);
  const b = next(p);
  assert.equal(a.code, 0);
  assert.deepEqual(a.out, b.out);
  assert.equal(a.out.kind, 'step');
  assert.equal(a.out.step.step_id, '0-architect-1');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(codeOf(() => nextView({ root: p.dir, run: 'nope' })), EXIT_CODES.NOT_FOUND);
}));

test('scenario 1, happy path: seven reports end in ready_to_ship, the mirror follows every step', withProject((p) => {
  start(p);
  const { view, trace } = play(p);
  assert.deepEqual(trace, ['0-architect-1', '0-techlead-1', '0-human-1', '0-ui_ux-1', '0-engineering-1', '0-reviewer-1', '0-shipping-1']);
  assert.equal(view.kind, 'ready_to_ship');
  assert.equal(events(p).length, 8);
  assert.equal(events(p).at(-1).state.phase, 'ready_to_ship');
  const terminal = next(p);
  assert.equal(terminal.code, EXIT_CODES.TERMINAL_PHASE);
  assert.equal(terminal.out.kind, 'ready_to_ship');
  assert.equal(stateOf(p).phase, 'ready_to_ship');
  assert.equal(stateOf(p).gate.lint, 'pass');
  assert.equal(stateOf(p).needs_human, false);
}));

test('briefs: the Reviewer gets no goal, the human step names the plan canvas, build steps carry their round', withProject((p) => {
  start(p);
  const steps = {};
  play(p, 'ok', { stop: (s) => { steps[s.node] = s; return false; } });
  const brief = (id) => fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'briefs', `${id}.md`), 'utf8');
  assert.ok(!brief('0-reviewer-1').includes(GOAL), 'Reviewer brief must not carry the goal');
  assert.ok(!brief('0-techlead-1').includes(GOAL));
  assert.ok(brief('0-architect-1').includes(GOAL));
  assert.match(brief('0-reviewer-1'), /Do NOT validate\. Do NOT summarize\./);
  assert.match(brief('0-reviewer-1'), /"ui_ux", "engineering", "media_eventtech"/);
  assert.match(brief('0-human-1'), /aos-plan-canvas open production_artifacts\/plan\/plan\.mdx --await/);
  assert.equal(steps.human.scope, 'none');
  assert.deepEqual(steps.human.allowed_writes, []);
  assert.equal(steps.human.plan, 'production_artifacts/plan/plan.mdx');
  assert.equal(fs.existsSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'steps', '0-human-1.baseline.json')), false);
  assert.deepEqual(steps.ui_ux.round, { remaining: ['engineering'], reason: 'build' });
  assert.equal(steps.ui_ux.timeout_s, 3600);
  assert.deepEqual(steps.ui_ux.allowed_writes, ['**']);
  assert.equal(steps.techlead.timeout_s, 600);
  assert.deepEqual(steps.techlead.allowed_writes, []);
  assert.match(brief('0-shipping-1'), /lint, typecheck, tests, a11y, seo, security/);
}));

test('report: the same report twice is a no-op, another one for the accepted step is a conflict (4)', withProject((p) => {
  start(p);
  const step = next(p).out.step;
  const first = accept(p, step);
  const n = events(p).length;
  const again = accept(p, step);
  assert.deepEqual(again.out, first.out);
  assert.equal(events(p).length, n, 'no second event');
  const other = reportFor(step, p.dir);
  other.findings = [{ id: 'extra', severity: 'advisory', node: 'architect', status: 'open', summary: 'x' }];
  const file = path.join(p.base, 'other.json');
  fs.writeFileSync(file, JSON.stringify(other));
  assert.equal(codeOf(() => acceptReport({ root: p.dir, home: p.home, run: 'r', step: step.step_id, file })), EXIT_CODES.CONFLICT);
  // the same content in another key order has the same digest
  const reordered = Object.fromEntries(Object.entries(reportFor(step, p.dir)).reverse());
  fs.writeFileSync(file, JSON.stringify(reordered));
  assert.equal(acceptReport({ root: p.dir, home: p.home, run: 'r', step: step.step_id, file }).code, 0);
}));

test('report: bad input is exit 2, an unknown or stale step is exit 3', withProject((p) => {
  start(p);
  const step = next(p).out.step;
  const good = reportFor(step, p.dir);
  const send = (obj, stepId = step.step_id) => {
    const file = path.join(p.base, 'x.json');
    fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
    return () => acceptReport({ root: p.dir, home: p.home, run: 'r', step: stepId, file });
  };
  assert.equal(codeOf(send('{ not json')), 2);
  assert.equal(codeOf(send({ ...good, status: 'maybe' })), 2);
  assert.equal(codeOf(send({ ...good, schema: 'aos.fabric.report/2' })), 2);
  assert.equal(codeOf(send({ ...good, step_id: '0-engineering-1' })), 2, 'step_id inside the report must match --step');
  assert.equal(codeOf(() => acceptReport({ root: p.dir, home: p.home, run: 'r', step: step.step_id, file: path.join(p.base, 'missing.json') })), 2);
  assert.equal(codeOf(() => acceptReport({ root: p.dir, home: p.home, run: 'r', step: step.step_id })), 2);
  assert.equal(codeOf(send(good, '0-techlead-1')), EXIT_CODES.NOT_FOUND, 'a step that is not open');
  assert.equal(codeOf(() => acceptReport({ root: p.dir, home: p.home, run: 'ghost', step: 'x', file: 'y' })), EXIT_CODES.NOT_FOUND);
  assert.equal(events(p).length, 1, 'refused reports write nothing');
}));

test('report: an ok report that does not hold up is recorded as a failed step and retried', withProject((p) => {
  start(p);
  const step = next(p).out.step;
  const res = accept(p, step, 'ok', { artifacts: { plan: 'production_artifacts/plan/missing.mdx' } });
  assert.equal(res.out.step.step_id, '0-architect-2');
  assert.equal(res.out.step.attempt, 2);
  const ev = events(p).at(-1);
  assert.equal(ev.effective_status, 'fail');
  assert.equal(ev.verification[0].id, 'artifact-missing');
  assert.equal(ev.report.status, 'ok', 'the submitted report stays in the log as it was');
  assert.match(fs.readFileSync(res.out.step.brief, 'utf8'), /previous attempt gave no usable result: artifacts\.plan does not exist/);
  assert.equal(stateOf(p).attempts['0-architect'], 1);
  assert.deepEqual(stateOf(p).findings, [], 'verification findings are not state findings');
}));

test('report: a change outside allowed_writes is a failed step, and a retry cannot hide it', withProject((p) => {
  start(p);
  const { view } = play(p, 'scope');
  assert.equal(view.kind, 'escalated');
  assert.match(view.reason, /architect gave no usable result in 2 attempts: .*src\/evil\.txt changed outside allowed_writes/);
  const accepted = events(p).filter((e) => e.kind === 'report_accepted');
  assert.deepEqual(accepted.map((e) => e.effective_status), ['fail', 'fail']);
  assert.equal(accepted[0].verification[0].id, 'scope');
  assert.equal(accepted[1].verification[0].id, 'scope', 'attempt 2 keeps the baseline of attempt 1');
}));

test('report --fail records a failed step without a report file; two of them escalate', withProject((p) => {
  start(p);
  const a = acceptReport({ root: p.dir, home: p.home, run: 'r', step: '0-architect-1', fail: 'the worker crashed' });
  assert.equal(a.out.step.step_id, '0-architect-2');
  assert.equal(events(p).at(-1).report.executor.name, 'driver');
  assert.equal(acceptReport({ root: p.dir, home: p.home, run: 'r', step: '0-architect-1', fail: 'the worker crashed' }).code, 0, 'same reason: no-op');
  assert.equal(codeOf(() => acceptReport({ root: p.dir, home: p.home, run: 'r', step: '0-architect-1', fail: 'another reason' })), EXIT_CODES.CONFLICT);
  const b = acceptReport({ root: p.dir, home: p.home, run: 'r', step: '0-architect-2', fail: 'crashed again' });
  assert.equal(b.out.kind, 'escalated');
  assert.equal(codeOf(() => acceptReport({ root: p.dir, home: p.home, run: 'r', step: '0-architect-3', fail: 'late' })), EXIT_CODES.TERMINAL_PHASE);
  assert.equal(codeOf(() => acceptReport({ root: p.dir, home: p.home, run: 'r', step: 'zzz', fail: 'x' })), EXIT_CODES.TERMINAL_PHASE, 'terminal wins over unknown');
}));

test('scenario 2, TechLead rejects once: Architect gets the reason in its next brief', withProject((p) => {
  start(p);
  const { view, trace } = play(p, 'reject');
  assert.equal(view.kind, 'ready_to_ship');
  assert.deepEqual(trace.slice(0, 4), ['0-architect-1', '0-techlead-1', '1-architect-1', '1-techlead-1']);
  const brief = fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'briefs', '1-architect-1.md'), 'utf8');
  assert.match(brief, /The previous plan was rejected\. Address each point:\n- \[plan-1\] \(architect\) no capability map/);
  assert.equal(stateOf(p).iteration, 1);
}));

test('scenario 3, Reviewer repair: the owner gets the finding in its brief; findings are state-schema shaped', withProject((p) => {
  start(p);
  const { view, trace } = play(p, 'repair');
  assert.equal(view.kind, 'ready_to_ship');
  assert.deepEqual(trace.slice(5), ['0-reviewer-1', '1-engineering-1', '1-reviewer-1', '1-shipping-1']);
  const brief = fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'briefs', '1-engineering-1.md'), 'utf8');
  assert.match(brief, /Address these open Reviewer findings before anything else:\n- \[f1\] \(engineering\) problem/);
  assert.match(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'briefs', '1-reviewer-1.md'), 'utf8'), /Previous review:\n- \[f1\]/);
}));

test('scenario 4, loop brake: the same blocking id after a repair round escalates with a reason', withProject((p) => {
  start(p);
  const { view } = play(p, 'noprogress');
  assert.equal(view.kind, 'escalated');
  assert.match(view.reason, /No progress/);
  const t = next(p);
  assert.equal(t.code, EXIT_CODES.TERMINAL_PHASE);
  assert.equal(t.out.needs_human, true);
  assert.deepEqual(stateOf(p).last_blocking_ids, ['f1']);
}));

test('scenario 5, gate repair: Shipping runs again after the owner fixed it', withProject((p) => {
  start(p);
  const { view, trace } = play(p, 'gate');
  assert.equal(view.kind, 'ready_to_ship');
  assert.deepEqual(trace.slice(-3), ['0-shipping-1', '1-engineering-1', '1-shipping-1']);
  assert.match(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'briefs', '1-engineering-1.md'), 'utf8'), /Shipping's quality gate failed on a check you own/);
}));

test('scenario 7, a small --max-iterations escalates at the ceiling', withProject((p) => {
  start(p, { maxIterations: 1 });
  const { view } = play(p, 'repair');
  assert.equal(view.kind, 'escalated');
  assert.match(view.reason, /iteration limit of 1/);
}));

test('the Architect can add the optional media node to the build round', withProject((p) => {
  start(p);
  const { trace } = (() => {
    const t = [];
    for (;;) {
      const v = next(p).out;
      if (v.kind !== 'step') return { trace: t };
      t.push(v.step.step_id);
      accept(p, v.step, 'ok', v.step.node === 'architect' ? { optional_nodes: ['media_eventtech'] } : {});
    }
  })();
  assert.deepEqual(trace.slice(3, 6), ['0-ui_ux-1', '0-engineering-1', '0-media_eventtech-1']);
  assert.equal(stateOf(p).roles.media_eventtech, true);
  assert.equal(stateOf(p).artifacts.media, 'production_artifacts/03_media_pipeline.md');
}));

test('scenario 9, cancel: phase cancelled, a second cancel is a no-op, later reports are exit 6', withProject((p) => {
  start(p);
  const c = cancelRun({ root: p.dir, run: 'r', reason: 'not needed' });
  assert.deepEqual(c.out, { schema: 'aos.fabric.response/1', run: 'r', phase: 'cancelled' });
  assert.equal(stateOf(p).phase, 'cancelled');
  assertStateShape(stateOf(p));
  const n = events(p).length;
  assert.equal(cancelRun({ root: p.dir, run: 'r' }).code, 0);
  assert.equal(events(p).length, n);
  const t = next(p);
  assert.equal(t.code, EXIT_CODES.TERMINAL_PHASE);
  assert.equal(t.out.kind, 'cancelled');
  assert.equal(t.out.reason, 'not needed');
  assert.equal(codeOf(() => acceptReport({ root: p.dir, home: p.home, run: 'r', step: '0-architect-1', fail: 'x' })), EXIT_CODES.TERMINAL_PHASE);
  assert.equal(codeOf(() => cancelRun({ root: p.dir, run: 'ghost' })), EXIT_CODES.NOT_FOUND);
}));

test('cancel refuses a run that already ended another way (6)', withProject((p) => {
  start(p);
  play(p);
  assert.equal(codeOf(() => cancelRun({ root: p.dir, run: 'r' })), EXIT_CODES.TERMINAL_PHASE);
}));

test('status: phase, iteration, open findings, open step, last step, lock, stale projection', withProject((p) => {
  start(p);
  accept(p, next(p).out.step);
  let s = statusView({ root: p.dir, run: 'r' }).out;
  assert.equal(s.phase, 'plan');
  assert.equal(s.iteration, 0);
  assert.equal(s.max_iterations, 3);
  assert.equal(s.open_step, '0-techlead-1');
  assert.equal(s.last_step.step_id, '0-architect-1');
  assert.equal(s.last_step.status, 'ok');
  assert.deepEqual(s.open_findings, []);
  assert.equal(s.lock, null);
  assert.equal(s.projection_stale, false);
  fs.rmSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'state.json'));
  assert.equal(statusView({ root: p.dir, run: 'r' }).out.projection_stale, true, 'the log wins over a missing projection');
  const held = createStore('r', { root: p.dir }).lock();
  s = statusView({ root: p.dir, run: 'r' }).out;
  assert.equal(s.lock.held, true);
  assert.equal(s.lock.pid, process.pid);
  held.release();
  assert.equal(codeOf(() => statusView({ root: p.dir, run: 'ghost' })), EXIT_CODES.NOT_FOUND);
}));

test('a lost projection is rebuilt by the next writer', withProject((p) => {
  start(p);
  fs.rmSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'state.json'));
  fs.rmSync(path.join(p.dir, 'production_artifacts', 'state.json'));
  assert.equal(next(p).out.step.step_id, '0-architect-1', 'next reads the log, not the projection');
  accept(p, next(p).out.step);
  assert.equal(statusView({ root: p.dir, run: 'r' }).out.projection_stale, false);
  assert.equal(stateOf(p).phase, 'plan');
}));

test('writers refuse with exit 5 while another process holds the lock', withProject((p) => {
  start(p);
  const held = createStore('r', { root: p.dir }).lock();
  assert.equal(codeOf(() => acceptReport({ root: p.dir, home: p.home, run: 'r', step: '0-architect-1', fail: 'x' })), EXIT_CODES.LOCK_BUSY);
  assert.equal(codeOf(() => cancelRun({ root: p.dir, run: 'r' })), EXIT_CODES.LOCK_BUSY);
  assert.equal(codeOf(() => start(p)), EXIT_CODES.LOCK_BUSY);
  assert.equal(next(p).code, 0, 'readers do not take the lock');
  held.release();
  assert.equal(cancelRun({ root: p.dir, run: 'r' }).code, 0);
}));

test('a corrupt log is exit 7 for every command, a torn last line is not', withProject((p) => {
  start(p);
  const file = path.join(p.dir, 'production_artifacts', 'runs', 'r', 'events.jsonl');
  fs.appendFileSync(file, '{"kind":"report_accepted","step');
  assert.equal(next(p).out.step.step_id, '0-architect-1', 'a torn tail is dropped');
  accept(p, next(p).out.step);
  assert.equal(next(p).out.step.step_id, '0-techlead-1', 'the next write repaired the tail');
  fs.appendFileSync(file, 'garbage\n{"kind":"note"}\n');
  for (const fn of [() => next(p), () => statusView({ root: p.dir, run: 'r' }), () => cancelRun({ root: p.dir, run: 'r' })]) assert.equal(codeOf(fn), EXIT_CODES.CORRUPTED_STATE);
}));

test('a missing step file is corruption, not a crash', withProject((p) => {
  start(p);
  fs.rmSync(path.join(p.dir, 'production_artifacts', 'runs', 'r', 'steps', '0-architect-1.json'));
  assert.equal(codeOf(() => next(p)), EXIT_CODES.CORRUPTED_STATE);
}));

test('noteRun adds a note and leaves the state alone', withProject((p) => {
  start(p);
  const before = stateOf(p);
  noteRun({ root: p.dir, run: 'r', text: 'AO was requested but absent' });
  assert.equal(events(p).at(-1).kind, 'note');
  assert.equal(events(p).at(-1).text, 'AO was requested but absent');
  assert.deepEqual(stateOf(p), before);
  assert.equal(next(p).out.step.step_id, '0-architect-1');
  assert.equal(codeOf(() => noteRun({ root: p.dir, run: 'ghost', text: 'x' })), EXIT_CODES.NOT_FOUND);
}));

test('model hints come from pipeline.json and are only hints', withProject((p) => {
  fs.mkdirSync(path.join(p.dir, '.aos'));
  fs.writeFileSync(path.join(p.dir, '.aos', 'pipeline.json'), JSON.stringify({
    version: 1,
    pipeline: { architect: { harness: 'antigravity', models: { antigravity: 'pro', claude: 'opus' }, model: 'legacy' }, godmode_ui_ux: { model: 'sonnet' } },
  }));
  const step = start(p).out.next.step;
  assert.deepEqual(step.model_hint, { harness: 'agy', model: 'legacy', models: { antigravity: 'pro', claude: 'opus' } });
  const { trace } = play(p, 'ok', { stop: (s) => s.node === 'ui_ux' });
  assert.ok(trace.length > 0);
  assert.deepEqual(next(p).out.step.model_hint, { model: 'sonnet' });
  assert.deepEqual(modelHint(null, 'architect', { agentType: 'architect' }), {});
  assert.deepEqual(modelHint({ x: {} }, 'architect', { agentType: 'architect' }), {});
}));

test('loadRegistry prefers the project copy, then ~/.agents, then the package', withProject((p) => {
  assert.match(loadRegistry({ root: p.dir, home: p.home }).file, /\.agents[\\/]nodes\.json$/);
  assert.ok(loadRegistry({ root: p.dir, home: p.home }).file.startsWith(ROOT), 'package copy');
  fs.mkdirSync(path.join(p.home, '.agents'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.agents', 'nodes.json'), path.join(p.home, '.agents', 'nodes.json'));
  assert.ok(loadRegistry({ root: p.dir, home: p.home }).file.startsWith(p.home));
  fs.mkdirSync(path.join(p.dir, '.agents'));
  fs.copyFileSync(path.join(ROOT, '.agents', 'nodes.json'), path.join(p.dir, '.agents', 'nodes.json'));
  assert.ok(loadRegistry({ root: p.dir, home: p.home }).file.startsWith(p.dir));
}));

test('a work tree that is no git repository still runs; the event says the scope was not checked', withProject((p) => {
  start(p);
  accept(p, next(p).out.step);
  assert.match(events(p).at(-1).notes[0], /scope not checked/);
  assert.equal(next(p).out.step.step_id, '0-techlead-1');
}, { git: false }));
