import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const entries = new Set(Object.values(pkg.bin));
for (const f of readdirSync(join(root, 'bin'))) if (/\.(mjs|js)$/.test(f)) entries.add(`bin/${f}`);
entries.add('skills/global_config/aos-setup/scripts/aos-doctor.mjs');
entries.add('skills/global_config/aos-project-init/scripts/aos-project-doctor.mjs');

test('package.json bin entries all exist', () => {
  for (const rel of Object.values(pkg.bin)) assert.ok(existsSync(join(root, rel)), rel);
});

for (const rel of entries) {
  test(`node --check ${rel}`, () => {
    const r = spawnSync(process.execPath, ['--check', join(root, rel)], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
}
