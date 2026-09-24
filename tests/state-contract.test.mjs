import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(root, '.agents', 'state.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const GATE_KEYS = ['lint', 'typecheck', 'tests', 'a11y', 'seo', 'security'];
const GATE_VALUES = new Set(['pass', 'fail', 'skip']);
const PHASES = new Set(['define', 'plan', 'build', 'verify', 'review', 'ready_to_ship', 'ship', 'done', 'escalated']);

function sampleAoState() {
  return {
    run_id: 'archify-demo-123',
    goal: 'Projekt archify-demo via BDB AOrchestrator initialisiert',
    phase: 'define',
    iteration: 0,
    max_iterations: 3,
    pipeline: 'startcycle-graph',
    planCanvasRequired: true,
    roles: { architect: true, techlead: true },
    models: { architect: 'Claude Sonnet 4.6 (Thinking)' },
    harnesses: { architect: 'claude-code' },
    artifacts: {
      plan: null,
      architecture: null,
      frontend: null,
      backend: null,
      media: null,
      review: null,
      report: null,
    },
    findings: [],
    gate: { lint: 'skip', typecheck: 'skip', tests: 'skip', a11y: 'skip', seo: 'skip', security: 'skip' },
    approvals: [],
  };
}

describe('state schema contract', () => {
  test('requires the canonical hand-off fields', () => {
    for (const key of ['run_id', 'goal', 'phase', 'iteration', 'max_iterations', 'gate', 'findings', 'approvals']) {
      assert.ok(schema.required.includes(key), `required missing ${key}`);
    }
  });

  test('phase covers the canonical enum including define', () => {
    assert.deepEqual([...PHASES].sort(), [...schema.properties.phase.enum].sort());
  });

  test('dispatcher shipping gate includes every canonical key', () => {
    const dispatcher = readFileSync(resolve(root, '.claude', 'workflows', 'startcycle-dispatch.mjs'), 'utf8');
    assert.match(dispatcher, /const GATE_KEYS = \[[^\]]*'security'/);
    assert.match(dispatcher, /a11y, seo, security/);
  });

  test('gate exposes the canonical keys with pass fail skip only', () => {
    for (const key of GATE_KEYS) {
      const prop = schema.properties.gate.properties[key];
      assert.ok(prop, `gate missing ${key}`);
      assert.deepEqual([...prop.enum].sort(), ['fail', 'pass', 'skip']);
    }
    assert.equal(schema.properties.gate.additionalProperties, false);
  });

  test('allows AO scaffold metadata as optional typed properties without opening the contract', () => {
    assert.equal(schema.additionalProperties, false);
    for (const key of ['pipeline', 'planCanvasRequired', 'roles', 'models', 'harnesses']) {
      assert.ok(schema.properties[key], `missing optional property ${key}`);
      assert.ok(!schema.required.includes(key), `${key} must stay optional`);
    }
    assert.equal(schema.properties.pipeline.type, 'string');
    assert.equal(schema.properties.planCanvasRequired.type, 'boolean');
    assert.equal(schema.properties.roles.type, 'object');
    assert.equal(schema.properties.models.type, 'object');
    assert.equal(schema.properties.harnesses.type, 'object');
  });

  test('sample AO scaffold state satisfies the required shapes', () => {
    const state = sampleAoState();
    assert.ok(typeof state.run_id === 'string' && state.run_id.length > 0);
    assert.ok(PHASES.has(state.phase));
    assert.ok(Number.isInteger(state.iteration) && state.iteration >= 0);
    assert.ok(Number.isInteger(state.max_iterations) && state.max_iterations >= 1);
    for (const key of GATE_KEYS) {
      assert.ok(GATE_VALUES.has(state.gate[key]), `gate.${key} invalid`);
    }
    assert.deepEqual(state.findings, []);
    assert.deepEqual(state.approvals, []);
    assert.ok('architecture' in state.artifacts);
    assert.ok(existsSync(schemaPath));
  });
});
