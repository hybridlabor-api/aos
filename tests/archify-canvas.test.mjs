import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCHITECTURE_HTML_PATH,
  EXECUTION_PLAN_PATH,
  PLAN_CANVAS_BIN,
  PLAN_CANVAS_TIMEOUT_MS,
  PLAN_CANVAS_MAX_BYTES,
  buildPlanCanvasOpenArgs,
  buildAgentTrailArgs,
  buildUrlLine,
  runArchitectureCanvas,
} from '../lib/aos-archify-contract.mjs';

describe('A4 architecture canvas command', () => {
  test('builds the fixed canvas open argv for the verified HTML', () => {
    assert.deepEqual(buildPlanCanvasOpenArgs(ARCHITECTURE_HTML_PATH), [
      'open',
      ARCHITECTURE_HTML_PATH,
      '--no-open',
    ]);
  });

  test('rejects untrusted or missing canvas paths', () => {
    assert.equal(buildPlanCanvasOpenArgs('../00_architecture.html'), null);
    assert.equal(buildPlanCanvasOpenArgs('/tmp/00_architecture.html'), null);
    assert.equal(buildPlanCanvasOpenArgs('production_artifacts/00_execution_plan.md'), null);
    assert.equal(buildPlanCanvasOpenArgs(null), null);
    assert.equal(buildPlanCanvasOpenArgs(''), null);
  });

  test('pins canvas display bounds without a new port', () => {
    assert.equal(PLAN_CANVAS_BIN, 'aos-plan-canvas');
    assert.equal(typeof PLAN_CANVAS_TIMEOUT_MS, 'number');
    assert.ok(PLAN_CANVAS_TIMEOUT_MS > 0 && PLAN_CANVAS_TIMEOUT_MS <= 30000);
    assert.equal(typeof PLAN_CANVAS_MAX_BYTES, 'number');
    assert.ok(PLAN_CANVAS_MAX_BYTES > 0 && PLAN_CANVAS_MAX_BYTES <= 65536);
    const argv = buildPlanCanvasOpenArgs(ARCHITECTURE_HTML_PATH);
    assert.ok(!argv.some((a) => String(a).includes('--port')));
    assert.ok(!argv.some((a) => /https?:\/\//.test(String(a))));
  });
});

describe('A4 missing artifact fail-open', () => {
  test('skips canvas when the verified HTML is absent and preserves architecture', async () => {
    let called = false;
    const result = await runArchitectureCanvas({
      cwd: '/repo',
      htmlPath: ARCHITECTURE_HTML_PATH,
      exists: () => false,
      run: async () => {
        called = true;
        return { status: 0, stdout: '{}', stderr: '' };
      },
    });
    assert.equal(called, false);
    assert.equal(result.displayed, false);
    assert.equal(result.architecturePreserved, true);
    assert.match(String(result.reason || result.error || 'missing'), /missing|not found|absent|skip/i);
  });
});

describe('A4 safe argv without shell', () => {
  test('runs canvas with fixed argv, shell false, cwd and timeout', async () => {
    const calls = [];
    const result = await runArchitectureCanvas({
      cwd: '/repo',
      htmlPath: ARCHITECTURE_HTML_PATH,
      exists: () => true,
      run: async (argv, opts) => {
        calls.push({ argv, opts });
        return { status: 0, stdout: '{"status":"open"}', stderr: '' };
      },
    });
    assert.equal(result.displayed, true);
    assert.equal(result.architecturePreserved, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].argv, ['open', ARCHITECTURE_HTML_PATH, '--no-open']);
    assert.equal(calls[0].opts.cwd, '/repo');
    assert.equal(calls[0].opts.shell, false);
    assert.equal(calls[0].opts.timeoutMs, PLAN_CANVAS_TIMEOUT_MS);
    assert.ok(!calls[0].argv.some((a) => /0\.0\.0\.0|https?:\/\//.test(String(a))));
  });
});

describe('A4 agenttrail plan url', () => {
  test('emits fixed trail argv on the existing trigger path', () => {
    assert.deepEqual(buildAgentTrailArgs(), ['.', '--plan', EXECUTION_PLAN_PATH, '--no-open']);
    assert.equal(EXECUTION_PLAN_PATH, 'production_artifacts/00_execution_plan.md');
  });

  test('links the architecture from the plan component url line', () => {
    assert.equal(buildUrlLine(), `url: ${ARCHITECTURE_HTML_PATH}`);
  });
});

describe('A4 canvas error fallback fail-open', () => {
  test('stays fail-open when the canvas server is unavailable', async () => {
    const throwing = await runArchitectureCanvas({
      cwd: '/repo',
      htmlPath: ARCHITECTURE_HTML_PATH,
      exists: () => true,
      run: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1');
      },
    });
    assert.equal(throwing.displayed, false);
    assert.equal(throwing.architecturePreserved, true);

    const failing = await runArchitectureCanvas({
      cwd: '/repo',
      htmlPath: ARCHITECTURE_HTML_PATH,
      exists: () => true,
      run: async () => ({ status: 1, stdout: '', stderr: 'canvas server down' }),
    });
    assert.equal(failing.displayed, false);
    assert.equal(failing.architecturePreserved, true);
  });

  test('bounds canvas output and redacts log evidence', async () => {
    const big = await runArchitectureCanvas({
      cwd: '/repo',
      htmlPath: ARCHITECTURE_HTML_PATH,
      exists: () => true,
      run: async () => ({ status: 0, stdout: 'x'.repeat(PLAN_CANVAS_MAX_BYTES + 1), stderr: '' }),
    });
    assert.equal(big.displayed, false);
    assert.equal(big.architecturePreserved, true);
    assert.match(String(big.error || big.reason || 'bounded'), /bound/i);

    const leaking = await runArchitectureCanvas({
      cwd: '/repo',
      htmlPath: ARCHITECTURE_HTML_PATH,
      exists: () => true,
      run: async () => ({ status: 1, stdout: '', stderr: 'denied at /Users/bob/keys/token.txt' }),
    });
    assert.equal(leaking.displayed, false);
    assert.doesNotMatch(String(leaking.error || ''), /\/Users\/bob/);
    assert.ok(String(leaking.error || '').length <= 400);
  });
});
