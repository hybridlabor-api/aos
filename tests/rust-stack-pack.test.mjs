import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

test('skill-packs.json includes rust stack group and updated description', () => {
  const packsPath = path.join(rootDir, 'lib', 'skill-packs.json');
  assert(fs.existsSync(packsPath), 'lib/skill-packs.json must exist');

  const packs = JSON.parse(fs.readFileSync(packsPath, 'utf8'));
  const stacks = packs.packs?.stacks;
  assert(stacks, 'packs.stacks must exist');
  assert(stacks.groups, 'stacks.groups must exist');

  assert.deepStrictEqual(
    stacks.groups.rust,
    ['rust-pro', 'tauri-pilot'],
    'stacks.groups.rust must contain rust-pro and tauri-pilot',
  );

  assert(
    stacks.description.includes('rust'),
    `stacks.description must mention rust (found: "${stacks.description}")`,
  );
});

test('detectProjectStack detects Rust/Tauri, Go, and Vite stacks', async () => {
  const { detectProjectStack } = await import('../lib/skill-packs.js');
  assert.strictEqual(typeof detectProjectStack, 'function', 'detectProjectStack must be exported');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-stack-test-'));

  try {
    // Empty directory
    assert.strictEqual(detectProjectStack(tmp), null);

    // Cargo.toml
    fs.writeFileSync(path.join(tmp, 'Cargo.toml'), '[package]\nname = "test"\n');
    assert.strictEqual(detectProjectStack(tmp), 'rust');

    fs.unlinkSync(path.join(tmp, 'Cargo.toml'));

    // src-tauri/tauri.conf.json
    fs.mkdirSync(path.join(tmp, 'src-tauri'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src-tauri', 'tauri.conf.json'), '{}');
    assert.strictEqual(detectProjectStack(tmp), 'rust');

    fs.rmSync(path.join(tmp, 'src-tauri'), { recursive: true, force: true });

    // go.mod
    fs.writeFileSync(path.join(tmp, 'go.mod'), 'module example.com/test\n');
    assert.strictEqual(detectProjectStack(tmp), 'go');

    fs.unlinkSync(path.join(tmp, 'go.mod'));

    // package.json with vite
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ devDependencies: { vite: '^5.0.0' } }),
    );
    assert.strictEqual(detectProjectStack(tmp), 'vite');

    fs.unlinkSync(path.join(tmp, 'package.json'));

    // package.json without vite
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
    );
    assert.strictEqual(detectProjectStack(tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('installer parseModuleSelection maps rust to rustauri', () => {
  const installer = require('../installer.js');
  assert.strictEqual(typeof installer.parseModuleSelection, 'function');

  const res1 = installer.parseModuleSelection('rust');
  assert(res1.includes('rustauri'), 'parseModuleSelection("rust") should include rustauri');

  const res2 = installer.parseModuleSelection('all');
  assert(res2.includes('rustauri'), 'parseModuleSelection("all") should include rustauri');
});

test('tauri_expert role includes rust-pro and tauri-pilot', () => {
  const rolePath = path.join(rootDir, 'lib', 'roles', 'shipped-roles', 'tauri_expert.json');
  assert(fs.existsSync(rolePath), 'tauri_expert.json must exist');

  const role = JSON.parse(fs.readFileSync(rolePath, 'utf8'));
  assert(Array.isArray(role.skills), 'tauri_expert role.skills must be an array');
  assert(role.skills.includes('rust-pro'), 'tauri_expert role must include rust-pro');
  assert(role.skills.includes('tauri-pilot'), 'tauri_expert role must include tauri-pilot');
});

test('pb-tauri-e2e requires rust-pro and tauri-pilot', () => {
  const pbPath = path.join(rootDir, 'skills', 'playbooks', 'pb-tauri-e2e', 'SKILL.md');
  assert(fs.existsSync(pbPath), 'pb-tauri-e2e/SKILL.md must exist');

  const content = fs.readFileSync(pbPath, 'utf8');
  assert(content.includes('rust-pro'), 'pb-tauri-e2e frontmatter must require rust-pro');
  assert(content.includes('tauri-pilot'), 'pb-tauri-e2e frontmatter must require tauri-pilot');
});

test('vendor/rustauri skills and documentation exist', () => {
  const rustProSkill = path.join(rootDir, 'vendor', 'rustauri', 'skills', 'rust-pro', 'SKILL.md');
  const tauriPilotSkill = path.join(rootDir, 'vendor', 'rustauri', 'skills', 'tauri-pilot', 'SKILL.md');
  const readmePath = path.join(rootDir, 'vendor', 'rustauri', 'README.md');

  assert(fs.existsSync(rustProSkill), 'vendor/rustauri/skills/rust-pro/SKILL.md must exist');
  assert(fs.existsSync(tauriPilotSkill), 'vendor/rustauri/skills/tauri-pilot/SKILL.md must exist');
  assert(fs.existsSync(readmePath), 'vendor/rustauri/README.md must exist');

  const readme = fs.readFileSync(readmePath, 'utf8');
  assert(readme.includes('0.8.1'), 'README must mention pinned tauri-pilot-cli version 0.8.1');
  assert(readme.includes('TAURI_PILOT_VERSION'), 'README must mention TAURI_PILOT_VERSION');
});

test('rust-reviewer agent includes rust-pro in skills across harnesses', () => {
  const claudeAgent = path.join(rootDir, '.claude', 'agents', 'rust-reviewer.md');
  const rootAgent = path.join(rootDir, 'agents', 'rust-reviewer.md');
  const codexAgent = path.join(rootDir, '.codex', 'agents', 'rust-reviewer.toml');

  assert(fs.existsSync(claudeAgent), '.claude/agents/rust-reviewer.md must exist');
  assert(fs.readFileSync(claudeAgent, 'utf8').includes('rust-pro'));

  assert(fs.existsSync(rootAgent), 'agents/rust-reviewer.md must exist');
  assert(fs.readFileSync(rootAgent, 'utf8').includes('rust-pro'));

  assert(fs.existsSync(codexAgent), '.codex/agents/rust-reviewer.toml must exist');
  assert(fs.readFileSync(codexAgent, 'utf8').includes('rust-pro'));
});
