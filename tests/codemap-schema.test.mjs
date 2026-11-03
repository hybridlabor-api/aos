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
    ],
    tour: [
      { part: 'backend', note: 'Start here' }
    ]
  };

  const errors = validateCodeMap(map);
  assert.strictEqual(errors.length, 0);
});

test('validateCodeMap - non-object map returns error', () => {
  assert.strictEqual(validateCodeMap(null)[0], 'CodeMap must be an object.');
  assert.strictEqual(validateCodeMap("string")[0], 'CodeMap must be an object.');
  assert.strictEqual(validateCodeMap([{}])[0], 'CodeMap must be an object.');
});

test('validateCodeMap - missing id on parts', () => {
  const map = {
    parts: [
      { name: 'Backend API' }
    ]
  };

  const errors = validateCodeMap(map);
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes("must have a string 'id'"));
});

test('validateCodeMap - wrong type for globs', () => {
  const map = {
    parts: [
      { id: 'backend', name: 'Backend API', globs: "src/**/*.js" }
    ]
  };

  const errors = validateCodeMap(map);
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes("must be an array of strings"));
});

test('validateCodeMap - duplicate part id', () => {
  const map = {
    parts: [
      { id: 'backend', name: 'Backend API 1' },
      { id: 'backend', name: 'Backend API 2' }
    ]
  };

  const errors = validateCodeMap(map);
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes("Duplicate part id: 'backend'"));
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

test('validateCodeMap - tour reference checking', () => {
  const map = {
    parts: [
      { id: 'app', name: 'App' }
    ],
    tour: [
      { part: 'appp', note: 'Start here' }
    ]
  };

  const errors = validateCodeMap(map);
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes("Unknown part reference: 'appp'"));
  assert.ok(errors[0].includes("Did you mean 'app'?"));
});
