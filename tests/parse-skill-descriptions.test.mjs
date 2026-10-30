import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const SCRIPT = join(repoRoot, 'scripts', 'gen-readme-catalog.mjs');

test('gen-readme-catalog parses folded, literal, and plain descriptions', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'aos-parse-test-'));

  try {
    // Setup fake repo
    const tmpRoot = join(tmpHome, 'repo');
    mkdirSync(tmpRoot);
    mkdirSync(join(tmpRoot, 'scripts'));
    mkdirSync(join(tmpRoot, 'skills'));
    mkdirSync(join(tmpRoot, 'agents'));
    mkdirSync(join(tmpRoot, 'commands'));

    // Copy the script so it resolves its root relative to itself
    copyFileSync(SCRIPT, join(tmpRoot, 'scripts', 'gen-readme-catalog.mjs'));

    // Mock files for gen-readme-catalog to modify
    const mockReadme = `Some text\n<details>\n<summary><b>Skills (\n<!-- END GENERATED CATALOG -->\nEnd`;
    writeFileSync(join(tmpRoot, 'README.md'), mockReadme);
    writeFileSync(join(tmpRoot, 'README.de.md'), mockReadme);
    writeFileSync(join(tmpRoot, 'README.pt.md'), mockReadme);

    const writeSkill = (name, desc) => {
      mkdirSync(join(tmpRoot, 'skills', name));
      writeFileSync(join(tmpRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\ncategory: library\n---\nbody`);
    };

    writeSkill('test-plain', 'Plain description.');
    writeSkill('test-folded', '>-\n  A folded\n  description.');
    writeSkill('test-literal', '|\n  A literal\n  description.');

    const r = spawnSync(process.execPath, [join(tmpRoot, 'scripts', 'gen-readme-catalog.mjs')], { cwd: tmpRoot, encoding: 'utf8', env: { ...process.env, HOME: tmpHome } });
    assert.equal(r.status, 0, r.stderr || r.stdout);

    const out = readFileSync(join(tmpRoot, 'README.md'), 'utf8');

    assert.match(out, /Plain description\./);
    assert.match(out, /A folded description\./);
    assert.match(out, /A literal description\./);
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});
