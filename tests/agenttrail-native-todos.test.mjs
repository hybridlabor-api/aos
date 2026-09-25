/**
 * tests/agenttrail-native-todos.test.mjs
 *
 * Covers two behaviors added to agenttrail.mjs:
 *   1. normalizeTodos() recognizes Claude's TodoWrite, OpenCode's Todowrite
 *      (title-cased by mcsc's opencode.js before it reaches the hook), and
 *      Codex's update_plan, all normalized to {content, status}.
 *   2. When a repo has no plan file, a live run with todos gets a synthetic
 *      board card (synthetic: true) instead of the empty "waiting for the
 *      plan" state — but a real plan file always wins outright, never mixed
 *      with synthetic nodes.
 *
 * Boots two REAL daemons on scratch repos and their own ports in 5350-5359
 * (never the user's daemons on 5330-5344), matching the harness pattern in
 * tests/agenttrail-ask.test.mjs.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const AGENTTRAIL_BIN = path.join(REPO_ROOT, 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function probeFreePort(start, floor) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      if (p < floor) return resolve(start);
      const srv = net.createServer();
      srv.once('error', () => { srv.close(() => tryPort(p - 1)); });
      srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(p)));
    };
    tryPort(start);
  });
}

async function bootDaemon(repo, extraArgs, portStart, portFloor) {
  const port = await probeFreePort(portStart, portFloor);
  const child = spawn(process.execPath, [AGENTTRAIL_BIN, repo, '--port', String(port), '--no-open', ...extraArgs], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdoutBuf = '', stderrBuf = '';
  child.stdout.on('data', (c) => { stdoutBuf += c; });
  child.stderr.on('data', (c) => { stderrBuf += c; });
  const deadline = Date.now() + 20000;
  let daemonPort = 0, base = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) assert.fail(`daemon exited early (code ${child.exitCode}):\n${stderrBuf}`);
    const m = stdoutBuf.match(/http:\/\/localhost:(\d+)/);
    if (m) {
      daemonPort = Number(m[1]);
      base = `http://127.0.0.1:${daemonPort}`;
      try {
        const r = await fetch(`${base}/whoami`, { signal: AbortSignal.timeout(1000) });
        const j = await r.json();
        if (j && j.repoPath === repo) return { child, base, port: daemonPort };
      } catch { /* not up yet */ }
    }
    await sleep(200);
  }
  assert.fail(`daemon not ready within 20s\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`);
}

async function killDaemon(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const end = Date.now() + 3000;
  while (child.exitCode === null && Date.now() < end) await sleep(100);
  if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch {} }
}

function rmState(repo) {
  try {
    const hash = crypto.createHash('sha1').update(repo).digest('hex').slice(0, 12);
    fs.rmSync(path.join(os.homedir(), '.agenttrail', `${hash}.json`), { force: true });
  } catch {}
}

function postHook(base, ev) {
  return fetch(`${base}/hook`, {
    method: 'POST',
    body: JSON.stringify(ev),
    signal: AbortSignal.timeout(3000),
  });
}

describe('agenttrail: native cross-harness plan/todo support', () => {
  let repoNoPlan, daemonNoPlan;
  let repoWithPlan, daemonWithPlan;

  before(async () => {
    repoNoPlan = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-notodos-'));
    daemonNoPlan = await bootDaemon(repoNoPlan, [], 5359, 5350);

    repoWithPlan = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-plan-'));
    fs.writeFileSync(path.join(repoWithPlan, 'PLAN.md'), [
      '# Native Todos Test Repo',
      '',
      '## Real component {#real}',
      'tech: exists on disk, must always win over synthetic nodes',
      '- [ ] Do the thing {#do-thing}',
      '',
      '## decisions',
      '',
    ].join('\n'));
    daemonWithPlan = await bootDaemon(repoWithPlan, ['--plan', 'PLAN.md'], 5349, 5340);
  });

  after(async () => {
    await killDaemon(daemonNoPlan?.child);
    await killDaemon(daemonWithPlan?.child);
    rmState(repoNoPlan);
    rmState(repoWithPlan);
    try { fs.rmSync(repoNoPlan, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(repoWithPlan, { recursive: true, force: true }); } catch {}
  });
  process.on('exit', () => {
    try { if (daemonNoPlan?.child?.exitCode === null) daemonNoPlan.child.kill('SIGKILL'); } catch {}
    try { if (daemonWithPlan?.child?.exitCode === null) daemonWithPlan.child.kill('SIGKILL'); } catch {}
  });

  test('Claude TodoWrite normalizes to {content, status}', async () => {
    await postHook(daemonNoPlan.base, {
      hook_event_name: 'PostToolUse', session_id: 'claude-1', cwd: repoNoPlan, agent: 'claude',
      tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Ship it', status: 'in_progress' }] },
    });
    const m = await fetch(`${daemonNoPlan.base}/model`).then((r) => r.json());
    const run = m.runs.find((r) => r.id === 'claude-1');
    assert.ok(run, 'run exists');
    assert.deepStrictEqual(run.todos, [{ content: 'Ship it', status: 'in_progress' }]);
  });

  test("OpenCode's title-cased Todowrite normalizes the same way", async () => {
    await postHook(daemonNoPlan.base, {
      hook_event_name: 'PostToolUse', session_id: 'opencode-1', cwd: repoNoPlan, agent: 'opencode',
      tool_name: 'Todowrite', tool_input: { todos: [{ content: 'Verify CLI', status: 'pending', priority: 'low' }] },
    });
    const m = await fetch(`${daemonNoPlan.base}/model`).then((r) => r.json());
    const run = m.runs.find((r) => r.id === 'opencode-1');
    assert.ok(run, 'run exists');
    assert.deepStrictEqual(run.todos, [{ content: 'Verify CLI', status: 'pending' }]);
  });

  test("Codex's update_plan (step/status) normalizes to content/status", async () => {
    await postHook(daemonNoPlan.base, {
      hook_event_name: 'PostToolUse', session_id: 'codex-1', cwd: repoNoPlan, agent: 'codex',
      tool_name: 'update_plan', tool_input: { plan: [{ step: 'Read the task', status: 'completed' }, { step: 'Implement it', status: 'in_progress' }] },
    });
    const m = await fetch(`${daemonNoPlan.base}/model`).then((r) => r.json());
    const run = m.runs.find((r) => r.id === 'codex-1');
    assert.ok(run, 'run exists');
    assert.deepStrictEqual(run.todos, [
      { content: 'Read the task', status: 'completed' },
      { content: 'Implement it', status: 'in_progress' },
    ]);
  });

  test('no plan file + live todos synthesizes a board card per run ({#synthetic-fallback})', async () => {
    const m = await fetch(`${daemonNoPlan.base}/model`).then((r) => r.json());
    assert.strictEqual(m.hasPlan, false, 'repo genuinely has no PLAN.md');
    const synth = m.plan.filter((n) => n.synthetic);
    // three runs posted above (claude-1, opencode-1, codex-1), each with todos
    assert.ok(synth.length >= 3, `expected >=3 synthetic nodes, got ${synth.length}`);
    const codexNode = synth.find((n) => n.by === 'codex');
    assert.ok(codexNode, 'codex run got a synthetic node');
    assert.strictEqual(codexNode.status, 'active', 'one in_progress todo makes the card active');
    assert.strictEqual(codexNode.level, 'component');
  });

  test('a real plan file always wins — never mixed with synthetic nodes ({#real-plan-wins})', async () => {
    await postHook(daemonWithPlan.base, {
      hook_event_name: 'PostToolUse', session_id: 'claude-real-1', cwd: repoWithPlan, agent: 'claude',
      tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Should not create a synthetic card', status: 'in_progress' }] },
    });
    const m = await fetch(`${daemonWithPlan.base}/model`).then((r) => r.json());
    assert.strictEqual(m.hasPlan, true);
    assert.ok(m.plan.some((n) => n.id === 'real'), 'the real PLAN.md component is present');
    assert.strictEqual(m.plan.some((n) => n.synthetic), false, 'no synthetic node leaks in once a real plan exists');
  });
});
