import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkModelNames } from '../scripts/validate-skills.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const skillsDir = join(repo, 'skills');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('W-MODEL01 flags a fixed model name', () => {
  const findings = checkModelNames('Configure model="gpt-4o" before the call.');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'W-MODEL01');
  assert.equal(findings[0].level, 'warn');
});

test('clean text produces no findings', () => {
  assert.deepEqual(
    checkModelNames('Choose a reasoning-capable model and read the ID from process.env.MODEL.'),
    [],
  );
});

test('skills/ in this clone contains zero fixed model names', () => {
  const hits = [];
  for (const p of walk(skillsDir)) {
    if (!p.endsWith('SKILL.md')) continue;
    const rel = p.startsWith(repo) ? p.slice(repo.length + 1) : p;
    for (const f of checkModelNames(readFileSync(p, 'utf8'))) {
      hits.push(`${rel}:${f.line} ${f.msg}`);
    }
  }
  assert.deepEqual(hits, []);
});
