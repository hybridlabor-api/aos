import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walkFiles = (dir = '') => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
  if (e.name === 'node_modules' || e.name === '.git') return [];
  const rel = dir ? `${dir}/${e.name}` : e.name;
  return e.isDirectory() ? walkFiles(rel) : [rel];
});
const tracked = (...args) => {
  let files;
  try {
    if (!fs.existsSync(path.join(root, '.git'))) throw new Error('no .git');
    files = execFileSync('git', ['ls-files', '-z', ...args], { cwd: root, encoding: 'utf8' }).split('\0');
  } catch {
    files = walkFiles().filter((f) => !args.length || args.some((a) => f === a || f.startsWith(`${a.replace(/\/$/, '')}/`)));
  }
  return files.filter((f) => f && fs.existsSync(path.join(root, f)));
};
const readText = (f) => { if (!fs.statSync(path.join(root, f)).isFile()) return ''; const b = fs.readFileSync(path.join(root, f)); return b.includes(0) ? '' : b.toString('utf8'); };

// Exclusions: CHANGELOG.md is release history; installer.js, lib/retired-skills.js and this test
// legitimately name the retired skills; the canvas-dispatcher contract and the harness-audit plan
// are design artifacts that describe the removal itself.
const SKILL_NAME_EXCLUDED = new Set(['CHANGELOG.md', 'installer.js', 'lib/retired-skills.js', 'tests/no-builderio-visual.test.mjs', 'tests/retired-skills.test.mjs', 'tests/bdb-visual-edit.test.mjs',
  // the plan-canvas route id "visual-edit" is a live name, not the retired skill
  'tests/bdb-visual-edit-locate.test.mjs', 'tests/plan-canvas-route.test.mjs', 'tests/plan-canvas-e2e-app.test.mjs', 'skills/basic/godmode-ui-ux/SKILL.md', 'skills/global_config/bdb-visual-edit/SKILL.md',
  'skills/global_config/bdb-visual-edit/scripts/sanitize-element.mjs', 'skills/global_config/plan-canvas/SKILL.md',
  'skills/global_config/plan-canvas/scripts/plan-canvas.js', 'skills/global_config/plan-canvas/scripts/lib/plan-canvas/route.js']);
const ARTIFACT_EXCLUDED = (f) => f.startsWith('production_artifacts/canvas-dispatcher/') || f.startsWith('production_artifacts/harness-audit/');

test('the file list is real, not vacuously empty', () => {
  const files = tracked();
  assert.ok(files.length > 50, `only ${files.length} files listed`);
  assert.ok(files.includes('package.json'));
});

test('no tracked file references agent-native.com', () => {
  const hits = tracked().filter((f) => f !== 'CHANGELOG.md' && !ARTIFACT_EXCLUDED(f) && f !== 'tests/no-builderio-visual.test.mjs')
    .filter((f) => /agent-native\.com/i.test(readText(f)));
  assert.deepEqual(hits, []);
});

test('the three BuilderIO visual skill dirs are gone', () => {
  for (const n of ['visual-edit', 'visual-plan', 'visual-recap']) {
    assert.ok(!fs.existsSync(path.join(root, 'skills/global_config', n)), n);
    assert.deepEqual(tracked(`skills/global_config/${n}`), []);
  }
});

test('no tracked file outside the exclusions names visual-edit, visual-plan or visual-recap', () => {
  const re = /(^|[^-\w])visual-(edit|plan|recap)([^-\w]|$)/;
  const hits = tracked().filter((f) => !SKILL_NAME_EXCLUDED.has(f) && !ARTIFACT_EXCLUDED(f))
    .filter((f) => re.test(readText(f)));
  assert.deepEqual(hits, []);
});
