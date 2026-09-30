import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(root, 'skills/global_config/plan-canvas/scripts/plan-canvas.js');

function runCommand(args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    proc.on('close', code => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', reject);
  });
}

describe('Plan Canvas modes', () => {
  test('modes command returns JSON with correct shape', async () => {
    const result = await runCommand(['modes']);
    assert.equal(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.ok(output.default);
    assert.ok(Array.isArray(output.modes));
    assert.ok(output.modes.length > 0);

    for (const mode of output.modes) {
      assert.ok(mode.id);
      assert.ok(mode.label);
      assert.strictEqual(typeof mode.available, 'boolean');
      assert.ok(mode.reason === null || typeof mode.reason === 'string');
    }
  });

  test('standard mode is always available', async () => {
    const result = await runCommand(['modes']);
    const output = JSON.parse(result.stdout);

    const standard = output.modes.find(m => m.id === 'standard');
    assert.ok(standard);
    assert.strictEqual(standard.available, true);
    assert.strictEqual(standard.reason, null);
    assert.strictEqual(output.default, 'standard');
  });

  test('bdb-plan-builder is unavailable when lib/plan-builder/index.js does not exist', async () => {
    const result = await runCommand(['modes']);
    const output = JSON.parse(result.stdout);

    const builder = output.modes.find(m => m.id === 'bdb-plan-builder');
    assert.ok(builder);
    assert.strictEqual(builder.available, false);
    assert.ok(builder.reason);
  });

  test('builder mode detection with AOS_PLAN_CANVAS_SKILL_DIRS', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    const visualPlanDir = path.join(tempDir, 'visual-plan');
    fs.mkdirSync(visualPlanDir, { recursive: true });
    fs.writeFileSync(path.join(visualPlanDir, 'SKILL.md'), '# Visual Plan');

    try {
      const result = await runCommand(['modes'], {
        AOS_PLAN_CANVAS_SKILL_DIRS: tempDir
      });
      const output = JSON.parse(result.stdout);

      const builder = output.modes.find(m => m.id === 'builder');
      assert.ok(builder);
      assert.strictEqual(builder.available, true);
      assert.strictEqual(builder.reason, null);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('builder mode is unavailable when visual-plan/SKILL.md not found', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));

    try {
      const result = await runCommand(['modes'], {
        AOS_PLAN_CANVAS_SKILL_DIRS: tempDir
      });
      const output = JSON.parse(result.stdout);

      const builder = output.modes.find(m => m.id === 'builder');
      assert.ok(builder);
      assert.strictEqual(builder.available, false);
      assert.ok(builder.reason);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('open with unknown mode exits with code 2', async () => {
    const tempFile = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    const planFile = path.join(tempFile, 'plan.md');
    fs.writeFileSync(planFile, '# Test Plan');

    try {
      const result = await runCommand(['open', planFile, '--mode', 'nonsense']);
      assert.equal(result.code, 2);
      assert.ok(result.stdout.includes('error'));
    } finally {
      fs.rmSync(tempFile, { recursive: true, force: true });
    }
  });

  test('open with unavailable mode exits with code 2', async () => {
    const tempFile = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-test-'));
    const planFile = path.join(tempFile, 'plan.md');
    fs.writeFileSync(planFile, '# Test Plan');

    try {
      const result = await runCommand(['open', planFile, '--mode', 'bdb-plan-builder']);
      assert.equal(result.code, 2);
      assert.ok(result.stdout.includes('error'));
    } finally {
      fs.rmSync(tempFile, { recursive: true, force: true });
    }
  });

  test('open with standard mode (default) succeeds with file not found error (no server)', async () => {
    const result = await runCommand(['open', '/nonexistent/file.md', '--mode', 'standard']);
    // Should fail with artifact not found, not mode error
    assert.equal(result.code, 1);
    assert.ok(result.stdout.includes('artifact not found'));
  });
});
