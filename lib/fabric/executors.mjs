// Executors of the fabric loop and `drive`. An executor is anything that works off a brief file and leaves a report;
// the contract is the same for all of them: brief and cwd in, report.json at expected_report out, exit code 0 on a normal end.
// The driver enforces timeout_s (stop signal, hard kill after 10 s) and fails closed: a crash, a missing or a broken
// report is a failed step, never a pass. Harness-neutral: aos-acp for claude/opencode/agy, `codex exec` for codex, AO optional.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { acceptReport, EXECUTOR_MODES, noteRun } from './engine.mjs';
import { createStore, EXIT_CODES, FabricError, readTextCapped } from './store.mjs';
import { failReport, REPORT_SCHEMA_ID, validateReport } from './schema.mjs';
import { urlOf } from '../endpoints.mjs';

const require = createRequire(import.meta.url);
const cliSpawn = require('../cli-spawn.js');
const { winBin } = require('../win-bin.js');
const { modelProblem } = require('../agent-models.js');
const ACP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'aos-acp.mjs');

export const HARNESSES = ['claude', 'codex', 'opencode', 'agy'];
export { EXECUTOR_MODES };
const GRACE_MS = 10000;
// The session variables bin/aos-gate.mjs lists as HARNESS_ENV, and the harness each one stands for.
const HARNESS_BY_ENV = {
  CLAUDE_SESSION_ID: 'claude', CLAUDECODE: 'claude', OPENCODE: 'opencode', CODEX_SANDBOX: 'codex', CODEX_SESSION_ID: 'codex',
  AGY_SESSION_ID: 'agy', ANTIGRAVITY_SESSION_ID: 'agy',
};
const MODEL_KEY = { claude: 'claude', codex: 'codex', opencode: 'opencode', agy: 'antigravity' };
const AO_HARNESS = { claude: 'claude-code', opencode: 'opencode', agy: 'agy' };

export function currentHarness(env = process.env) {
  for (const [name, harness] of Object.entries(HARNESS_BY_ENV)) if (env[name]) return harness;
  return null;
}

// model_hint.harness, else the harness this process runs in, else the first installed one. A hint is never binding.
export function chooseHarness(hint = {}, env = process.env, onPath = (h, e) => cliSpawn.onPath(h, { env: e })) {
  const order = [hint.harness, currentHarness(env), ...HARNESSES].filter((h) => HARNESSES.includes(h));
  return order.find((h) => onPath(h, env)) ?? null;
}

// AO is optional. Detection order: `ao` on PATH, then the daemon's /health within one second.
export async function detectAO({ env = process.env, fetchImpl = fetch, healthUrl, timeoutMs = 1000 } = {}) {
  const bin = cliSpawn.resolveCommand('ao', { env });
  if (!bin) return { present: false, healthy: false, reason: 'the ao command is not on PATH' };
  try {
    const res = await fetchImpl(healthUrl ?? `${urlOf('ao')}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? { present: true, healthy: true, bin } : { present: true, healthy: false, bin, reason: `the AO daemon answered ${res.status}` };
  } catch (e) {
    return { present: true, healthy: false, bin, reason: `the AO daemon is not reachable (${e.name === 'TimeoutError' ? 'timeout' : e.message})` };
  }
}

// Index after the "}" that closes the object opened at `start`, or -1. Strings are skipped, so a brace inside one does not count.
function objectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

// The last JSON object in a text that starts a line (text, fences or log lines may come before and after it); null when none parses.
export function lastJsonObject(raw) {
  const starts = [];
  const re = /(^|\n)\{/g;
  let m;
  while ((m = re.exec(raw))) starts.push(m.index + m[1].length);
  for (let i = starts.length - 1; i >= 0; i--) {
    const end = objectEnd(raw, starts[i]);
    if (end < 0) continue;
    try { return JSON.parse(raw.slice(starts[i], end)); } catch { /* try an earlier object */ }
  }
  return null;
}

// Same decision table as decideCanvasVerdict in .claude/workflows/fabric-dispatch.mjs, which cannot import this file (tests keep the two in step).
export function decideCanvasVerdict(payload) {
  if (!payload || payload.error) return { approved: false, escalate: true, feedback: `plan-canvas returned no verdict (${(payload && payload.error) || 'no JSON'})` };
  const items = Array.isArray(payload.items) ? payload.items.filter((i) => i && typeof i === 'object') : [];
  if (items.some((i) => i.kind === 'verdict' && i.verdict === 'approve')) return { approved: true };
  if (payload.status === 'feedback' && items.length > 0) {
    const lines = items.map((i) => `- [${i.kind === 'verdict' ? i.verdict : i.kind || 'comment'}] ${i.text || '(no text)'}`);
    return { approved: false, feedback: lines.join('\n') };
  }
  return { approved: false, escalate: true, feedback: `canvas ended without a verdict (status: ${payload.status || 'unknown'})` };
}

export { failReport };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const live = new Set();

function killTree(child, signal) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try { spawn(winBin('taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {}); } catch { /* already gone */ }
    return;
  }
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already gone */ } }
}

// One executor process under a hard timeout: stop signal at the limit, hard kill after 10 s more.
// -> { code, stdout, stderr, timedOut, error }
export function runProcess(inv, { cwd, env, timeoutS, graceMs = GRACE_MS, cap = 1 << 20 }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(inv.file, inv.args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32', ...inv.options });
    } catch (error) { resolve({ code: null, stdout: '', stderr: '', timedOut: false, error }); return; }
    live.add(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    let hard;
    let flush;
    child.stdout.on('data', (d) => { stdout = (stdout + d).slice(-cap); });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-cap); });
    const finish = (code, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(hard); clearTimeout(flush);
      live.delete(child);
      resolve({ code, stdout, stderr, timedOut, ...(error && { error }) });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, 'SIGTERM');
      hard = setTimeout(() => killTree(child, 'SIGKILL'), graceMs);
    }, timeoutS * 1000);
    child.on('error', (error) => finish(null, error));
    // A grandchild can keep the pipes open after the executor exited: do not wait for them for long.
    child.on('exit', (code) => { flush = setTimeout(() => finish(code), 2000); });
    child.on('close', (code) => finish(code));
  });
}

function pointerPrompt(step) {
  return `Carry out the fabric step described in the brief file ${step.brief} exactly as written there, then write the report file it names.`;
}

function pickModel(hint, harness) {
  const value = hint?.models?.[MODEL_KEY[harness]] ?? hint?.model;
  if (value === undefined) return { model: null };
  const problem = modelProblem(MODEL_KEY[harness], value);
  return problem ? { model: null, note: `model hint ${JSON.stringify(value)} ignored for ${harness}: ${problem}` } : { model: value };
}

async function invocationFor(step, harness, { sandbox, model, timeoutS }) {
  const writes = step.allowed_writes.length > 0;
  if (harness === 'codex') {
    const { codexInvocation } = await import('../a2a-codex.mjs');
    return codexInvocation(['exec', '--sandbox', writes ? 'workspace-write' : 'read-only', '--', pointerPrompt(step)]);
  }
  const args = [ACP, harness, '--name', `fabric-${step.run}-${step.step_id}`, '--cwd', step.cwd, '--prompt-file', step.brief,
    '--allow-default', writes ? 'scoped' : 'deny', '--timeout', String(timeoutS), '--trail-node', step.node];
  if (harness === 'agy') args.push('--print-timeout', String(timeoutS));
  if (model) args.push('--model', model);
  if (sandbox) args.push('--sandbox', sandbox);
  return { file: process.execPath, args, options: {} };
}

// `ao spawn --workdir` (AO commit 74f709cc57) is the only way to run the worker in step.cwd. Older ao creates its own
// worktree, so it is never used. Checked once per drive run; any failure counts as unsupported (fail open to aos-acp).
export function aoWorkdirSupport(env = process.env, cache = new Map()) {
  if (cache.has('workdir')) return cache.get('workdir');
  const help = cliSpawn.run('ao', ['spawn', '--help'], { env, timeout: 5000 });
  const ver = help.missing ? null : cliSpawn.run('ao', ['--version'], { env, timeout: 3000 });
  const out = { ok: !help.missing && !help.timedOut && /--workdir\b/.test(`${help.stdout}\n${help.stderr}`),
    version: ver?.stdout.trim().split('\n')[0] || 'unknown version' };
  cache.set('workdir', out);
  return out;
}

// At most 20 chars (old ao rejects longer names): f-<6 hex of sha1(run)>-<node>-<attempt>.
export function aoName(step) {
  const head = `f-${createHash('sha1').update(String(step.run)).digest('hex').slice(0, 6)}-`;
  const attempt = String(step.attempt ?? step.step_id.split('-').at(-1));
  return `${head}${String(step.node).slice(0, 20 - head.length - attempt.length - 1)}-${attempt}`;
}

// AO gets the same brief and the same report path; the report file is the only completion signal it must give.
// -> process result, or { escalate } when AO did not work in step.cwd (never counted as done).
async function runAo(step, harness, { env, timeoutS }) {
  let want;
  try { want = fs.realpathSync(step.cwd); } catch (e) { return { escalate: `the step directory cannot be resolved: ${e.message}` }; }
  const args = ['spawn', '--workdir', want, ...(AO_HARNESS[harness] ? ['--agent', AO_HARNESS[harness]] : []),
    '--name', aoName(step), '--prompt', pointerPrompt(step), '--json'];
  const started = Date.now();
  const res = await runProcess(cliSpawn.invocation('ao', args, { env }), { cwd: want, env, timeoutS });
  if (res.error || res.timedOut || res.code !== 0) return res;
  let got = null;
  try { got = fs.realpathSync(lastJsonObject(res.stdout)?.workdir); } catch { /* none or unresolvable: mismatch */ }
  if (got !== want) return { escalate: `ao worked in ${got ?? 'an unknown directory'}, not in ${want}; the step is not counted as done` };
  while (!fs.existsSync(step.expected_report)) {
    if (Date.now() - started > timeoutS * 1000) return { ...res, timedOut: true };
    await sleep(2000);
  }
  return res;
}

function runFake(step, env, timeoutS) {
  const script = env.AOS_FABRIC_FAKE_EXECUTOR;
  if (!script || !fs.existsSync(script)) throw new FabricError(EXIT_CODES.INVALID_INPUT, '--executor fake needs AOS_FABRIC_FAKE_EXECUTOR to name a script file (tests only)');
  return runProcess({ file: process.execPath, args: [script], options: {} }, {
    cwd: step.cwd, timeoutS,
    env: { ...env, AOS_FABRIC_STEP_ID: step.step_id, AOS_FABRIC_NODE: step.node, AOS_FABRIC_BRIEF: step.brief, AOS_FABRIC_REPORT: step.expected_report },
  });
}

// The finished process -> one valid report. Every way a step can go wrong becomes a failed report.
function collectReport(step, res, executor) {
  if (res.timedOut) return failReport(step, 'timeout', `the executor did not finish within ${res.limit ?? step.timeout_s} s`, 124, executor);
  if (res.error) return failReport(step, 'executor-error', `the executor could not run: ${res.error.code === 'ENOENT' ? `${res.error.path ?? 'command'} not found` : res.error.message}`, 1, executor);
  let text = null;
  // The executor can put anything at this path, also a link to a file of the user: do not follow it.
  try { if (fs.lstatSync(step.expected_report).isSymbolicLink()) return failReport(step, 'bad-report', 'the report path is a link, not a file', res.code ?? 1, executor); } catch { /* absent: checked below */ }
  try { text = readTextCapped(step.expected_report); } catch (e) {
    if (e.code === 'E2BIG') return failReport(step, 'bad-report', `the report is too large: ${e.message.replace(step.expected_report, 'the report file')}`, res.code ?? 1, executor);
    /* absent: maybe printed instead */
  }
  if (text === null) {
    const printed = lastJsonObject(res.stdout);
    if (printed && /^aos\.fabric\.report\//.test(printed.schema ?? '')) text = JSON.stringify(printed);
  }
  const exit = res.code ?? 1;
  if (text === null) return failReport(step, 'no-report', `the executor exited with code ${exit} and left no report${executor.log ? ` (see ${executor.log})` : ''}`, exit, executor);
  let parsed;
  try { parsed = JSON.parse(text); } catch { return failReport(step, 'bad-report', 'the report is not valid JSON', exit, executor); }
  const v = validateReport(parsed);
  if (!v.ok) return failReport(step, 'bad-report', `the report is invalid: ${v.errors[0]}`, exit, executor);
  if (parsed.step_id !== step.step_id) return failReport(step, 'bad-report', `the report names step ${parsed.step_id}, not ${step.step_id}`, exit, executor);
  if (exit !== 0 && parsed.status === 'ok') return failReport(step, 'executor-exit', `the executor exited with code ${exit} although the report says ok${executor.log ? ` (see ${executor.log})` : ''}`, exit, executor);
  return { ...parsed, exit_code: exit, executor: { ...parsed.executor, ...executor } };
}

export function runHumanStep(step, { env = process.env, run = cliSpawn.run, err = (s) => process.stderr.write(s), timeoutS } = {}) {
  const executor = { name: 'plan-canvas' };
  const done = (status, summary, extra = {}) => ({
    schema: REPORT_SCHEMA_ID, step_id: step.step_id, status, exit_code: 0,
    findings: summary ? [{ id: `human-${step.step_id}`, severity: 'blocking', node: 'architect', status: 'open', summary }] : [],
    artifacts: {}, files_changed: [], needs_human: status === 'escalate', executor, ...extra,
  });
  if (env.AOS_PLAN_APPROVAL === 'auto') {
    err('[aos-fabric] WARNING: AOS_PLAN_APPROVAL=auto, the plan-canvas verdict gate is SKIPPED (CI only; no human approved this plan)\n');
    return done('ok', '', { executor: { name: 'plan-approval-auto' } });
  }
  if (!step.plan) return done('escalate', 'no plan path to put in front of the human');
  const plan = path.resolve(step.cwd, step.plan);
  const headless = !!env.CI || !process.stdin.isTTY;
  const noDisplay = process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY;
  const args = ['open', plan, '--await', '--mode', /\.mdx$/i.test(plan) ? 'bdb-plan-builder' : 'standard', ...(headless || noDisplay ? ['--no-open'] : [])];
  const raw = env.AOS_PLAN_AWAIT_TIMEOUT_MS;
  // drive --timeout bounds the wait too, so an outer wrapper timeout never fires first.
  const timeoutMs = raw !== undefined && raw !== '' ? Number.parseInt(raw, 10) || 0 : timeoutS ? timeoutS * 1000 : headless ? 30 * 60 * 1000 : 0;
  const r = run('aos-plan-canvas', args, { cwd: step.cwd, env, timeout: timeoutMs });
  if (r.missing) return done('escalate', 'the aos-plan-canvas CLI is not on PATH; install AOS, or set AOS_PLAN_APPROVAL=auto in CI only');
  const payload = lastJsonObject(r.stdout);
  // No answer yet is not a verdict: the step stays open and drive stops with a waiting state (never counts as approval).
  const waiting = (url) => done('escalate', `waiting for human approval: open ${url || 'the plan canvas (aos-plan-canvas open <plan> --await)'}`, { waiting: true });
  if (r.timedOut) return waiting(payload?.url);
  if (payload?.status === 'waiting') return waiting(payload.url);
  const verdict = decideCanvasVerdict(payload);
  if (verdict.approved) return done('ok', '');
  const summary = String(verdict.feedback).slice(0, 3000);
  return done(verdict.escalate ? 'escalate' : 'fail', summary);
}

// Runs one step on the chosen executor. -> { report, harness, executor, notes }. Throws FabricError(1) when no harness exists.
export async function executeStep(step, { env = process.env, mode = 'aos-acp', sandbox, timeoutS, onPath, detect = () => detectAO({ env }), aoCache = new Map() } = {}) {
  const limit = timeoutS ?? step.timeout_s;
  const notes = [];
  if (step.kind === 'human') {
    const report = runHumanStep(step, { env, timeoutS });
    const { waiting, ...clean } = report;
    return { report: clean, waiting: waiting ? clean.findings[0].summary : null, harness: null, executor: 'plan-canvas', notes };
  }
  if (mode === 'fake') {
    const res = await runFake(step, env, limit);
    return { report: collectReport(step, { ...res, limit }, { name: 'fake' }), harness: null, executor: 'fake', notes };
  }
  let exec = 'aos-acp';
  if (mode === 'ao' || mode === 'auto') {
    const ao = await detect();
    if (ao.present && ao.healthy) {
      const sup = aoWorkdirSupport(env, aoCache);
      if (sup.ok) exec = 'ao';
      else notes.push(`ao ${sup.version} lacks --workdir; use --executor aos-acp or update AO (the step runs on aos-acp)`);
    }
    else if (mode === 'ao') notes.push(`AO was requested but ${ao.reason}; the step runs on aos-acp`);
  }
  const harness = chooseHarness(step.model_hint, env, onPath);
  if (!harness) throw new FabricError(EXIT_CODES.UNEXPECTED_ERROR, `no harness found: install one of ${HARNESSES.join(', ')} and put it on PATH`);
  const picked = pickModel(step.model_hint, harness);
  if (picked.note) notes.push(picked.note);
  const name = exec === 'ao' ? 'ao' : harness === 'codex' ? 'codex-exec' : 'aos-acp';
  const executor = { name, harness, ...(picked.model && { model: picked.model }) };
  if (harness === 'agy' && step.allowed_writes.length > 0 && !sandbox) {
    return { report: failReport(step, 'agy-scope', 'agy cannot limit its write paths per tool call, so a step that writes needs a sandbox: run drive with --sandbox coop|wsl2 (or AOS_FABRIC_SANDBOX)', 1, executor), harness, executor: name, notes };
  }
  const workerEnv = (await import('../a2a-spawn.mjs')).childEnv(Number(env.AOS_DELEGATE_DEPTH) || 0, env);
  let res;
  if (exec === 'ao') res = await runAo(step, harness, { env: workerEnv, timeoutS: limit });
  else {
    const inv = await invocationFor(step, harness, { sandbox, model: picked.model, timeoutS: limit });
    res = await runProcess(inv, { cwd: step.cwd, env: workerEnv, timeoutS: limit });
    // aos-acp keeps its own run log under the lower-cased worker name (go-gate slug()).
    if (harness !== 'codex') executor.log = `~/.aos/acp/${`fabric-${step.run}-${step.step_id}`.toLowerCase()}.jsonl`;
  }
  if (res.escalate) {
    const report = { ...failReport(step, 'ao-workdir', res.escalate, 1, executor), status: 'escalate', needs_human: true };
    return { report, harness, executor: name, notes };
  }
  return { report: collectReport(step, { ...res, limit }, executor), harness, executor: name, notes };
}

async function withLockRetry(fn, tries = 5, delayMs = 500) {
  for (let i = 1; ; i++) {
    try { return fn(); } catch (e) {
      if (!(e instanceof FabricError) || e.code !== EXIT_CODES.LOCK_BUSY || i >= tries) throw e;
      await sleep(delayMs);
    }
  }
}

// next -> execute -> report until the run is terminal. Convenience only: `next` and `report` do the same by hand.
// Returns the exit code: 0 ready_to_ship/done, 6 escalated/cancelled (a human is needed), others as the CLI contract.
export async function drive({ root = process.cwd(), home = os.homedir(), run, executor, timeout, sandbox, env = process.env, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s), maxSteps = 200, deps = {} }) {
  const emit = (o) => out(`${JSON.stringify(o)}\n`);
  let aborted = false;
  const onSignal = () => { aborted = true; for (const c of live) killTree(c, 'SIGTERM'); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const store = createStore(run, { root });
    let r = store.replay();
    if (!r.found) throw new FabricError(EXIT_CODES.NOT_FOUND, `run ${run} not found`);
    const mode = executor ?? r.config.executor ?? 'aos-acp';
    if (!EXECUTOR_MODES.includes(mode)) throw new FabricError(EXIT_CODES.INVALID_INPUT, `--executor must be one of ${EXECUTOR_MODES.join(', ')}`);
    const box = sandbox ?? env.AOS_FABRIC_SANDBOX;
    if (box && !['coop', 'wsl2'].includes(box)) throw new FabricError(EXIT_CODES.INVALID_INPUT, '--sandbox must be coop or wsl2');
    const noted = new Set();
    const aoCache = new Map();
    for (let n = 0; ; n++) {
      r = store.replay();
      if (r.terminal) {
        emit({ event: 'done', run, phase: r.state.phase, iteration: r.state.iteration, ...(r.reason && { reason: r.reason }) });
        return ['ready_to_ship', 'done'].includes(r.state.phase) ? 0 : EXIT_CODES.TERMINAL_PHASE;
      }
      if (aborted) throw new FabricError(EXIT_CODES.UNEXPECTED_ERROR, 'interrupted; the open step stays open, run drive again to resume');
      if (n >= maxSteps) throw new FabricError(EXIT_CODES.UNEXPECTED_ERROR, `drive stopped after ${maxSteps} steps`);
      const step = store.readStep(r.openStep);
      emit({ event: 'step_start', step_id: step.step_id, node: step.node, kind: step.kind, attempt: step.attempt });
      const done = await (deps.executeStep ?? executeStep)(step, { env, mode, sandbox: box, timeoutS: timeout, aoCache, ...deps.options });
      if (aborted) throw new FabricError(EXIT_CODES.UNEXPECTED_ERROR, 'interrupted; the step stays open, run drive again to resume');
      if (done.waiting) {
        emit({ event: 'waiting_for_human', step_id: step.step_id, message: done.waiting });
        err(`[aos-fabric] ${done.waiting}; run drive again after answering\n`);
        return EXIT_CODES.TERMINAL_PHASE;
      }
      for (const text of done.notes.filter((t) => !noted.has(t))) { noted.add(text); await withLockRetry(() => noteRun({ root, run, text })); emit({ event: 'note', text }); }
      const res = await withLockRetry(() => acceptReport({ root, home, run, step: step.step_id, report: done.report }));
      const last = store.replay().events.at(-1);
      emit({ event: 'step_end', step_id: step.step_id, status: done.report.status, accepted_as: last.effective_status ?? done.report.status, harness: done.harness, executor: done.executor, phase: res.out.phase, kind: res.out.kind });
    }
  } catch (e) {
    const code = e instanceof FabricError ? e.code : EXIT_CODES.UNEXPECTED_ERROR;
    err(`${JSON.stringify({ error: e.message, code })}\n`);
    return code;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
