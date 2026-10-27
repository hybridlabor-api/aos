// Executors: harness choice, AO detection, the process runner with its timeout, how a finished process becomes one valid
// report (every failure mode is a failed step) and the human plan-canvas step. No real harness is started here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chooseHarness, currentHarness, decideCanvasVerdict, detectAO, executeStep, failReport, HARNESSES, lastJsonObject, runHumanStep, runProcess } from '../lib/fabric/executors.mjs';
import { validateReport } from '../lib/fabric/schema.mjs';
import { FabricError } from '../lib/fabric/store.mjs';
import { ROOT, tmpProject, writeFakeExecutor } from './fixtures/fabric-helpers.mjs';

const withProject = (fn) => async () => { const p = tmpProject({ git: false }); try { await fn(p); } finally { p.cleanup(); } };

test('currentHarness maps the session variables of aos-gate to a harness', () => {
  assert.equal(currentHarness({}), null);
  assert.equal(currentHarness({ CLAUDECODE: '1' }), 'claude');
  assert.equal(currentHarness({ CLAUDE_SESSION_ID: 'x' }), 'claude');
  assert.equal(currentHarness({ OPENCODE: '1' }), 'opencode');
  assert.equal(currentHarness({ CODEX_SANDBOX: 'seatbelt' }), 'codex');
  assert.equal(currentHarness({ CODEX_SESSION_ID: 'x' }), 'codex');
  assert.equal(currentHarness({ AGY_SESSION_ID: 'x' }), 'agy');
  assert.equal(currentHarness({ ANTIGRAVITY_SESSION_ID: 'x' }), 'agy');
  assert.equal(currentHarness({ HARNESS_ENV: 'codex' }), null, 'HARNESS_ENV is a list of names in aos-gate, not a value');
});

test('every session variable aos-gate knows is mapped here too', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'aos-gate.mjs'), 'utf8');
  const names = [...(/export const HARNESS_ENV = \[([^\]]+)\]/.exec(src)?.[1] ?? '').matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 7, 'found the list in bin/aos-gate.mjs');
  for (const name of names) assert.ok(HARNESSES.includes(currentHarness({ [name]: '1' })), `${name} is not mapped`);
});

test('chooseHarness: hint, then the running harness, then the first installed; a hint is not binding', () => {
  const all = () => true;
  const only = (...names) => (h) => names.includes(h);
  assert.equal(chooseHarness({ harness: 'opencode' }, { CLAUDECODE: '1' }, all), 'opencode');
  assert.equal(chooseHarness({}, { CODEX_SESSION_ID: 'x' }, all), 'codex');
  assert.equal(chooseHarness({}, {}, all), 'claude', 'first of claude codex opencode agy');
  assert.equal(chooseHarness({}, {}, only('opencode', 'agy')), 'opencode');
  assert.equal(chooseHarness({ harness: 'codex' }, { CLAUDECODE: '1' }, only('claude')), 'claude', 'hinted harness not installed: next candidate');
  assert.equal(chooseHarness({ harness: 'bogus' }, {}, only('agy')), 'agy', 'an unknown hint is ignored');
  assert.equal(chooseHarness({}, {}, () => false), null);
});

function shim(dir, name) {
  const win = process.platform === 'win32';
  const file = path.join(dir, win ? `${name}.cmd` : name);
  fs.writeFileSync(file, win ? '@echo off\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return file;
}

test('detectAO: needs the ao command on PATH and a healthy daemon, and says what is missing', withProject(async (p) => {
  const bin = path.join(p.base, 'bin');
  fs.mkdirSync(bin);
  const env = { PATH: bin, Path: bin, PATHEXT: '.CMD;.EXE' };
  const ok = async () => ({ ok: true, status: 200 });
  // resolveCommand also looks in the usual install folders; a developer machine may have a real ao there.
  if (!['/opt/homebrew/bin/ao', '/usr/local/bin/ao'].some((f) => fs.existsSync(f))) {
    const none = await detectAO({ env, fetchImpl: ok });
    assert.deepEqual([none.present, none.healthy], [false, false]);
    assert.match(none.reason, /ao command is not on PATH/);
  }

  shim(bin, 'ao');
  assert.deepEqual(await detectAO({ env, fetchImpl: ok }).then((r) => [r.present, r.healthy]), [true, true]);
  const sick = await detectAO({ env, fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.deepEqual([sick.present, sick.healthy], [true, false]);
  assert.match(sick.reason, /answered 503/);
  const down = await detectAO({ env, fetchImpl: async () => { throw Object.assign(new Error('refused'), { name: 'Error' }); } });
  assert.match(down.reason, /not reachable \(refused\)/);
  const slow = await detectAO({ env, fetchImpl: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); } });
  assert.match(slow.reason, /timeout/);
  let asked;
  await detectAO({ env, fetchImpl: async (url, opts) => { asked = [url, !!opts.signal]; return { ok: true }; }, healthUrl: 'http://127.0.0.1:1/health' });
  assert.deepEqual(asked, ['http://127.0.0.1:1/health', true], 'the health call carries a timeout signal');
  const dflt = [];
  await detectAO({ env, fetchImpl: async (url) => { dflt.push(url); return { ok: true }; } });
  assert.match(dflt[0], /^https?:\/\/[^/]+\/health$/);
}));

test('lastJsonObject finds the last parseable object that starts a line, also with text and fences around it', () => {
  assert.equal(lastJsonObject('no json here'), null);
  assert.equal(lastJsonObject(''), null);
  assert.deepEqual(lastJsonObject('log\n{"a":1}\nmore log\n{"b":2}'), { b: 2 });
  assert.deepEqual(lastJsonObject('{"a":1}\n{ broken'), { a: 1 });
  assert.deepEqual(lastJsonObject('{\n  "a": [1,\n 2]\n}'), { a: [1, 2] });
  assert.deepEqual(lastJsonObject('Here is the report:\n```json\n{"schema":"aos.fabric.report/1"}\n```\nDone.'), { schema: 'aos.fabric.report/1' });
  assert.deepEqual(lastJsonObject('{"s":"}{ \\" }"}\nthanks'), { s: '}{ " }' }, 'braces and quotes inside strings');
  assert.equal(lastJsonObject('inline {"a":1} is not at a line start'), null);
});

test('the canvas verdict table is the one in the dispatcher script', () => {
  const src = fs.readFileSync(path.join(ROOT, '.claude', 'workflows', 'fabric-dispatch.mjs'), 'utf8');
  const block = /\/\/ BEGIN canvas-verdict[^\n]*\n([\s\S]*?)\/\/ END canvas-verdict/.exec(src)[1];
  const theirs = new Function(`${block}\nreturn { lastJsonObject, decideCanvasVerdict };`)();
  const payloads = [
    null, { error: 'no server' }, { status: 'ended', items: [] }, { status: 'feedback', items: [] },
    { status: 'feedback', items: [{ kind: 'verdict', verdict: 'approve' }] },
    { status: 'feedback', items: [{ kind: 'verdict', verdict: 'request-changes', text: 'rename it' }, { kind: 'comment', text: 'and this' }] },
    { status: 'feedback', items: [{ kind: 'comment' }] }, { items: [{ kind: 'verdict', verdict: 'approve' }] }, { status: 'timeout' },
  ];
  for (const payload of payloads) assert.deepEqual(decideCanvasVerdict(payload), theirs.decideCanvasVerdict(payload), JSON.stringify(payload));
  for (const text of ['x', 'a\n{"b":1}', '']) assert.deepEqual(lastJsonObject(text), theirs.lastJsonObject(text), text);
});

test('runProcess captures output and the exit code', async () => {
  const ok = await runProcess({ file: process.execPath, args: ['-e', 'console.log("out"); console.error("err")'], options: {} }, { cwd: process.cwd(), env: process.env, timeoutS: 30 });
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout.trim(), 'out');
  assert.equal(ok.stderr.trim(), 'err');
  assert.equal(ok.timedOut, false);
  const bad = await runProcess({ file: process.execPath, args: ['-e', 'process.exit(7)'], options: {} }, { cwd: process.cwd(), env: process.env, timeoutS: 30 });
  assert.equal(bad.code, 7);
  const missing = await runProcess({ file: path.join(ROOT, 'no-such-binary'), args: [], options: {} }, { cwd: process.cwd(), env: process.env, timeoutS: 30 });
  assert.equal(missing.code, null);
  assert.equal(missing.error.code, 'ENOENT');
});

test('runProcess stops a hanging process at the limit: stop signal first, hard kill after the grace time', async () => {
  const started = Date.now();
  const r = await runProcess({ file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], options: {} }, { cwd: process.cwd(), env: process.env, timeoutS: 0.3, graceMs: 200 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 10000, 'did not wait for the process');
  const stubborn = await runProcess({ file: process.execPath, args: ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], options: {} }, { cwd: process.cwd(), env: process.env, timeoutS: 0.3, graceMs: 300 });
  assert.equal(stubborn.timedOut, true, 'a process that ignores the stop signal is killed');
});

test('runProcess stops the children of the executor too', { skip: process.platform === 'win32' }, async () => {
  const src = 'const { spawn } = require("node:child_process"); const c = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "inherit" }); console.log(c.pid); setInterval(()=>{},1000)';
  const r = await runProcess({ file: process.execPath, args: ['-e', src], options: {} }, { cwd: process.cwd(), env: process.env, timeoutS: 0.5, graceMs: 200 });
  const child = Number(r.stdout.trim());
  assert.ok(child > 0);
  await new Promise((resolve) => setTimeout(resolve, 300));
  let alive = true;
  try { process.kill(child, 0); } catch { alive = false; }
  assert.equal(alive, false, 'the grandchild was left running');
});

const stepFor = (p, over = {}) => ({
  run: 'r', step_id: '0-architect-1', node: 'architect', kind: 'plan', cwd: p.dir, brief: path.join(p.dir, 'brief.md'),
  expected_report: path.join(p.dir, 'production_artifacts', 'runs', 'r', 'reports', '0-architect-1.json'),
  timeout_s: 30, scope: 'read-only', allowed_writes: ['production_artifacts/**'], model_hint: {}, ...over,
});
const fake = (p, scen, over = {}) => executeStep(stepFor(p), { mode: 'fake', env: { ...process.env, AOS_FABRIC_FAKE_EXECUTOR: writeFakeExecutor(p.base), FAKE_SCEN: scen }, ...over });

test('a normal executor leaves a valid report, and the driver stamps who ran it', withProject(async (p) => {
  const r = await fake(p, 'ok');
  assert.equal(r.report.status, 'ok');
  assert.equal(r.report.exit_code, 0);
  assert.equal(r.report.executor.name, 'fake');
  assert.equal(r.executor, 'fake');
  assert.equal(validateReport(r.report).ok, true);
  assert.equal(r.report.artifacts.plan, 'production_artifacts/plan/plan.mdx');
}));

test('fail closed: crash, missing report, broken report, wrong step id, exit code on an ok report', withProject(async (p) => {
  const cases = [
    ['crash', 'no-report', 3], ['badjson', 'bad-report', 0], ['wrongstep', 'bad-report', 0], ['exit5', 'executor-exit', 5],
  ];
  for (const [scen, id, exit] of cases) {
    const r = await fake(p, scen);
    assert.equal(r.report.status, 'fail', scen);
    assert.equal(r.report.findings[0].id, id, scen);
    assert.equal(r.report.exit_code, exit, scen);
    assert.equal(r.report.findings[0].node, 'architect');
    assert.equal(validateReport(r.report).ok, true, `${scen}: the synthetic report is itself valid`);
  }
}));

test('a report file above the size cap is a broken report, not a memory problem', withProject(async (p) => {
  const r = await fake(p, 'huge');
  assert.equal(r.report.status, 'fail');
  assert.equal(r.report.findings[0].id, 'bad-report');
  assert.match(r.report.findings[0].summary, /the report is too large: the report file is \d+ bytes, more than the 2097152 allowed/);
}));

test('a report printed as the last JSON object of stdout is accepted when no file was written', withProject(async (p) => {
  const r = await fake(p, 'stdout');
  assert.equal(r.report.status, 'ok');
  assert.equal(r.report.artifacts.plan, 'production_artifacts/plan/plan.mdx');
}));

test('timeout: the report is a failed one with exit code 124', withProject(async (p) => {
  const started = Date.now();
  const r = await fake(p, 'slow', { timeoutS: 0.5 });
  assert.equal(r.report.status, 'fail');
  assert.equal(r.report.exit_code, 124);
  assert.equal(r.report.findings[0].id, 'timeout');
  assert.match(r.report.findings[0].summary, /did not finish within 0\.5 s/);
  assert.ok(Date.now() - started < 20000);
}));

test('--executor fake without a script is refused as invalid input', withProject(async (p) => {
  await assert.rejects(executeStep(stepFor(p), { mode: 'fake', env: {} }), (e) => e instanceof FabricError && e.code === 2);
}));

test('no harness on PATH is exit 1 with a clear message, not a failed step', withProject(async (p) => {
  await assert.rejects(executeStep(stepFor(p), { mode: 'aos-acp', env: {}, onPath: () => false }), (e) => e instanceof FabricError && e.code === 1 && /no harness found: install one of claude, codex, opencode, agy/.test(e.message));
}));

test('agy cannot limit its write paths: a writing step without a sandbox fails with agy-scope and starts nothing', withProject(async (p) => {
  const r = await executeStep(stepFor(p, { model_hint: { harness: 'agy' }, allowed_writes: ['**'] }), { mode: 'aos-acp', env: {}, onPath: (h) => h === 'agy' });
  assert.equal(r.report.status, 'fail');
  assert.equal(r.report.findings[0].id, 'agy-scope');
  assert.match(r.report.findings[0].summary, /--sandbox coop\|wsl2/);
  assert.equal(r.report.executor.harness, 'agy');
}));

test('failReport is exported for drivers', () => {
  assert.equal(failReport({ step_id: '0-a-1', node: 'a' }, 'x', 'y').status, 'fail');
});

const humanStep = (p, over = {}) => ({ step_id: '0-human-1', node: 'human', kind: 'human', cwd: p.dir, plan: 'production_artifacts/plan/plan.mdx', ...over });
const canvas = (payload, over = {}) => (calls) => (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 0, stdout: `${payload === undefined ? '' : JSON.stringify(payload)}\n`, stderr: '', ...over }; };

test('human step: AOS_PLAN_APPROVAL=auto skips the verdict with a warning and says so in the report', () => {
  let said = '';
  const r = runHumanStep(humanStep({ dir: '/x' }), { env: { AOS_PLAN_APPROVAL: 'auto' }, err: (s) => { said += s; }, run: () => assert.fail('no canvas call') });
  assert.equal(r.status, 'ok');
  assert.equal(r.executor.name, 'plan-approval-auto');
  assert.match(said, /WARNING: AOS_PLAN_APPROVAL=auto/);
  assert.equal(validateReport(r).ok, true);
});

test('human step: the verdict of plan-canvas becomes ok, fail with the feedback, or escalate', withProject((p) => {
  const calls = [];
  const via = (payload, over) => runHumanStep(humanStep(p), { env: { CI: '1' }, run: canvas(payload, over)(calls) });

  assert.equal(via({ status: 'feedback', items: [{ kind: 'verdict', verdict: 'approve' }] }).status, 'ok');

  const changes = via({ status: 'feedback', items: [{ kind: 'verdict', verdict: 'request-changes', text: 'rename it' }, { kind: 'comment', text: 'and the logo' }] });
  assert.equal(changes.status, 'fail');
  assert.deepEqual([changes.findings[0].node, changes.findings[0].severity, changes.findings[0].status, changes.findings[0].id], ['architect', 'blocking', 'open', 'human-0-human-1']);
  assert.match(changes.findings[0].summary, /rename it[\s\S]*and the logo/);
  assert.equal(validateReport(changes).ok, true);

  assert.equal(via({ status: 'ended', items: [] }).status, 'escalate');
  assert.equal(via({ error: 'no server' }).status, 'escalate');
  assert.equal(via(undefined).status, 'escalate');
  assert.match(via(undefined).findings[0].summary, /returned no verdict/);
  assert.equal(via(undefined).needs_human, true);

  const missing = runHumanStep(humanStep(p), { env: {}, run: () => ({ missing: true }) });
  assert.match(missing.findings[0].summary, /aos-plan-canvas CLI is not on PATH/);
  const timedOut = runHumanStep(humanStep(p), { env: { AOS_PLAN_AWAIT_TIMEOUT_MS: '5000' }, run: () => ({ timedOut: true }) });
  assert.match(timedOut.findings[0].summary, /no human verdict within 5000 ms/);
  assert.equal(runHumanStep(humanStep(p, { plan: undefined }), { env: {}, run: () => assert.fail('nothing to open') }).status, 'escalate');
}));

test('human step: how plan-canvas is called', withProject((p) => {
  const calls = [];
  const call = (step, env) => { calls.length = 0; runHumanStep(step, { env, run: canvas({ status: 'feedback', items: [{ kind: 'verdict', verdict: 'approve' }] })(calls) }); return calls[0]; };
  const mdx = call(humanStep(p), { CI: '1' });
  assert.equal(mdx.cmd, 'aos-plan-canvas');
  assert.deepEqual(mdx.args.slice(0, 5), ['open', path.join(p.dir, 'production_artifacts/plan/plan.mdx'), '--await', '--mode', 'bdb-plan-builder']);
  assert.ok(mdx.args.includes('--no-open'), 'headless runs open no browser');
  assert.equal(mdx.opts.timeout, 30 * 60 * 1000, 'headless default is 30 minutes');
  assert.equal(mdx.opts.cwd, p.dir);
  const md = call(humanStep(p, { plan: 'production_artifacts/00_execution_plan.md' }), { CI: '1', AOS_PLAN_AWAIT_TIMEOUT_MS: '0' });
  assert.equal(md.args[4], 'standard');
  assert.equal(md.opts.timeout, 0, '0 means unbounded');
}));
