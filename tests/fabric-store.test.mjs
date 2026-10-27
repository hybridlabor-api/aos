import { test } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createStore, EXIT_CODES } from '../lib/fabric/store.mjs';

const tmpDir = path.join(os.tmpdir(), `aos-fabric-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

async function cleanup() {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {}
}

test('store: create and lock', async () => {
  const store = createStore('test-run-1', tmpDir);
  const lockRes = store.tryLock();
  assert.strictEqual(lockRes.ok, true, `Lock failed: ${lockRes.code}`);
  store.releaseLock();
  await cleanup();
});

test('store: lock is exclusive', async () => {
  const store1 = createStore('test-run-2', tmpDir);
  const store2 = createStore('test-run-2', tmpDir);

  const lock1 = store1.tryLock();
  assert.strictEqual(lock1.ok, true);

  const lock2 = store2.tryLock();
  assert.strictEqual(lock2.ok, false);
  assert.strictEqual(lock2.code, EXIT_CODES.LOCK_BUSY);

  store1.releaseLock();
  await cleanup();
});

test('store: append event and replay', async () => {
  const store = createStore('test-run-3', tmpDir);

  const lockRes = store.tryLock();
  assert.strictEqual(lockRes.ok, true);

  store.appendEvent({
    kind: 'start',
    run_id: 'test-run-3',
    goal: 'Test goal',
    max_iterations: 3,
    at: new Date().toISOString(),
  });

  const state = store.replayState();
  assert.strictEqual(state.goal, 'Test goal');
  assert.strictEqual(state.max_iterations, 3);

  store.releaseLock();
  await cleanup();
});

test('store: atomic write to state.json and mirror', async () => {
  const store = createStore('test-run-4', tmpDir);

  const lockRes = store.tryLock();
  assert.strictEqual(lockRes.ok, true);

  const testState = { run_id: 'test-run-4', phase: 'build', iteration: 1 };
  store.writeState(testState);

  const fileContent = await fs.readFile(store.statePath, 'utf8');
  const readState = JSON.parse(fileContent);
  assert.strictEqual(readState.phase, 'build');

  const mirrorContent = await fs.readFile(store.stateBackupPath, 'utf8');
  const mirrorState = JSON.parse(mirrorContent);
  assert.strictEqual(mirrorState.phase, 'build');

  store.releaseLock();
  await cleanup();
});

test('store: write step and brief files', async () => {
  const store = createStore('test-run-5', tmpDir);

  const lockRes = store.tryLock();
  assert.strictEqual(lockRes.ok, true);

  const stepData = { step_id: 'step-1', node: 'eng', kind: 'build' };
  store.writeStepFile('step-1', stepData);

  const stepContent = await fs.readFile(path.join(store.stepsDirPath, 'step-1.json'), 'utf8');
  const readStep = JSON.parse(stepContent);
  assert.strictEqual(readStep.node, 'eng');

  const briefText = '# Brief\nThis is a test brief.';
  store.writeBriefFile('step-1', briefText);

  const briefContent = await fs.readFile(path.join(store.briefsDirPath, 'step-1.md'), 'utf8');
  assert(briefContent.includes('test brief'));

  store.releaseLock();
  await cleanup();
});

test('store: digest for idempotency', async () => {
  const store = createStore('test-run-6', tmpDir);

  const report1 = { step_id: 'step-1', status: 'ok', findings: [] };
  const report2 = { step_id: 'step-1', status: 'ok', findings: [] };
  const report3 = { step_id: 'step-1', status: 'fail', findings: [] };

  const digest1 = store.digest(report1);
  const digest2 = store.digest(report2);
  const digest3 = store.digest(report3);

  assert.strictEqual(digest1, digest2, 'Identical reports should have same digest');
  assert.notStrictEqual(digest1, digest3, 'Different reports should have different digest');

  await cleanup();
});

test('store: replay with torn last line dropped', async () => {
  const store = createStore('test-run-7', tmpDir);
  const lockRes = store.tryLock();
  assert.strictEqual(lockRes.ok, true);

  // Write events then corrupt last line
  store.appendEvent({ kind: 'start', run_id: 'test-run-7', goal: 'Test' });
  store.appendEvent({ kind: 'step_issued', step_id: 'step-1' });

  // Append incomplete line (no newline)
  const fs_import = await import('node:fs');
  fs_import.appendFileSync(store.eventsPath, '{"kind": "invalid", "incomplete": true');

  const state = store.replayState();
  assert.strictEqual(state.goal, 'Test');
  assert.strictEqual(state.last_step_id, 'step-1');
  // The incomplete line should be silently dropped, not cause error

  store.releaseLock();
  await cleanup();
});

test('store: read and update state', async () => {
  const store = createStore('test-run-8', tmpDir);
  const lockRes = store.tryLock();
  assert.strictEqual(lockRes.ok, true);

  const initialState = { run_id: 'test-run-8', phase: 'define' };
  store.writeState(initialState);

  const readBack = store.readState();
  assert.strictEqual(readBack.phase, 'define');

  const updated = { ...readBack, phase: 'build', iteration: 1 };
  store.writeState(updated);

  const readAgain = store.readState();
  assert.strictEqual(readAgain.phase, 'build');
  assert.strictEqual(readAgain.iteration, 1);

  store.releaseLock();
  await cleanup();
});
