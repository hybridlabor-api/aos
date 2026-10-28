// The standalone shim in .claude/workflows/fabric-dispatch.mjs must fail closed. Every test here runs the real
// dispatcher with its real shim (globalThis.agent is never replaced) against a fake `agy` on PATH, so a reply of
// the fake is the only thing that decides a stage. A failing or garbage reply at any stage must escalate and stop
// the run; the positive controls prove the same harness reaches ready_to_ship when agy answers, so the
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
const AGENTS = path.join(ROOT, '.agents');
const REVIEWERS = ['reviewer-1', 'reviewer-2', 'code-reviewer', 'devils-advocate'];
const STATE_REQUIRED = JSON.parse(fs.readFileSync(path.join(AGENTS, 'state.schema.json'), 'utf8')).required;
const SKIP_WIN = process.platform === 'win32' ? 'the fake agy is a POSIX shell script' : false;

// Role by prompt text; calls.log records the role of every agy call. A role answers with <role>.reply, or with
// <role>.reply.<n> on its n-th call; a role without a reply file fails with exit 7. Shell builtins only: PATH holds
// nothing but the fake's own directory.
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
n=0
[ -f "$AGY_DIR/$role.n" ] && read -r n < "$AGY_DIR/$role.n"
n=$((n + 1))
echo "$n" > "$AGY_DIR/$role.n"
reply="$AGY_DIR/$role.reply.$n"
[ -f "$reply" ] || reply="$AGY_DIR/$role.reply"
if [ -f "$reply" ]; then
  while IFS= read -r line || [ -n "$line" ]; do printf '%s\\n' "$line"; done < "$reply"
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
const review = (...findings) => envelope({ findings, blockingCount: findings.length });
const READY = { build: BUILD_OK, ...allReviewers(CLEAN), shipping: gatePass(GATE_KEYS) };

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

// Runs the dispatcher in a temp project with a fake agy. Replies are keyed by role ("build", "reviewer-1", "shipping");
// "reviewer-1#2" is the answer of the second call. approve: false edits the plan after its approval record was written.
// installed: run a copy of the dispatcher from <HOME>/.claude/workflows, with the libs in <HOME>/.agents/lib unless libInstalled
// is false. cli: run it as a command line (the dispatcher then ends the process with its own exit code).
function runFabric({ goal, replies = {}, approve = true, seedState = null, installed = false, libInstalled = true, cli = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-fail-closed-'));
  try {
    const proj = path.join(dir, 'proj');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(path.join(proj, '.agents'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'production_artifacts'));
    fs.mkdirSync(bin);
    fs.copyFileSync(path.join(AGENTS, 'nodes.json'), path.join(proj, '.agents', 'nodes.json'));
    fs.cpSync(path.join(AGENTS, 'profiles'), path.join(proj, '.agents', 'profiles'), { recursive: true });
    if (seedState) fs.writeFileSync(path.join(proj, 'production_artifacts', 'state.json'), JSON.stringify(seedState));

    // Every registry skill is already installed, so the shim never spawns the store CLI.
    const profiles = fs.readdirSync(path.join(AGENTS, 'profiles')).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
    for (const name of skillNames(path.join(AGENTS, 'nodes.json'), ...profiles.map((f) => path.join(AGENTS, 'profiles', f)))) {
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
    for (const [key, body] of Object.entries(replies)) {
      const [role, nth] = key.split('#');
      fs.writeFileSync(path.join(bin, nth ? `${role}.reply.${nth}` : `${role}.reply`), `${body}\n`);
    }

    // The installed layout of installer.js: the dispatcher in a harness dir, the libs only under ~/.agents/lib.
    let dispatchPath = DISPATCH;
    if (installed) {
      dispatchPath = path.join(proj, '.claude', 'workflows', 'fabric-dispatch.mjs');
      fs.mkdirSync(path.dirname(dispatchPath), { recursive: true });
      fs.copyFileSync(DISPATCH, dispatchPath);
      if (libInstalled) {
        fs.mkdirSync(path.join(proj, '.agents', 'lib'), { recursive: true });
        for (const lib of ['fabric-plan-approval.mjs', 'fabric-review-dedupe.mjs']) {
          fs.copyFileSync(path.join(ROOT, 'lib', lib), path.join(proj, '.agents', 'lib', lib));
        }
      }
    }

    const resultFile = path.join(dir, 'result.json');
    const harness = path.join(dir, 'run.mjs');
    fs.writeFileSync(harness, `
import fs from 'node:fs';
globalThis.args = { goal: ${JSON.stringify(goal)} };
const mod = await import(${JSON.stringify(pathToFileURL(dispatchPath).href)});
fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify(mod.default));
`);

    const r = spawnSync(process.execPath, cli ? [dispatchPath, ...goal.split(' ')] : [harness], {
      cwd: proj,
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: bin, HOME: proj, USERPROFILE: proj, AGY_DIR: bin, RESULT_FILE: resultFile,
        ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir() } : {}),
      },
    });
    if (!cli) assert.equal(r.status, 0, `the dispatcher run must end cleanly, got ${r.status}. stderr: ${r.stderr}`);

    const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
    const raw = cli ? r.stdout.slice(r.stdout.indexOf('{')) : read(resultFile);
    assert.ok(raw, `the dispatcher returned no result. stderr: ${r.stderr}`);
    return {
      status: r.status,
      result: JSON.parse(raw),
      calls: read(path.join(bin, 'calls.log')).split('\n').filter(Boolean),
      state: JSON.parse(read(path.join(proj, 'production_artifacts', 'state.json')) || '{}'),
      review: read(path.join(proj, 'production_artifacts', 'review_findings.md')),
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

// What a --plan run leaves in state.json: the keys the schema requires, and the record that the plan came pre-approved.
function assertPreApprovedState(state) {
  for (const key of STATE_REQUIRED) assert.ok(key in state, `state.json lacks the required key ${key}`);
  assert.equal(state.pre_approved, true);
  assert.equal(state.approval_source, 'plan.md');
  assert.match(state.approval_hash, /^[0-9a-f]{64}$/);
  assert.equal(state.artifacts.plan, 'plan.md');
}

describe('fabric-dispatch standalone shim: fail-closed on executor failure', () => {
  test('a failing agy at the Architect step escalates', () => {
    const run = runFabric({ goal: 'add a login page' });
    assertEscalated(run, /Architect executor failed/);
  });

  describe('with a pre-approved plan', { skip: SKIP_WIN }, () => {
    const goal = '--plan plan.md add a login page';

    test('a failing agy at the build step escalates and never reaches the review', () => {
      const run = runFabric({ goal });
      assertEscalated(run, /One or more build nodes failed: .*agy exited 7/);
      assert.ok(!run.calls.some((c) => c.startsWith('reviewer') || c === 'shipping'), `got: ${run.calls.join(', ')}`);
    });

    test('a failing agy at the only build node of a domain profile escalates', () => {
      const run = runFabric({ goal: `--profile=copywriter ${goal}` });
      assertEscalated(run, /Build node copy failed: .*agy exited 7/);
      assert.deepEqual(run.calls, ['build']);
    });

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

    test('a finding with an unknown severity, status or node, or without a summary, escalates instead of reading as clean', () => {
      const good = finding('A1', 'engineering', 'Missing input validation');
      const bad = [
        { ...good, severity: 'critical' },
        { ...good, status: 'resolved' },
        { ...good, node: 'media_eventtech' },
        { ...good, summary: undefined },
      ];
      for (const f of bad) {
        const run = runFabric({ goal, replies: { build: BUILD_OK, ...allReviewers(CLEAN), 'reviewer-1': review(f) } });
        assertEscalated(run, /Reviewer reviewer-1 escalated: a finding does not match the review schema/);
        assert.ok(!run.calls.includes('shipping'), `${JSON.stringify(f)} must not reach shipping, got: ${run.calls.join(', ')}`);
      }
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
      const run = runFabric({ goal, approve: false, replies: READY });
      assertEscalated(run, /does not match approval record/);
      assert.deepEqual(run.calls, []);
    });

    test('--plan values that cannot be trusted are refused before any agent runs', () => {
      const cases = [
        ['--plan plan.md --plan other.md add a login page', /more than once/],
        ['--plan notes.txt add a login page', /must end with \.md/],
        ['--plan missing.md add a login page', /does not exist/],
        ['--plan= add a login page', /Malformed --plan flag/],
        ['add a login page --plan', /Malformed --plan flag/],
      ];
      for (const [badGoal, reason] of cases) {
        const run = runFabric({ goal: badGoal });
        assertEscalated(run, reason);
        assert.deepEqual(run.calls, [], badGoal);
      }
    });

    test('the command line exits non-zero on a refused plan and zero on a finished run', () => {
      const refused = runFabric({ goal, approve: false, replies: READY, cli: true });
      assert.equal(refused.status, 1, JSON.stringify(refused.result));
      assert.match(refused.result.reason, /does not match approval record/);

      const done = runFabric({ goal, replies: READY, cli: true });
      assert.equal(done.status, 0, JSON.stringify(done.result));
      assert.equal(done.result.phase, 'ready_to_ship');
    });

    test('the same finding on two different nodes keeps both nodes in the repair loop and is recorded', () => {
      const run = runFabric({
        goal,
        replies: {
          ...READY,
          'reviewer-1': review(finding('A1', 'engineering', 'Missing input validation')),
          'reviewer-2': review(finding('B1', 'ui_ux', 'Missing input validation')),
        },
      });
      assertEscalated(run, /No progress/);
      // two build nodes in the first pass and the same two in the repair pass; one merged finding would repair one node
      assert.equal(run.calls.filter((c) => c === 'build').length, 4, `got: ${run.calls.join(', ')}`);
      // the read-only reviewers cannot write: the dispatcher records the merged review, with the keys the schema allows
      assert.deepEqual(run.state.findings, [
        finding('A1', 'engineering', 'Missing input validation'),
        finding('B1', 'ui_ux', 'Missing input validation'),
      ]);
      assert.match(run.review, /A1: Missing input validation/);
    });

    test('blocking findings still open after the second review escalate without another repair', () => {
      const run = runFabric({
        goal,
        replies: {
          ...READY,
          'reviewer-1': review(finding('F1', 'engineering', 'Missing input validation')),
          'reviewer-1#2': review(finding('F2', 'engineering', 'Race in the cache layer')),
        },
      });
      assertEscalated(run, /Reviewer round 2/);
      // both nodes in the first pass, the owning node alone in the one repair pass, no second repair
      assert.equal(run.calls.filter((c) => c === 'build').length, 3, `got: ${run.calls.join(', ')}`);
      assert.deepEqual(run.state.findings, [finding('F2', 'engineering', 'Race in the cache layer')]);
    });

    test('positive control: profile build ids pass and the run reaches ready_to_ship', () => {
      const run = runFabric({
        goal: `--profile=kicad ${goal}`,
        replies: { ...READY, shipping: gatePass(['erc', 'drc', 'constraints']) },
      });
      assert.equal(run.result.phase, 'ready_to_ship', JSON.stringify(run.result));
      assert.equal(run.calls.filter((c) => c === 'build').length, 2, 'pcb and firmware both build');
      assertPreApprovedState(run.state);
    });

    test('positive control: the default pipeline reaches ready_to_ship', () => {
      const run = runFabric({ goal, replies: READY });
      assert.equal(run.result.phase, 'ready_to_ship', JSON.stringify(run.result));
      assertPreApprovedState(run.state);
      assert.deepEqual(run.state.findings, []);
      assert.match(run.review, /No findings/);
    });

    test('a state.json left by an earlier escalated run does not leak into a --plan run', () => {
      const run = runFabric({
        goal,
        replies: READY,
        seedState: {
          run_id: 'old-run', goal: 'old goal', phase: 'escalated', needs_human: true, iteration: 2, max_iterations: 3,
          gate: { lint: 'fail' }, approvals: [], pipeline: 'fabric-graph',
          findings: [finding('OLD', 'engineering', 'stale finding')],
          artifacts: { plan: 'old.md', frontend: 'production_artifacts/01_frontend_spec.md' },
        },
      });
      assert.equal(run.result.phase, 'ready_to_ship', JSON.stringify(run.result));
      assertPreApprovedState(run.state);
      assert.equal(run.state.needs_human, false);
      assert.equal(run.state.goal, 'add a login page');
      assert.deepEqual(run.state.gate, {});
      assert.deepEqual(run.state.findings, []);
      assert.equal(run.state.run_id, 'old-run', 'scaffold keys of the project stay');
      assert.equal(run.state.pipeline, 'fabric-graph');
      assert.equal(run.state.artifacts.frontend, 'production_artifacts/01_frontend_spec.md');
    });

    test('an installed dispatcher finds the libs under ~/.agents/lib', () => {
      const run = runFabric({ goal, replies: READY, installed: true });
      assert.equal(run.result.phase, 'ready_to_ship', JSON.stringify(run.result));
      assertPreApprovedState(run.state);
    });

    test('an installed dispatcher without the libs refuses --plan instead of skipping the approval check', () => {
      const run = runFabric({ goal, replies: READY, installed: true, libInstalled: false });
      assertEscalated(run, /Plan approval module unavailable/);
      assert.deepEqual(run.calls, []);
    });
  });
});
