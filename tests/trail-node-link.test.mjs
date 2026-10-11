import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildModel } from '../skills/global_config/agenttrail/lib/hub-model.mjs';
import { SessionTable } from '../skills/global_config/agenttrail/lib/sessions.mjs';
import { fromLegacyHook } from '../skills/global_config/agenttrail/lib/events.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RELAY = path.join(here, '..', '.claude', 'hooks', 'trail-relay.mjs');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};

const PLAN_REL = 'production_artifacts/00_execution_plan.md';
const PLAN = `# Checkout rewrite

## Cart {#cart}
files: [src/cart.ts]

- [x] build it {#cart-build}
- [ ] wire it {#cart-wire}
`;

function planRepo(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'production_artifacts'), { recursive: true });
  fs.writeFileSync(path.join(dir, PLAN_REL), PLAN);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'plan');
  return dir;
}

const withNode = { id: 'cart-wire', status: 'doing', plan: PLAN_REL };

// The relay stamps the node onto the raw hook payload; /hook maps it through fromLegacyHook.
function hookEvent(hook, repo, task) {
  return fromLegacyHook({
    hook_event_name: hook,
    session_id: 'worker-1',
    cwd: repo,
    agent: 'claude',
    tool_name: hook === 'PreToolUse' ? 'Edit' : undefined,
    ...(task ? { task } : {}),
  });
}

const modelFor = (repo, table) => buildModel({
  now: Date.now(), port: 5350, sessionTable: table, gate: null, asks: [], repos: [{ root: repo }], pinnedKeys: [],
});
const planOf = (m) => m.repos.flatMap((r) => r.plans)[0];

describe('relayed node link (hub)', () => {
  test('a relayed PreToolUse carrying a node marks that node live', () => {
    const repo = planRepo('trail-link-live-');
    const t = new SessionTable();
    t.apply(hookEvent('PreToolUse', repo, withNode));
    const wire = planOf(modelFor(repo, t)).tasks.find((x) => x.id === 'cart-wire');
    assert.equal(wire.live.status, 'doing');
    assert.equal(wire.live.harness, 'claude');
  });

  test('an event without a node marks nothing live', () => {
    const repo = planRepo('trail-link-none-');
    const t = new SessionTable();
    t.apply(hookEvent('PreToolUse', repo));
    assert.equal(planOf(modelFor(repo, t)).progress.live, 0);
  });

  test('Stop clears the live node, records it as touched, and never marks it done', () => {
    const repo = planRepo('trail-link-stop-');
    const t = new SessionTable();
    t.apply(hookEvent('PreToolUse', repo, withNode));
    t.apply(hookEvent('Stop', repo, withNode));
    const p = planOf(modelFor(repo, t));
    const wire = p.tasks.find((x) => x.id === 'cart-wire');
    assert.equal(wire.live, null);
    assert.equal(p.progress.live, 0);
    assert.ok(wire.touchedAt, 'the stopped node must carry touchedAt');
    assert.notEqual(wire.status, 'done');
  });

  test('SessionEnd clears the live node and keeps it touched', () => {
    const repo = planRepo('trail-link-end-');
    const t = new SessionTable();
    t.apply(hookEvent('PreToolUse', repo, withNode));
    t.apply(hookEvent('SessionEnd', repo, withNode));
    const wire = planOf(modelFor(repo, t)).tasks.find((x) => x.id === 'cart-wire');
    assert.equal(wire.live, null);
    assert.ok(wire.touchedAt);
  });

  test('a node in another plan path does not light this plan', () => {
    const repo = planRepo('trail-link-other-');
    const t = new SessionTable();
    t.apply(hookEvent('PreToolUse', repo, { ...withNode, plan: 'docs/other.md' }));
    assert.equal(planOf(modelFor(repo, t)).progress.live, 0);
  });
});

describe('trail relay hook: AOS_TRAIL_NODE / AOS_TRAIL_PLAN', () => {
  // Starts a local stand-in for the hub and returns every body the relay posted.
  async function relay(env) {
    const bodies = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => { bodies.push(JSON.parse(raw)); res.statusCode = 204; res.end(); });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const childEnv = { ...process.env, AGENTTRAIL_PORT: String(server.address().port), AGENTTRAIL_LEGACY: '0' };
    delete childEnv.AOS_TRAIL_NODE;
    delete childEnv.AOS_TRAIL_PLAN;
    Object.assign(childEnv, env);
    try {
      await new Promise((resolve) => {
        const child = spawn(process.execPath, [RELAY, '--agent', 'claude'], { env: childEnv, stdio: ['pipe', 'ignore', 'ignore'] });
        child.on('exit', resolve);
        child.stdin.end(JSON.stringify({ session_id: 'w1', cwd: '/abs/repo', hook_event_name: 'PreToolUse', tool_name: 'Edit' }));
      });
    } finally {
      server.close();
    }
    return bodies;
  }

  test('adds node and plan from the env to the posted event', async () => {
    const [ev] = await relay({ AOS_TRAIL_NODE: 'cart-wire', AOS_TRAIL_PLAN: PLAN_REL });
    assert.deepEqual(ev.task, { id: 'cart-wire', status: 'doing', plan: PLAN_REL });
    assert.equal(ev.tool_name, 'Edit');
  });

  test('without the env the event is posted unchanged', async () => {
    const [ev] = await relay({});
    assert.equal(ev.task, undefined);
  });
});
