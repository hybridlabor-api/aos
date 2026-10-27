import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Helper to run aos-fabric command
function runAosFabric(args, cwd) {
  const result = spawnSync('node', ['bin/aos-fabric.mjs', ...args], {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

test('fabric-cli: start creates a run', () => {
  const tmpDir = mkdtempSync('fabric-test-');
  try {
    const result = runAosFabric(['start', '--run', 'test-1', '--goal', 'Build something'], tmpDir);
    assert.strictEqual(result.code, 0, `Expected exit 0, got ${result.code}: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.run, 'test-1');
    assert.strictEqual(output.phase, 'define');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('fabric-cli: start with goal-file', () => {
  const tmpDir = mkdtempSync('fabric-test-');
  try {
    const goalFile = join(tmpDir, 'goal.md');
    writeFileSync(goalFile, '# Goal\nBuild something');

    const result = runAosFabric(['start', '--run', 'test-2', '--goal-file', goalFile], tmpDir);
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.ok(output.goal);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('fabric-cli: start is idempotent with same goal', () => {
  const tmpDir = mkdtempSync('fabric-test-');
  try {
    const result1 = runAosFabric(['start', '--run', 'test-3', '--goal', 'Same goal'], tmpDir);
    assert.strictEqual(result1.code, 0);

    const result2 = runAosFabric(['start', '--run', 'test-3', '--goal', 'Same goal'], tmpDir);
    assert.strictEqual(result2.code, 0, `Expected idempotent, got exit ${result2.code}`);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('fabric-cli: start conflicts with different goal', () => {
  const tmpDir = mkdtempSync('fabric-test-');
  try {
    runAosFabric(['start', '--run', 'test-4', '--goal', 'First goal'], tmpDir);
    const result = runAosFabric(['start', '--run', 'test-4', '--goal', 'Different goal'], tmpDir);
    assert.strictEqual(result.code, 4, `Expected conflict (exit 4), got ${result.code}`);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('fabric-cli: next on non-existent run fails', () => {
  const tmpDir = mkdtempSync('fabric-test-');
  try {
    const result = runAosFabric(['next', '--run', 'nonexistent'], tmpDir);
    assert.strictEqual(result.code, 3, `Expected not found (exit 3), got ${result.code}`);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('fabric-cli: next returns step', () => {
  const tmpDir = mkdtempSync('fabric-test-');
  try {
    runAosFabric(['start', '--run', 'test-5', '--goal', 'Test goal'], tmpDir);
    const result = runAosFabric(['next', '--run', 'test-5'], tmpDir);
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.ok(output.step || output.kind);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('fabric-cli: cancel sets phase to cancelled', () => {
  const tmpDir = mkdtempSync('fabric-test-');
  try {
    runAosFabric(['start', '--run', 'test-6', '--goal', 'Test goal'], tmpDir);
    const result = runAosFabric(['cancel', '--run', 'test-6', '--reason', 'User cancelled'], tmpDir);
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.phase, 'cancelled');
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('fabric-cli: cancel is idempotent', () => {
  const tmpDir = mkdtempSync('fabric-test-');
  try {
    runAosFabric(['start', '--run', 'test-7', '--goal', 'Test goal'], tmpDir);
    runAosFabric(['cancel', '--run', 'test-7'], tmpDir);
    const result = runAosFabric(['cancel', '--run', 'test-7'], tmpDir);
    assert.strictEqual(result.code, 0);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('fabric-cli: status shows current state', () => {
  const tmpDir = mkdtempSync('fabric-test-');
  try {
    runAosFabric(['start', '--run', 'test-8', '--goal', 'Test goal'], tmpDir);
    const result = runAosFabric(['status', '--run', 'test-8'], tmpDir);
    assert.strictEqual(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.ok(output.phase);
    assert.strictEqual(output.iteration, 0);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('fabric-cli: report requires --run, --step, --file', () => {
  const tmpDir = mkdtempSync('fabric-test-');
  try {
    const result = runAosFabric(['report', '--run', 'test-9'], tmpDir);
    assert.strictEqual(result.code, 2, `Expected invalid input (exit 2), got ${result.code}`);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('fabric-cli: missing command shows help', () => {
  const result = runAosFabric(['--help']);
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.includes('aos-fabric'));
});
