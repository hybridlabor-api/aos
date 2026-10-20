import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildModel, ttlMemo } from '../skills/global_config/agenttrail/lib/hub-model.mjs';
import { SessionTable } from '../skills/global_config/agenttrail/lib/sessions.mjs';

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

const PLAN = `# Checkout rewrite

## Cart {#cart}
files: [src/cart.ts]

- [x] build it {#cart-build}
- [ ] wire it {#cart-wire}
`;

const PLAN_REL = 'production_artifacts/00_execution_plan.md';

function planRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'production_artifacts'), { recursive: true });
  fs.writeFileSync(path.join(dir, PLAN_REL), PLAN);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'plan');
  return fs.realpathSync(dir);
}

const taskSession = (repo, task) => {
  const t = new SessionTable();
  t.apply({ v: 1, ts: new Date().toISOString(), agent: 'claude', session: { id: 'worker' }, cwd: repo, kind: 'task.update', task });
  return t;
};

describe('ttlMemo', () => {
  test('reuses a value inside its TTL and recomputes after it', () => {
    let clock = 0;
    const memo = ttlMemo(() => clock);
    let calls = 0;
    const fn = () => { calls += 1; return calls; };

    assert.equal(memo('k', fn, 1000), 1);
    clock = 999;
    assert.equal(memo('k', fn, 1000), 1);
    clock = 1000;
    assert.equal(memo('k', fn, 1000), 2);
  });

  test('keys are independent', () => {
    const memo = ttlMemo(() => 0);
    assert.equal(memo('a', () => 'A', 1000), 'A');
    assert.equal(memo('b', () => 'B', 1000), 'B');
  });
});

describe('hub model rebuilds', () => {
  test('a second build reuses the git-derived lookups instead of spawning them again', () => {
    const repo = planRepo('trail-load-memo-');
    const inner = ttlMemo();
    let computed = 0;
    const memo = (key, fn, ttlMs) => inner(key, () => { computed += 1; return fn(); }, ttlMs);
    const args = { now: Date.now(), port: 5350, sessionTable: new SessionTable(), gate: null, asks: [], repos: [{ root: repo }], pinnedKeys: [], memo };

    buildModel(args);
    const afterFirst = computed;
    assert.ok(afterFirst > 0, 'the first build must compute the git facts');
    buildModel(args);
    assert.equal(computed, afterFirst, 'a second build inside the TTL must compute nothing new');
  });

  test('a task.update naming a plan node marks that node live on its plan', () => {
    const repo = planRepo('trail-load-live-');
    const plan = path.join(repo, PLAN_REL);
    const t = taskSession(repo, { id: 'cart-wire', status: 'doing', plan: PLAN_REL });
    const m = buildModel({ now: Date.now(), port: 5350, sessionTable: t, gate: null, asks: [], repos: [{ root: repo }], pinnedKeys: [] });
    const p = m.repos.flatMap((r) => r.plans).find((x) => x.path === plan);
    assert.ok(p, 'the plan must be on the map');
    const wire = p.tasks.find((x) => x.id === 'cart-wire');
    assert.equal(wire.live.status, 'doing');
    assert.equal(wire.live.harness, 'claude');
    assert.equal(p.progress.live, 1);
    assert.equal(p.tasks.find((x) => x.id === 'cart-build').live, null);
  });

  test('a task.update that names another plan does not touch this plan', () => {
    const repo = planRepo('trail-load-other-');
    const t = taskSession(repo, { id: 'cart-wire', status: 'doing', plan: 'docs/other-plan.md' });
    const m = buildModel({ now: Date.now(), port: 5350, sessionTable: t, gate: null, asks: [], repos: [{ root: repo }], pinnedKeys: [] });
    const p = m.repos.flatMap((r) => r.plans)[0];
    assert.equal(p.tasks.find((x) => x.id === 'cart-wire').live, null);
    assert.equal(p.progress.live, 0);
  });

  test('a task.update without a plan adopts the checkout plan only when it names one of its nodes', () => {
    const repo = planRepo('trail-load-noplan-');
    const model = (id) => buildModel({ now: Date.now(), port: 5350, sessionTable: taskSession(repo, { id, status: 'doing' }), gate: null, asks: [], repos: [{ root: repo }], pinnedKeys: [] });
    const plan = (m) => m.repos.flatMap((r) => r.plans)[0];
    const hit = plan(model('cart-wire'));
    assert.equal(hit.progress.live, 1);
    assert.equal(hit.tasks.find((x) => x.id === 'cart-wire').live.status, 'doing');
    assert.equal(hit.tasks.find((x) => x.id === 'cart-build').live, null);
    const miss = plan(model('not-in-this-plan'));
    assert.equal(miss.progress.live, 0);
    assert.ok(miss.tasks.every((x) => x.live === null));
  });
});
