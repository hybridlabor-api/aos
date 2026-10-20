'use strict';
// Router tab API: read the layered routing table (shipped < user < project)
// and save one role's ordered target preference to the user or project layer.
// The route reuses lib/router (the same library bin/aos-router.mjs uses) —
// never the CLI. Contract stays:
// { method, path, mutates, confirm?, lock?, handler({url, params, body, ctx}) }.
// Handlers never check auth (the server does); nothing from the request ever
// becomes a shell string, and layer files are fixed paths from layerPath().
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redact } from './redact.mjs';

const reqCjs = createRequire(import.meta.url);
// CJS router modules are loaded through createRequire against ctx.root so a
// test or an installed layout can point at any repo (same pattern as
// routes-store.mjs).
const lazyCjs = (root, ...parts) => reqCjs(join(root, ...parts));

const fail = (e) => ({
  status: e?.status && Number.isInteger(e.status) && e.status >= 400 && e.status < 500 ? e.status : 400,
  json: { ok: false, error: redact(e?.message || String(e)) },
});

// Tolerant raw-layer read for provenance: a missing OR unparsable layer is
// just "not present here" — provenance never fails the whole GET.
function readLayerJson(resolvedPath) {
  try { return JSON.parse(readFileSync(resolvedPath, 'utf8')); }
  catch { return null; }
}

// Which layer owns a value: project beats user beats shipped (the merge order
// in loadLayeredRouterTable).
function provenance(table, shipped, userLayer, projectLayer) {
  const layerOf = (get) => (get(projectLayer) !== undefined ? 'project' : get(userLayer) !== undefined ? 'user' : 'shipped');
  const sources = { enforce: layerOf((l) => l?.enforce) };
  for (const role of table.roles) sources[role] = layerOf((l) => l?.preferences?.[role]);
  for (const t of Object.keys(table.targets)) sources[`target:${t}`] = layerOf((l) => l?.targets?.[t]);
  return sources;
}

function routerMods(root) {
  return {
    tableMod: lazyCjs(root, 'lib', 'router', 'table.js'),
    routeMod: lazyCjs(root, 'lib', 'router', 'route.js'),
  };
}

export const routes = [
  {
    method: 'GET',
    path: '/api/router',
    handler: async ({ ctx }) => {
      try {
        const home = ctx.home || homedir();
        const projectRoot = ctx.cwd || process.cwd();
        const { tableMod, routeMod } = routerMods(ctx.root);
        const table = tableMod.loadLayeredRouterTable({ home, projectRoot });
        const paths = tableMod.layerPath(home, projectRoot);
        const sources = provenance(
          table,
          readLayerJson(tableMod.DEFAULT_CONFIG_PATH),
          readLayerJson(paths.user),
          readLayerJson(paths.project),
        );
        // What the router would pick per role right now — the data behind the
        // tab's per-role "test" button.
        const tests = {};
        for (const role of table.roles) {
          try {
            tests[role] = routeMod.routeFor(role, { table, home, projectRoot });
          } catch (e) {
            tests[role] = { error: redact(e?.message || String(e)) };
          }
        }
        return {
          status: 200,
          json: {
            ok: true,
            enforce: table.enforce,
            roles: table.roles,
            targets: table.targets,
            preferences: table.preferences,
            limits: table.limits,
            sources,
            paths,
            tests,
            // lib/router exposes configured soft/hard limits only, never live
            // usage numbers; the tab renders them marked "usage unknown".
            usageAvailable: false,
            note: 'Router decisions are advisory: the table suggests a target per role, the calling agent still decides.',
          },
        };
      } catch (e) {
        return fail(e);
      }
    },
  },
  {
    method: 'POST',
    path: '/api/router',
    mutates: true,
    lock: 'router',
    handler: async ({ body, ctx }) => {
      try {
        const { role, targets, layer } = body || {};
        const { tableMod } = routerMods(ctx.root);
        const { KNOWN_ROLES, KNOWN_TARGETS, layerPath, deepMerge, validateRouterTable, loadLayeredRouterTable } = tableMod;
        if (typeof role !== 'string' || !KNOWN_ROLES.includes(role)) {
          return { status: 400, json: { ok: false, error: `role must be one of: ${KNOWN_ROLES.join(', ')}` } };
        }
        if (!Array.isArray(targets) || targets.length === 0 || !targets.every((t) => KNOWN_TARGETS.includes(t))) {
          return { status: 400, json: { ok: false, error: `targets must be a non-empty array of: ${KNOWN_TARGETS.join(', ')}` } };
        }
        if (layer !== 'user' && layer !== 'project') {
          return { status: 400, json: { ok: false, error: 'layer must be "user" or "project"' } };
        }
        const home = ctx.home || homedir();
        const projectRoot = ctx.cwd || process.cwd();
        const paths = layerPath(home, projectRoot);
        const dest = paths[layer];
        const shipped = readLayerJson(tableMod.DEFAULT_CONFIG_PATH);
        const userLayer = readLayerJson(paths.user);
        const projectLayer = readLayerJson(paths.project);

        // Merge the change into the destination layer file (never clobber its
        // other keys), then validate the WOULD-BE merged table through the
        // strict loader BEFORE anything is written.
        const layerData = (layer === 'user' ? userLayer : projectLayer) || {};
        layerData.preferences = { ...(layerData.preferences || {}), [role]: [...targets] };
        const merged = deepMerge(
          shipped,
          layer === 'user' ? layerData : userLayer,
          layer === 'project' ? layerData : projectLayer,
        );
        try {
          validateRouterTable(merged);
        } catch (e) {
          return { status: 400, json: { ok: false, error: `router config rejected: ${redact(e?.message || String(e))}` } };
        }

        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, JSON.stringify(layerData, null, 2) + '\n');
        // Belt and braces: the written file must still load layered (the CLI
        // validates after the write too).
        loadLayeredRouterTable({ home, projectRoot });
        return { status: 200, json: { ok: true, layer, role, targets, path: dest } };
      } catch (e) {
        return fail(e);
      }
    },
  },
];
