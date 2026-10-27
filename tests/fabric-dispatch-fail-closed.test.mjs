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
  test('when agy exits non-zero, techlead escalates instead of approving', () => {
    withTmpDir('dispatch-fail-closed-tl-', (dir) => {
      const cwd = path.join(dir, 'proj');
      fs.mkdirSync(cwd, { recursive: true });
      fs.cpSync(path.join(ROOT, '.agents'), path.join(cwd, '.agents'), { recursive: true });

      // Fake agy that exits 127 (command not found)
      const binDir = path.join(dir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fakeBinary(binDir, 'agy', 127, 'agy: not found');

      const harness = path.join(dir, 'run.mjs');
      fs.writeFileSync(harness, `
import fs from 'node:fs';
const calls = [];
globalThis.args = { goal: 'test goal' };
globalThis.pipeline = (items, fn) => Promise.all(items.map(fn));
globalThis.agent = async (prompt, opts) => {
  calls.push({ label: opts.label, approved: opts.label.startsWith('techlead') ? !!opts.result?.approved : undefined });
  if (opts.label === 'load-registry') return JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, '.agents', 'nodes.json'))}, 'utf8'));
  if (opts.label === 'validate-mandatory-skills') return { found: [], missing: [], store_matches: [] };
  if (opts.label === 'architect') return { planPath: 'p.md', needsMedia: false, deliverOk: true };
  if (opts.label.startsWith('techlead')) {
    // The shim should return approved: false with escalate: true when agy fails
    calls[calls.length - 1].result = opts.result;
  }
  return {};
};
try {
  const result = await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});
  process.stdout.write(JSON.stringify({ phase: result.default?.phase, calls }));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message, calls }));
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
      // The dispatcher should escalate when techlead executor fails
      assert.equal(output.phase, 'escalated', `phase should be 'escalated', got '${output.phase}'`);
    });
  });

  test('when agy exits non-zero, reviewer returns a blocking failure finding', () => {
    withTmpDir('dispatch-fail-closed-rev-', (dir) => {
      const cwd = path.join(dir, 'proj');
      fs.mkdirSync(cwd, { recursive: true });
      fs.cpSync(path.join(ROOT, '.agents'), path.join(cwd, '.agents'), { recursive: true });

      // Fake agy that exits 127
      const binDir = path.join(dir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fakeBinary(binDir, 'agy', 127);

      const harness = path.join(dir, 'run.mjs');
      fs.writeFileSync(harness, `
import fs from 'node:fs';
globalThis.args = { goal: 'test' };
globalThis.pipeline = (items, fn) => Promise.all(items.map(fn));
globalThis.agent = async (prompt, opts) => {
  if (opts.label === 'load-registry') return JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, '.agents', 'nodes.json'))}, 'utf8'));
  if (opts.label === 'validate-mandatory-skills') return { found: [], missing: [], store_matches: [] };
  if (opts.label === 'architect') return { planPath: 'p.md', needsMedia: false, deliverOk: true };
  if (opts.label.startsWith('techlead')) return { approved: true, reason: '' };
  if (opts.label.startsWith('merge-')) return { merged: 0, skipped: [], needsHuman: false };
  if (opts.label.startsWith('reviewer')) {
    // The shim should return a blocking "executor-failed" finding when agy fails
    return opts.result || {};
  }
  return {};
};
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
      // Reviewer failure should escalate
      assert.equal(output.phase, 'escalated', `phase should be 'escalated' when reviewer executor fails, got '${output.phase}'`);
    });
  });

  test('when agy exits non-zero, shipping returns all gates as fail', () => {
    withTmpDir('dispatch-fail-closed-ship-', (dir) => {
      const cwd = path.join(dir, 'proj');
      fs.mkdirSync(cwd, { recursive: true });
      fs.cpSync(path.join(ROOT, '.agents'), path.join(cwd, '.agents'), { recursive: true });

      // Fake agy that exits 127
      const binDir = path.join(dir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fakeBinary(binDir, 'agy', 127);

      const harness = path.join(dir, 'run.mjs');
      fs.writeFileSync(harness, `
import fs from 'node:fs';
globalThis.args = { goal: 'test' };
globalThis.pipeline = (items, fn) => Promise.all(items.map(fn));
globalThis.agent = async (prompt, opts) => {
  if (opts.label === 'load-registry') return JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, '.agents', 'nodes.json'))}, 'utf8'));
  if (opts.label === 'validate-mandatory-skills') return { found: [], missing: [], store_matches: [] };
  if (opts.label === 'architect') return { planPath: 'p.md', needsMedia: false, deliverOk: true };
  if (opts.label.startsWith('techlead')) return { approved: true, reason: '' };
  if (opts.label.startsWith('merge-')) return { merged: 0, skipped: [], needsHuman: false };
  if (opts.label.startsWith('reviewer')) return { findings: [], blockingCount: 0 };
  if (opts.label.startsWith('shipping')) {
    // The shim should return all gates as 'fail' when agy fails
    return opts.result || {};
  }
  return {};
};
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
      // Shipping failure should escalate
      assert.equal(output.phase, 'escalated', `phase should be 'escalated' when shipping executor fails, got '${output.phase}'`);
    });
  });
});
