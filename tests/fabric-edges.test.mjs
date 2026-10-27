// decide() is a pure function: one table row per edge of .agents/graph.md, then the dispatcher scenarios played through it.
// Scenarios 6 (missing goal) and 9 (cancel) need the CLI and are in fabric-engine.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, firstNext, HUMAN_NODE, initialState, kindOf, MAX_ATTEMPTS_DEFAULT, MAX_ITERATIONS_DEFAULT, REQUIRED_NODE_IDS } from '../lib/fabric/edges.mjs';
import { NODES } from './fixtures/fabric-helpers.mjs';

const S = (over = {}) => ({ ...initialState({ run_id: 'r', goal: 'g' }), ...over });
const step = (node, over = {}) => ({ step_id: `0-${node}-1`, node, kind: kindOf(node, NODES), ...over });
const R = (over = {}) => ({ schema: 'aos.fabric.report/1', step_id: 'x', status: 'ok', exit_code: 0, findings: [], artifacts: {}, files_changed: [], needs_human: false, executor: {}, ...over });
const F = (id, node, over = {}) => ({ id, severity: 'blocking', node, status: 'open', summary: 's', ...over });
const GATE = { lint: 'pass', typecheck: 'pass', tests: 'pass', a11y: 'pass', seo: 'skip', security: 'pass' };
const run = (state, st, report) => decide(state, st, report, { nodes: NODES });

// Every key of `want` must equal the same key of `got`, recursively (arrays element by element, with the same length).
function covers(got, want, at = '') {
  if (Array.isArray(want)) {
    assert.ok(Array.isArray(got), `${at}: expected an array, got ${JSON.stringify(got)}`);
    assert.equal(got.length, want.length, `${at}: length`);
    want.forEach((w, i) => covers(got[i], w, `${at}[${i}]`));
  } else if (want !== null && typeof want === 'object') {
    assert.ok(got !== null && typeof got === 'object', `${at}: expected an object, got ${JSON.stringify(got)}`);
    for (const [k, v] of Object.entries(want)) covers(got[k], v, `${at}.${k}`);
  } else assert.deepEqual(got, want, at);
}

const ROUND = (remaining, reason) => ({ remaining, reason });
const ROWS = [
  ['Architect -> TechLead', S(), step('architect'), R({ artifacts: { plan: 'p.md' } }),
    { next: { kind: 'step', node: 'techlead', attempt: 1 }, state: { phase: 'plan', iteration: 0, artifacts: { plan: 'p.md' } } }],
  ['Architect without a plan path is a retry', S(), step('architect'), R(),
    { next: { kind: 'step', node: 'architect', attempt: 2, reason: 'retry' }, state: { attempts: { '0-architect': 1 }, phase: 'define' } }],
  ['Architect asks for the optional media node', S(), step('architect'), R({ artifacts: { plan: 'p' }, optional_nodes: ['media_eventtech'] }),
    { state: { roles: { media_eventtech: true } } }],
  ['Architect cannot switch on a node that is not optional', S(), step('architect'), R({ artifacts: { plan: 'p' }, optional_nodes: ['ui_ux', 'ghost'] }),
    { state: { phase: 'plan' } }],
  ['TechLead approves -> human verdict', S({ phase: 'plan', artifacts: { plan: 'p' } }), step('techlead'), R(),
    { next: { kind: 'step', node: HUMAN_NODE, attempt: 1 }, state: { phase: 'plan', iteration: 0 } }],
  ['TechLead rejects -> Architect again, iteration + 1', S({ phase: 'plan' }), step('techlead'), R({ findings: [F('plan-1', 'engineering', { summary: 'no capability map' })] }),
    { next: { kind: 'step', node: 'architect', attempt: 1 }, state: { phase: 'define', iteration: 1, findings: [{ id: 'plan-1', node: 'architect', status: 'open', summary: 'no capability map' }] } }],
  ['TechLead approves a revised plan: its earlier objections are closed', S({ iteration: 1, findings: [F('plan-1', 'architect')] }), step('techlead', { step_id: '1-techlead-1' }), R(),
    { next: { node: HUMAN_NODE }, state: { findings: [{ id: 'plan-1', status: 'fixed' }] } }],
  ['TechLead rejection at the last iteration escalates', S({ iteration: 2 }), step('techlead'), R({ findings: [F('plan-1', 'architect')] }),
    { next: { kind: 'escalated' }, state: { phase: 'escalated', needs_human: true, iteration: 3 }, reason: /iteration limit of 3/ }],
  ['Human approves -> first build node, media stays out', S({ phase: 'plan' }), step(HUMAN_NODE), R(),
    { next: { kind: 'step', node: 'ui_ux', round: ROUND(['engineering'], 'build') }, state: { phase: 'build' } }],
  ['Human approves a plan that needs media', S({ roles: { media_eventtech: true } }), step(HUMAN_NODE), R(),
    { next: { node: 'ui_ux', round: ROUND(['engineering', 'media_eventtech'], 'build') } }],
  ['Human requests changes -> Architect, iteration + 1', S({ phase: 'plan' }), step(HUMAN_NODE), R({ status: 'fail', findings: [F('human-0-human-1', 'architect', { summary: 'rename it' })] }),
    { next: { node: 'architect', attempt: 1 }, state: { phase: 'define', iteration: 1, findings: [{ id: 'human-0-human-1', summary: 'rename it' }] } }],
  ['Human requests changes without a text', S(), step(HUMAN_NODE), R({ status: 'fail' }),
    { next: { node: 'architect' }, state: { iteration: 1, findings: [{ id: 'human-0-human-1', node: 'architect', severity: 'blocking', status: 'open' }] } }],
  ['Human gives no verdict (session ended, timeout) -> escalated', S(), step(HUMAN_NODE), R({ status: 'escalate', findings: [F('human-0-human-1', 'architect', { summary: 'canvas ended' })] }),
    { next: { kind: 'escalated' }, reason: 'canvas ended' }],
  ['Build node in the middle of a round -> next build node', S({ phase: 'build' }), step('ui_ux', { round: ROUND(['engineering'], 'build') }), R({ artifacts: { frontend: 'f.md' } }),
    { next: { node: 'engineering', round: ROUND([], 'build') }, state: { artifacts: { frontend: 'f.md' } } }],
  ['Last build node -> Reviewer', S({ phase: 'build' }), step('engineering', { round: ROUND([], 'build') }), R({ artifacts: { backend: 'b.md' } }),
    { next: { node: 'reviewer', attempt: 1 }, state: { phase: 'review', artifacts: { backend: 'b.md' } } }],
  ['Last node of a repair round -> Reviewer again', S({ phase: 'build', iteration: 1 }), step('engineering', { step_id: '1-engineering-1', round: ROUND([], 'repair') }), R(),
    { next: { node: 'reviewer' }, state: { phase: 'review' } }],
  ['Last node of a gate-fix round -> Shipping, not Reviewer', S({ phase: 'build', iteration: 1 }), step('engineering', { step_id: '1-engineering-1', round: ROUND([], 'gate-fix') }), R(),
    { next: { node: 'shipping' }, state: { phase: 'verify' } }],
  ['A build node flips its finding to fixed', S({ findings: [F('f1', 'engineering')] }), step('engineering', { round: ROUND([], 'repair') }), R({ findings: [F('f1', 'engineering', { status: 'fixed' })] }),
    { state: { findings: [{ id: 'f1', status: 'fixed' }] } }],
  ['Reviewer clean -> Shipping', S({ phase: 'review', last_blocking_ids: ['old'] }), step('reviewer'), R(),
    { next: { node: 'shipping' }, state: { phase: 'verify', last_blocking_ids: [] } }],
  ['Reviewer with advisory findings only -> Shipping', S({ phase: 'review' }), step('reviewer'), R({ findings: [F('a1', 'engineering', { severity: 'advisory' })] }),
    { next: { node: 'shipping' }, state: { findings: [{ id: 'a1', severity: 'advisory' }] } }],
  ['Reviewer blocking, new ids -> owners repair in registry order, iteration + 1', S({ phase: 'review' }), step('reviewer'), R({ findings: [F('f1', 'engineering'), F('f2', 'ui_ux')] }),
    { next: { node: 'ui_ux', round: ROUND(['engineering'], 'repair') }, state: { phase: 'build', iteration: 1, last_blocking_ids: ['f1', 'f2'] } }],
  ['Reviewer blocking, one owner -> only that node runs', S({ phase: 'review' }), step('reviewer'), R({ findings: [F('f1', 'engineering')] }),
    { next: { node: 'engineering', round: ROUND([], 'repair') } }],
  ['Loop brake: the same blocking ids after a repair round -> escalated', S({ iteration: 1, last_blocking_ids: ['f1'] }), step('reviewer', { step_id: '1-reviewer-1' }), R({ findings: [F('f1', 'engineering')] }),
    { next: { kind: 'escalated' }, state: { phase: 'escalated', needs_human: true }, reason: /No progress/ }],
  ['Loop brake ignores the order of the ids', S({ iteration: 1, last_blocking_ids: ['f2', 'f1'] }), step('reviewer'), R({ findings: [F('f1', 'engineering'), F('f2', 'ui_ux')] }),
    { next: { kind: 'escalated' }, reason: /No progress/ }],
  ['Loop brake: the first review (iteration 0) never trips it', S({ iteration: 0, last_blocking_ids: ['f1'] }), step('reviewer'), R({ findings: [F('f1', 'engineering')] }),
    { next: { kind: 'step', node: 'engineering' }, state: { iteration: 1 } }],
  ['A partly different id set is progress', S({ iteration: 1, last_blocking_ids: ['f1'] }), step('reviewer'), R({ findings: [F('f1', 'engineering'), F('f3', 'engineering')] }),
    { next: { kind: 'step', node: 'engineering' }, state: { iteration: 2, last_blocking_ids: ['f1', 'f3'] } }],
  ['Reviewer finding owned by an unknown node -> escalated', S(), step('reviewer'), R({ findings: [F('f1', 'ghost')] }),
    { next: { kind: 'escalated' }, reason: /none is owned by a build node/ }],
  ['Reviewer repair at the iteration limit -> escalated', S({ iteration: 2, max_iterations: 3, last_blocking_ids: ['x'] }), step('reviewer', { step_id: '2-reviewer-1' }), R({ findings: [F('f9', 'engineering')] }),
    { next: { kind: 'escalated' }, state: { iteration: 3 }, reason: /iteration limit of 3/ }],
  ['A review replaces the finding list', S({ findings: [F('old', 'engineering')] }), step('reviewer'), R(),
    { state: { findings: [] } }],
  ['Shipping all pass or skip -> ready_to_ship', S({ phase: 'verify' }), step('shipping'), R({ gate: GATE }),
    { next: { kind: 'ready_to_ship' }, state: { phase: 'ready_to_ship', gate: { seo: 'skip', tests: 'pass' } } }],
  ['Shipping gate fails -> owners fix, then Shipping again', S({ phase: 'verify' }), step('shipping'), R({ gate: { ...GATE, tests: 'fail' }, findings: [F('gate-tests', 'engineering')] }),
    { next: { node: 'engineering', round: ROUND([], 'gate-fix') }, state: { phase: 'build', iteration: 1, gate: { tests: 'fail' } } }],
  ['Shipping gate fails with no owning node -> escalated', S(), step('shipping'), R({ gate: { ...GATE, lint: 'fail' } }),
    { next: { kind: 'escalated' }, reason: /named no owning build node/ }],
  ['Shipping gate fails at the iteration limit -> escalated', S({ iteration: 2 }), step('shipping', { step_id: '2-shipping-1' }), R({ gate: { ...GATE, lint: 'fail' }, findings: [F('gate-lint', 'ui_ux')] }),
    { next: { kind: 'escalated' }, state: { iteration: 3 }, reason: /iteration limit/ }],
  ['Shipping without gate results is a retry', S(), step('shipping'), R(),
    { next: { node: 'shipping', attempt: 2, reason: 'retry' } }],
  ['A failed step is retried in the same round', S({ phase: 'build' }), step('ui_ux', { round: ROUND(['engineering'], 'build') }), R({ status: 'fail', findings: [F('x', 'ui_ux', { summary: 'crashed' })] }),
    { next: { node: 'ui_ux', attempt: 2, reason: 'retry', round: ROUND(['engineering'], 'build') }, state: { attempts: { '0-ui_ux': 1 }, findings: [] } }],
  ['A second failure of the same step -> escalated', S({ attempts: { '0-ui_ux': 1 } }), step('ui_ux', { step_id: '0-ui_ux-2' }), R({ status: 'fail' }),
    { next: { kind: 'escalated' }, state: { phase: 'escalated', needs_human: true }, reason: /ui_ux gave no usable result in 2 attempts/ }],
  ['Status escalate -> escalated with the finding as reason', S(), step('engineering', { round: ROUND([], 'build') }), R({ status: 'escalate', findings: [F('x', 'engineering', { summary: 'need a decision' })] }),
    { next: { kind: 'escalated' }, reason: 'need a decision' }],
  ['needs_human on an ok report -> escalated', S(), step('engineering', { round: ROUND([], 'build') }), R({ needs_human: true }),
    { next: { kind: 'escalated' }, state: { needs_human: true } }],
  ['Attempt counters start fresh in a new iteration', S({ iteration: 1, attempts: { '0-engineering': 2 } }), step('engineering', { step_id: '1-engineering-1', round: ROUND([], 'repair') }), R({ status: 'fail' }),
    { next: { node: 'engineering', attempt: 2, reason: 'retry' }, state: { attempts: { '0-engineering': 2, '1-engineering': 1 } } }],
  ['An unknown step kind -> escalated', S(), { step_id: '0-x-1', node: 'x', kind: 'weird' }, R(),
    { next: { kind: 'escalated' }, reason: /unknown step kind/ }],
];

for (const [name, state, st, report, want] of ROWS) {
  test(`edge: ${name}`, () => {
    const res = run(state, st, report);
    if (want.next) covers(res.next, want.next, 'next');
    if (want.state) covers(res.state, want.state, 'state');
    if (want.reason instanceof RegExp) assert.match(res.reason, want.reason);
    else if (want.reason !== undefined) assert.equal(res.reason, want.reason);
  });
}

test('decide never changes its input', () => {
  const deep = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deep(v)); return Object.freeze(o); };
  const state = deep(S({ findings: [F('f1', 'engineering')], attempts: { '0-reviewer': 1 } }));
  const before = JSON.stringify(state);
  run(state, deep(step('reviewer')), deep(R({ findings: [F('f9', 'ui_ux')] })));
  assert.equal(JSON.stringify(state), before);
});

test('the registry gives every required node a kind; the human step has one too', () => {
  assert.deepEqual(REQUIRED_NODE_IDS.map((n) => kindOf(n, NODES)), ['plan', 'techlead', 'build', 'build', 'build', 'review', 'ship']);
  assert.equal(kindOf(HUMAN_NODE, NODES), 'human');
  assert.equal(kindOf('ghost', NODES), undefined);
  assert.equal(MAX_ITERATIONS_DEFAULT, 3);
  assert.equal(MAX_ATTEMPTS_DEFAULT, 2);
});

// ---- the dispatcher scenarios, played through decide() ----

const PLAN = { plan: 'production_artifacts/plan/plan.mdx' };
function happy(st) {
  if (st.node === 'architect') return R({ artifacts: PLAN });
  if (st.node === 'ui_ux') return R({ artifacts: { frontend: 'f.md' } });
  if (st.node === 'engineering') return R({ artifacts: { backend: 'b.md' } });
  if (st.node === 'shipping') return R({ gate: GATE });
  return R();
}
function play(answer, { max = 3 } = {}) {
  let state = initialState({ run_id: 'r', goal: 'g', max_iterations: max });
  let next = firstNext();
  let reason;
  const trace = [];
  for (let i = 0; i < 80 && next.kind === 'step'; i++) {
    const st = { step_id: `${state.iteration}-${next.node}-${next.attempt}`, node: next.node, kind: kindOf(next.node, NODES), ...(next.round && { round: next.round }) };
    trace.push(st.step_id);
    ({ state, next, reason } = run(state, st, answer(st, state)));
  }
  return { state, next, trace, reason };
}

test('scenario 1, happy path: seven steps, no repair, ready_to_ship', () => {
  const r = play(happy);
  assert.deepEqual(r.trace, ['0-architect-1', '0-techlead-1', '0-human-1', '0-ui_ux-1', '0-engineering-1', '0-reviewer-1', '0-shipping-1']);
  assert.equal(r.next.kind, 'ready_to_ship');
  assert.equal(r.state.iteration, 0);
  assert.equal(r.state.needs_human, false);
});

test('scenario 2, TechLead loop: one rejection sends Architect around once', () => {
  const r = play((st) => (st.node === 'techlead' && st.step_id.startsWith('0-') ? R({ findings: [F('plan-1', 'architect')] }) : happy(st)));
  assert.deepEqual(r.trace.slice(0, 5), ['0-architect-1', '0-techlead-1', '1-architect-1', '1-techlead-1', '1-human-1']);
  assert.equal(r.next.kind, 'ready_to_ship');
  assert.equal(r.state.iteration, 1);
});

test('scenario 3, Reviewer repair: only the owner of the finding runs again', () => {
  const r = play((st) => (st.node === 'reviewer' && st.step_id.startsWith('0-') ? R({ findings: [F('f1', 'engineering')] }) : happy(st)));
  assert.deepEqual(r.trace.slice(5), ['0-reviewer-1', '1-engineering-1', '1-reviewer-1', '1-shipping-1']);
  assert.equal(r.next.kind, 'ready_to_ship');
  assert.equal(r.state.iteration, 1);
});

test('scenario 4, loop brake: a repair that changes nothing stops the run after one round', () => {
  const r = play((st) => (st.node === 'reviewer' ? R({ findings: [F('f1', 'engineering')] }) : happy(st)));
  assert.equal(r.trace.at(-1), '1-reviewer-1');
  assert.equal(r.next.kind, 'escalated');
  assert.match(r.reason, /No progress/);
  assert.equal(r.state.iteration, 1);
});

test('scenario 5, gate repair: the failing check goes back to its owner, then Shipping runs again', () => {
  const r = play((st) => (st.node === 'shipping' && st.step_id.startsWith('0-')
    ? R({ gate: { ...GATE, tests: 'fail' }, findings: [F('gate-tests', 'engineering')] }) : happy(st)));
  assert.deepEqual(r.trace.slice(-3), ['0-shipping-1', '1-engineering-1', '1-shipping-1']);
  assert.equal(r.next.kind, 'ready_to_ship');
  assert.equal(r.state.gate.tests, 'pass');
});

test('scenario 7, escalation at the iteration ceiling: a TechLead who never approves', () => {
  const r = play((st) => (st.node === 'techlead' ? R({ findings: [F(`p${st.step_id}`, 'architect')] }) : happy(st)));
  assert.deepEqual(r.trace, ['0-architect-1', '0-techlead-1', '1-architect-1', '1-techlead-1', '2-architect-1', '2-techlead-1']);
  assert.equal(r.next.kind, 'escalated');
  assert.equal(r.state.iteration, 3);
  assert.equal(r.state.needs_human, true);
});

test('scenario 8, escalation by attempts: a node that keeps failing', () => {
  const r = play((st) => (st.node === 'architect' ? R({ status: 'fail' }) : happy(st)));
  assert.deepEqual(r.trace, ['0-architect-1', '0-architect-2']);
  assert.equal(r.next.kind, 'escalated');
  assert.equal(r.state.iteration, 0);
});

test('a smaller max_iterations escalates sooner', () => {
  const r = play((st) => (st.node === 'reviewer' && st.step_id.startsWith('0-') ? R({ findings: [F('f1', 'engineering')] }) : happy(st)), { max: 1 });
  assert.equal(r.next.kind, 'escalated');
  assert.match(r.reason, /iteration limit of 1/);
});
