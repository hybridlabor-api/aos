'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const ROUTER_JSON = path.join(ROOT, 'config', 'router.json');
const DISPATCH = path.join(ROOT, '.claude', 'workflows', 'fabric-dispatch.mjs');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'router-route-test-'));
after(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

const {
  validateRouterTable,
  loadRouterTable,
  getRouterTable,
  resetRouterTableCache,
  KNOWN_ROLES,
  KNOWN_TARGETS,
} = require('../lib/router/table.js');

const { routeFor, resolveRole } = require('../lib/router/route.js');

describe('Router Table Configuration & Validation', () => {
  test('default config/router.json exists and validates successfully', () => {
    assert.ok(fs.existsSync(ROUTER_JSON), 'config/router.json must exist');
    const table = loadRouterTable(ROUTER_JSON);

    assert.strictEqual(table.enforce, false, 'enforce flag must be false in default config');
    assert.deepStrictEqual(
      [...table.roles].sort(),
      ['architect', 'builder', 'reviewer', 'scout', 'techlead']
    );

    for (const role of KNOWN_ROLES) {
      assert.ok(table.preferences[role], `preference for role "${role}" must exist`);
      assert.ok(Array.isArray(table.preferences[role]));
      assert.ok(table.preferences[role].length > 0);
    }

    for (const target of KNOWN_TARGETS) {
      assert.ok(table.targets[target], `target "${target}" must be defined`);
    }

    assert.strictEqual(table.targets['opencode-go'].model, 'glm-5.3-flash');
    assert.strictEqual(table.targets['claude'].model, null);

    assert.ok(table.limits, 'limits must be present');
    assert.strictEqual(table.limits.window_5h.soft, 0.8);
    assert.strictEqual(table.limits.window_5h.hard, 0.95);
    assert.strictEqual(table.limits.weekly.soft, 0.8);
    assert.strictEqual(table.limits.weekly.hard, 0.95);
  });

  test('rejects unknown role in roles list with clear error', () => {
    const invalid = {
      enforce: false,
      roles: ['architect', 'ninja'],
      targets: { claude: {} },
    };
    assert.throws(
      () => validateRouterTable(invalid),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Unknown role "ninja"/);
        assert.match(err.message, /Valid roles are:/);
        return true;
      }
    );
  });

  test('rejects unknown target in targets list with clear error', () => {
    const invalid = {
      enforce: false,
      roles: ['architect', 'builder'],
      targets: { claude: {}, 'unknown-engine': {} },
    };
    assert.throws(
      () => validateRouterTable(invalid),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Unknown target "unknown-engine"/);
        assert.match(err.message, /Valid targets are:/);
        return true;
      }
    );
  });

  test('rejects unknown target in preferences', () => {
    const invalid = {
      enforce: false,
      roles: ['architect'],
      targets: { claude: {} },
      preferences: {
        architect: ['claude', 'magic-target'],
      },
    };
    assert.throws(
      () => validateRouterTable(invalid),
      (err) => {
        assert.match(err.message, /Unknown target "magic-target" in preference list for role "architect"/);
        return true;
      }
    );
  });

  test('rejects unknown role in preferences key', () => {
    const invalid = {
      enforce: false,
      roles: ['architect'],
      targets: { claude: {} },
      preferences: {
        astronaut: ['claude'],
      },
    };
    assert.throws(
      () => validateRouterTable(invalid),
      (err) => {
        assert.match(err.message, /Unknown role "astronaut" in preferences/);
        return true;
      }
    );
  });

  test('rejects malformed limits where soft > hard', () => {
    const invalid = {
      enforce: false,
      roles: ['builder'],
      targets: { agy: {} },
      limits: {
        window_5h: { soft: 0.99, hard: 0.5 },
      },
    };
    assert.throws(
      () => validateRouterTable(invalid),
      (err) => {
        assert.match(err.message, /Soft limit \(0.99\) cannot exceed hard limit \(0.5\)/);
        return true;
      }
    );
  });

  test('rejects non-existent file path with descriptive error', () => {
    const fakePath = path.join(tmpBase, 'non-existent-router.json');
    assert.throws(
      () => loadRouterTable(fakePath),
      (err) => {
        assert.match(err.message, /Failed to read router config/);
        return true;
      }
    );
  });

  test('rejects invalid JSON file with descriptive error', () => {
    const badJsonPath = path.join(tmpBase, 'bad.json');
    fs.writeFileSync(badJsonPath, '{ invalid json');
    assert.throws(
      () => loadRouterTable(badJsonPath),
      (err) => {
        assert.match(err.message, /Failed to parse router config/);
        return true;
      }
    );
  });
});

describe('Route Resolution (routeFor)', () => {
  const table = loadRouterTable(ROUTER_JSON);

  test('resolves every known role to its preferred target and model', () => {
    const rolesExpected = {
      architect: { target: 'claude', model: null },
      techlead: { target: 'claude', model: null },
      reviewer: { target: 'claude', model: null },
      builder: { target: 'opencode-go', model: 'glm-5.3-flash' },
      scout: { target: 'opencode-go', model: 'glm-5.3-flash' },
    };

    for (const [role, expected] of Object.entries(rolesExpected)) {
      const res = routeFor(role, { table });
      assert.strictEqual(res.target, expected.target, `role "${role}" target`);
      assert.strictEqual(res.model, expected.model, `role "${role}" model`);
      assert.ok(typeof res.reason === 'string' && res.reason.length > 0, `role "${role}" reason`);
    }
  });

  test('resolves object nodes with known roles and agentTypes', () => {
    const architectNode = { id: 'architect', agentType: 'architect', role: 'plan' };
    const archRes = routeFor(architectNode, { table });
    assert.strictEqual(archRes.target, 'claude');
    assert.strictEqual(archRes.model, null);

    const techleadNode = { id: 'techlead', agentType: 'techlead', role: 'approve' };
    const leadRes = routeFor(techleadNode, { table });
    assert.strictEqual(leadRes.target, 'claude');

    const uiNode = { id: 'ui_ux', agentType: 'godmode-ui-ux', role: 'build' };
    const uiRes = routeFor(uiNode, { table });
    assert.strictEqual(uiRes.target, 'opencode-go');
    assert.strictEqual(uiRes.model, 'glm-5.3-flash');

    const engNode = { id: 'engineering', agentType: 'godmode-engineering', executor: 'builder' };
    const engRes = routeFor(engNode, { table });
    assert.strictEqual(engRes.target, 'opencode-go');

    const reviewerNode = { id: 'reviewer', agentType: 'reviewer', role: 'review' };
    const revRes = routeFor(reviewerNode, { table });
    assert.strictEqual(revRes.target, 'claude');
  });

  test('unknown node falls back to builder role default', () => {
    const unknownStr = routeFor('totally_custom_worker_id', { table });
    assert.strictEqual(unknownStr.target, 'opencode-go');
    assert.strictEqual(unknownStr.model, 'glm-5.3-flash');
    assert.match(unknownStr.reason, /unknown node/i);
    assert.match(unknownStr.reason, /builder role default/i);

    const unknownObj = routeFor({ id: 'nonexistent-agent', label: 'Alien' }, { table });
    assert.strictEqual(unknownObj.target, 'opencode-go');
    assert.strictEqual(unknownObj.model, 'glm-5.3-flash');
    assert.match(unknownObj.reason, /unknown node/i);

    const nullNode = routeFor(null, { table });
    assert.strictEqual(nullNode.target, 'opencode-go');
    assert.strictEqual(nullNode.model, 'glm-5.3-flash');
  });

  test('context overrides for target and model', () => {
    const resOverride = routeFor('architect', {
      table,
      target: 'agy',
      model: 'gemini-3.8-flash',
    });
    assert.strictEqual(resOverride.target, 'agy');
    assert.strictEqual(resOverride.model, 'gemini-3.8-flash');
    assert.match(resOverride.reason, /target override via ctx/);
  });

  test('pure function without side effects or unmockable I/O when table is provided', () => {
    const customTable = validateRouterTable({
      enforce: false,
      roles: ['architect', 'builder', 'reviewer', 'techlead', 'scout'],
      targets: {
        codex: { model: 'o3-mini' },
      },
      preferences: {
        architect: ['codex'],
        builder: ['codex'],
        reviewer: ['codex'],
        techlead: ['codex'],
        scout: ['codex'],
      },
    });

    const res = routeFor('architect', { table: customTable });
    assert.strictEqual(res.target, 'codex');
    assert.strictEqual(res.model, 'o3-mini');
  });
});

describe('Dispatcher Advisory Hook (enforce=false leaves dispatch unchanged)', () => {
  test('dispatcher logs advisory target and leaves agent call options unchanged', () => {
    const caseDir = fs.mkdtempSync(path.join(tmpBase, 'dispatch-case-'));
    const home = path.join(caseDir, 'home');
    const cwd = path.join(caseDir, 'proj');
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.aos'), { recursive: true });

    // Custom pipeline config with a specific model override for architect
    const pipelineConfig = {
      pipeline: {
        architect: { harness: 'claude', model: 'claude-3-7-sonnet-custom' },
      },
    };
    fs.writeFileSync(path.join(cwd, '.aos', 'pipeline.json'), JSON.stringify(pipelineConfig));

    const runner = path.join(caseDir, 'runner.mjs');
    fs.writeFileSync(
      runner,
      `
import fs from 'node:fs';
const calls = [];
globalThis.args = { goal: 'build test app' };
globalThis.pipeline = (items, fn) => Promise.all(items.map(fn));
globalThis.agent = async (prompt, opts) => {
  calls.push(opts);
  if (opts.label === 'load-registry') {
    return JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, '.agents', 'nodes.json'))}, 'utf8'));
  }
  if (opts.label === 'validate-mandatory-skills') return { found: [], missing: [], store_matches: [] };
  if (opts.label.startsWith('architect')) return { planPath: 'p.md', needsMedia: false, deliverOk: true };
  throw new Error('stop-test');
};

await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});
process.stdout.write(JSON.stringify(calls));
`
    );

    const res = spawnSync(process.execPath, [runner], {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.strictEqual(res.status, 0, res.stderr);

    // Verify dispatcher advisory log appeared in stderr/stdout
    const combinedOutput = (res.stdout || '') + (res.stderr || '');
    assert.match(combinedOutput, /\[router\] advisory node architect -> target: claude/);

    // Verify agent options passed to agent() were unchanged: architect still receives model from pipeline.json
    const calls = JSON.parse(res.stdout);
    const architectCall = calls.find((c) => c.label && c.label.startsWith('architect'));
    assert.ok(architectCall, 'architect call was recorded');
    assert.strictEqual(
      architectCall.model,
      'claude-3-7-sonnet-custom',
      'enforce=false leaves model resolution strictly unchanged'
    );
  });
});
