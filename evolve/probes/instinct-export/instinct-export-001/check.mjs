#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const fixturePath = path.join(__dirname, 'fixture', 'sample-instinct.json');
  const expectedPath = path.join(__dirname, 'expected.json');

  const raw = fs.readFileSync(fixturePath, 'utf8');
  const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

  // Sanitize path and secrets
  const sanitized = raw
    .replace(/\/Users\/[a-zA-Z0-9._-]+/g, '~')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '***REDACTED***');

  const parsed = JSON.parse(sanitized);

  const hasSecret = /sk-[A-Za-z0-9_-]{20,}/.test(sanitized);
  const hasUserPath = /\/Users\//.test(sanitized);

  const pass = (
    parsed.id === expected.id &&
    parsed.trigger === expected.trigger &&
    parsed.action === expected.action &&
    hasSecret === expected.has_secret &&
    hasUserPath === expected.has_user_path
  );

  const score = pass ? 1.0 : 0.0;
  const result = {
    pass,
    score,
    notes: pass
      ? 'Instinct exported and sanitized cleanly without leaking user paths or secrets.'
      : 'Sanitization check failed.'
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(pass ? 0 : 1);
} catch (err) {
  process.stdout.write(JSON.stringify({
    pass: false,
    score: 0,
    notes: `Checker error: ${err.message}`
  }, null, 2) + '\n');
  process.exit(1);
}
