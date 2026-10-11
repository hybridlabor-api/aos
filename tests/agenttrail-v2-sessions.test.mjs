import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SessionTable, readA2aRegistry, waitingList, mergeKey } from '../skills/global_config/agenttrail/lib/sessions.mjs';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const at = (mins) => new Date(NOW - mins * 60000).toISOString();
let clock = NOW;
const table = () => new SessionTable({ now: () => clock });

const ev = (over = {}) => ({
  v: 1, ts: at(0), agent: 'claude', session: { id: 's1' }, cwd: '/repo', kind: 'note', ...over,
});

describe('mergeKey', () => {
  test('the session id is the merge key', () => {
    assert.equal(mergeKey(ev({ session: { id: 'abc' } })), 'abc');
  });

  test('without an id, harness, cwd and pid stand in', () => {
    assert.equal(mergeKey({ agent: 'opencode', cwd: '/repo', pid: 12 }), 'opencode:/repo:12');
  });
});

describe('SessionTable.apply', () => {
  test('events from four harnesses merge into four sessions by id', () => {
    const t = table();
    for (const agent of ['claude', 'opencode', 'agy', 'codex']) t.apply(ev({ agent, session: { id: 'shared' }, kind: 'session.start' }));
    assert.equal(t.all().length, 1);
    const s = t.all()[0];
    assert.equal(s.harnesses.sort().join(','), 'agy,claude,codex,opencode');
  });

  test('a tool.pre shows as working with the current tool', () => {
    const t = table();
    t.apply(ev({ kind: 'tool.pre', tool: { name: 'Edit', detail: 'src/x.ts' } }));
    const s = t.byId('s1');
    assert.equal(s.state, 'working');
    assert.deepEqual(s.currentTool, { name: 'Edit', detail: 'src/x.ts' });
  });

  test('a tool.post clears the current tool and records the file', () => {
    const t = table();
    t.apply(ev({ kind: 'tool.pre', tool: { name: 'Edit' } }));
    t.apply(ev({ kind: 'tool.post', tool: { name: 'Edit' }, file: 'src/x.ts' }));
    const s = t.byId('s1');
    assert.equal(s.currentTool, null);
    assert.equal(s.lastFile, 'src/x.ts');
  });

  test('a task.update shows as the current task', () => {
    const t = table();
    t.apply(ev({ kind: 'task.update', task: { id: 't1', status: 'doing' } }));
    assert.deepEqual(t.byId('s1').currentTask, { id: 't1', status: 'doing' });
  });

  test('a Stop without done leaves the session waiting, not done', () => {
    const t = table();
    t.apply(ev({ kind: 'session.stop' }));
    const s = t.byId('s1');
    assert.equal(s.state, 'waiting-for-you');
    assert.equal(s.ended, true);
    assert.equal(s.done, false);
  });

  test('a SessionEnd is done and ended', () => {
    const t = table();
    t.apply(ev({ kind: 'session.end' }));
    const s = t.byId('s1');
    assert.equal(s.state, 'ended');
    assert.equal(s.done, true);
  });

  test('a waiting event keeps its message and is not done', () => {
    const t = table();
    t.apply(ev({ kind: 'waiting', message: 'needs a GO' }));
    const s = t.byId('s1');
    assert.equal(s.state, 'waiting-for-you');
    assert.equal(s.waiting, 'needs a GO');
    assert.equal(s.done, false);
  });

  test('a resumed session is neither waiting nor done', () => {
    const t = table();
    t.apply(ev({ kind: 'session.stop' }));
    t.apply(ev({ kind: 'tool.pre', tool: { name: 'Bash' } }));
    const s = t.byId('s1');
    assert.equal(s.state, 'working');
    assert.equal(s.waiting, null);
    assert.equal(s.done, false);
  });

  test('an untrusted go.request claim never carries a decision', () => {
    const t = table();
    t.apply(ev({ kind: 'go.request', message: 'agent says it waits for GO' }));
    const s = t.byId('s1');
    assert.equal(s.goClaim, 'agent says it waits for GO');
    assert.equal(s.state, 'working');
    assert.equal('decision' in s, false);
  });

  test('a session that stopped reporting goes idle', () => {
    clock = NOW;
    const t = table();
    t.apply(ev({ kind: 'tool.pre', tool: { name: 'Bash' }, ts: at(45) }));
    assert.equal(t.byId('s1').state, 'idle');
  });

  test('two events without a session id fall back to harness, cwd and pid', () => {
    const t = table();
    t.apply({ v: 1, agent: 'agy', cwd: '/repo', pid: 7, kind: 'session.start' });
    t.apply({ v: 1, agent: 'agy', cwd: '/repo', pid: 7, kind: 'session.stop' });
    assert.equal(t.all().length, 1);
    assert.equal(t.all()[0].state, 'waiting-for-you');
  });

  test('lastEventAt follows the newest event', () => {
    clock = NOW;
    const t = table();
    t.apply(ev({ kind: 'session.start', ts: at(30) }));
    t.apply(ev({ kind: 'tool.pre', tool: { name: 'Read' }, ts: at(5) }));
    assert.equal(t.byId('s1').lastEventAt, NOW - 5 * 60000);
  });
});

describe('readA2aRegistry', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-a2a-'));
    fs.writeFileSync(path.join(dir, 'one.json'), JSON.stringify({ name: 'worker-1', harness: 'codex', pid: 111, cwd: '/repo' }));
    fs.writeFileSync(path.join(dir, 'two.json'), JSON.stringify({ name: 'worker-2', harness: 'opencode', pid: 222, cwd: '/other' }));
    fs.writeFileSync(path.join(dir, 'broken.json'), 'not json');
  });

  test('registry entries become sessions with name, pid and liveness', () => {
    const entries = readA2aRegistry(dir, { isAlive: (pid) => pid === 111 });
    assert.equal(entries.length, 2);
    const one = entries.find((e) => e.name === 'worker-1');
    assert.equal(one.alive, true);
    assert.equal(one.harness, 'codex');
    const two = entries.find((e) => e.name === 'worker-2');
    assert.equal(two.alive, false);
    assert.equal(two.ended, true, 'a dead pid means the session ended');
  });

  test('an absent registry directory is not an error', () => {
    assert.deepEqual(readA2aRegistry(path.join(dir, 'nope'), { isAlive: () => true }), []);
  });

  test('a malformed file is skipped, not fatal', () => {
    assert.equal(readA2aRegistry(dir, { isAlive: () => true }).some((e) => e.name === undefined), false);
  });
});

describe('waitingList', () => {
  const gate = {
    requests: [
      { id: 'r1', sessionKey: 's1', command: 'git push origin feat', ts: NOW - 2 * 60000, click: true },
      { id: 'r2', sessionKey: 's2', command: 'npm publish', ts: NOW - 1 * 60000, click: false },
    ],
  };

  test('GO requests come first, only the clickable one has a decision', () => {
    const t = table();
    t.apply(ev({ session: { id: 's9' }, kind: 'waiting', message: 'old news', ts: at(90) }));
    const items = waitingList({ sessions: t.all(), gate, asks: [], plans: [] }, { now: NOW });
    assert.equal(items[0].kind, 'go');
    assert.equal(items[0].decision, true);
    assert.equal(items.find((i) => i.id === 'r2').decision, false);
    const clickable = items.filter((i) => i.decision === true);
    assert.deepEqual(clickable.map((i) => i.id), ['r1']);
  });

  test('a hard request is listed but never decided', () => {
    const items = waitingList({ sessions: [], gate, asks: [], plans: [] }, { now: NOW });
    const hard = items.find((i) => i.id === 'r2');
    assert.equal(hard.kind, 'go');
    assert.notEqual(hard.decision, true);
  });

  test('waiting events appear after GO requests', () => {
    const t = table();
    t.apply(ev({ session: { id: 's9' }, kind: 'waiting', message: 'need input', ts: at(90) }));
    const items = waitingList({ sessions: t.all(), gate, asks: [], plans: [] }, { now: NOW });
    const waiting = items.find((i) => i.kind === 'waiting');
    assert.equal(waiting.message, 'need input');
    assert.equal(items.indexOf(waiting) > items.findIndex((i) => i.kind === 'go'), true);
  });

  test('items inside a tier are ordered by age, oldest first', () => {
    const t = table();
    t.apply(ev({ session: { id: 'a' }, kind: 'waiting', message: 'younger', ts: at(5) }));
    t.apply(ev({ session: { id: 'b' }, kind: 'waiting', message: 'older', ts: at(45) }));
    const items = waitingList({ sessions: t.all(), gate: { requests: [] }, asks: [], plans: [] }, { now: NOW });
    const waits = items.filter((i) => i.kind === 'waiting');
    assert.deepEqual(waits.map((i) => i.message), ['older', 'younger']);
  });

  test('an agent go.request claim is listed without a decision', () => {
    const t = table();
    t.apply(ev({ kind: 'go.request', message: 'claims a GO' }));
    const items = waitingList({ sessions: t.all(), gate: { requests: [] }, asks: [], plans: [] }, { now: NOW });
    const claim = items.find((i) => i.kind === 'claim');
    assert.equal(claim.decision, undefined);
    assert.equal(claim.label, 'agent claims it waits for GO');
  });

  test('open asks are listed without a decision button', () => {
    const asks = [{ id: 'q1', question: 'ship it?', askedBy: 'opus', askedAt: NOW - 10 * 60000, status: 'pending' }];
    const items = waitingList({ sessions: [], gate: { requests: [] }, asks, plans: [] }, { now: NOW });
    const ask = items.find((i) => i.kind === 'ask');
    assert.equal(ask.question, 'ship it?');
    assert.notEqual(ask.decision, true);
  });

  test('a decided ask is not listed', () => {
    const asks = [{ id: 'q1', question: 'ship it?', status: 'go' }];
    assert.equal(waitingList({ sessions: [], gate: { requests: [] }, asks, plans: [] }, { now: NOW }).some((i) => i.kind === 'ask'), false);
  });

  test('stuck and stalled tasks are listed', () => {
    const plans = [{
      name: 'Checkout',
      tasks: [{ id: 't1', title: 'fix totals', status: 'blocked' }, { id: 't2', title: 'wire page', status: 'active' }],
      stalled: ['t2'],
    }];
    const items = waitingList({ sessions: [], gate: { requests: [] }, asks: [], plans }, { now: NOW });
    assert.equal(items.filter((i) => i.kind === 'task').length, 2);
    assert.ok(items.some((i) => i.taskId === 't2' && i.stalled === true));
  });

  test('a session stopped but not done shows as idle work waiting', () => {
    const t = table();
    t.apply(ev({ kind: 'session.stop', ts: at(20) }));
    const items = waitingList({ sessions: t.all(), gate: { requests: [] }, asks: [], plans: [] }, { now: NOW });
    const idle = items.find((i) => i.kind === 'idle-session');
    assert.equal(idle.sessionId, 's1');
  });

  test('a working session is not in the list', () => {
    const t = table();
    t.apply(ev({ kind: 'tool.pre', tool: { name: 'Bash' } }));
    assert.equal(waitingList({ sessions: t.all(), gate: { requests: [] }, asks: [], plans: [] }, { now: NOW }).some((i) => i.sessionId === 's1'), false);
  });

  test('an ended and done session is not in the list', () => {
    const t = table();
    t.apply(ev({ kind: 'session.end', ts: at(30) }));
    assert.equal(waitingList({ sessions: t.all(), gate: { requests: [] }, asks: [], plans: [] }, { now: NOW }).some((i) => i.sessionId === 's1'), false);
  });

  test('every item carries a kind and an age', () => {
    const t = table();
    t.apply(ev({ kind: 'session.stop', ts: at(15) }));
    const items = waitingList({ sessions: t.all(), gate, asks: [], plans: [] }, { now: NOW });
    assert.ok(items.length > 0);
    for (const i of items) {
      assert.equal(typeof i.kind, 'string', JSON.stringify(i));
      assert.equal(typeof i.age, 'number', JSON.stringify(i));
    }
  });
});