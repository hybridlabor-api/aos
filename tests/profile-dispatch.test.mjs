import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// R8 step 2b profile-dispatch source pins.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dispatch = fs.readFileSync(
  path.join(ROOT, '.claude', 'workflows', 'startcycle-dispatch.mjs'), 'utf8');
const schema = JSON.parse(fs.readFileSync(
  path.join(ROOT, '.agents', 'state.schema.json'), 'utf8'));
const nodes = JSON.parse(fs.readFileSync(
  path.join(ROOT, '.agents', 'nodes.json'), 'utf8'));
const kicad = JSON.parse(fs.readFileSync(
  path.join(ROOT, '.agents', 'profiles', 'kicad.json'), 'utf8'));

test('default graph unchanged: same 7 node ids, order, models, gate keys', () => {
  assert.deepEqual(Object.keys(nodes.nodes),
    ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping']);
  assert.ok(dispatch.includes(
    "profile ? Object.keys(profile.gates) : ['lint', 'typecheck', 'tests', 'a11y', 'seo', 'security']"));
  assert.deepEqual(Object.keys(schema.properties.gate.properties),
    ['lint', 'typecheck', 'tests', 'a11y', 'seo', 'security']);
});

test('a profile run derives build nodes and gate keys from the profile', () => {
  assert.ok(dispatch.includes('for (const id of spec?.replace ?? [])'));
  assert.ok(dispatch.includes('for (const entry of spec?.add ?? [])'));
  assert.ok(dispatch.includes('Object.keys(profile.gates)'));
  assert.ok(dispatch.includes('Object.values(profile.artifacts).join'));
  assert.ok(dispatch.includes('GATE_LABELS'));
  assert.deepEqual(kicad.nodes.build.replace,
    ['ui_ux', 'engineering', 'media_eventtech']);
  assert.deepEqual(Object.keys(kicad.gates), ['erc', 'drc', 'constraints']);
  assert.deepEqual(schema.properties.gate.additionalProperties,
    { type: 'string', enum: ['pass', 'fail', 'skip'] });
  assert.ok(!('enum' in schema.properties.findings.items.properties.node));
  assert.ok(schema.properties.artifacts.additionalProperties);
});

test('unknown profile escalates, never silently falls back', () => {
  assert.ok(dispatch.includes('extractProfileFlag'));
  assert.ok(dispatch.includes('--profile was given with an empty value'));
  assert.ok(dispatch.includes('--profile named a profile that could not be loaded'));
  assert.ok(dispatch.includes('Refusing to silently fall back to the default pipeline'));
  assert.ok(dispatch.includes("label: 'load-profile'"));
});
