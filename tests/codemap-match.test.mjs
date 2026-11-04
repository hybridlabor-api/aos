import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { matchRequests } from '../lib/codemap/match.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readFixtureFiles(dir) {
  const serverPath = join(__dirname, 'fixtures/codemap', dir, dir === 'fastapi' ? 'main.py' : dir === 'go' ? 'main.go' : dir === 'nextjs' ? 'app/api/users/[id]/route.ts' : 'server.js');
  const clientPath = join(__dirname, 'fixtures/codemap', dir, 'client.js');

  const files = [
    { path: serverPath, content: readFileSync(serverPath, 'utf8') },
    { path: clientPath, content: readFileSync(clientPath, 'utf8') }
  ];

  if (dir === 'nextjs') {
    const pagesPath = join(__dirname, 'fixtures/codemap/nextjs/pages/api/posts/index.js');
    files.push({ path: pagesPath, content: readFileSync(pagesPath, 'utf8') });
  } else if (dir === 'express') {
    const authPath = join(__dirname, 'fixtures/codemap/express/routes/auth.js');
    const settingsPath = join(__dirname, 'fixtures/codemap/express/routes/settings.js');
    files.push({ path: authPath, content: readFileSync(authPath, 'utf8') });
    files.push({ path: settingsPath, content: readFileSync(settingsPath, 'utf8') });
  }

  return files;
}

test('CodeMap endpoint and request matching - Express', () => {
  const files = readFixtureFiles('express');
  const { matches, unmatchedRequests } = matchRequests(files);

  assert.strictEqual(matches.length, 8, 'Should find 8 matches');
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

  assert.strictEqual(matches.length, 3, 'Should find 3 matches');
  assert.strictEqual(unmatchedRequests.length, 1, 'Should find 1 unmatched request');
  assert.strictEqual(unmatchedRequests[0].path, '/api/unknown');
});

test('CodeMap endpoint and request matching - FastAPI', () => {
  const files = readFixtureFiles('fastapi');
  const { matches, unmatchedRequests } = matchRequests(files);

  assert.strictEqual(matches.length, 4, 'Should find 4 matches');
  assert.strictEqual(unmatchedRequests.length, 1, 'Should find 1 unmatched request');
  assert.strictEqual(unmatchedRequests[0].path, '/other');
});

test('CodeMap endpoint and request matching - Go', () => {
  const files = readFixtureFiles('go');
  const { matches, unmatchedRequests } = matchRequests(files);

  assert.strictEqual(matches.length, 4, 'Should find 4 matches');
  assert.strictEqual(unmatchedRequests.length, 1, 'Should find 1 unmatched request');
  assert.strictEqual(unmatchedRequests[0].path, '/api/go/unknown');
});
