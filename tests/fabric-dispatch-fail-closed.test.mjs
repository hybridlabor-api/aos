// Test that fabric-dispatch standalone shim fails closed when executor is unavailable.
// This is a security-relevant fix: a missing/failed agy should NOT return canned success results.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DISPATCH = path.join(ROOT, '.claude', 'workflows', 'fabric-dispatch.mjs');

function withTmpDir(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function fakeBinary(dir, name, exitCode, stderr = '') {
  const isWin = process.platform === 'win32';
  const ext = isWin ? '.cmd' : '';
  const content = isWin
    ? `@echo off\n(echo ${stderr.replace(/"/g, '\\"')} >&2) > nul\nexit /b ${exitCode}\n`
    : `#!/bin/sh\n[ -z "" ] || echo "${stderr.replace(/"/g, '\\"')}" >&2\nexit ${exitCode}\n`;
  const fPath = path.join(dir, name + ext);
  fs.writeFileSync(fPath, content);
  if (!isWin) fs.chmodSync(fPath, 0o755);
}

describe('fabric-dispatch standalone shim: fail-closed on executor failure', () => {
  test('when agy exits non-zero, dispatcher escalates and never calls shim techlead', () => {
    withTmpDir('dispatch-fail-closed-tl-', (dir) => {
      const cwd = path.join(dir, 'proj');
      fs.mkdirSync(cwd, { recursive: true });
      fs.cpSync(path.join(ROOT, '.agents'), path.join(cwd, '.agents'), { recursive: true });
      fs.mkdirSync(path.join(cwd, 'production_artifacts'), { recursive: true });

      // Fake agy that exits 127 (command not found)
      const binDir = path.join(dir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fakeBinary(binDir, 'agy', 127, 'agy: not found');

      const harness = path.join(dir, 'run.mjs');
      fs.writeFileSync(harness, `
import fs from 'node:fs';
globalThis.args = { goal: 'test goal' };
globalThis.pipeline = (items, fn) => Promise.all(items.map(fn));
// DO NOT predefine globalThis.agent -- let the shim run and invoke agy
try {
  const result = await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});
  process.stdout.write(JSON.stringify({ phase: result.default?.phase }));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message }));
}
`);

      const r = spawnSync(process.execPath, [harness], {
        cwd,
        encoding: 'utf8',
        timeout: 60000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: binDir + (process.platform === 'win32' ? ';' + process.env.PATH : ':' + process.env.PATH),
          HOME: cwd,
          USERPROFILE: cwd,
          AOS_PLAN_APPROVAL: 'auto',
        },
      });

      assert.equal(r.status, 0, `exit status should be 0, got ${r.status}. stderr: ${r.stderr}`);
      const output = JSON.parse(r.stdout);
      // The dispatcher should escalate when architect executor fails (agy not found)
      assert.equal(output.phase, 'escalated', `phase should be 'escalated', got '${output.phase}'`);
    });
  });

  test('when agy exits non-zero, shim returns blocking executor-failed finding', () => {
    withTmpDir('dispatch-fail-closed-rev-', (dir) => {
      const cwd = path.join(dir, 'proj');
      fs.mkdirSync(cwd, { recursive: true });
      fs.cpSync(path.join(ROOT, '.agents'), path.join(cwd, '.agents'), { recursive: true });
      fs.mkdirSync(path.join(cwd, 'production_artifacts'), { recursive: true });

      // Fake agy that exits 127
      const binDir = path.join(dir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fakeBinary(binDir, 'agy', 127);

      const harness = path.join(dir, 'run.mjs');
      fs.writeFileSync(harness, `
import fs from 'node:fs';
globalThis.args = { goal: 'test goal' };
globalThis.pipeline = (items, fn) => Promise.all(items.map(fn));
const agentCalls = [];
globalThis.agent = async (prompt, opts) => {
  agentCalls.push(opts.label);
  // Minimal shim: only handle deterministic steps; let agy fail for LLM steps
  if (opts.label === 'load-registry') return JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, '.agents', 'nodes.json'))}, 'utf8'));
  if (opts.label === 'validate-mandatory-skills') return { found: [], missing: [], store_matches: [] };
  if (opts.label === 'verify-plan-approval') return { valid: false, reason: 'test' };
  if (opts.label === 'ensure-node-skills' || opts.label.startsWith('ensure-skills-')) return { installed: [], stillMissing: [] };
  if (opts.label.startsWith('merge-')) return { merged: 0, skipped: [], needsHuman: false };
  if (opts.label === 'escalate') {
    try {
      const statePath = 'production_artifacts/state.json';
      let state = {};
      if (fs.existsSync(statePath)) {
        state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      }
      state.phase = 'escalated';
      state.needs_human = true;
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
    } catch (e) {}
    return { phase: 'escalated' };
  }
  // All LLM steps (architect, reviewer, etc) will hit agy, which fails; shim should escalate
  throw new Error('Unexpected agent call: ' + opts.label + ' -- should be handled by shim');
};
try {
  const result = await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});
  process.stdout.write(JSON.stringify({ phase: result.default?.phase, calls: agentCalls }));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message, calls: agentCalls }));
}
`);

      const r = spawnSync(process.execPath, [harness], {
        cwd,
        encoding: 'utf8',
        timeout: 60000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: binDir + (process.platform === 'win32' ? ';' + process.env.PATH : ':' + process.env.PATH),
          HOME: cwd,
          USERPROFILE: cwd,
          AOS_PLAN_APPROVAL: 'auto',
        },
      });

      assert.equal(r.status, 0, `exit status should be 0, got ${r.status}. stderr: ${r.stderr}`);
      const output = JSON.parse(r.stdout);
      // When reviewer shim fails (agy missing), dispatcher should escalate
      assert.equal(output.phase, 'escalated', `phase should be 'escalated' when reviewer executor fails, got '${output.phase}'`);
      // Verify that reviewer-N was called (with iteration counter N)
      assert.ok(output.calls.some(c => c.startsWith('reviewer-')), `reviewer should have been called, got calls: ${output.calls.join(', ')}`);
    });
  });

  test('when agy exits non-zero, shim returns all gates as fail', () => {
    withTmpDir('dispatch-fail-closed-ship-', (dir) => {
      const cwd = path.join(dir, 'proj');
      fs.mkdirSync(cwd, { recursive: true });
      fs.cpSync(path.join(ROOT, '.agents'), path.join(cwd, '.agents'), { recursive: true });
      fs.mkdirSync(path.join(cwd, 'production_artifacts'), { recursive: true });

      // Fake agy that exits 127
      const binDir = path.join(dir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fakeBinary(binDir, 'agy', 127);

      const harness = path.join(dir, 'run.mjs');
      fs.writeFileSync(harness, `
import fs from 'node:fs';
globalThis.args = { goal: 'test goal' };
globalThis.pipeline = (items, fn) => Promise.all(items.map(fn));
const agentCalls = [];
globalThis.agent = async (prompt, opts) => {
  agentCalls.push(opts.label);
  // Minimal shim: only handle deterministic steps
  if (opts.label === 'load-registry') return JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, '.agents', 'nodes.json'))}, 'utf8'));
  if (opts.label === 'validate-mandatory-skills') return { found: [], missing: [], store_matches: [] };
  if (opts.label === 'verify-plan-approval') return { valid: false, reason: 'test' };
  if (opts.label === 'ensure-node-skills' || opts.label.startsWith('ensure-skills-')) return { installed: [], stillMissing: [] };
  if (opts.label.startsWith('merge-')) return { merged: 0, skipped: [], needsHuman: false };
  if (opts.label === 'escalate') {
    try {
      const statePath = 'production_artifacts/state.json';
      let state = {};
      if (fs.existsSync(statePath)) {
        state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      }
      state.phase = 'escalated';
      state.needs_human = true;
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
    } catch (e) {}
    return { phase: 'escalated' };
  }
  // All LLM steps will hit agy; shim should escalate
  throw new Error('Unexpected agent call: ' + opts.label + ' -- should be handled by shim');
};
try {
  const result = await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});
  process.stdout.write(JSON.stringify({ phase: result.default?.phase, calls: agentCalls }));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message, calls: agentCalls }));
}
`);

      const r = spawnSync(process.execPath, [harness], {
        cwd,
        encoding: 'utf8',
        timeout: 60000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: binDir + (process.platform === 'win32' ? ';' + process.env.PATH : ':' + process.env.PATH),
          HOME: cwd,
          USERPROFILE: cwd,
          AOS_PLAN_APPROVAL: 'auto',
        },
      });

      assert.equal(r.status, 0, `exit status should be 0, got ${r.status}. stderr: ${r.stderr}`);
      const output = JSON.parse(r.stdout);
      // When shipping shim fails (agy missing), dispatcher should escalate instead of passing
      assert.equal(output.phase, 'escalated', `phase should be 'escalated' when shipping executor fails, got '${output.phase}'`);
      assert.ok(output.calls.some(c => c.startsWith('shipping-')), `shipping should have been called, got calls: ${output.calls.join(', ')}`);
    });
  });
});
