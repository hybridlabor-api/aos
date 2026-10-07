import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProfile } from '../scripts/validate-profile.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILES = join(ROOT, '.agents', 'profiles');

function loadCtx() {
  const skillNames = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'SKILL.md') skillNames.add(p.split('/').slice(-2)[0]);
    }
  };
  walk(join(ROOT, 'skills'));
  const agentTypes = new Set(readdirSync(join(ROOT, '.claude', 'agents')).map((f) => f.replace(/\.md$/, '')));
  const registry = JSON.parse(readFileSync(join(ROOT, '.agents', 'nodes.json'), 'utf8'));
  for (const n of Object.values(registry.nodes)) agentTypes.add(n.agentType);
  return { skillNames, agentTypes, registryIds: new Set(Object.keys(registry.nodes)), triggerOwner: new Map() };
}

const ctx = loadCtx();
const loadProfile = (name) => JSON.parse(readFileSync(join(PROFILES, `${name}.json`), 'utf8'));

test('the validator accepts all four domain profiles', () => {
  for (const name of ['kicad', 'touchdesigner', 'creator', 'copywriter']) {
    const errors = validateProfile(loadProfile(name), ctx);
    assert.deepEqual(errors, [], `${name}.json must validate cleanly`);
  }
});

test('rejections', async (t) => {
  const cases = [
    ['missing gate', (p) => { p.gates = {}; }],
    ['unknown skill', (p) => { p.nodes.build.add[0].skills = ['definitely-not-a-skill']; }],
    ['unknown replace id', (p) => { p.nodes.build.replace = ['no_such_default_node']; }],
    ['shared trigger', (p) => { p.selection.triggers = ['mesh']; }], // `mesh` belongs to the creator profile
    ['escaping artifact path', (p) => { p.artifacts[Object.keys(p.artifacts)[0]] = 'production_artifacts/../escape.md'; }],
    ['role deploy', (p) => { p.nodes.build.add[0].role = 'deploy'; }],
  ];
  for (const [label, mutate] of cases) {
    await t.test(label, () => {
      const profile = loadProfile('kicad');
      const fresh = {
        ...ctx,
        triggerOwner: new Map(),
      };
      for (const trig of profile.selection.triggers) fresh.triggerOwner.set(trig, profile.domain);
      // The shared-trigger case swaps in `mesh`, which belongs to the creator profile.
      fresh.triggerOwner.set('mesh', 'creator');
      mutate(profile);
      const errors = validateProfile(profile, fresh);
      assert.ok(errors.length > 0, `${label} must be rejected`);
    });
  }
});

test('the default pipeline registry stays untouched (seven ids, exact order)', () => {
  const registry = JSON.parse(readFileSync(join(ROOT, '.agents', 'nodes.json'), 'utf8'));
  assert.deepStrictEqual(
    Object.keys(registry.nodes),
    ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'],
  );
});
