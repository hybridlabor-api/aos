'use strict';

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const {
  loadLayeredRouterTable,
  getRouterTable,
  resetRouterTableCache,
  validateRouterTable,
  DEFAULT_CONFIG_PATH,
} = require(path.join(ROOT, 'lib', 'router', 'table.js'));

const { routeFor } = require(path.join(ROOT, 'lib', 'router', 'route.js'));

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'router-layering-test-'));
after(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

describe('loadLayeredRouterTable layering order', () => {
  test('shipped config loads when no layers exist', () => {
    const home = path.join(tmpBase, 'no-user');
    const projectRoot = path.join(tmpBase, 'no-project');
    const table = loadLayeredRouterTable({ home, projectRoot });
    assert.strictEqual(table.enforce, false);
    assert.deepStrictEqual(table.preferences.architect, ['claude', 'codex', 'agy', 'opencode-go', 'claude-glm']);
  });

  test('user layer overrides shipped', () => {
    const home = path.join(tmpBase, 'user-override-home');
    writeJson(path.join(home, '.aos', 'router.json'), {
      preferences: {
        architect: ['opencode-go', 'claude'],
      },
    });
    const projectRoot = path.join(tmpBase, 'user-override-project');
    const table = loadLayeredRouterTable({ home, projectRoot });
    assert.deepStrictEqual(table.preferences.architect, ['opencode-go', 'claude']);
    assert.deepStrictEqual(table.preferences.builder, ['opencode-go', 'agy', 'claude', 'codex', 'claude-glm']);
  });

  test('project layer overrides user and shipped', () => {
    const home = path.join(tmpBase, 'proj-user-home');
    const projectRoot = path.join(tmpBase, 'proj-user-project');
    writeJson(path.join(home, '.aos', 'router.json'), {
      preferences: {
        architect: ['opencode-go', 'claude'],
      },
    });
    writeJson(path.join(projectRoot, '.aos', 'router.json'), {
      preferences: {
        architect: ['agy'],
      },
    });
    const table = loadLayeredRouterTable({ home, projectRoot });
    assert.deepStrictEqual(table.preferences.architect, ['agy']);
  });

  test('user and project layers merge for different roles', () => {
    const home = path.join(tmpBase, 'merge-home');
    const projectRoot = path.join(tmpBase, 'merge-project');
    writeJson(path.join(home, '.aos', 'router.json'), {
      preferences: {
        architect: ['opencode-go', 'claude'],
      },
    });
    writeJson(path.join(projectRoot, '.aos', 'router.json'), {
      preferences: {
        builder: ['agy', 'claude'],
      },
    });
    const table = loadLayeredRouterTable({ home, projectRoot });
    assert.deepStrictEqual(table.preferences.architect, ['opencode-go', 'claude']);
    assert.deepStrictEqual(table.preferences.builder, ['agy', 'claude']);
  });

  test('targets and limits merge per layer', () => {
    const home = path.join(tmpBase, 'limits-home');
    const projectRoot = path.join(tmpBase, 'limits-project');
    writeJson(path.join(home, '.aos', 'router.json'), {
      limits: {
        window_5h: { soft: 0.7, hard: 0.9 },
      },
    });
    writeJson(path.join(projectRoot, '.aos', 'router.json'), {
      limits: {
        weekly: { soft: 0.6, hard: 0.85 },
      },
    });
    const table = loadLayeredRouterTable({ home, projectRoot });
    assert.strictEqual(table.limits.window_5h.soft, 0.7);
    assert.strictEqual(table.limits.window_5h.hard, 0.9);
    assert.strictEqual(table.limits.weekly.soft, 0.6);
    assert.strictEqual(table.limits.weekly.hard, 0.85);
  });

  test('project layer can override a single target entry while keeping others', () => {
    const home = path.join(tmpBase, 'target-home');
    const projectRoot = path.join(tmpBase, 'target-project');
    writeJson(path.join(projectRoot, '.aos', 'router.json'), {
      targets: {
        claude: { model: 'claude-sonnet-4.6' },
      },
    });
    const table = loadLayeredRouterTable({ home, projectRoot });
    assert.strictEqual(table.targets.claude.model, 'claude-sonnet-4.6');
    assert.strictEqual(table.targets['opencode-go'].model, 'glm-5.3-flash');
  });

  test('validation rejects unknown role in project layer after merge', () => {
    const home = path.join(tmpBase, 'bad-role-home');
    const projectRoot = path.join(tmpBase, 'bad-role-project');
    writeJson(path.join(projectRoot, '.aos', 'router.json'), {
      roles: ['architect', 'ninja'],
      targets: { claude: {} },
    });
    assert.throws(
      () => loadLayeredRouterTable({ home, projectRoot }),
      /Unknown role "ninja"/
    );
  });

  test('validation rejects unknown target in user layer after merge', () => {
    const home = path.join(tmpBase, 'bad-target-home');
    const projectRoot = path.join(tmpBase, 'bad-target-project');
    writeJson(path.join(home, '.aos', 'router.json'), {
      preferences: {
        architect: ['magic-engine'],
      },
    });
    assert.throws(
      () => loadLayeredRouterTable({ home, projectRoot }),
      /Unknown target "magic-engine"/
    );
  });

  test('HOME is a parameter, not read from process.env', () => {
    const realHome = process.env.HOME;
    const home = path.join(tmpBase, 'explicit-home');
    writeJson(path.join(home, '.aos', 'router.json'), {
      preferences: {
        scout: ['agy', 'claude'],
      },
    });
    const saved = process.env.HOME;
    try {
      process.env.HOME = '/should/not/be/used';
      const table = loadLayeredRouterTable({ home, projectRoot: path.join(tmpBase, 'explicit-project') });
      assert.deepStrictEqual(table.preferences.scout, ['agy', 'claude']);
    } finally {
      process.env.HOME = saved;
    }
  });
});

describe('getRouterTable accepts string or options object', () => {
  test('string path loads a single config', () => {
    const table = getRouterTable(DEFAULT_CONFIG_PATH);
    assert.strictEqual(table.enforce, false);
  });

  test('options object loads layered config', () => {
    const home = path.join(tmpBase, 'layered-home');
    writeJson(path.join(home, '.aos', 'router.json'), {
      preferences: {
        techlead: ['codex', 'claude'],
      },
    });
    const table = getRouterTable({ home, projectRoot: path.join(tmpBase, 'layered-project') });
    assert.deepStrictEqual(table.preferences.techlead, ['codex', 'claude']);
  });

  test('no argument returns shipped default and is cached', () => {
    resetRouterTableCache();
    const first = getRouterTable();
    const second = getRouterTable();
    assert.strictEqual(first, second);
    assert.strictEqual(first.enforce, false);
  });
});

describe('routeFor uses layered table via context', () => {
  test('routeFor reads project layer when projectRoot is given', () => {
    const home = path.join(tmpBase, 'route-home');
    const projectRoot = path.join(tmpBase, 'route-project');
    writeJson(path.join(projectRoot, '.aos', 'router.json'), {
      preferences: {
        architect: ['agy'],
      },
    });
    const res = routeFor('architect', { home, projectRoot });
    assert.strictEqual(res.target, 'agy');
  });
});
