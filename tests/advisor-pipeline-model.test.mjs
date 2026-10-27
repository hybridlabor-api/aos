import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { routeFor, harnessKeyFor, pipelineModelFor } = require('../lib/router/route.js');
const { loadRouterTable } = require('../lib/router/table.js');

const table = loadRouterTable(path.join(root, 'config', 'router.json'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-home-'));

function project(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-proj-'));
  if (content !== undefined) {
    fs.mkdirSync(path.join(dir, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.aos', 'pipeline.json'), content);
  }
  return dir;
}

test('target to harness key mapping', () => {
  assert.equal(harnessKeyFor('agy'), 'antigravity');
  assert.equal(harnessKeyFor('opencode-go'), 'opencode');
  assert.equal(harnessKeyFor('claude-glm'), 'claude');
  assert.equal(harnessKeyFor('claude'), 'claude');
  assert.equal(harnessKeyFor('codex'), 'codex');
});

test('advisor model is read from pipeline.json models.<harness>', () => {
  const dir = project(JSON.stringify({
    version: 1,
    pipeline: { advisor: { models: { claude: 'test-claude-model', codex: 'test-codex-model' } } },
  }));
  const res = routeFor('advisor', { home, projectRoot: dir, table, target: 'claude' });
  assert.equal(res.target, 'claude');
  assert.equal(res.model, 'test-claude-model');
});

test('explicit ctx.model beats pipeline.json', () => {
  const dir = project(JSON.stringify({ pipeline: { advisor: { models: { claude: 'from-pipeline' } } } }));
  const res = routeFor('advisor', { home, projectRoot: dir, table, target: 'claude', model: 'from-cli' });
  assert.equal(res.model, 'from-cli');
});

test('missing pipeline.json falls back to the configured default', () => {
  const dir = project();
  const res = routeFor('advisor', { home, projectRoot: dir, table });
  assert.equal(res.model, table.targets[res.target].model);
});

test('invalid JSON or invalid values fall back to default, never throw', () => {
  const bad = project('{ not json');
  assert.equal(pipelineModelFor(bad, 'advisor', 'claude'), null);
  assert.doesNotThrow(() => routeFor('advisor', { home, projectRoot: bad, table }));

  const spaced = project(JSON.stringify({ pipeline: { advisor: { models: { claude: 'bad model' } } } }));
  assert.equal(pipelineModelFor(spaced, 'advisor', 'claude'), null);

  const wrongShape = project(JSON.stringify({ pipeline: { advisor: 'nope' } }));
  assert.equal(pipelineModelFor(wrongShape, 'advisor', 'claude'), null);
});

test('mapped target uses the mapped harness key', () => {
  const dir = project(JSON.stringify({ pipeline: { advisor: { models: { antigravity: 'agy-model' } } } }));
  assert.equal(pipelineModelFor(dir, 'advisor', 'agy'), 'agy-model');
  assert.equal(pipelineModelFor(dir, 'advisor', 'opencode-go'), null);
});

test('non-advisor roles are not affected by pipeline advisor entries', () => {
  const dir = project(JSON.stringify({ pipeline: { architect: { models: { claude: 'x-model' } } } }));
  const res = routeFor('architect', { home, projectRoot: dir, table });
  assert.notEqual(res.model, 'x-model');
});
