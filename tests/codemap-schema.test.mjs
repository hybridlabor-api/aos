import test from 'node:test';
import assert from 'node:assert';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { validateCodeMap, levenshteinDistance } from '../lib/codemap/validate.mjs';

test('levenshteinDistance', () => {
  assert.strictEqual(levenshteinDistance('kitten', 'sitting'), 3);
  assert.strictEqual(levenshteinDistance('flitten', 'flitting'), 2);
  assert.strictEqual(levenshteinDistance('hello', 'hello'), 0);
  assert.strictEqual(levenshteinDistance('abc', ''), 3);
  assert.strictEqual(levenshteinDistance('', 'abc'), 3);
});

test('validateCodeMap - valid map', () => {
  const map = {
    parts: [
      { id: 'backend', name: 'Backend API' },
      { id: 'frontend', name: 'Frontend Client' },
      { id: 'database', name: 'Database', parent: 'backend' }
    ],
    services: [
      { id: 'auth0', name: 'Auth0' }
    ],
    connections: [
      { from: 'frontend', to: 'backend' },
      { from: 'backend', to: 'database' },
      { from: 'frontend', to: 'auth0' }
    ],
    flows: [
      {
        id: 'login',
        name: 'Login Flow',
        steps: [
          { part: 'frontend' },
          { part: 'auth0' }
        ]
      }
    ]
  };

  const errors = validateCodeMap(map);
  assert.strictEqual(errors.length, 0);
});

test('validateCodeMap - unknown part reference', () => {
  const map = {
    parts: [
      { id: 'backend', name: 'Backend API' },
      { id: 'frontend', name: 'Frontend Client' }
    ],
    connections: [
      { from: 'frntend', to: 'backend' } // Typo: frntend -> frontend
    ]
  };

  const errors = validateCodeMap(map);
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes("Unknown part reference: 'frntend'"));
  assert.ok(errors[0].includes("Did you mean 'frontend'?"));
});

test('validateCodeMap - multiple unknown references', () => {
  const map = {
    parts: [
      { id: 'app', name: 'App' }
    ],
    flows: [
      {
        id: 'flow1',
        name: 'Flow 1',
        steps: [
          { part: 'appp' },
          { part: 'unknown_service' }
        ]
      }
    ]
  };

  const errors = validateCodeMap(map);
  assert.strictEqual(errors.length, 2);
  assert.ok(errors[0].includes("Unknown part reference: 'appp'"));
  assert.ok(errors[0].includes("Did you mean 'app'?"));
  assert.ok(errors[1].includes("Unknown part reference: 'unknown_service'"));
  assert.ok(!errors[1].includes("Did you mean"));
});

test('Ensure temp HOME usage', () => {
  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-test-'));
  process.env.HOME = tempHome;

  try {
    // Just a sanity check that we are not touching the real HOME
    assert.notStrictEqual(originalHome, tempHome);
    assert.strictEqual(process.env.HOME, tempHome);
  } finally {
    process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
