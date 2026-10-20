import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const json = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

const manifests = [
  '.claude-plugin/marketplace.json',
  '.claude-plugin/plugin.json',
  'plugins/bdb-aos/.claude-plugin/plugin.json',
  'plugins/bdb-aos/plugin.json',
  'plugins/bdb-aos-fleet/.claude-plugin/plugin.json',
  'plugins/bdb-aos-sessions/.claude-plugin/plugin.json',
  'plugins/bdb-aos-alert/.claude-plugin/plugin.json',
  'plugins/bdb-aos-control/.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  'plugins/bdb-aos-codex/.codex-plugin/plugin.json',
  '.agents/plugins/marketplace.json',
  'plugin.json',
];

// A plugin manifest's component paths are relative to the PLUGIN root, not the
// file's directory: .claude-plugin/plugin.json lists ./skills/... at the repo
// root, while plugins/<name>/** files resolve inside their own directory.
const baseOf = (file) => (file.startsWith('plugins/') ? file.split('/').slice(0, 2).join('/') : '.');

test('marketplace/plugin manifests: files exist and parse with a valid name', () => {
  for (const file of manifests) {
    const doc = json(file);
    assert.equal(typeof doc.name, 'string', `${file}: has a name`);
    assert.match(doc.name, /^[a-zA-Z0-9-_]+$/, `${file}: name matches ^[a-zA-Z0-9-_]+$`);
  }
});

test('every local path referenced by a manifest exists', () => {
  for (const file of manifests.filter((f) => f.endsWith('plugin.json'))) {
    const base = baseOf(file);
    const doc = json(file);
    if (Array.isArray(doc.skills)) {
      for (const ref of doc.skills) {
        assert.ok(existsSync(join(ROOT, base, ref, 'SKILL.md')), `${file}: missing SKILL.md at ${ref}`);
      }
    } else if (typeof doc.skills === 'string') {
      assert.ok(existsSync(join(ROOT, base, doc.skills)), `${file}: missing skills dir ${doc.skills}`);
    }
    if (Array.isArray(doc.commands)) {
      for (const ref of doc.commands) {
        assert.ok(existsSync(join(ROOT, base, ref)), `${file}: missing command file ${ref}`);
      }
    }
    if (typeof doc.types === 'string') {
      assert.ok(existsSync(join(ROOT, base, doc.types)), `${file}: missing types ${doc.types}`);
    }
  }
  // Claude marketplace: relative plugin sources from the marketplace root.
  const market = json('.claude-plugin/marketplace.json');
  for (const entry of market.plugins) {
    assert.equal(typeof entry.source, 'string', `${entry.name}: source is a relative path`);
    assert.ok(!entry.source.includes('..'), `${entry.name}: source must not contain ..`);
    assert.ok(existsSync(join(ROOT, entry.source)), `marketplace.json: missing source ${entry.source}`);
    assert.ok(existsSync(join(ROOT, entry.source, '.claude-plugin', 'plugin.json')), `${entry.name}: source has no .claude-plugin/plugin.json`);
  }
  // Codex marketplace: local source path relative to the marketplace root.
  const codexMarket = json('.agents/plugins/marketplace.json');
  for (const entry of codexMarket.plugins) {
    assert.equal(entry.source.source, 'local', `${entry.name}: Codex source type`);
    assert.equal(typeof entry.policy?.installation, 'string', `${entry.name}: policy.installation set`);
    assert.equal(typeof entry.policy?.authentication, 'string', `${entry.name}: policy.authentication set`);
    assert.ok(existsSync(join(ROOT, entry.source.path)), `marketplace.json: missing source.path ${entry.source.path}`);
  }
});

test('versions equal package.json where a manifest carries one', () => {
  for (const file of manifests.filter((f) => f.endsWith('plugin.json'))) {
    const doc = json(file);
    assert.equal(doc.version, pkg.version, `${file}: version ${doc.version} != package.json ${pkg.version}`);
  }
  const market = json('.claude-plugin/marketplace.json');
  for (const entry of market.plugins) {
    assert.equal(entry.version, pkg.version, `marketplace entry ${entry.name}: version must equal package.json`);
  }
});

test('entry names match the referenced plugin manifest names', () => {
  const market = json('.claude-plugin/marketplace.json');
  for (const entry of market.plugins) {
    assert.equal(json(join(entry.source, '.claude-plugin', 'plugin.json')).name, entry.name, `${entry.name}: entry name must match manifest name`);
  }
  const codexMarket = json('.agents/plugins/marketplace.json');
  for (const entry of codexMarket.plugins) {
    assert.equal(json(join(entry.source.path, '.codex-plugin', 'plugin.json')).name, entry.name, `${entry.name}: entry name must match Codex manifest name`);
  }
});

test('each verified harness has the manifest this repo claims to ship', () => {
  // Claude Code: marketplace with a bdb-aos entry (docs: code.claude.com plugin-marketplaces).
  const market = json('.claude-plugin/marketplace.json');
  assert.ok(market.owner?.name, 'Claude marketplace has an owner');
  assert.ok(market.plugins.some((e) => e.name === 'bdb-aos'), 'Claude marketplace lists bdb-aos');
  // Codex: repo marketplace .agents/plugins/marketplace.json + .codex-plugin/plugin.json
  // (docs: developers.openai.com/codex/plugins/build).
  assert.ok(json('.agents/plugins/marketplace.json'));
  assert.ok(json('plugins/bdb-aos-codex/.codex-plugin/plugin.json'));
  // Antigravity: plugin.json at the plugin root; no self-hosted marketplace format ships
  // (docs: antigravity.google/docs/plugins).
  assert.equal(json('plugin.json').name, 'bdb-aos');
  // OpenCode: local plugin file; there is no marketplace concept (opencode.ai/docs/plugins).
  assert.ok(existsSync(join(ROOT, '.opencode', 'plugins', 'bdb-aos.js')), 'OpenCode local plugin file exists');
});

test('content parity of the generated manifest copies', () => {
  const root = readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8');
  assert.equal(readFileSync(join(ROOT, 'plugins', 'bdb-aos', '.claude-plugin', 'plugin.json'), 'utf8'), root);
  assert.deepEqual(json('plugins/bdb-aos/plugin.json'), json('plugin.json'));
});

test('the claude manifest is slim: no skills key; the full pack lives in skills.sh.json', () => {
  const manifest = json('.claude-plugin/plugin.json');
  assert.equal(manifest.skills, undefined,
    'the plugin must not bundle skills (the AOS installer installs them from loose copies)');
  // The installer's registry carries the full, unique skill pack.
  const skillsSh = json('skills.sh.json');
  const pack = skillsSh.groupings.flatMap((g) => (Array.isArray(g.skills) ? g.skills : []));
  assert.ok(pack.length > 100, `expected the full skill pack in skills.sh.json, got ${pack.length}`);
  assert.deepEqual(pack, [...pack].sort(), 'skills.sh.json skills must be sorted for a stable diff');
  // every registered skill name resolves to a SKILL.md in the skills/ tree
  const dirs = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const full = join(dir, e.name);
      if (existsSync(join(full, 'SKILL.md'))) dirs.push(e.name); else walk(full);
    }
  };
  walk(join(ROOT, 'skills'));
  assert.ok(new Set(pack).size === pack.length, 'skills.sh.json lists each skill once');
  for (const name of pack) {
    assert.ok(dirs.includes(name), `SKILL.md missing for registered skill ${name}`);
  }
});
