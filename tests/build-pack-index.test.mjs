import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);
const packScriptPath = path.join(__dirname, '..', 'scripts', 'build-pack-index.mjs');
const skillsDir = path.join(__dirname, '..', 'skills');

test('build-pack-index.mjs script exists', () => {
  assert(fs.existsSync(packScriptPath), `Script not found: ${packScriptPath}`);
});

test('build-pack-index.mjs --check mode detects when updates are needed', async () => {
  try {
    const { stdout, stderr } = await execAsync(`node "${packScriptPath}" --check`, {
      cwd: path.join(__dirname, '..')
    });
    // If we reach here, files are up to date
    assert(stdout.includes('up to date'), 'Should report files are up to date');
  } catch (error) {
    // --check mode exits with code 1 if files need update
    if (error.code === 1) {
      assert(error.stdout.includes('need update'), 'Should report files need update');
    } else {
      throw error;
    }
  }
});

test('pack indices contain expected sections', () => {
  const godmodeHeads = [
    { name: 'godmode-eventtech', pack: 'live-show' },
    { name: 'godmode-ui-ux', pack: 'web-design' },
    { name: 'godmode-engineering', pack: 'app-dev' },
    { name: 'bdbmediastorm', pack: 'live-show' }
  ];

  for (const { name, pack } of godmodeHeads) {
    let skillPath = path.join(skillsDir, 'basic', name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      skillPath = path.join(skillsDir, 'global_config', name, 'SKILL.md');
    }

    assert(fs.existsSync(skillPath), `Skill file not found: ${skillPath}`);
    const content = fs.readFileSync(skillPath, 'utf-8');

    // Check that pack index content is present
    const startMarker = '<!-- aos:pack-index:start -->';
    const endMarker = '<!-- aos:pack-index:end -->';
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);

    assert(startIdx !== -1, `Start marker not found in ${name}`);
    assert(endIdx !== -1, `End marker not found in ${name}`);

    const indexContent = content.substring(startIdx + startMarker.length, endIdx);
    // Index should contain skill names (hyphens and alphanumerics)
    assert(indexContent.length > 10, `Pack index for ${name} appears empty`);
  }
});

test('ask-tim has full pack catalogue', () => {
  let skillPath = path.join(skillsDir, 'basic', 'ask-tim', 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    skillPath = path.join(skillsDir, 'global_config', 'ask-tim', 'SKILL.md');
  }

  assert(fs.existsSync(skillPath), `ask-tim SKILL.md not found`);
  const content = fs.readFileSync(skillPath, 'utf-8');

  const startMarker = '<!-- aos:pack-index:start -->';
  const endMarker = '<!-- aos:pack-index:end -->';
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  assert(startIdx !== -1, 'Start marker not found in ask-tim');
  assert(endIdx !== -1, 'End marker not found in ask-tim');

  const indexContent = content.substring(startIdx + startMarker.length, endIdx);
  // ask-tim should have "Available Packs" section
  assert(indexContent.includes('Available Packs') || indexContent.includes('live-show'),
    'ask-tim pack index should contain pack references');
});
