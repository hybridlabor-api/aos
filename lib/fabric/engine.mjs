// Commands of aos-fabric as plain functions: start, next, report, status, cancel. The CLI and `drive` both call them.
// Every writer takes the run lock; `next` and `status` only read the log. Each function returns { code, out } or throws FabricError.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore, digest, EXIT_CODES, FabricError, readTextCapped, TERMINAL_PHASES } from './store.mjs';
import { decide, firstNext, HUMAN_NODE, initialState, kindOf, MAX_ATTEMPTS_DEFAULT, MAX_ITERATIONS_DEFAULT, REQUIRED_NODE_IDS } from './edges.mjs';
import { buildBrief } from './briefs.mjs';
import { failReport, RESPONSE_SCHEMA_ID, SCOPES, STEP_SCHEMA_ID, validateReport } from './schema.mjs';
import { gitSnapshot, verifyReport } from './verify.mjs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HUMAN_CFG = { label: 'Plan approval (human)', role: 'human', scope: 'none', allowed_writes: [], timeout_s: 1800, skills: [] };
// Used when nodes.json gives a node no timeout_s of its own.
const TIMEOUT_BY_EXECUTOR = { planner: 900, builder: 3600, reviewer: 1200, gate: 1800 };
const HARNESS_ALIAS = { antigravity: 'agy', 'claude-code': 'claude' };
export const EXECUTOR_MODES = ['aos-acp', 'ao', 'auto', 'fake'];

// A project may carry its own nodes.json; its fields drive the scope check, so they must have the shape the check expects.
function checkNodeFields(file, nodes) {
  for (const [id, n] of Object.entries(nodes)) {
    const bad = (what) => new FabricError(EXIT_CODES.INVALID_INPUT, `${file}: node ${id} has ${what}`);
    if (n.scope !== undefined && !SCOPES.includes(n.scope)) throw bad(`scope ${JSON.stringify(n.scope)} (use ${SCOPES.join(', ')})`);
    if (n.timeout_s !== undefined && !(Number.isInteger(n.timeout_s) && n.timeout_s > 0)) throw bad('a timeout_s that is not a positive integer');
    if (n.allowed_writes !== undefined && !(Array.isArray(n.allowed_writes) && n.allowed_writes.every((g) => typeof g === 'string' && g))) throw bad('allowed_writes that is not an array of glob strings');
  }
}

// First registry that exists wins: project, then ~/.agents, then the package. A broken one is an error, never a fallback.
export function loadRegistry({ root = process.cwd(), home = os.homedir(), pkgRoot = PKG_ROOT } = {}) {
  for (const file of [path.join(root, '.agents', 'nodes.json'), path.join(home, '.agents', 'nodes.json'), path.join(pkgRoot, '.agents', 'nodes.json')]) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
    let reg;
    try { reg = JSON.parse(raw); } catch { throw new FabricError(EXIT_CODES.INVALID_INPUT, `${file} is not valid JSON`); }
    const missing = REQUIRED_NODE_IDS.filter((id) => !reg?.nodes?.[id]);
    if (missing.length) throw new FabricError(EXIT_CODES.INVALID_INPUT, `${file} lacks required node id(s): ${missing.join(', ')}`);
    checkNodeFields(file, reg.nodes);
    return { nodes: reg.nodes, common: Array.isArray(reg.common) ? reg.common : [], file };
  }
  throw new FabricError(EXIT_CODES.INVALID_INPUT, '.agents/nodes.json not found in the project, ~/.agents or the package');
}

// Same lookup order as the dispatcher and the installer: .aos/pipeline.json, .aos/project.json, ~/.aos/pipeline.json.
function readPipeline({ root, home }) {
  for (const f of [path.join(root, '.aos', 'pipeline.json'), path.join(root, '.aos', 'project.json'), path.join(home, '.aos', 'pipeline.json')]) {
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (d?.pipeline && typeof d.pipeline === 'object') return d.pipeline;
    } catch { /* missing or unparseable: next file */ }
  }
  return null;
}

// A hint only (docs/agent-models.md): harness and model(s) the pipeline file names for this node. Never binding.
export function modelHint(pipeline, nodeId, cfg) {
  for (const role of [cfg.agentType, nodeId]) {
    if (!role) continue;
    const c = pipeline?.[String(role).toLowerCase().replace(/-/g, '_')] ?? pipeline?.[role];
    if (!c || typeof c !== 'object') continue;
    const hint = {};
    if (typeof c.harness === 'string') hint.harness = HARNESS_ALIAS[c.harness] ?? c.harness;
    if (typeof c.model === 'string') hint.model = c.model;
    if (c.models && typeof c.models === 'object') hint.models = Object.fromEntries(Object.entries(c.models).filter(([, v]) => typeof v === 'string'));
    return hint;
  }
  return {};
}

export function validateSkills(names, { root, home }) {
  const roots = ['.claude', '.agents', '.gemini/config', '.codex', '.cursor', '.roo'].map((d) => path.join(home, d, 'skills')).concat(path.join(root, 'skills'));
  const exists = (r, n) => fs.existsSync(path.join(r, n, 'SKILL.md'))
    || (() => { try { return fs.readdirSync(r, { withFileTypes: true }).some((e) => e.isDirectory() && fs.existsSync(path.join(r, e.name, n, 'SKILL.md'))); } catch { return false; } })();
  const missing = names.filter((n) => !roots.some((r) => exists(r, n)));
  if (!missing.length) return;
  const installed = new Set();
  for (const r of roots) { try { for (const e of fs.readdirSync(r, { withFileTypes: true })) if (e.isDirectory()) installed.add(e.name); } catch { /* absent root */ } }
  const near = [...installed].filter((i) => missing.some((m) => i.includes(m) || m.includes(i))).slice(0, 5);
  throw new FabricError(EXIT_CODES.INVALID_INPUT, `--skill named skill(s) that could not be found: ${missing.join(', ')}.${near.length ? ` Did you mean: ${near.join(', ')}?` : ''} --skill takes the exact skill directory name.`);
}

function context(r, { root, home }) {
  return { registry: loadRegistry({ root, home }), config: r.config, pipeline: readPipeline({ root, home }) };
}

// Writes the step file and its brief (immutable once the event that names it is committed) and returns the step.
function issueStep(store, ctx, state, next, failure = '') {
  const { registry, config, pipeline } = ctx;
  const human = next.node === HUMAN_NODE;
  const cfg = human ? HUMAN_CFG : registry.nodes[next.node];
  const scope = cfg.scope ?? 'read-only';
  const stepId = `${state.iteration}-${next.node}-${next.attempt}`;
  const step = {
    schema: STEP_SCHEMA_ID,
    run: store.runId,
    step_id: stepId,
    node: next.node,
    role: cfg.agentType ?? cfg.role,
    kind: kindOf(next.node, registry.nodes),
    brief: path.join(store.briefs, `${stepId}.md`),
    cwd: config.cwd,
    model_hint: human ? {} : modelHint(pipeline, next.node, cfg),
    timeout_s: cfg.timeout_s ?? TIMEOUT_BY_EXECUTOR[cfg.executor] ?? 1800,
    scope,
    allowed_writes: Array.isArray(cfg.allowed_writes) ? cfg.allowed_writes : scope === 'worktree-write' ? ['**'] : ['production_artifacts/**'],
    expected_report: path.join(store.reports, `${stepId}.json`),
    attempt: next.attempt,
    max_attempts: MAX_ATTEMPTS_DEFAULT,
    iteration: state.iteration,
    ...(next.round && { round: next.round }),
    ...(human && state.artifacts?.plan && { plan: state.artifacts.plan }),
  };
  const brief = buildBrief(step, { node: { ...cfg, label: cfg.label ?? next.node }, nodes: registry.nodes, common: registry.common, state, failure });
  // A retry keeps the baseline of the attempt before it, so a stray change that attempt left behind stays visible to the scope check.
  const baseline = human ? null : (next.reason === 'retry' && store.readBaseline(`${state.iteration}-${next.node}-${next.attempt - 1}`)) || gitSnapshot(step.cwd);
  store.writeStep(step, brief, baseline);
  return step;
}

function view(store, state, openStep, reason) {
  const base = { schema: RESPONSE_SCHEMA_ID, run: store.runId, phase: state.phase, iteration: state.iteration };
  if (TERMINAL_PHASES.includes(state.phase)) return { ...base, kind: state.phase, ...(reason && { reason }), needs_human: !!state.needs_human };
  return { ...base, kind: 'step', step: store.readStep(openStep) };
}
const viewOfReplay = (store, r) => view(store, r.state, r.openStep, r.reason);

// `must` is true for every writer except start: a mistyped run id must not create a folder.
function lockOrThrow(store, must = true) {
  if (must && !fs.existsSync(store.events)) throw new FabricError(EXIT_CODES.NOT_FOUND, `run ${store.runId} not found`);
  const lk = store.lock();
  if (!lk.ok) throw new FabricError(EXIT_CODES.LOCK_BUSY, `run ${store.runId} is locked by pid ${lk.holder?.pid ?? 'unknown'} (${Math.round((lk.holder?.age_ms ?? 0) / 1000)} s); retry shortly`);
  return lk;
}

function openRun(store) {
  const r = store.replay();
  if (!r.found) throw new FabricError(EXIT_CODES.NOT_FOUND, `run ${store.runId} not found`);
  return r;
}

export function startRun({ root = process.cwd(), home = os.homedir(), run, goal: rawGoal, skills = [], maxIterations, executor = 'aos-acp' }) {
  if (!EXECUTOR_MODES.includes(executor)) throw new FabricError(EXIT_CODES.INVALID_INPUT, `--executor must be one of ${EXECUTOR_MODES.join(', ')}`);
  const goal = String(rawGoal ?? '').trim();
  if (!goal) throw new FabricError(EXIT_CODES.INVALID_INPUT, '--goal or --goal-file is required');
  if (goal.length > 50000) throw new FabricError(EXIT_CODES.INVALID_INPUT, 'the goal is longer than 50000 characters');
  const max = maxIterations ?? MAX_ITERATIONS_DEFAULT;
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new FabricError(EXIT_CODES.INVALID_INPUT, '--max-iterations must be an integer from 1 to 20');
  const names = [...new Set(skills)];
  if (names.some((n) => !/^[A-Za-z0-9_-]+$/.test(n))) throw new FabricError(EXIT_CODES.INVALID_INPUT, '--skill takes a skill directory name (letters, digits, - and _)');
  const runId = run ?? `run-${crypto.createHash('sha256').update(goal).digest('hex').slice(0, 10)}`;
  const store = createStore(runId, { root });
  const registry = loadRegistry({ root, home });
  validateSkills(names, { root, home });
  const lk = lockOrThrow(store, false);
  try {
    const existing = store.replay();
    if (existing.found) {
      if (existing.state.goal !== goal) throw new FabricError(EXIT_CODES.CONFLICT, `run ${runId} exists with a different goal`);
      const v = viewOfReplay(store, existing);
      return { code: 0, out: { schema: RESPONSE_SCHEMA_ID, run: runId, phase: v.phase, next: { kind: v.kind, ...(v.step && { step: v.step }), ...(v.reason && { reason: v.reason }) } } };
    }
    const state = initialState({ run_id: runId, goal, max_iterations: max, mandatory_skills: names });
    const config = { cwd: root, skills: names, max_iterations: max, executor, registry: registry.file };
    const step = issueStep(store, { registry, config, pipeline: readPipeline({ root, home }) }, state, firstNext());
    store.commit({ kind: 'start', run_id: runId, goal, config, state, open_step: step.step_id });
    return { code: 0, out: { schema: RESPONSE_SCHEMA_ID, run: runId, phase: state.phase, next: { kind: 'step', step } } };
  } finally { lk.release(); }
}

// Exit 0 for a step and for every end the graph itself reaches (done, escalated, ready_to_ship): read `kind`, not only the code.
// Exit 6 only for a run that `cancel` ended, which a driver must not loop on.
export function nextView({ root = process.cwd(), run }) {
  const store = createStore(run, { root });
  const r = openRun(store);
  return { code: r.state.phase === 'cancelled' ? EXIT_CODES.TERMINAL_PHASE : 0, out: viewOfReplay(store, r) };
}

const failedFrom = (report, problems, step) => ({
  ...report,
  status: 'fail',
  exit_code: report.exit_code || 1,
  findings: problems.map((p) => ({ id: `verify-${p.id}`, severity: 'blocking', node: step.node, status: 'open', summary: p.summary })),
});

// A report comes from `file`, from `report` (an object) or, with `fail`, is the failed report the CLI writes for the step itself.
export function acceptReport({ root = process.cwd(), home = os.homedir(), run, step: stepId, file, report: given, fail }) {
  if (!stepId || (!file && !given && fail === undefined)) throw new FabricError(EXIT_CODES.INVALID_INPUT, '--step and --file (or --fail) are required');
  const store = createStore(run, { root });
  const lk = lockOrThrow(store);
  try {
    const r = openRun(store);
    const known = r.accepted.has(stepId);
    if (!known && r.terminal) throw new FabricError(EXIT_CODES.TERMINAL_PHASE, `run ${run} is ${r.state.phase}`);
    if (!known && stepId !== r.openStep) throw new FabricError(EXIT_CODES.NOT_FOUND, `step ${stepId} is not the open step (open: ${r.openStep})`);
    let raw = given;
    if (fail !== undefined) raw = failReport(store.readStep(stepId), 'executor-failed', fail, 1, { name: 'driver' });
    if (!raw) {
      try { raw = JSON.parse(readTextCapped(file)); } catch (e) {
        throw new FabricError(EXIT_CODES.INVALID_INPUT, `cannot read the report ${file}: ${e instanceof SyntaxError ? `not valid JSON (${e.message})` : e.code === 'E2BIG' ? e.message : e.code || e.message}`);
      }
    }
    const v = validateReport(raw);
    if (!v.ok) throw new FabricError(EXIT_CODES.INVALID_INPUT, `report invalid: ${v.errors.join('; ')}`);
    if (raw.step_id !== stepId) throw new FabricError(EXIT_CODES.INVALID_INPUT, `report step_id ${raw.step_id} does not match --step ${stepId}`);
    const dg = digest(raw);
    if (known) {
      if (r.accepted.get(stepId) === dg) return { code: 0, out: viewOfReplay(store, r) };
      throw new FabricError(EXIT_CODES.CONFLICT, `step ${stepId} was already accepted with a different report`);
    }

    const ctx = context(r, { root, home });
    const step = store.readStep(stepId);
    const cfg = ctx.registry.nodes[step.node] ?? HUMAN_CFG;
    const before = store.readBaseline(stepId);
    const ver = verifyReport({ step, report: v.report, cwd: step.cwd, before, after: before ? gitSnapshot(step.cwd) : null, artifactKey: cfg.artifactKey });
    const effective = ver.problems.length ? failedFrom(v.report, ver.problems, step) : v.report;
    const d = decide(r.state, step, effective, { nodes: ctx.registry.nodes });
    let open = null;
    if (d.next.kind === 'step') {
      const failure = d.next.reason === 'retry' ? effective.findings.map((f) => f.summary).filter(Boolean).join('; ') || 'the step reported failure' : '';
      open = issueStep(store, ctx, d.state, d.next, failure).step_id;
    }
    store.commit({
      kind: 'report_accepted', step_id: stepId, digest: dg, report: raw, effective_status: effective.status,
      verification: ver.problems, notes: ver.notes, reason: d.reason ?? null, state: d.state, open_step: open,
    });
    return { code: 0, out: view(store, d.state, open, d.reason) };
  } finally { lk.release(); }
}

export function statusView({ root = process.cwd(), run }) {
  const store = createStore(run, { root });
  const r = openRun(store);
  const last = [...r.events].reverse().find((e) => e.kind === 'report_accepted');
  return {
    code: 0,
    out: {
      schema: RESPONSE_SCHEMA_ID, run, phase: r.state.phase, iteration: r.state.iteration, max_iterations: r.state.max_iterations,
      needs_human: !!r.state.needs_human, ...(r.reason && { reason: r.reason }),
      open_findings: (r.state.findings ?? []).filter((f) => f.status === 'open'),
      open_step: r.openStep,
      last_step: last ? { step_id: last.step_id, status: last.effective_status, at: last.at } : null,
      lock: store.lockInfo(),
      projection_stale: store.projectionStale(r.state),
    },
  };
}

export function cancelRun({ root = process.cwd(), run, reason = '' }) {
  const store = createStore(run, { root });
  const lk = lockOrThrow(store);
  try {
    const r = openRun(store);
    if (r.state.phase === 'cancelled') return { code: 0, out: { schema: RESPONSE_SCHEMA_ID, run, phase: 'cancelled' } };
    if (r.terminal) throw new FabricError(EXIT_CODES.TERMINAL_PHASE, `run ${run} is already ${r.state.phase}`);
    const state = { ...r.state, phase: 'cancelled' };
    store.commit({ kind: 'cancelled', reason: String(reason).slice(0, 500) || null, state });
    return { code: 0, out: { schema: RESPONSE_SCHEMA_ID, run, phase: 'cancelled' } };
  } finally { lk.release(); }
}

// Appends a note (fallbacks, decisions of the driver) to the log without touching the state.
export function noteRun({ root = process.cwd(), run, text, data }) {
  const store = createStore(run, { root });
  const lk = lockOrThrow(store);
  try { openRun(store); store.note(text, data); } finally { lk.release(); }
}
