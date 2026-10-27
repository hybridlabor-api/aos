// Shared by the aos-fabric tests: a throwaway git project, a scripted executor and CLI/process helpers.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI = path.join(ROOT, 'bin', 'aos-fabric.mjs');
export const NODES = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'nodes.json'), 'utf8')).nodes;

// { dir, home, cleanup }: a git work tree with one commit and an empty HOME next to it. Nothing real is touched.
export function tmpProject({ git = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
  const dir = path.join(base, 'proj');
  const home = path.join(base, 'home');
  fs.mkdirSync(dir);
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  if (git) {
    const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    g('init', '-q');
    g('config', 'user.email', 't@example.invalid');
    g('config', 'user.name', 't');
    g('add', '-A');
    g('commit', '-qm', 'base');
  }
  return { dir, home, base, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

export function runCli(args, { cwd, env = {}, timeout = 60000 } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout, env: { ...process.env, ...env } });
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  const last = lines.at(-1);
  let json = null;
  try { json = last ? JSON.parse(last) : null; } catch { /* not JSON */ }
  let error = null;
  try { error = r.stderr.trim() ? JSON.parse(r.stderr.trim().split('\n').at(-1)) : null; } catch { /* plain text */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json, lines, error };
}

// The report an executor would write for `step`, scripted by scenario. Creates the artifacts a real node would leave.
// scenarios: ok | repair | noprogress | scope | gate | reject (TechLead rejects once)
export function reportFor(step, cwd, scen = 'ok') {
  const iteration = Number(step.step_id.split('-')[0]);
  const w = (rel, text = 'x\n') => { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); return rel; };
  const rep = { schema: 'aos.fabric.report/1', step_id: step.step_id, status: 'ok', findings: [], artifacts: {}, executor: { name: 'scripted' } };
  const finding = (id, node, summary = 'problem') => ({ id, severity: 'blocking', node, status: 'open', summary });
  if (step.node === 'architect') { rep.artifacts.plan = w('production_artifacts/plan/plan.mdx'); if (scen === 'scope') w('src/evil.txt'); }
  if (step.node === 'techlead' && scen === 'reject' && iteration === 0) rep.findings = [finding('plan-1', 'architect', 'no capability map')];
  if (step.node === 'ui_ux') { w('src/ui.txt', step.step_id); rep.artifacts.frontend = w('production_artifacts/01_frontend_spec.md'); }
  if (step.node === 'engineering') { w('src/api.txt', step.step_id); rep.artifacts.backend = w('production_artifacts/02_backend_schema.md'); }
  if (step.node === 'media_eventtech') rep.artifacts.media = w('production_artifacts/03_media_pipeline.md');
  if (step.node === 'reviewer') {
    if (scen === 'repair' && iteration === 0) rep.findings = [finding('f1', 'engineering')];
    if (scen === 'noprogress') rep.findings = [finding('f1', 'engineering')];
  }
  if (step.node === 'shipping') {
    const failing = scen === 'gate' && iteration === 0;
    rep.gate = { lint: 'pass', typecheck: 'pass', tests: failing ? 'fail' : 'pass', a11y: 'skip', seo: 'skip', security: 'pass' };
    if (failing) rep.findings = [finding('gate-tests', 'engineering', 'tests are red')];
  }
  return rep;
}

// What a scripted worker does with a brief: read who it is (Step, Node, Report file), write that node's report.
export function answerBrief(briefText, cwd, scen = 'ok') {
  const field = (label) => new RegExp(`^${label}: (.+)$`, 'm').exec(briefText)?.[1]?.trim();
  const stepId = field('Step');
  const node = field('Node');
  const out = field('Report file');
  if (!stepId || !node || !out) throw new Error('this is not a fabric brief');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(reportFor({ step_id: stepId, node }, cwd, scen)));
  return { stepId, node, out };
}

// An executor script for AOS_FABRIC_FAKE_EXECUTOR (`--executor fake`): writes reportFor() output, or misbehaves on request.
// FAKE_SCEN is one of reportFor's scenarios or: crash | badjson | wrongstep | stdout | slow | exit5 | huge
export function writeFakeExecutor(dir) {
  const file = path.join(dir, 'fake-executor.mjs');
  const src = `
import fs from 'node:fs';
import path from 'node:path';
import { reportFor } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'tests', 'fixtures', 'fabric-helpers.mjs')).href)};
const scen = process.env.FAKE_SCEN || 'ok';
const stepId = process.env.AOS_FABRIC_STEP_ID;
const out = process.env.AOS_FABRIC_REPORT;
const node = process.env.AOS_FABRIC_NODE;
if (scen === 'crash' && node === 'architect') process.exit(3);
if (scen === 'slow' && node === 'architect') await new Promise((r) => setTimeout(r, 60000));
const step = { step_id: stepId, node };
const rep = reportFor(step, process.cwd(), scen);
const write = (text) => { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, text); };
if (scen === 'badjson' && node === 'architect') { write('{ not json'); process.exit(0); }
if (scen === 'wrongstep' && node === 'architect') rep.step_id = '9-architect-9';
if (scen === 'huge' && node === 'architect') rep.pad = 'x'.repeat(3 * 1024 * 1024);
if (scen === 'stdout' && node === 'architect') { console.log('working...'); console.log(JSON.stringify(rep)); process.exit(0); }
write(JSON.stringify(rep));
if (scen === 'exit5' && node === 'architect') process.exit(5);
`;
  fs.writeFileSync(file, src);
  return file;
}

export const fakeEnv = (home, extra = {}) => ({ HOME: home, USERPROFILE: home, AOS_PLAN_APPROVAL: 'auto', ...extra });
