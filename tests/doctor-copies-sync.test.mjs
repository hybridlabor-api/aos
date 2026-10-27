// bin/aos-doctor.mjs and skills/global_config/aos-setup/scripts/aos-doctor.mjs are
// two copies of the doctor. The skill copy can run standalone from ~/.claude/skills
// with no package around it, so it cannot import a shared module; this test keeps
// the duplicated value tables equal instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const BIN_DOCTOR = 'bin/aos-doctor.mjs';
const SKILL_DOCTOR = 'skills/global_config/aos-setup/scripts/aos-doctor.mjs';
const MEMB_INJECT = '.claude/hooks/memb-inject.mjs';

function extractTable(src, name, file) {
  const m = new RegExp(`const ${name} = (\\{[^;]*\\});`).exec(src);
  assert.ok(m, `${file}: const ${name} = {...} not found`);
  return new Function(`return ${m[1]};`)();
}

const declaredVersion = (src) => {
  const m = /^\/\/\s*aos-hook-version:\s*(\d+)/m.exec(src);
  return m ? Number(m[1]) : null;
};

test('EXPECTED_VERSION is identical in both doctor copies', () => {
  const bin = extractTable(read(BIN_DOCTOR), 'EXPECTED_VERSION', BIN_DOCTOR);
  const skill = extractTable(read(SKILL_DOCTOR), 'EXPECTED_VERSION', SKILL_DOCTOR);
  assert.deepStrictEqual(skill, bin);
});

test('EXPECTED_VERSION pins memb-inject.mjs to the version the shipped hook declares', () => {
  const declared = declaredVersion(read(MEMB_INJECT));
  assert.ok(declared !== null, `${MEMB_INJECT} has no aos-hook-version stamp`);
  const bin = extractTable(read(BIN_DOCTOR), 'EXPECTED_VERSION', BIN_DOCTOR);
  assert.strictEqual(bin['memb-inject.mjs'], declared);
});
