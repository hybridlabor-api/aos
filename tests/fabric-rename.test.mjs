import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { RETIRED_SKILLS } = require('../lib/retired-skills.js');

const OLD = 'start' + 'cycle';
const SCAN = [
  'skills', 'docs', 'commands', 'plugins', 'agents', 'agy-commands', 'agy-hooks', 'bin', 'scripts', 'lib',
  '.agents', '.claude', '.claude-plugin', '.codex', '.codex-plugin', '.cursor', '.opencode', '.github', '.openwiki',
  'AGENTS.md', 'CLAUDE.md', 'RULES.md', 'CODEX.md', 'README.md', 'README.de.md', 'README.pt.md',
  'plugin.json', 'plugin-commands.json', 'skills.sh.json', 'package.json', 'installer.js', '.roomodes',
];
// The retired-skills list keeps the old names so an update can remove them from installs.
const ALLOW = new Set(['lib/retired-skills.js']);
const BINARY = /\.(png|jpe?g|gif|webp|mp4|webm|ico|woff2?|ttf|zip|gz|node)$/i;

function* walk(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isFile()) { yield rel; return; }
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    yield* walk(path.posix.join(rel.split(path.sep).join('/'), e.name));
  }
}

describe('fabric rename', () => {
  test('shipped files do not contain the old family name outside the allowlist', () => {
    const hits = [];
    for (const top of SCAN) {
      for (const rel of walk(top)) {
        if (ALLOW.has(rel) || BINARY.test(rel)) continue;
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        if (text.toLowerCase().includes(OLD)) hits.push(rel);
        if (rel.toLowerCase().includes(OLD)) hits.push(`${rel} (path)`);
      }
    }
    assert.deepEqual(hits, []);
  });

  test('the old skills are retired and the new ones exist', () => {
    for (const n of [OLD, `${OLD}-graph`, `${OLD}-graph-user`, 'teamwork-preview']) {
      assert.ok(Object.hasOwn(RETIRED_SKILLS, n), `${n} must be retired`);
      assert.ok(!fs.existsSync(path.join(root, 'skills', 'basic', n)), `${n} must not ship`);
    }
    for (const n of ['fabric', 'fabric-graph', 'fabric-multigraph', 'fabric-teamwork', 'fabric-swarm', 'fabric-loop']) {
      assert.ok(fs.existsSync(path.join(root, 'skills', 'basic', n, 'SKILL.md')), `${n} must ship`);
      assert.ok(!Object.hasOwn(RETIRED_SKILLS, n), `${n} must not be retired`);
    }
  });

  test('the installer reads workflow and command files that exist', () => {
    const src = fs.readFileSync(path.join(root, 'installer.js'), 'utf8');
    const m = /path\.join\(srcDir, '\.agents', 'workflows', '([^']+)'\)/.exec(src);
    assert.ok(m, 'installer reads an .agents/workflows file');
    assert.ok(fs.existsSync(path.join(root, '.agents', 'workflows', m[1])), m[1]);
  });

  test('retiring skills keeps store-installed copies', () => {
    const src = fs.readFileSync(path.join(root, 'installer.js'), 'utf8');
    const body = src.slice(src.indexOf('function pruneRemovedSkills'));
    assert.match(body.slice(0, body.indexOf('\n}\n')), /keep: storeProtectedDirs\(homeDir\)/);
  });

  test('the dispatchers are renamed', () => {
    for (const f of ['fabric-dispatch.mjs', 'fabric-teamwork-dispatch.mjs']) {
      assert.ok(fs.existsSync(path.join(root, '.claude', 'workflows', f)), f);
    }
  });

  test('a state file written by the old dispatcher still validates against the schema shape', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'state.schema.json'), 'utf8'));
    const pipeline = schema.properties.pipeline;
    assert.equal(pipeline.type, 'string');
    assert.equal(pipeline.enum, undefined, 'pipeline must stay a free string so old values load');
    assert.ok(!schema.required.includes('pipeline'));
    assert.deepEqual(
      schema.required.slice().sort(),
      ['approvals', 'findings', 'gate', 'goal', 'iteration', 'max_iterations', 'phase', 'run_id'],
    );
  });
});
