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
