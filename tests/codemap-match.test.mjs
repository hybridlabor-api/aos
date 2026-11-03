import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { matchRequests } from '../lib/codemap/match.mjs';

function readFixtureFiles(dir) {
  const serverPath = join('tests/fixtures/codemap', dir, dir === 'fastapi' ? 'main.py' : dir === 'go' ? 'main.go' : dir === 'nextjs' ? 'app/api/users/[id]/route.ts' : 'server.js');
  const clientPath = join('tests/fixtures/codemap', dir, 'client.js');

  return [
    { path: serverPath, content: readFileSync(serverPath, 'utf8') },
    { path: clientPath, content: readFileSync(clientPath, 'utf8') }
  ];
}

test('CodeMap endpoint and request matching - Express', () => {
  const files = readFixtureFiles('express');
  const { matches, unmatchedRequests } = matchRequests(files);

  assert.strictEqual(matches.length, 4, 'Should find 4 matches');
  assert.strictEqual(unmatchedRequests.length, 1, 'Should find 1 unmatched request');
  assert.strictEqual(unmatchedRequests[0].path, '/api/missing');

  const matchedPaths = matches.map(m => m.request.path);
  assert.ok(matchedPaths.includes('/api/health'));
  assert.ok(matchedPaths.includes('/api/users'));
  assert.ok(matchedPaths.includes('/api/users/123'));
  assert.ok(matchedPaths.includes('/api/v2/info'));
});

test('CodeMap endpoint and request matching - Next.js', () => {
  const files = readFixtureFiles('nextjs');
  const { matches, unmatchedRequests } = matchRequests(files);

  assert.strictEqual(matches.length, 2, 'Should find 2 matches');
  assert.strictEqual(unmatchedRequests.length, 1, 'Should find 1 unmatched request');
  assert.strictEqual(unmatchedRequests[0].path, '/api/unknown');
});

test('CodeMap endpoint and request matching - FastAPI', () => {
  const files = readFixtureFiles('fastapi');
  const { matches, unmatchedRequests } = matchRequests(files);

  assert.strictEqual(matches.length, 2, 'Should find 2 matches');
  assert.strictEqual(unmatchedRequests.length, 1, 'Should find 1 unmatched request');
  assert.strictEqual(unmatchedRequests[0].path, '/other');
});

test('CodeMap endpoint and request matching - Go', () => {
  const files = readFixtureFiles('go');
  const { matches, unmatchedRequests } = matchRequests(files);

  assert.strictEqual(matches.length, 2, 'Should find 2 matches');
  assert.strictEqual(unmatchedRequests.length, 1, 'Should find 1 unmatched request');
  assert.strictEqual(unmatchedRequests[0].path, '/api/go/unknown');
});
