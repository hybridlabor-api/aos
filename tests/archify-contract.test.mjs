import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ARCHITECTURE_SPEC_PATH,
  ARCHITECTURE_HTML_PATH,
  ARCHITECTURE_STATE_KEY,
  ARCHIFY_REL_BIN,
  ARCHIFY_TIMEOUT_MS,
  ARCHIFY_MAX_BYTES,
  isAllowedArchitecturePath,
  parseDeliverReceipt,
  mergeArchitectureState,
  buildUrlLine,
  planCanvasCommands,
  agentTrailCommand,
  redactForLog,
  resolveArchifyBin,
  buildValidateArgs,
  buildDeliverArgs,
  runArchifyBoundary,
} from '../lib/aos-archify-contract.mjs';

describe('archify contract paths', () => {
  test('pins the approved artifact paths and state key', () => {
    assert.equal(ARCHITECTURE_SPEC_PATH, 'production_artifacts/00_architecture.json');
    assert.equal(ARCHITECTURE_HTML_PATH, 'production_artifacts/00_architecture.html');
    assert.equal(ARCHITECTURE_STATE_KEY, 'architecture');
  });

  test('accepts only the two approved relative paths', () => {
    assert.equal(isAllowedArchitecturePath('production_artifacts/00_architecture.json'), true);
    assert.equal(isAllowedArchitecturePath('production_artifacts/00_architecture.html'), true);
  });

  test('rejects traversal, absolute paths and remote urls', () => {
    assert.equal(isAllowedArchitecturePath('../00_architecture.html'), false);
    assert.equal(isAllowedArchitecturePath('production_artifacts/../00_architecture.html'), false);
    assert.equal(isAllowedArchitecturePath('/tmp/00_architecture.html'), false);
    assert.equal(isAllowedArchitecturePath('https://example.com/00_architecture.html'), false);
    assert.equal(isAllowedArchitecturePath('production_artifacts/01_frontend_spec.md'), false);
    assert.equal(isAllowedArchitecturePath(''), false);
    assert.equal(isAllowedArchitecturePath(null), false);
  });
});

describe('deliver receipt handling', () => {
  test('accepts a passing showcase receipt', () => {
    const receipt = JSON.stringify({
      schemaVersion: 1,
      ok: true,
      command: 'deliver',
      type: 'architecture',
      specification: { sha256: 'a'.repeat(64), bytes: 1200 },
      artifact: { sha256: 'b'.repeat(64), bytes: 45000 },
      validation: { checksPassed: 9, checkCount: 9, errors: 0, warnings: 0 },
    });
    const parsed = parseDeliverReceipt(receipt);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.checksPassed, 9);
    assert.equal(parsed.checkCount, 9);
  });

  test('rejects a failing receipt without throwing', () => {
    const receipt = JSON.stringify({
      schemaVersion: 1,
      ok: false,
      command: 'deliver',
      stage: 'check',
      error: 'Final artifact check failed',
      diagnostics: [{ code: 'artifact/check-failed', message: 'failed', subject: {}, evidence: {} }],
    });
    const parsed = parseDeliverReceipt(receipt);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /check|deliver|failed/i);
  });

  test('rejects malformed json and oversized input without throwing', () => {
    const bad = parseDeliverReceipt('{not json');
    assert.equal(bad.ok, false);
    const big = parseDeliverReceipt('{"ok":true}', { maxBytes: 4 });
    assert.equal(big.ok, false);
    assert.match(big.error, /bound|size|large/i);
  });
});

describe('state merge', () => {
  test('sets artifacts.architecture only on a passing receipt', () => {
    const state = { artifacts: { plan: 'production_artifacts/00_execution_plan.md' }, findings: [] };
    const receipt = { ok: true, checksPassed: 9, checkCount: 9 };
    const merged = mergeArchitectureState(state, receipt);
    assert.equal(merged.state.artifacts.architecture, 'production_artifacts/00_architecture.html');
    assert.equal(merged.state.artifacts.plan, 'production_artifacts/00_execution_plan.md');
    assert.equal(merged.escalate, null);
  });

  test('leaves state untouched on a failing receipt and asks to escalate', () => {
    const state = { artifacts: { plan: 'production_artifacts/00_execution_plan.md' }, findings: [] };
    const receipt = { ok: false, error: 'Final artifact check failed' };
    const merged = mergeArchitectureState(state, receipt);
    assert.equal(merged.state.artifacts.architecture, undefined);
    assert.equal(merged.state.artifacts.plan, 'production_artifacts/00_execution_plan.md');
    assert.match(merged.escalate, /archif|deliver|valid/i);
  });
});

describe('triggers', () => {
  test('emits the component url line', () => {
    assert.equal(buildUrlLine(), 'url: production_artifacts/00_architecture.html');
  });

  test('emits loopback-safe plan-canvas and agenttrail commands', () => {
    const canvas = planCanvasCommands();
    assert.match(canvas.open, /aos-plan-canvas open production_artifacts\/00_architecture\.html/);
    assert.match(canvas.awaitCmd, /aos-plan-canvas await production_artifacts\/00_architecture\.html/);
    assert.doesNotMatch(canvas.open, /0\.0\.0\.0|https?:\/\//);
    const trail = agentTrailCommand();
    assert.match(trail, /aos-trail \. --plan production_artifacts\/00_execution_plan\.md --no-open/);
  });
});

describe('redaction', () => {
  test('redacts home directories and keeps logs bounded', () => {
    const redacted = redactForLog('open /Users/alice/secret/prod.json sha ' + 'c'.repeat(64));
    assert.doesNotMatch(redacted, /\/Users\/alice/);
    assert.match(redacted, /~/);
    assert.ok(redacted.length < 500);
  });
});

describe('runtime argv', () => {
  test('pins the archify binary path, timeout and output bound', () => {
    assert.equal(ARCHIFY_REL_BIN, 'skills/global_config/archify/bin/archify.mjs');
    assert.equal(ARCHIFY_TIMEOUT_MS, 120000);
    assert.equal(ARCHIFY_MAX_BYTES, 65536);
  });

  test('resolves the binary through realpath and confines symlink targets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-archify-root-'));
    const bin = path.join(root, ARCHIFY_REL_BIN);
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '');
    try {
      assert.equal(resolveArchifyBin(root), fs.realpathSync(bin));
      assert.equal(resolveArchifyBin(path.join(root, 'nested', '..')), fs.realpathSync(bin));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    const linkedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-archify-link-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-archify-outside-'));
    const outsideBin = path.join(outside, 'archify.mjs');
    fs.writeFileSync(outsideBin, '');
    fs.mkdirSync(path.join(linkedRoot, 'skills', 'global_config'), { recursive: true });
    fs.symlinkSync(outside, path.join(linkedRoot, 'skills', 'global_config', 'archify'), 'dir');
    try {
      assert.equal(resolveArchifyBin(linkedRoot), null);
    } finally {
      fs.rmSync(linkedRoot, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
    assert.equal(resolveArchifyBin(''), null);
    assert.equal(resolveArchifyBin(null), null);
  });

  test('builds exact validate argv and rejects untrusted spec paths', () => {
    assert.deepEqual(buildValidateArgs(ARCHITECTURE_SPEC_PATH), [
      'validate', 'architecture', ARCHITECTURE_SPEC_PATH, '--quality', 'showcase', '--json',
    ]);
    assert.equal(buildValidateArgs('../00_architecture.json'), null);
    assert.equal(buildValidateArgs('/tmp/00_architecture.json'), null);
    assert.equal(buildValidateArgs('production_artifacts/01_frontend_spec.md'), null);
    assert.equal(buildValidateArgs(null), null);
  });

  test('builds exact deliver argv and rejects untrusted pairs', () => {
    assert.deepEqual(buildDeliverArgs(ARCHITECTURE_SPEC_PATH, ARCHITECTURE_HTML_PATH), [
      'deliver', 'architecture', ARCHITECTURE_SPEC_PATH, ARCHITECTURE_HTML_PATH, '--quality', 'showcase', '--json',
    ]);
    assert.equal(buildDeliverArgs(ARCHITECTURE_SPEC_PATH, '/tmp/x.html'), null);
    assert.equal(buildDeliverArgs('/tmp/x.json', ARCHITECTURE_HTML_PATH), null);
    assert.equal(buildDeliverArgs(ARCHITECTURE_SPEC_PATH, ARCHITECTURE_SPEC_PATH), null);
  });
});

describe('runtime boundary', () => {
  const passingReceipt = () => JSON.stringify({
    schemaVersion: 1,
    ok: true,
    command: 'deliver',
    type: 'architecture',
    specification: { sha256: 'a'.repeat(64), bytes: 1200 },
    artifact: { sha256: 'b'.repeat(64), bytes: 45000 },
    validation: { checksPassed: 9, checkCount: 9, errors: 0, warnings: 0 },
  });

  test('runs validate then deliver in order with cwd and timeout', async () => {
    const calls = [];
    const run = async (argv, opts) => {
      calls.push({ argv, opts });
      if (argv[0] === 'validate') return { status: 0, stdout: '{"ok":true}', stderr: '' };
      return { status: 0, stdout: passingReceipt(), stderr: '' };
    };
    const result = await runArchifyBoundary({
      bin: '/repo/' + ARCHIFY_REL_BIN,
      cwd: '/repo',
      specPath: ARCHITECTURE_SPEC_PATH,
      htmlPath: ARCHITECTURE_HTML_PATH,
      run,
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].argv[0], 'validate');
    assert.equal(calls[1].argv[0], 'deliver');
    assert.equal(calls[0].opts.cwd, '/repo');
    assert.equal(calls[1].opts.cwd, '/repo');
    assert.equal(calls[0].opts.timeoutMs, ARCHIFY_TIMEOUT_MS);
    assert.equal(calls[0].opts.shell, false);
    assert.equal(calls[0].opts.maxBuffer, ARCHIFY_MAX_BYTES);
    assert.deepEqual(result.receipt.checksPassed, 9);
  });

  test('stops before deliver when validate fails and preserves the previous artifact', async () => {
    let deliverCalled = false;
    const run = async (argv) => {
      if (argv[0] === 'deliver') deliverCalled = true;
      return { status: 1, stdout: '', stderr: 'validate failed' };
    };
    const result = await runArchifyBoundary({
      bin: '/repo/' + ARCHIFY_REL_BIN,
      cwd: '/repo',
      specPath: ARCHITECTURE_SPEC_PATH,
      htmlPath: ARCHITECTURE_HTML_PATH,
      run,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, 'validate');
    assert.equal(deliverCalled, false);
    assert.equal(result.preservePrevious, true);
  });

  test('fails closed without throwing when the executor throws', async () => {
    const run = async () => { throw new Error('spawn EACCES'); };
    const result = await runArchifyBoundary({
      bin: '/repo/' + ARCHIFY_REL_BIN,
      cwd: '/repo',
      specPath: ARCHITECTURE_SPEC_PATH,
      htmlPath: ARCHITECTURE_HTML_PATH,
      run,
    });
    assert.equal(result.ok, false);
    assert.equal(result.preservePrevious, true);
    assert.match(result.error, /EACCES|executor|spawn/i);
  });

  test('fails closed on oversized and unparsable output with bounded redacted errors', async () => {
    const big = async () => ({ status: 0, stdout: 'x'.repeat(ARCHIFY_MAX_BYTES + 1), stderr: '' });
    const oversized = await runArchifyBoundary({
      bin: '/repo/' + ARCHIFY_REL_BIN, cwd: '/repo',
      specPath: ARCHITECTURE_SPEC_PATH, htmlPath: ARCHITECTURE_HTML_PATH, run: big,
    });
    assert.equal(oversized.ok, false);
    assert.match(oversized.error, /bound/i);

    const junk = async (argv) => {
      if (argv[0] === 'validate') return { status: 0, stdout: '{"ok":true}', stderr: '' };
      return { status: 0, stdout: '{not json', stderr: '' };
    };
    const unparsable = await runArchifyBoundary({
      bin: '/repo/' + ARCHIFY_REL_BIN, cwd: '/repo',
      specPath: ARCHITECTURE_SPEC_PATH, htmlPath: ARCHITECTURE_HTML_PATH, run: junk,
    });
    assert.equal(unparsable.ok, false);
    assert.equal(unparsable.stage, 'deliver');

    const leaking = async (argv) => {
      if (argv[0] === 'validate') return { status: 0, stdout: '{"ok":true}', stderr: '' };
      return { status: 1, stdout: '', stderr: 'denied at /Users/bob/keys/token.txt' };
    };
    const failed = await runArchifyBoundary({
      bin: '/repo/' + ARCHIFY_REL_BIN, cwd: '/repo',
      specPath: ARCHITECTURE_SPEC_PATH, htmlPath: ARCHITECTURE_HTML_PATH, run: leaking,
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.preservePrevious, true);
    assert.doesNotMatch(failed.error, /\/Users\/bob/);
    assert.ok(failed.error.length <= 400);
  });

  test('rejects untrusted paths and missing executor fail-closed', async () => {
    const run = async () => ({ status: 0, stdout: '{}', stderr: '' });
    const bad = await runArchifyBoundary({
      bin: '/repo/' + ARCHIFY_REL_BIN, cwd: '/repo',
      specPath: '/tmp/evil.json', htmlPath: ARCHITECTURE_HTML_PATH, run,
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.stage, 'arguments');
    const missing = await runArchifyBoundary({
      bin: '/repo/' + ARCHIFY_REL_BIN, cwd: '/repo',
      specPath: ARCHITECTURE_SPEC_PATH, htmlPath: ARCHITECTURE_HTML_PATH,
    });
    assert.equal(missing.ok, false);
  });
});

describe('dispatcher contract wiring', () => {
  test('uses the tested boundary and fixed-argv shell hardening', () => {
    const source = fs.readFileSync(new URL('../.claude/workflows/startcycle-dispatch.mjs', import.meta.url), 'utf8');
    const verifyStart = source.indexOf("if (label.startsWith('archify-verify'))");
    const verifyEnd = source.indexOf('// LLM Agent Steps:', verifyStart);
    const verifyBlock = source.slice(verifyStart, verifyEnd);
    assert.match(source, /aos-archify-contract\.mjs/);
    assert.match(source, /runArchifyBoundary/);
    assert.doesNotMatch(verifyBlock, /JSON\.parse\(deliverRes\.stdout\)/);
    assert.match(source, /spawn\('aos-trail',[\s\S]*?shell:\s*false/);
  });
});
