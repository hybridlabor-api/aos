import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const SRC = 'lib/ui-tokens/aos-tokens.css';
const COPIES = [
  'skills/global_config/agenttrail/public/shared/aos-tokens.css',
  'skills/global_config/plan-canvas/scripts/lib/plan-builder/aos-tokens.css',
];
const STATUSES = ['running', 'done', 'needs-you', 'stopped', 'failed'];
const src = at(SRC);

test('source defines lane, status and motion tokens', () => {
  for (let i = 0; i < 6; i++) {
    assert.match(src, new RegExp(`--aos-lane-${i}:`));
    assert.match(src, new RegExp(`--aos-lane-${i}-soft:`));
  }
  for (const s of STATUSES) for (const k of ['fg', 'bg', 'border']) assert.match(src, new RegExp(`--aos-status-${s}-${k}:`));
  for (const t of ['instant', 'fast', 'enter', 'settle', 'loop']) assert.match(src, new RegExp(`--aos-motion-${t}:`));
  for (const t of ['out', 'pop', 'camera']) assert.match(src, new RegExp(`--aos-ease-${t}:`));
});

test('light theme overrides the lane palette', () => {
  const light = src.slice(src.indexOf(':root[data-theme="light"]{\n--aos-lane-0'));
  assert.match(light, /--aos-lane-5:/);
});

test('reduced-motion block zeroes the motion durations', () => {
  const m = src.match(/@media\(prefers-reduced-motion:reduce\)\{([\s\S]*)\}\s*$/);
  assert.ok(m, 'reduced-motion block missing');
  for (const t of ['instant', 'fast', 'enter', 'settle', 'loop']) assert.match(m[1], new RegExp(`--aos-motion-${t}:0ms`));
});

test('every copy of aos-tokens.css equals the source', () => {
  for (const c of COPIES) assert.equal(at(c), src, c);
});

test('each UI references the token file', () => {
  assert.match(at('lib/hub/ui/index.html'), /aos-tokens\.css/);
  assert.match(at('lib/store-ui/index.html'), /aos-tokens\.css/);
  assert.match(at('skills/global_config/agenttrail/public/index.html'), /aos-tokens\.css/);
  assert.match(at('skills/global_config/agenttrail/public/hub/index.html'), /\/shared\/aos-tokens\.css/);
  assert.match(at('skills/global_config/plan-canvas/scripts/lib/plan-builder/render.js'), /aos-tokens\.css/);
});

test('changed status-pill rules use tokens, no hard-coded hex', () => {
  const rules = [
    [at('skills/global_config/agenttrail/public/shared/map.css'), /\.(?:badge\.working|task-capsule-pill\.(?:blocked|now)|need-n)\{[^}]*\}/g],
    [at('skills/global_config/agenttrail/public/hub/app.css'), /\.tag\.(?:go|wait|blocked|ok)\s*\{[^}]*\}/g],
    [at('lib/hub/ui/hub.css'), /\.s-tag\.warn\{[^}]*\}/g],
    [at('lib/store-ui/index.html'), /\.badge\.warn\{[^}]*\}/g],
    [at('skills/global_config/plan-canvas/scripts/lib/plan-builder/theme.css'), /\.topbar \.status\s*\{[^}]*\}/g],
  ];
  for (const [css, re] of rules) {
    const found = css.match(re) || [];
    assert.ok(found.length > 0, String(re));
    for (const r of found) assert.doesNotMatch(r, /#[0-9a-fA-F]{3,8}\b/, r);
  }
  assert.doesNotMatch(at('lib/hub/ui/services.js'), /color:#f87171/);
});

test('AgentTrail map assigns lane colours from the tokens', () => {
  assert.match(at('skills/global_config/agenttrail/public/shared/map.js'), /--aos-lane-/);
});

test('plan-builder themeCss guards the aos-tokens.css read', () => {
  const body = at('skills/global_config/plan-canvas/scripts/lib/plan-builder/render.js').match(/function themeCss\(\) \{([\s\S]*?)\n\}/);
  assert.ok(body, 'themeCss not found');
  assert.match(body[1], /try\s*\{[\s\S]*aos-tokens\.css[\s\S]*\}\s*catch/);
});
