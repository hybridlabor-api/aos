import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProfile, repoSkillNames, repoAgentTypes, registryNodeIds } from '../scripts/validate-profile.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILES = join(ROOT, '.agents', 'profiles');
const REG = JSON.parse(readFileSync(join(ROOT, '.agents', 'nodes.json'), 'utf8'));
const ROLES = new Map(Object.entries(REG.nodes ?? {}).map(([id, n]) => [id, n.role]));

function loadCtx() {
  return {
    skillNames: repoSkillNames(),
    agentTypes: repoAgentTypes(),
    registryIds: registryNodeIds(),
    registryRoles: ROLES,
    triggerOwner: new Map(),
  };
}

const ctx = loadCtx();
const loadProfile = (name) => JSON.parse(readFileSync(join(PROFILES, `${name}.json`), 'utf8'));
const skillDirName = (p) => p.split(sep).slice(-2)[0];

test('repo helpers agree with a manual walk (no re-implemented loadCtx drift)', () => {
  const manual = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'SKILL.md') manual.add(skillDirName(p));
    }
  };
  walk(join(ROOT, 'skills'));
  assert.deepStrictEqual([...ctx.skillNames].sort(), [...manual].sort());
  assert.deepStrictEqual([...ctx.registryIds].sort(), Object.keys(REG.nodes ?? {}).sort());
});

test('the validator accepts all four domain profiles with zero errors', () => {
  for (const name of ['kicad', 'touchdesigner', 'creator', 'copywriter']) {
    const fresh = { ...ctx, triggerOwner: new Map(), fileBase: name };
    const errors = validateProfile(loadProfile(name), fresh);
    assert.deepStrictEqual(errors, [], `${name}.json must validate with zero errors`);
  }
});

test('rejections match a specific error message', async (t) => {
  const cases = [
    ['missing gate', (p) => { p.gates = {}; }, /fewer than 1 propert/],
    ['unknown skill', (p) => { p.nodes.build.add[0].skills = ['definitely-not-a-skill']; }, /definitely-not-a-skill/],
    ['unknown replace id', (p) => { p.nodes.build.replace = ['no_such_default_node']; }, /no_such_default_node/],
    ['replace non-build role', (p) => { p.nodes.build.replace = ['reviewer']; }, /only build nodes may be replaced/],
    ['add non-build role', (p) => { p.nodes.build.add[0].role = 'review'; }, /must be build/],
    ['duplicate add id', (p) => { p.nodes.build.add.push({ ...p.nodes.build.add[0] }); }, /duplicates another added node id/],
    ['add id collides with registry', (p) => { p.nodes.build.add[0].id = 'engineering'; }, /already exists in .agents\/nodes.json/],
    ['shared trigger', (p) => { p.selection.triggers = ['mesh']; }, /already used by profile `creator`/],
    ['escaping artifact path', (p) => { p.artifacts[Object.keys(p.artifacts)[0]] = 'production_artifacts/../escape.md'; }, /escapes production_artifacts/],
    ['role deploy', (p) => { p.nodes.build.add[0].role = 'deploy'; }, /unknown role `deploy`/],
    ['bad writes path', (p) => { p.nodes.build.add[0].writes = 'production_artifacts/other.json'; }, /must match production_artifacts\/state\.d/],
    ['bad personaFile', (p) => { p.nodes.build.add[0].personaFile = '../escape.md'; }, /must exist under \.claude\/agents/],
    ['unknown top-level skill', (p) => { p.skills = ['definitely-not-a-skill']; }, /top-level skill/],
    ['unknown artifactKey', (p) => { p.nodes.build.add[0].artifactKey = 'nope'; }, /not in artifacts/],
    ['domain filename mismatch', (p) => { p.domain = 'other'; }, /must equal the file name/],
  ];
  for (const [label, mutate, re] of cases) {
    await t.test(label, () => {
      const profile = loadProfile('kicad');
      const fresh = { ...ctx, triggerOwner: new Map(), fileBase: 'kicad' };
      for (const trig of profile.selection.triggers) fresh.triggerOwner.set(trig, profile.domain);
      fresh.triggerOwner.set('mesh', 'creator');
      mutate(profile);
      const errors = validateProfile(profile, fresh);
      assert.ok(errors.some((e) => re.test(e)), `${label} must fail matching ${re}; got ${JSON.stringify(errors)}`);
    });
  }
});

test('the default pipeline registry stays untouched (seven ids, exact order)', () => {
  assert.deepStrictEqual(
    Object.keys(REG.nodes),
    ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'],
  );
});
