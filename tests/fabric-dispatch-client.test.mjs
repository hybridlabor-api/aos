// .claude/workflows/fabric-dispatch.mjs with --engine=cli: a thin client of aos-fabric. Inside a workflow runtime (a real
// agent() global) it asks for a step, lets an agent do it and reports; anywhere else it hands the run to `drive`.
// The legacy engine is covered by the dispatch-*, profile-* and state-* tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLI, fakeEnv, ROOT, tmpProject, writeFakeExecutor } from './fixtures/fabric-helpers.mjs';

const DISPATCH = path.join(ROOT, '.claude', 'workflows', 'fabric-dispatch.mjs');
const HELPERS = pathToFileURL(path.join(ROOT, 'tests', 'fixtures', 'fabric-helpers.mjs')).href;
const withProject = (fn) => async () => { const p = tmpProject(); try { await fn(p); } finally { p.cleanup(); } };

// A workflow runtime in miniature: ambient args/agent/pipeline, then the dispatcher is imported and its result printed.
// Helper steps (label fabric-cli) run the real CLI, as the helper agent would; every other agent() call is a worker that
// reads the brief named in its prompt and writes the report (SCEN=missing: the first Architect attempt leaves none).
function workflow(p, goal, env = {}) {
  const file = path.join(p.base, 'workflow.mjs');
  fs.writeFileSync(file, `
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { answerBrief } from ${JSON.stringify(HELPERS)};
const labels = [];
const calls = [];
let skipped = false;
globalThis.args = { goal: ${JSON.stringify(goal)} };
globalThis.pipeline = (items, fn) => Promise.all(items.map(fn));
globalThis.agent = async (prompt, opts) => {
  labels.push(opts.label);
  calls.push({ label: opts.label, agentType: opts.agentType ?? null, model: opts.model ?? null, trail: opts.trail ?? null });
  if (opts.label === 'fabric-cli') {
    for (const [f, t] of Object.entries(opts.files || {})) { fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); fs.writeFileSync(path.resolve(f), t); }
    const r = spawnSync(process.execPath, [${JSON.stringify(CLI)}, ...opts.cliArgs], { encoding: 'utf8', cwd: process.cwd() });
    let json = null;
    try { json = JSON.parse(r.stdout.trim().split('\\n').at(-1)); } catch {}
    return { code: r.status, json, stderr: r.stderr.slice(-300) };
  }
  const brief = fs.readFileSync(/brief file (.+?) exactly as written/.exec(prompt)[1], 'utf8');
  if (process.env.SCEN === 'missing' && !skipped && opts.label === '0-architect-1') { skipped = true; return { done: true }; }
  answerBrief(brief, process.cwd(), process.env.SCEN === 'repair' ? 'repair' : 'ok');
  return { done: true };
};
const mod = await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});
process.stdout.write(JSON.stringify({ result: mod.default, labels, calls }));
`);
  const r = spawnSync(process.execPath, [file], { cwd: p.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...fakeEnv(p.home), ...env } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('workflow runtime: the client drives the run through next/report with an agent per step, no merge step, no state.d', withProject((p) => {
  const { result, labels } = workflow(p, '--engine=cli add a status page');
  assert.equal(result.phase, 'ready_to_ship');
  assert.match(result.run, /^fg-/);
  assert.match(result.reason, /Reply with the literal word GO/);
  assert.deepEqual(labels.filter((l) => l !== 'fabric-cli'), ['0-architect-1', '0-techlead-1', '0-human-1', '0-ui_ux-1', '0-engineering-1', '0-reviewer-1', '0-shipping-1']);
  assert.equal(labels[0], 'fabric-cli');
  assert.equal(labels.filter((l) => l === 'fabric-cli').length, 8, 'start and one report per step');
  assert.ok(!labels.some((l) => /^(load-registry|merge-|validate-|ensure-|archify-|escalate)/.test(l)), `legacy helper steps ran: ${labels}`);
  assert.equal(fs.existsSync(path.join(p.dir, 'production_artifacts', 'state.d')), false);
  const state = JSON.parse(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'state.json'), 'utf8'));
  assert.equal(state.phase, 'ready_to_ship');
  assert.equal(state.run_id, result.run);
  assert.equal(state.goal, 'add a status page', 'the --engine flag is not part of the goal');
}));

test('workflow runtime: workers are started as their agent type with a trail node; the human step has no agent type', withProject((p) => {
  const { calls } = workflow(p, '--engine=cli add a status page');
  const by = Object.fromEntries(calls.map((c) => [c.label, c]));
  assert.equal(by['0-architect-1'].agentType, 'architect');
  assert.equal(by['0-ui_ux-1'].agentType, 'godmode-ui-ux');
  assert.equal(by['0-engineering-1'].agentType, 'godmode-engineering');
  assert.equal(by['0-shipping-1'].agentType, 'godmode-shipping');
  assert.equal(by['0-human-1'].agentType, null);
  assert.equal(by['0-reviewer-1'].trail.node, 'reviewer');
  assert.equal(by['fabric-cli'].agentType, null, 'the helper step is a plain agent');
}));

test('workflow runtime: a worker that leaves no report is a failed step, the Architect is asked again', withProject((p) => {
  const { result, labels } = workflow(p, '--engine=cli add a status page', { SCEN: 'missing' });
  assert.equal(result.phase, 'ready_to_ship');
  assert.ok(labels.includes('0-architect-2'));
  const events = fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', result.run, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const first = events.find((e) => e.step_id === '0-architect-1');
  assert.equal(first.effective_status, 'fail');
  assert.equal(first.report.executor.name, 'driver');
}));

test('workflow runtime: --skill flags reach aos-fabric start and the goal text stays clean', withProject((p) => {
  fs.mkdirSync(path.join(p.home, '.agents', 'skills', 'my-skill'), { recursive: true });
  fs.writeFileSync(path.join(p.home, '.agents', 'skills', 'my-skill', 'SKILL.md'), 'x');
  const { result } = workflow(p, '--engine=cli --skill=my-skill add a status page');
  assert.equal(result.phase, 'ready_to_ship');
  const state = JSON.parse(fs.readFileSync(path.join(p.dir, 'production_artifacts', 'state.json'), 'utf8'));
  assert.deepEqual(state.mandatory_skills, ['my-skill']);
  assert.equal(state.goal, 'add a status page');
}));

test('workflow runtime: a start that aos-fabric refuses escalates with its message', withProject((p) => {
  const { result } = workflow(p, '--engine=cli --skill=no-such-skill add a status page');
  assert.equal(result.phase, 'escalated');
  assert.equal(result.needs_human, true);
  assert.match(result.reason, /aos-fabric start failed \(exit 2\)/);
}));

test('the cli engine says it does not know --plan, --profile and --workstreams instead of ignoring them', withProject((p) => {
  for (const flag of ['--profile=kicad', '--workstreams', '--plan=production_artifacts/plan/plan.mdx', '--plan production_artifacts/plan/plan.mdx']) {
    const { result, labels } = workflow(p, `--engine=cli ${flag} add a board`);
    assert.equal(result.phase, 'escalated', flag);
    assert.match(result.reason, /does not support --plan, --profile or --workstreams yet/);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(labels, [], 'nothing was started');
  }
}));

test('outside a workflow runtime the refusal makes the CLI exit 1, as a refused --plan does', withProject((p) => {
  const r = spawnSync(process.execPath, [DISPATCH, '--engine=cli', '--plan', 'x.md', 'add a thing'], {
    cwd: p.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, env: { ...process.env, ...fakeEnv(p.home) },
  });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).phase, 'escalated');
  assert.equal(fs.existsSync(path.join(p.dir, 'production_artifacts', 'runs')), false);
}));

test('an empty goal escalates before anything is started', withProject((p) => {
  const { result, labels } = workflow(p, '--engine=cli --skill=x');
  assert.equal(result.phase, 'escalated');
  assert.match(result.reason, /needs actual goal text/);
  assert.deepEqual(labels, []);
}));

function standalone(p, args, env) {
  const script = writeFakeExecutor(p.base);
  const r = spawnSync(process.execPath, [DISPATCH, ...args], {
    cwd: p.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 110000,
    env: { ...process.env, ...fakeEnv(p.home, { AOS_FABRIC_EXECUTOR: 'fake', AOS_FABRIC_FAKE_EXECUTOR: script }), ...env },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
}

test('outside a workflow runtime (hook or terminal) the client lets aos-fabric drive the run', withProject((p) => {
  const result = standalone(p, ['--engine=cli', 'add a status page']);
  assert.equal(result.phase, 'ready_to_ship');
  assert.match(result.run, /^fg-/);
  const events = fs.readFileSync(path.join(p.dir, 'production_artifacts', 'runs', result.run, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.kind === 'report_accepted').length, 7);
  assert.equal(events[0].config.executor, 'fake', 'AOS_FABRIC_EXECUTOR is handed to aos-fabric start');
}));

test('outside a workflow runtime: AOS_FABRIC_ENGINE=cli selects the engine, and an escalation is reported with its reason', withProject((p) => {
  const result = standalone(p, ['add a status page'], { AOS_FABRIC_ENGINE: 'cli', FAKE_SCEN: 'noprogress' });
  assert.equal(result.phase, 'escalated');
  assert.equal(result.needs_human, true);
  assert.match(result.reason, /No progress/);
}));

test('without the switch the legacy engine still runs: it answers --profile, and creates no run store', withProject((p) => {
  fs.cpSync(path.join(ROOT, '.agents'), path.join(p.dir, '.agents'), { recursive: true });
  const r = spawnSync(process.execPath, [DISPATCH, '--profile=../x', 'add a thing'], {
    cwd: p.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, env: { PATH: path.dirname(process.execPath), HOME: p.home },
  });
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  assert.equal(result.phase, 'escalated');
  assert.match(result.reason, /not a lowercase kebab-case profile name/);
  assert.equal(fs.existsSync(path.join(p.dir, 'production_artifacts', 'runs')), false);
}));

test('--engine=legacy is accepted and stripped from the goal', withProject((p) => {
  fs.cpSync(path.join(ROOT, '.agents'), path.join(p.dir, '.agents'), { recursive: true });
  const r = spawnSync(process.execPath, [DISPATCH, '--engine=legacy', '--profile=../x', 'add a thing'], {
    cwd: p.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, env: { PATH: path.dirname(process.execPath), HOME: p.home, AOS_FABRIC_ENGINE: 'cli' },
  });
  const result = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  assert.match(result.reason, /not a lowercase kebab-case profile name/, 'the flag beats the environment, and the legacy engine ran');
}));
