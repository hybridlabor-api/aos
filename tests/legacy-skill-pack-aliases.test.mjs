import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const skillPacks = require('../lib/skill-packs.js');
const root = new URL('..', import.meta.url).pathname;

test('legacy creator and live-show pack aliases resolve to skills', () => {
  for (const name of ['creator', 'live-show']) {
    assert.ok(skillPacks.knownPack(name, root), `${name} should be a known pack alias`);
    assert.ok(skillPacks.packSkillNames(root, name).length > 0, `${name} should resolve to skills`);
  }
});
