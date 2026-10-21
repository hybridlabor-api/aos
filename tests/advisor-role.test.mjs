import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { KNOWN_ROLES, loadRouterTable } = require('../lib/router/table.js');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

test('advisor is a known router role', () => {
  assert.ok(KNOWN_ROLES.includes('advisor'));
});

test('shipped config/router.json validates with an advisor route', () => {
  const table = loadRouterTable(path.join(root, 'config', 'router.json'));
  assert.ok(table.roles.includes('advisor'));
  assert.ok(table.preferences.advisor.length > 0);
});

test('advisor SKILL.md names the three call points and never writes', () => {
  const skill = read('skills', 'basic', 'advisor', 'SKILL.md');
  assert.match(skill, /Before a plan or schema is locked/i);
  assert.match(skill, /same test or build error occurs a second time/i);
  assert.match(skill, /Before "done"/i);
  assert.match(skill, /Never writes/i);
  const description = skill.match(/description:\s*>-\n([\s\S]*?)\ncategory:/)[1].replace(/\s+/g, ' ').trim();
  assert.ok(description.length <= 160, `description is ${description.length} chars`);
});

test('graph contract keeps auxiliary agents out of the node set', () => {
  const graph = read('.agents', 'graph.md');
  assert.match(graph, /Auxiliary agents are not nodes/);
  assert.match(graph, /Advisor checkpoints/);
  const dispatch = read('.claude', 'workflows', 'fabric-dispatch.mjs');
  const ids = dispatch.match(/const REQUIRED_NODE_IDS = \[([^\]]*)\]/)[1];
  assert.ok(!ids.includes('advisor'));
  assert.ok(!('advisor' in JSON.parse(read('.agents', 'nodes.json')).nodes ?? {}));
});
