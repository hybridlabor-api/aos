#!/usr/bin/env node
// aos-router — inspect and edit the layered role/target routing table.
//
//   show   effective table and which layer (shipped/user/project) owns each part
//   set    write a role preference list to ~/.aos/router.json or ./.aos/router.json
//   limits current window/weekly limits
//   test   which target routeFor would pick for a role now
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tableMod from '../lib/router/table.js';
import routeMod from '../lib/router/route.js';

const { loadLayeredRouterTable, KNOWN_ROLES, KNOWN_TARGETS, deepMerge } = tableMod;
const { routeFor } = routeMod;

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const PROJECT_ROOT = process.cwd();
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED_PATH = path.join(REPO_ROOT, 'config', 'router.json');

const USAGE = `usage:
  aos-router show [--json]
  aos-router set <role> <target[,target...]> [--project|--user] [--json]
  aos-router limits [--json]
  aos-router test <role> [--json]`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean' },
    project: { type: 'boolean' },
    user: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (flags.help || positionals.length === 0) {
  console.log(USAGE);
  process.exit(flags.help ? 0 : 2);
}

function routerPaths() {
  return {
    user: path.join(HOME, '.aos', 'router.json'),
    project: path.join(PROJECT_ROOT, '.aos', 'router.json'),
  };
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw new Error(`Failed to read ${p}: ${err.message}`);
  }
}

function loadRawLayers() {
  const { user, project } = routerPaths();
  return {
    shipped: readJson(SHIPPED_PATH),
    userLayer: readJson(user),
    projectLayer: readJson(project),
  };
}

function provenance(merged, shipped, userLayer, projectLayer) {
  const withUser = deepMerge(shipped, userLayer);
  const sources = {};
  for (const key of Object.keys(merged)) {
    const mergedJson = JSON.stringify(merged[key]);
    if (projectLayer && mergedJson !== JSON.stringify(withUser[key])) {
      sources[key] = 'project';
    } else if (userLayer && mergedJson !== JSON.stringify(shipped[key])) {
      sources[key] = 'user';
    } else {
      sources[key] = 'shipped';
    }
  }
  return sources;
}

function fatal(msg) {
  console.error(`aos-router: ${msg}`);
  process.exit(2);
}

const [cmd, ...rest] = positionals;

if (cmd === 'show') {
  const table = loadLayeredRouterTable({ home: HOME, projectRoot: PROJECT_ROOT });
  const { shipped, userLayer, projectLayer } = loadRawLayers();
  const sources = provenance(table, shipped, userLayer, projectLayer);
  if (flags.json) {
    console.log(JSON.stringify({ table, sources }, null, 2));
  } else {
    console.log('Effective routing table');
    console.log(`Sources: ${Object.entries(sources).map(([k, v]) => `${k}=${v}`).join(', ')}\n`);
    console.log(`enforce: ${table.enforce}`);
    console.log(`roles:   ${table.roles.join(', ')}`);
    console.log('\nTargets:');
    for (const [name, cfg] of Object.entries(table.targets)) {
      console.log(`  ${name}: model=${cfg.model ?? '(session default)'}, limits=${cfg.limits ? 'yes' : 'no'}`);
    }
    console.log('\nPreferences:');
    for (const role of table.roles) {
      console.log(`  ${role}: ${(table.preferences[role] || []).join(' > ')}`);
    }
    console.log('\nLimits:');
    if (table.limits) {
      for (const [window, limits] of Object.entries(table.limits)) {
        console.log(`  ${window}: soft=${limits.soft}, hard=${limits.hard}`);
      }
    }
  }
} else if (cmd === 'limits') {
  const table = loadLayeredRouterTable({ home: HOME, projectRoot: PROJECT_ROOT });
  if (flags.json) {
    console.log(JSON.stringify(table.limits || {}, null, 2));
  } else {
    console.log('Current limits');
    if (!table.limits) {
      console.log('(none)');
    } else {
      for (const [window, limits] of Object.entries(table.limits)) {
        console.log(`  ${window}: soft=${limits.soft}, hard=${limits.hard}`);
      }
    }
  }
} else if (cmd === 'test') {
  const role = rest[0];
  if (!role) fatal('test needs a role, e.g. aos-router test architect');
  const res = routeFor(role, { home: HOME, projectRoot: PROJECT_ROOT });
  if (flags.json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`Role "${role}" would route to: ${res.target}`);
    console.log(`Model: ${res.model ?? '(session default)'}`);
    console.log(`Reason: ${res.reason}`);
  }
} else if (cmd === 'set') {
  const [role, targetsRaw] = rest;
  if (!role || !targetsRaw) fatal('set needs <role> <target[,target...]>');
  if (!KNOWN_ROLES.includes(role)) fatal(`unknown role "${role}"; valid: ${KNOWN_ROLES.join(', ')}`);
  const targets = targetsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (targets.length === 0) fatal('target list must not be empty');
  const unknown = targets.filter((t) => !KNOWN_TARGETS.includes(t));
  if (unknown.length) fatal(`unknown target(s): ${unknown.join(', ')}; valid: ${KNOWN_TARGETS.join(', ')}`);

  if (flags.project && flags.user) fatal('use --project or --user, not both');
  const destKey = flags.project ? 'project' : 'user';
  const destPath = routerPaths()[destKey];

  let layer = readJson(destPath) || {};
  layer.preferences = { ...(layer.preferences || {}), [role]: targets };

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, JSON.stringify(layer, null, 2) + '\n');

  // Validate the merged result after the write.
  loadLayeredRouterTable({ home: HOME, projectRoot: PROJECT_ROOT });

  if (flags.json) {
    console.log(JSON.stringify({ written: destPath, role, targets }, null, 2));
  } else {
    console.log(`Wrote ${destKey} preference for "${role}": ${targets.join(' > ')}`);
    console.log(`Path: ${destPath}`);
  }
} else {
  fatal(`unknown command "${cmd}"\n${USAGE}`);
}
