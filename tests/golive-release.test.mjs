import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedRelease } from '../scripts/rehash-golive.mjs';

// golive's CLI checks every file hash plus the bundle digest before it starts: an AOS edit without
// `node scripts/rehash-golive.mjs` leaves a skill whose CLI refuses to run (S6-2).
test('golive release.json matches the vendored files', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'global_config', 'golive', 'release.json');
    assert.deepStrictEqual(JSON.parse(readFileSync(file, 'utf8')), expectedRelease(), 'run: node scripts/rehash-golive.mjs');
});
