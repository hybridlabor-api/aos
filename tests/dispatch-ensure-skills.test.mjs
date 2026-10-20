// The startcycle dispatcher must install a node's registry skills before that
// node's worker starts. Two angles: the recorded-call harness proves order and
// payload; a full standalone run proves the deterministic polyfill really
// installs a missing skill into the test HOME via the store CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DISPATCH = path.join(ROOT, '.claude', 'workflows', 'startcycle-dispatch.mjs');
const NODES = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'nodes.json'), 'utf8'));

function withTmpDir(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('ensure-skills runs before each node worker and carries that node’s registry skills', () => {
  withTmpDir('dispatch-ensure-order-', (dir) => {
    const cwd = path.join(dir, 'proj');
    fs.mkdirSync(cwd, { recursive: true });
    fs.cpSync(path.join(ROOT, '.agents'), path.join(cwd, '.agents'), { recursive: true });
    const harness = path.join(dir, 'run.mjs');
    fs.writeFileSync(harness, `
import fs from 'node:fs';
const calls = [];
globalThis.args = { goal: 'build a thing' };
globalThis.pipeline = (items, fn) => Promise.all(items.map(fn));
globalThis.agent = async (prompt, opts) => {
  calls.push(opts);
  if (opts.label === 'load-registry') return JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, '.agents', 'nodes.json'))}, 'utf8'));
  if (opts.label === 'validate-mandatory-skills') return { found: [], missing: [], store_matches: [] };
  if (opts.label.startsWith('ensure-skills-')) return { installed: [], stillMissing: [] };
  if (opts.label.startsWith('archify-verify')) return { validateOk: true, deliverOk: true, checksPassed: 9, checkCount: 9, error: '' };
  if (opts.label.startsWith('architect')) return { planPath: 'p.md', needsMedia: false, deliverOk: true };
  if (opts.label.startsWith('techlead')) return { approved: true, reason: '' };
  if (opts.label.startsWith('merge-')) return { merged: 0, skipped: [], needsHuman: false };
  if (opts.label.startsWith('reviewer')) return { findings: [], blockingCount: 0 };
  if (opts.label.startsWith('shipping')) return { gate: {}, blockingNodes: [] };
  return {};
};
await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});
process.stdout.write(JSON.stringify(calls));
`);
    const r = spawnSync(process.execPath, [harness], {
      cwd, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: cwd, USERPROFILE: cwd, AOS_PLAN_APPROVAL: 'auto' },
    });
    assert.equal(r.status, 0, r.stderr);
    const calls = JSON.parse(r.stdout);
    const indexOf = (re) => calls.findIndex((c) => re.test(c.label));
    for (const node of ['architect', 'techlead', 'reviewer', 'shipping']) {
      const ensure = indexOf(new RegExp(`^ensure-skills-${node}`));
      const worker = indexOf(new RegExp(`^${node}`));
      assert.ok(ensure >= 0, `ensure-skills-${node} ran`);
      assert.ok(worker > ensure, `${node} worker ran after its ensure step`);
    }
    const architectEnsure = calls.find((c) => c.label === 'ensure-skills-architect');
    const expected = [...new Set([...(NODES.common || []), ...NODES.nodes.architect.skills])].sort();
    assert.deepEqual([...architectEnsure.skills].sort(), expected);
    // Same list the worker is told to prefer -- one source, no drift.
    const architectWorker = calls.find((c) => /^architect/.test(c.label));
    for (const s of architectEnsure.skills) assert.ok(architectWorker.prompt.includes(s), `worker prompt mentions ${s}`);
  });
});

test('standalone run installs a missing node skill into the test HOME before the worker starts', () => {
  withTmpDir('dispatch-ensure-install-', (dir) => {
    const cwd = path.join(dir, 'proj');
    fs.mkdirSync(cwd, { recursive: true });
    fs.cpSync(path.join(ROOT, '.agents'), path.join(cwd, '.agents'), { recursive: true });
    const r = spawnSync(process.execPath, [DISPATCH, 'add a status LED board'], {
      cwd, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: path.dirname(process.execPath), HOME: cwd, USERPROFILE: cwd },
    });
    // The run may escalate later (no archify binary here); the ensure step must already have run.
    const architectSkill = NODES.nodes.architect.skills.find((s) => fs.existsSync(path.join(ROOT, 'skills', s, 'SKILL.md')));
    assert.ok(architectSkill, 'architect has at least one shippable skill');
    const installed = path.join(cwd, '.agents', 'skills', architectSkill, 'SKILL.md');
    assert.ok(fs.existsSync(installed), `expected ${architectSkill} installed at ${installed}`);
  });
});
