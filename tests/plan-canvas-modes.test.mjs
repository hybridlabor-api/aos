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

  test('bdb-plan-builder is available because lib/plan-builder/index.js exists', async () => {
    const result = await runCommand(['modes']);
    const output = JSON.parse(result.stdout);

    const builder = output.modes.find(m => m.id === 'bdb-plan-builder');
    assert.ok(builder);
    assert.strictEqual(builder.available, true);
    assert.strictEqual(builder.reason, null);
  });

  test('builder mode is no longer listed', async () => {
    const result = await runCommand(['modes']);
    const output = JSON.parse(result.stdout);
    assert.ok(!output.modes.some(m => m.id === 'builder'));
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

  test('open .mdx file without --mode bdb-plan-builder emits warning to stderr and in JSON return object with await instruction', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-canvas-mdx-'));
    const tempStateDir = path.join(tempDir, 'state');
    const mdxFile = path.join(tempDir, 'test-plan-warning.mdx');
    fs.writeFileSync(mdxFile, '# Test Plan\n<Component />');

    try {
      const result = await runCommand(['open', mdxFile, '--no-open'], {
        AOS_PLAN_CANVAS_STATE_DIR: tempStateDir
      });
      assert.equal(result.code, 0);

      // Should emit warning to stderr
      assert.match(result.stderr, /without --mode bdb-plan-builder/i);
      assert.match(result.stderr, /aos-plan-canvas await <file>/);

      // JSON stdout should contain warning property and await instruction
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, 'open');
      assert.ok(output.warning || (output.warnings && output.warnings.length > 0));
      const warnMsg = output.warning || output.warnings[0];
      assert.match(warnMsg, /without --mode bdb-plan-builder/i);
      assert.match(warnMsg, /aos-plan-canvas await <file>/);
      assert.match(output.next_step, /aos-plan-canvas await <file>/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(mdxFile, { force: true });
    }
  });
});
