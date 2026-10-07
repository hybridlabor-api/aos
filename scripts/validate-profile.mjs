#!/usr/bin/env node
// Validates every domain profile in .agents/profiles/ against _schema.json,
// plus the semantic checks a JSON Schema cannot express (skill names, agent
// types, cross-profile trigger uniqueness).
// Zero dependencies on purpose: CI runs this with no install step, same as
// scripts/validate-skills.mjs.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILES_DIR = join(REPO, '.agents', 'profiles');

const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ROLES = new Set(['plan', 'approve', 'build', 'review', 'gate']);

// ------------------------------------------------------------ repo lookups

function repoSkillNames() {
  const names = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'SKILL.md') names.add(basename(dir));
    }
  };
  walk(join(REPO, 'skills'));
  return names;
}

function repoAgentTypes() {
  const names = new Set();
  const dir = join(REPO, '.claude', 'agents');
  if (existsSync(dir)) for (const e of readdirSync(dir)) if (e.endsWith('.md')) names.add(e.slice(0, -3));
  const registry = JSON.parse(readFileSync(join(REPO, '.agents', 'nodes.json'), 'utf8'));
  for (const n of Object.values(registry.nodes ?? {})) if (n.agentType) names.add(n.agentType);
  return names;
}

function registryNodeIds() {
  const registry = JSON.parse(readFileSync(join(REPO, '.agents', 'nodes.json'), 'utf8'));
  return new Set(Object.keys(registry.nodes ?? {}));
}

// -------------------------------------------------- hand-written schema check
// Implements the subset of draft-07 that _schema.json uses: type, required,
// enum/const, min/max Items/Properties/Length, pattern, oneOf, $ref into
// $defs/properties. Not a general validator — the schema is ours and small.

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function typeMatches(t, v) {
  const list = Array.isArray(t) ? t : [t];
  const actual = typeOf(v);
  if (actual === 'integer') return list.includes('integer') || list.includes('number');
  return list.includes(actual);
}

function checkSchema(value, schema, root, path, errors) {
  const fail = (msg) => errors.push(`${path}: ${msg}`);

  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], root);
    if (!target) { fail(`unresolvable $ref ${schema.$ref}`); return; }
    return checkSchema(value, target, root, path, errors);
  }
  if (schema.oneOf) {
    const passed = schema.oneOf.filter((s) => {
      const sub = [];
      checkSchema(value, s, root, path, sub);
      return sub.length === 0;
    });
    if (passed.length !== 1) fail('does not match exactly one of the allowed shapes (oneOf)');
    return;
  }
  if (schema.type && !typeMatches(schema.type, value)) {
    fail(`expected type ${JSON.stringify(schema.type)}, got ${typeOf(value)}`);
    return;
  }
  if (schema.const !== undefined && value !== schema.const) {
    fail(`must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    fail(`must be one of: ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`shorter than minLength ${schema.minLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail(`does not match pattern ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
    for (const [i, item] of value.entries()) {
      if (schema.items) checkSchema(item, schema.items, root, `${path}[${i}]`, errors);
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const req of schema.required ?? []) {
      if (!(req in value)) fail(`missing required property \`${req}\``);
    }
    const props = Object.entries(value);
    if (schema.minProperties !== undefined && props.length < schema.minProperties) fail(`fewer than ${schema.minProperties} properties`);
    for (const [k, v] of props) {
      const sub = schema.properties?.[k] ?? schema.additionalProperties;
      if (sub === false) { fail(`unexpected property \`${k}\``); continue; }
      if (sub && sub !== true) checkSchema(v, sub, root, `${path}.${k}`, errors);
    }
  }
}

// ------------------------------------------------------------ semantic checks

export function validateProfile(profile, ctx) {
  const errors = [];
  const schema = JSON.parse(readFileSync(join(PROFILES_DIR, '_schema.json'), 'utf8'));
  checkSchema(profile, schema, schema, profile.domain ?? '(unnamed)', errors);

  // Semantic checks run even when the shape check failed, but defensively:
  // anything not a plain object is skipped here (the schema error above
  // already reported it).
  const d = typeof profile.domain === 'string' ? profile.domain : '(unnamed)';
  const gates = profile.gates && typeof profile.gates === 'object' && !Array.isArray(profile.gates) ? profile.gates : {};
  const artifacts = profile.artifacts && typeof profile.artifacts === 'object' && !Array.isArray(profile.artifacts) ? profile.artifacts : {};
  for (const key of [...Object.keys(gates), ...Object.keys(artifacts)]) {
    if (!KEBAB_RE.test(key)) errors.push(`${d}: gate/artifact key \`${key}\` is not lowercase kebab`);
  }
  for (const [key, path] of Object.entries(artifacts)) {
    if (typeof path === 'string' && (path.includes('..') || !path.startsWith('production_artifacts/'))) {
      errors.push(`${d}: artifact \`${key}\` path \`${path}\` escapes production_artifacts/`);
    }
  }

  const nodes = profile.nodes && typeof profile.nodes === 'object' && !Array.isArray(profile.nodes) ? profile.nodes : {};
  for (const slot of Object.values(nodes)) {
    if (slot === null || typeof slot !== 'object') continue;
    for (const id of slot.replace ?? []) {
      if (!ctx.registryIds.has(id)) errors.push(`${d}: replace id \`${id}\` does not exist in .agents/nodes.json`);
    }
    for (const node of slot.add ?? []) {
      if (node === null || typeof node !== 'object') continue;
      if (!ROLES.has(node.role)) errors.push(`${d}: node \`${node.id}\` has unknown role \`${node.role}\``);
      if (!ctx.agentTypes.has(node.agentType)) {
        errors.push(`${d}: node \`${node.id}\` agentType \`${node.agentType}\` is neither .claude/agents/<name>.md nor a registry agentType`);
      }
      for (const s of node.skills ?? []) {
        if (!ctx.skillNames.has(s)) errors.push(`${d}: node \`${node.id}\` requires skill \`${s}\`, which has no SKILL.md in skills/`);
      }
      if (node.writes && node.writes.includes('..')) {
        errors.push(`${d}: node \`${node.id}\` writes path escapes the tree`);
      }
    }
  }

  const selection = profile.selection && typeof profile.selection === 'object' ? profile.selection : {};
  for (const t of selection.triggers ?? []) {
    if (typeof t !== 'string') continue;
    if (t !== t.toLowerCase()) errors.push(`${d}: trigger \`${t}\` is not lowercase`);
    const owner = ctx.triggerOwner.get(t);
    if (owner && owner !== d) {
      errors.push(`${d}: trigger \`${t}\` is already used by profile \`${owner}\``);
    } else if (!owner) {
      ctx.triggerOwner.set(t, d);
    }
  }

  return errors;
}

export function validateAll() {
  const ctx = {
    skillNames: repoSkillNames(),
    agentTypes: repoAgentTypes(),
    registryIds: registryNodeIds(),
    triggerOwner: new Map(),
  };
  const problems = [];
  const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  for (const file of files) {
    let profile;
    try {
      profile = JSON.parse(readFileSync(join(PROFILES_DIR, file), 'utf8'));
    } catch (e) {
      problems.push(`${file}: not valid JSON (${e.message})`);
      continue;
    }
    for (const err of validateProfile(profile, ctx)) problems.push(`${file}: ${err}`);
  }
  return { problems, files };
}

// ------------------------------------------------------------------ selftest

function builtInGood() {
  return {
    version: 1,
    domain: 'selftest',
    nodes: {
      architect: null,
      build: {
        replace: ['ui_ux'],
        add: [{
          id: 'worker', role: 'build', agentType: 'godmode-engineering',
          skills: ['godmode-engineering'], artifactKey: 'worker',
          writes: 'production_artifacts/state.d/worker.json', instructions: 'Do it.',
        }],
      },
    },
    gates: { 'all-green': 'Everything checks out' },
    artifacts: { worker: 'production_artifacts/01_worker.md' },
    selection: { triggers: ['selftest'], description: 'Built-in good profile for --selftest.' },
  };
}

function builtInBad() {
  const bad = builtInGood();
  bad.gates = {};
  bad.nodes.build.add[0].skills = ['no-such-skill'];
  bad.nodes.build.replace = ['not-a-node'];
  bad.nodes.build.add[0].role = 'deploy';
  bad.artifacts.worker = 'production_artifacts/../outside.md';
  bad.selection.triggers = ['kicad'];
  return bad;
}

function selftest() {
  const ctx = {
    skillNames: new Set(['godmode-engineering']),
    agentTypes: new Set(['godmode-engineering']),
    registryIds: new Set(['ui_ux', 'engineering']),
    triggerOwner: new Map([['kicad', 'kicad']]), // shared-trigger case swaps in a trigger owned by the kicad profile
  };
  const good = validateProfile(builtInGood(), ctx);
  if (good.length !== 0) throw new Error(`selftest: good profile rejected: ${good.join('; ')}`);
  const bad = validateProfile(builtInBad(), ctx);
  const expect = (re, what) => {
    if (!bad.some((e) => re.test(e))) throw new Error(`selftest: bad profile did not trip ${what}: got ${JSON.stringify(bad)}`);
  };
  expect(/fewer than 1 propert/, 'missing gate');
  expect(/no-such-skill/, 'unknown skill');
  expect(/not-a-node/, 'unknown replace id');
  expect(/unknown role `deploy`/, 'bad role');
  expect(/escapes production_artifacts/, 'escaping artifact path');
  expect(/already used by profile `kicad`/, 'shared trigger');
  if (bad.length < 5) throw new Error('selftest: bad profile produced too few findings');
  console.log('✓ selftest passed');
}

// ----------------------------------------------------------------------- main

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  try { selftest(); process.exit(0); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}

const { problems } = validateAll();
if (problems.length) {
  for (const p of problems) console.error(`error ${p}`);
  console.error(`✗ ${problems.length} profile problem(s)`);
  process.exit(1);
}
console.log('✓ profiles valid');
