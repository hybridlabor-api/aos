import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(root, '.agents', 'state.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

describe('state contract team and execution_manifest extensions', () => {
  test('team and execution_manifest are optional properties on root state', () => {
    assert.ok(schema.properties.team, 'schema missing team property');
    assert.ok(schema.properties.execution_manifest, 'schema missing execution_manifest property');
    assert.ok(schema.properties.workstreams, 'schema missing workstreams property');
    assert.ok(!schema.required.includes('team'), 'team must not be in required');
    assert.ok(!schema.required.includes('execution_manifest'), 'execution_manifest must not be in required');
    assert.ok(!schema.required.includes('workstreams'), 'workstreams must not be in required');
  });

  test('team property schema requires id and roles with strict patterns', () => {
    const team = schema.properties.team;
    assert.equal(team.type, 'object');
    assert.equal(team.additionalProperties, false);
    assert.deepEqual(team.required, ['id', 'roles']);
    assert.equal(team.properties.id.pattern, '^[a-z0-9_]+$');
    assert.equal(team.properties.roles.type, 'array');
    assert.equal(team.properties.roles.minItems, 1);
    assert.equal(team.properties.roles.items.pattern, '^[a-z0-9_]+$');
    assert.deepEqual(team.properties.effort.enum, ['S', 'M', 'L']);
  });

  test('execution_manifest schema requires workstreams and createdBy with 1-6 workstream cap', () => {
    const manifest = schema.properties.execution_manifest;
    assert.equal(manifest.type, 'object');
    assert.equal(manifest.additionalProperties, false);
    assert.deepEqual(manifest.required, ['workstreams', 'createdBy']);
    assert.deepEqual(manifest.properties.createdBy.enum, ['architect']);
    assert.deepEqual(manifest.properties.effort.enum, ['S', 'M', 'L']);
    assert.equal(manifest.properties.workstreams.type, 'array');
    assert.equal(manifest.properties.workstreams.minItems, 1);
    assert.equal(manifest.properties.workstreams.maxItems, 6);
    assert.equal(manifest.properties.workstreams.items.$ref, '#/$defs/workstream');
  });

  test('$defs.workstream defines required fields, valid role enum, and playbooks phases', () => {
    const ws = schema.$defs.workstream;
    assert.ok(ws, 'missing $defs.workstream');
    assert.equal(ws.type, 'object');
    assert.equal(ws.additionalProperties, false);
    assert.deepEqual(ws.required, ['id', 'agentType', 'skills', 'artifactKey']);
    assert.equal(ws.properties.id.pattern, '^[a-z0-9_]+$');
    assert.deepEqual(ws.properties.role.enum, ['plan', 'approve', 'build', 'review', 'gate', 'specialist']);
    assert.equal(ws.properties.skills.type, 'array');
    assert.equal(ws.properties.skills.items.type, 'string');
    assert.equal(ws.properties.playbooks.type, 'array');
    assert.equal(ws.properties.gates.type, 'array');
    assert.equal(ws.properties.iteration.type, 'integer');
    assert.equal(ws.properties.iteration.minimum, 0);
  });

  test('validates sample state with team and execution_manifest', () => {
    const state = {
      run_id: 'v2-test-001',
      goal: 'Build desktop client',
      phase: 'build',
      iteration: 0,
      max_iterations: 3,
      artifacts: {
        plan: 'production_artifacts/00_execution_plan.md',
      },
      findings: [],
      gate: { lint: 'pass', typecheck: 'pass', tests: 'pass', a11y: 'skip', seo: 'skip', security: 'pass' },
      approvals: [{ node: 'techlead', token: 'GO', at: new Date().toISOString() }],
      team: {
        id: 'desktop_app',
        label: 'Desktop Application Team',
        roles: ['architect', 'techlead', 'tauri_expert', 'reviewer', 'shipping'],
        playbooks: ['pb-tauri-e2e'],
        gates: ['ipc_latency'],
        effort: 'M',
      },
      execution_manifest: {
        createdBy: 'architect',
        effort: 'M',
        workstreams: [
          {
            id: 'ws_tauri',
            agentType: 'tauri_expert',
            role: 'build',
            skills: ['godmode-engineering', 'webapp-testing'],
            playbooks: [{ id: 'pb-tauri-e2e', phase: 'during' }],
            artifactKey: 'desktop',
            gates: ['ipc_latency'],
            iteration: 0,
          },
        ],
      },
    };

    // Verify root required fields present
    for (const req of schema.required) {
      assert.ok(req in state, `missing required ${req}`);
    }

    // Verify team fields
    assert.match(state.team.id, new RegExp(schema.properties.team.properties.id.pattern));
    assert.ok(state.team.roles.length >= schema.properties.team.properties.roles.minItems);
    assert.ok(schema.properties.team.properties.effort.enum.includes(state.team.effort));

    // Verify manifest fields
    assert.equal(state.execution_manifest.createdBy, 'architect');
    assert.ok(state.execution_manifest.workstreams.length >= schema.properties.execution_manifest.properties.workstreams.minItems);
    assert.ok(state.execution_manifest.workstreams.length <= schema.properties.execution_manifest.properties.workstreams.maxItems);

    const ws = state.execution_manifest.workstreams[0];
    for (const req of schema.$defs.workstream.required) {
      assert.ok(req in ws, `workstream missing required ${req}`);
    }
    assert.match(ws.id, new RegExp(schema.$defs.workstream.properties.id.pattern));
    assert.ok(schema.$defs.workstream.properties.role.enum.includes(ws.role));
  });

  test('legacy state without team or execution_manifest remains completely valid', () => {
    const legacyState = {
      run_id: 'legacy-run-999',
      goal: 'Legacy 7-node build',
      phase: 'plan',
      iteration: 0,
      max_iterations: 3,
      findings: [],
      gate: { lint: 'pass', typecheck: 'pass', tests: 'pass', a11y: 'skip', seo: 'skip', security: 'pass' },
      approvals: [],
    };

    for (const req of schema.required) {
      assert.ok(req in legacyState, `missing required ${req}`);
    }
    assert.equal(legacyState.team, undefined);
    assert.equal(legacyState.execution_manifest, undefined);
  });
});
