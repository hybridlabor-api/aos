// The standalone shim in .claude/workflows/fabric-dispatch.mjs must fail closed. Every test here runs the real
// dispatcher with its real shim (globalThis.agent is never replaced) against a fake `agy` on PATH, so a reply of
// the fake is the only thing that decides a stage. A failing or garbage reply at any stage must escalate and stop
// the run; the positive control proves the same harness reaches ready_to_ship when agy answers, so the
// escalations come from the executor and not from the harness.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DISPATCH = path.join(ROOT, '.claude', 'workflows', 'fabric-dispatch.mjs');
const REVIEWERS = ['reviewer-1', 'reviewer-2', 'code-reviewer', 'devils-advocate'];
const SKIP_WIN = process.platform === 'win32' ? 'the fake agy is a POSIX shell script' : false;

// Role by prompt text; calls.log records the role of every agy call. A role without a <role>.reply file fails with exit 7.
// Shell builtins only: PATH holds nothing but the fake's own directory.
const FAKE_AGY = `#!/bin/sh
case "$2" in
  "[trail-node:"*) role=build ;;
  *"acting as the reviewer-1 agent"*) role=reviewer-1 ;;
  *"acting as the reviewer-2 agent"*) role=reviewer-2 ;;
  *"acting as the code-reviewer agent"*) role=code-reviewer ;;
  *"acting as the devils-advocate agent"*) role=devils-advocate ;;
  *"Run the automated quality gate"*) role=shipping ;;
  *) role=other ;;
esac
echo "$role" >> "$AGY_DIR/calls.log"
if [ -f "$AGY_DIR/$role.reply" ]; then
  while IFS= read -r line || [ -n "$line" ]; do printf '%s\\n' "$line"; done < "$AGY_DIR/$role.reply"
  exit 0
fi
echo "agy: simulated failure for $role" >&2
exit 7
`;

const envelope = (payload) => JSON.stringify({
  conversation_id: 'c1',
  status: 'ok',
  response: typeof payload === 'string' ? payload : JSON.stringify(payload),
});
const allReviewers = (payload) => Object.fromEntries(REVIEWERS.map((id) => [id, envelope(payload)]));
const BUILD_OK = envelope({});
const CLEAN = { findings: [], blockingCount: 0 };
const GATE_KEYS = ['lint', 'typecheck', 'tests', 'a11y', 'seo', 'security'];
const gatePass = (keys) => envelope({ gate: Object.fromEntries(keys.map((k) => [k, 'pass'])), blockingNodes: [] });
const finding = (id, node, summary) => ({ id, severity: 'blocking', node, summary, status: 'open' });

function skillNames(...files) {
  const names = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'skills' || k === 'common') && Array.isArray(x)) x.forEach((s) => names.add(s));
        else walk(x);
      }
    }
  };
  for (const f of files) walk(JSON.parse(fs.readFileSync(f, 'utf8')));
  return [...names];
}

// Runs the dispatcher in a temp project with a fake agy. approve: false edits the plan after its approval record was written.
function runFabric({ goal, replies = {}, approve = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-fail-closed-'));
  try {
    const proj = path.join(dir, 'proj');
    const bin = path.join(dir, 'bin');
    const nodesFile = path.join(ROOT, '.agents', 'nodes.json');
    const kicadFile = path.join(ROOT, '.agents', 'profiles', 'kicad.json');
    fs.mkdirSync(path.join(proj, '.agents', 'profiles'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'production_artifacts'));
    fs.mkdirSync(bin);
    fs.copyFileSync(nodesFile, path.join(proj, '.agents', 'nodes.json'));
    fs.copyFileSync(kicadFile, path.join(proj, '.agents', 'profiles', 'kicad.json'));

    // Every registry skill is already installed, so the shim never spawns the store CLI.
    for (const name of skillNames(nodesFile, kicadFile)) {
      fs.mkdirSync(path.join(proj, '.claude', 'skills', name), { recursive: true });
      fs.writeFileSync(path.join(proj, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`);
    }

    const plan = '# Pre-approved plan\n\nBuild the thing.\n';
    fs.writeFileSync(path.join(proj, 'plan.md'), plan);
    fs.writeFileSync(path.join(proj, 'plan.approval.json'), JSON.stringify({
      schema: 'aos.plan-approval/1',
      verdict: 'approve',
      contentHash: createHash('sha256').update(plan).digest('hex'),
      source: 'plan-canvas',
    }));
    if (!approve) fs.writeFileSync(path.join(proj, 'plan.md'), `${plan}\nScope creep added after approval.\n`);

    fs.writeFileSync(path.join(bin, 'agy'), FAKE_AGY);
    fs.chmodSync(path.join(bin, 'agy'), 0o755);
    for (const [role, body] of Object.entries(replies)) fs.writeFileSync(path.join(bin, `${role}.reply`), `${body}\n`);

    const harness = path.join(dir, 'run.mjs');
    fs.writeFileSync(harness, `
import fs from 'node:fs';
globalThis.args = { goal: ${JSON.stringify(goal)} };
const mod = await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});
fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify(mod.default));
`);

    const resultFile = path.join(dir, 'result.json');
    const r = spawnSync(process.execPath, [harness], {
      cwd: proj,
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: bin, HOME: proj, USERPROFILE: proj, AGY_DIR: bin, RESULT_FILE: resultFile,
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir() } : {}),
      },
    });
    assert.equal(r.status, 0, `the dispatcher run must end cleanly, got ${r.status}. stderr: ${r.stderr}`);

    const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    return {
      result: JSON.parse(read(resultFile)),
      calls: read(path.join(bin, 'calls.log')).split('\n').filter(Boolean),
      state: JSON.parse(read(path.join(proj, 'production_artifacts', 'state.json')) || '{}'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertEscalated({ result, state }, reason) {
  assert.equal(result.phase, 'escalated', `phase should be escalated, got ${JSON.stringify(result)}`);
  assert.match(result.reason, reason);
  assert.equal(state.phase, 'escalated', 'the escalation must be written to state.json');
  assert.equal(state.needs_human, true);
}

describe('fabric-dispatch standalone shim: fail-closed on executor failure', () => {
  test('a failing agy at the Architect step escalates', () => {
    const run = runFabric({ goal: 'add a login page' });
    assertEscalated(run, /Architect executor failed/);
  });

  describe('with a pre-approved plan', { skip: SKIP_WIN }, () => {
    const goal = '--plan plan.md add a login page';

    test('a failing agy at the review step escalates and never reaches shipping', () => {
      const run = runFabric({ goal, replies: { build: BUILD_OK } });
      assertEscalated(run, /Reviewer reviewer-1 escalated: agy exited 7/);
      assert.ok(run.calls.includes('build'), `the build step should have run, got: ${run.calls.join(', ')}`);
      assert.ok(run.calls.includes('reviewer-1'), `the review step should have run, got: ${run.calls.join(', ')}`);
      assert.ok(!run.calls.includes('shipping'), `shipping must not run, got: ${run.calls.join(', ')}`);
    });

    test('a reply that is not a review escalates instead of reading as a clean review', () => {
      const run = runFabric({ goal, replies: { build: BUILD_OK, ...allReviewers('Looks fine to me, ship it.') } });
      assertEscalated(run, /Reviewer reviewer-1 escalated: findings is not an array/);
      assert.ok(!run.calls.includes('shipping'), `shipping must not run, got: ${run.calls.join(', ')}`);
    });

    test('a failing agy at the quality gate escalates and never reaches ready_to_ship', () => {
      const run = runFabric({ goal, replies: { build: BUILD_OK, ...allReviewers(CLEAN) } });
      assertEscalated(run, /Shipping executor failed: agy exited 7/);
      assert.deepEqual(run.calls.filter((c) => c === 'shipping'), ['shipping']);
    });

    test('a gate reply without gate results escalates', () => {
      const run = runFabric({ goal, replies: { build: BUILD_OK, ...allReviewers(CLEAN), shipping: envelope({ blockingNodes: [] }) } });
      assertEscalated(run, /Shipping executor failed: gate is not an object/);
    });

    test('a plan edited after its approval is refused before any agent runs', () => {
      const run = runFabric({ goal, approve: false, replies: { build: BUILD_OK, ...allReviewers(CLEAN) } });
      assertEscalated(run, /does not match approval record/);
      assert.deepEqual(run.calls, []);
    });

    test('the same finding on two different nodes keeps both nodes in the repair loop', () => {
      const run = runFabric({
        goal,
        replies: {
          build: BUILD_OK,
          ...allReviewers(CLEAN),
          'reviewer-1': envelope({ findings: [finding('A1', 'engineering', 'Missing input validation')], blockingCount: 1 }),
          'reviewer-2': envelope({ findings: [finding('B1', 'ui_ux', 'Missing input validation')], blockingCount: 1 }),
        },
      });
      assertEscalated(run, /No progress/);
      // two build nodes in the first pass and the same two in the repair pass; one merged finding would repair one node
      assert.equal(run.calls.filter((c) => c === 'build').length, 4, `got: ${run.calls.join(', ')}`);
    });

    test('positive control: profile build ids pass and the run reaches ready_to_ship', () => {
      const run = runFabric({
        goal: `--profile=kicad ${goal}`,
        replies: { build: BUILD_OK, ...allReviewers(CLEAN), shipping: gatePass(['erc', 'drc', 'constraints']) },
      });
      assert.equal(run.result.phase, 'ready_to_ship', JSON.stringify(run.result));
      assert.equal(run.calls.filter((c) => c === 'build').length, 2, 'pcb and firmware both build');
    });

    test('positive control: the default pipeline reaches ready_to_ship', () => {
      const run = runFabric({
        goal,
        replies: { build: BUILD_OK, ...allReviewers(CLEAN), shipping: gatePass(GATE_KEYS) },
      });
      assert.equal(run.result.phase, 'ready_to_ship', JSON.stringify(run.result));
    });
  });
});
