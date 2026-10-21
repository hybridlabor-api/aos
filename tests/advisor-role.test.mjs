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
  assert.ok(!('advisor' in (JSON.parse(read('.agents', 'nodes.json')).nodes ?? {})));
});

test('advisor agent is read-only: exactly Read, Grep, Glob, identical across shipped copies', () => {
  const persona = read('agents', 'advisor.md');
  assert.match(persona, /^tools: Read, Grep, Glob$/m);
  assert.doesNotMatch(persona, /^tools:.*(Write|Edit|Bash)/m);
  assert.strictEqual(read('.claude', 'agents', 'advisor.md'), persona);
  assert.strictEqual(read('plugins', 'bdb-aos', 'agents', 'advisor.md'), persona);
  assert.match(persona, /Never write/);
  assert.match(persona, /never a GO/);
});

test('docs/agent-models.md advisor example uses placeholders only', () => {
  const docs = read('docs', 'agent-models.md');
  const section = docs.split('## advisor role')[1];
  assert.ok(section, 'docs has an advisor role section');
  const example = section.match(/```json\n([\s\S]*?)```/)[1];
  assert.doesNotMatch(example, /\b(pro|opus|sonnet|haiku|gpt|gemini)\b/i);
  assert.match(example, /"advisor"/);
  assert.match(example, /"claude": "<strongest-claude-model>"/);
  assert.match(example, /"codex": "<strongest-codex-model>"/);
  assert.match(section, /without an entry the advisor inherits the session model/i);
});
