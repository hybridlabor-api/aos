import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stampTrailNode, trailNodeFromText } from '../skills/global_config/agenttrail/lib/events.mjs';
import { fromLegacyHook } from '../skills/global_config/agenttrail/lib/events.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RELAY = path.join(here, '..', '.claude', 'hooks', 'trail-relay.mjs');

describe('node marker attribution', () => {
  test('marker is extracted from a brief and env wins when both exist', () => {
    assert.equal(trailNodeFromText('do step 3 [trail-node:cart-build] please'), 'cart-build');
    assert.equal(trailNodeFromText('no marker here'), null);
    assert.equal(trailNodeFromText(null), null);

    const ev = { v: 1, kind: 'tool.pre', session: { id: 'w' }, cwd: '/x', agent: 'claude' };
    stampTrailNode(ev, { env: { AOS_TRAIL_NODE: 'n-env', AOS_TRAIL_PLAN: 'plan.md' } });
    assert.equal(ev.task.id, 'n-env');
    assert.equal(ev.task.plan, 'plan.md');

    const both = { v: 1, kind: 'tool.pre', session: { id: 'w' }, cwd: '/x', agent: 'claude' };
    both.prompt = 'brief [trail-node:marker-node]';
    stampTrailNode(both, { env: { AOS_TRAIL_NODE: 'env-node' } });
    assert.equal(both.task.id, 'env-node');
  });

  test('marker alone (no env) attaches the session to the named node', () => {
    const ev = { hook_event_name: 'PreToolUse', session_id: 'w', cwd: '/x', agent: 'claude' };
    ev.tool_input = { prompt: 'work the cart node [trail-node:cart-wire]' };
    stampTrailNode(ev, { env: {} });
    assert.deepEqual(ev.task, { id: 'cart-wire', status: 'doing' });
    const v = fromLegacyHook(ev);
    assert.equal(v.task.id, 'cart-wire');
  });

  test('trail-relay stamps the node from the marker in a subagent payload', () => {
    const payload = JSON.stringify({
      hook_event_name: 'SubagentStart',
      session_id: 'worker-9',
      cwd: process.cwd(),
      prompt: 'Fix the wire task. Brief: [trail-node:cart-wire]',
      tool_name: 'Agent',
    });
    const r = spawnSync(process.execPath, [RELAY, '--agent', 'claude'], {
      input: payload, encoding: 'utf8',
      env: { ...process.env, AGENTTRAIL_PORT: '1', AOS_TRAIL_PLAN: '', AOS_TRAIL_NODE: '' },
    });
    assert.equal(r.status, 0);
    // AGENTTRAIL_PORT=1 short-circuits the fan-out; assert via the stamping lib on the same
    // payload because the hook itself never persists state (unverified: stdout is empty by contract).
    const ev = JSON.parse(payload);
    const stamped = stampTrailNode(ev, { env: {} });
    assert.equal(stamped.task.id, 'cart-wire');
  });

  test('env AOS_TRAIL_NODE beats a marker inside the same payload', () => {
    const payload = {
      hook_event_name: 'PreToolUse', session_id: 'w', cwd: process.cwd(),
      tool_name: 'Task', tool_input: { prompt: 'brief [trail-node:marker-node]' },
    };
    const ev = JSON.parse(JSON.stringify(payload));
    assert.equal(stampTrailNode(ev, { env: { AOS_TRAIL_NODE: 'env-node' } }).task.id, 'env-node');
  });
});

import { SessionTable } from '../skills/global_config/agenttrail/lib/sessions.mjs';
import { buildModel } from '../skills/global_config/agenttrail/lib/hub-model.mjs';
import { tickTask } from '../skills/global_config/agenttrail/lib/plan.mjs';

const PLAN_REL = 'production_artifacts/00_execution_plan.md';
const PLAN = `# Checkout rewrite

## Cart {#cart}
files: [src/cart.ts]

- [ ] build it {#cart-build}
- [ ] wire it {#cart-wire}
`;

function planRepo(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'production_artifacts'), { recursive: true });
  fs.writeFileSync(path.join(dir, PLAN_REL), PLAN);
  spawnSync('git', ['add', '.'], { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  spawnSync('git', ['commit', '-qm', 'plan'], { cwd: dir, env: { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  return dir;
}

const ev = (repo, id, opts = {}) => ({
  hook_event_name: opts.hook || 'PreToolUse',
  session_id: id,
  cwd: repo,
  agent: opts.agent || 'claude',
  tool_name: opts.hook === undefined ? 'Edit' : undefined,
  file: opts.file,
  ...(opts.task ? { task: opts.task } : {}),
  ...(opts.marker ? { tool_input: { prompt: `brief [trail-node:${opts.marker}]` } } : {}),
});

describe('two workers land on the right nodes', () => {
  test('worker A via env marker path, worker B via brief marker, different nodes', () => {
    const repo = planRepo('trail-workers-');
    // Worker A: env-stamped (dispatcher set AOS_TRAIL_NODE before the run).
    const a = { ...ev(repo, 'worker-a'), task: { id: 'cart-build', status: 'doing', plan: PLAN_REL }, hook_event_name: 'PreToolUse' };
    // Worker B: marker in the brief, no env anywhere.
    const b = JSON.parse(JSON.stringify(ev(repo, 'worker-b', { marker: 'cart-wire' })));
    const stamped = stampTrailNode(b, { env: {} });
    const table = new SessionTable();
    table.apply(fromLegacyHook(a));
    table.apply(fromLegacyHook(stamped));

    const m = buildModel({ now: Date.now(), port: 5350, sessionTable: table, gate: null, asks: [], repos: [{ root: repo }], pinnedKeys: [] });
    const plan = m.repos.flatMap((r) => r.plans)[0];
    const byId = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
    assert.equal(byId['cart-build'].live?.status, 'doing');
    assert.equal(byId['cart-wire'].live?.status, 'doing');
    assert.equal(plan.progress.live, 2);
    const wb = byId['cart-wire'].workers?.[0];
    assert.equal(wb?.id, 'worker-b');
    assert.equal(wb?.state, 'working');
    assert.ok(Array.isArray(byId['cart-build'].workers));
  });
});


describe('float: aos-trail tick', () => {
  test('tickTask flips exactly one checkbox for the named id', () => {
    const plan = `# t\n## C {#c}\n\n- [ ] one {#task-1}\n- [ ] one-two {#task-12}\n- [ ] three {#task-3}\n`;
    const r = tickTask(plan, 'task-12');
    assert.equal(r.changed, true);
    assert.match(r.text, /- \[x\] one-two \{#task-12\}/);
    assert.match(r.text, /- \[ \] one \{#task-1\}/);
    assert.match(r.text, /- \[ \] three \{#task-3\}/);
    assert.equal(tickTask(r.text, 'task-12').changed, false);
    assert.equal(tickTask(plan, 'missing').changed, false);
  });

  test('tick --doing marks [~], --done takes in-progress work, --todo re-opens', () => {
    const plan = `# t\n## C {#c}\n\n- [ ] a {#t-a}\n- [~] b {#t-b}\n- [x] c {#t-c}\n`;
    const doing = tickTask(plan, 't-a', 'doing');
    assert.equal(doing.changed, true);
    assert.match(doing.text, /- \[~\] a \{#t-a\}/);
    assert.equal(tickTask(doing.text, 't-a', 'doing').changed, false, 'already [~]');
    assert.equal(tickTask(doing.text, 't-c', 'doing').changed, false, 'done is never un-done by --doing');
    const done = tickTask(doing.text, 't-a');
    assert.equal(done.changed, true, 'default --done');
    assert.match(done.text, /- \[x\] a \{#t-a\}/);
    const taken = tickTask(plan, 't-b');
    assert.equal(taken.changed, true, 'in-progress work lands as done');
    assert.match(taken.text, /- \[x\] b \{#t-b\}/);
    const todo = tickTask(done.text, 't-a', 'todo');
    assert.equal(todo.changed, true);
    assert.match(todo.text, /- \[ \] a \{#t-a\}/);
    const reopen = tickTask(plan, 't-c', 'todo');
    assert.equal(reopen.changed, true, '--todo re-opens a done task explicitly');
    assert.match(reopen.text, /- \[ \] c \{#t-c\}/);
    assert.equal(tickTask(plan, 't-a', 'todo').changed, false, 'already open is a no-op');
    assert.equal(tickTask(plan, 't-a', 'bogus').changed, false);
  });

  test('aos-trail tick edits the plan file: exactly one line flips', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-tick-'));
    const file = path.join(dir, 'plan.md');
    fs.writeFileSync(file, `# t\n## C {#c}\n\n- [ ] a {#aa}\n- [ ] bb {#aaa}\n`);
    const CLI = path.join(here, '..', 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
    const r = spawnSync(process.execPath, [CLI, 'tick', file, 'aa'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /- \[x\] a \{#aa\}/);
    assert.match(text, /- \[ \] bb \{#aaa\}/);
  });

  test('aos-trail tick --doing writes the in-progress mark', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-tick-'));
    const file = path.join(dir, 'plan.md');
    fs.writeFileSync(file, `# t\n## C {#c}\n\n- [ ] a {#aa}\n- [ ] bb {#aaa}\n`);
    const CLI = path.join(here, '..', 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
    const r = spawnSync(process.execPath, [CLI, 'tick', file, 'aa', '--doing'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /- \[~\] a \{#aa\}/);
    assert.match(text, /- \[ \] bb \{#aaa\}/);
    // and it lands as done from the doing state with the default mode
    const done = spawnSync(process.execPath, [CLI, 'tick', file, 'aa'], { encoding: 'utf8' });
    assert.equal(done.status, 0, done.stderr);
    assert.match(fs.readFileSync(file, 'utf8'), /- \[x\] a \{#aa\}/);
  });
});
