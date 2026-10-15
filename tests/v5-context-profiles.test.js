'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CONTEXT_PROFILES,
  DEFAULT_CONTEXT_PROFILE,
  MEDIA_SERVERS,
  CORE_GATEWAY_SERVERS,
  CONTEXT_PROFILE_DEFS,
  knownContextProfile,
  contextProfileOf,
  tokenEstimate,
  contextCommand,
} = require('../lib/v5/context-profiles');

const profileMod = require('../lib/v5/profile');

test('context profiles constants & knownContextProfile', () => {
  assert.deepStrictEqual(CONTEXT_PROFILES, ['full', 'orchestrator', 'worker', 'small']);
  assert.strictEqual(DEFAULT_CONTEXT_PROFILE, 'full');
  assert.strictEqual(knownContextProfile('full'), true);
  assert.strictEqual(knownContextProfile('worker'), true);
  assert.strictEqual(knownContextProfile('small'), true);
  assert.strictEqual(knownContextProfile('orchestrator'), true);
  assert.strictEqual(knownContextProfile('FULL'), true);
  assert.strictEqual(knownContextProfile('  worker  '), true);
  assert.strictEqual(knownContextProfile('invalid'), false);
  assert.strictEqual(knownContextProfile(123), false);
  assert.strictEqual(knownContextProfile(null), false);
});

test('contextProfileOf returns correct profile from settings', () => {
  assert.strictEqual(contextProfileOf({ context: 'worker' }), 'worker');
  assert.strictEqual(contextProfileOf({ context: 'small' }), 'small');
  assert.strictEqual(contextProfileOf({ context: 'orchestrator' }), 'orchestrator');
  assert.strictEqual(contextProfileOf({ context: 'full' }), 'full');
  assert.strictEqual(contextProfileOf({ context: 'invalid' }), 'full');
  assert.strictEqual(contextProfileOf({}), 'full');
  assert.strictEqual(contextProfileOf(null), 'full');
});

test('sanitizeSettings recognizes context setting and handles invalid values', () => {
  const clean = profileMod.sanitizeSettings({ context: 'worker' });
  assert.strictEqual(clean.settings.context, 'worker');
  assert.deepStrictEqual(clean.problems, []);

  const invalid = profileMod.sanitizeSettings({ context: 'mega-huge' });
  assert.strictEqual(invalid.settings.context, undefined);
  assert.ok(invalid.problems.some((p) => p.includes('is not a context profile')));
});

test('readSettings and writeSettings persist context setting', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ctx-test-'));
  try {
    const initial = profileMod.readSettings(tmpHome, () => {});
    assert.strictEqual(initial.context, undefined);
    assert.strictEqual(contextProfileOf(initial), 'full');

    profileMod.writeSettings(tmpHome, { ...initial, context: 'worker' });
    const updated = profileMod.readSettings(tmpHome, () => {});
    assert.strictEqual(updated.context, 'worker');
    assert.strictEqual(contextProfileOf(updated), 'worker');
  } catch (err) {
    throw err;
  }
});

test('tokenEstimate provides breakdown and calculates savings', () => {
  const fullEst = tokenEstimate('full');
  assert.strictEqual(fullEst.profile, 'full');
  assert.strictEqual(fullEst.breakdown.mcpCatalog, 25738);
  assert.strictEqual(fullEst.savingsVsFull, 0);

  const workerEst = tokenEstimate('worker');
  assert.strictEqual(workerEst.profile, 'worker');
  assert.strictEqual(workerEst.breakdown.mcpCatalog, 4200);
  assert.ok(workerEst.savingsVsFull > 20000);
  assert.ok(workerEst.totalEstTokens < fullEst.totalEstTokens);

  const smallEst = tokenEstimate('small');
  assert.strictEqual(smallEst.profile, 'small');
  assert.strictEqual(smallEst.breakdown.mcpCatalog, 4200);
  assert.ok(smallEst.savingsVsFull > 20000);
  assert.ok(smallEst.totalEstTokens <= workerEst.totalEstTokens);
});

test('contextCommand prints status and updates profile', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ctx-cmd-test-'));
  try {
    let out = '';
    let err = '';
    const write = (s) => { out += s; };
    const error = (s) => { err += s; };

    // Initial read
    const code1 = contextCommand([], { home: tmpHome, write, error });
    assert.strictEqual(code1, 0);
    assert.ok(out.includes('AOS Context Profile: full'));
    assert.ok(out.includes('Estimated Session Startup Token Breakdown'));

    // Update to worker
    out = '';
    const code2 = contextCommand(['worker'], { home: tmpHome, write, error });
    assert.strictEqual(code2, 0);
    assert.ok(out.includes('Context profile updated to: worker'));
    assert.ok(out.includes('AOS Context Profile: worker'));
    assert.ok(out.includes('Savings vs Full Profile'));

    // Verify persisted
    const st = profileMod.readSettings(tmpHome, () => {});
    assert.strictEqual(st.context, 'worker');

    // Invalid profile error
    out = '';
    err = '';
    const code3 = contextCommand(['nonexistent'], { home: tmpHome, write, error });
    assert.strictEqual(code3, 2);
    assert.ok(err.includes('Unknown context profile "nonexistent"'));
  } catch (err) {
    throw err;
  }
});
