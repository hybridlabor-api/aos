'use strict';
// WP4: real Store routes, replacing the WP1 stub. Contract stays:
// { method, path|RegExp, mutates, confirm?, lock?, handler({url, params, body, ctx}) }.
// Handlers never check auth (the server does). No request value ever becomes
// a path, a free argv token or a shell string: every spawn is fixed-argv
// ('node' + an absolute path built from ctx.root + validated tokens) with
// shell:false. Rollback runs in-process; nothing is ever deleted here.
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { rollbackInstall, STORE_NAME_RE, findItem, loadSources } from '../store-shared.mjs';
import { redact } from './redact.mjs';
import { catalog as uiCatalog, previewMeta } from '../store-ui/server.mjs';

const reqCjs = createRequire(import.meta.url);
// CJS modules are loaded through createRequire, the repo's ESM pattern; the
// paths are resolved lazily against ctx.root so tests can point at any repo.
const lazyCjs = (root, ...parts) => reqCjs(join(root, ...parts));

const KINDS = ['skill', 'agent', 'mcp'];
// Harness keys the MCP install may target; mirrors lib/v5/menu.js package
// mcp mapping. OpenCode is deliberately NOT here: installer.js's
// resolveTargetPaths() has no MCP configuration for OpenCode, so a one-server
// install is impossible for it (the menu handler prints instructions).
const MCP_TARGETS = ['claude', 'agy', 'antigravity', 'codex', 'cursor', 'roo', 'windsurf', 'aider'];

// Shipped MCP names (mcp_config.json + both candidates of every pick group).
function shippedMcpNames(root) {
  const { shippedAll } = lazyCjs(root, 'lib', 'mcp-secrets.js');
  const names = Object.keys(shippedAll(root));
  return new Set(names);
}

// Harness config files where the server name is missing (preview targets).
// Read-only: every file is only read, never written.
function missingMcpTargets(root, home, name) {
  const { harnessMcpFiles, parseCodexTables } = lazyCjs(root, 'lib', 'mcp-secrets.js');
  const out = [];
  for (const { file, kind } of harnessMcpFiles(home)) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    let present = false;
    if (kind === 'toml') {
      present = name in parseCodexTables(text);
    } else {
      let data;
      try { data = JSON.parse(text); } catch { continue; }
      const map = kind === 'opencode' ? data && data.mcp : data && data.mcpServers;
      present = !!map && typeof map === 'object' && name in map;
    }
    if (!present) out.push({ file, kind });
  }
  return out;
}

const fail = (e) => ({
  status: e?.status && Number.isInteger(e.status) && e.status >= 400 && e.status < 500 ? e.status : 400,
  json: { ok: false, error: redact(e?.message || String(e)) },
});

// The hub child runs with cwd = $HOME, so a scope:'project' install would
// land in ~/skills, not in any real project. Only the CLI keeps that scope.
const refuseProjectScope = (body) => (body && body.scope === 'project'
  ? { status: 400, json: { error: 'project scope is not available from the hub' } }
  : null);

// Package registry (lib/v5/packages.js) detect/verify against the installer
// host (ctx.root/installer.js), the same pairing lib/v5/menu.js builds.
function packageChecks(root, ctx) {
  const out = [];
  let host;
  try { host = lazyCjs(root, 'installer.js'); } catch (e) {
    return [{ error: `package registry unavailable: ${e.message}` }];
  }
  const pk = lazyCjs(root, 'lib', 'v5', 'packages.js');
  const base = { host, home: ctx.home || homedir(), state: host.detectInstallState(), run: ctx.run };
  for (const p of pk.registry) {
    const row = { id: p.id, name: p.name, npm: p.npm || null };
    try {
      const d = p.detect(base) || {};
      row.installed = Boolean(d.installed);
      row.version = d.version || null;
    } catch (e) {
      row.installed = null;
      row.error = e.message;
    }
    if (row.installed && p.verify) {
      try {
        const v = p.verify({ ...base, run: null });
        row.verify = v || { ok: true, detail: 'n/a' };
      } catch (e) {
        row.verify = { ok: false, detail: e.message };
      }
    }
    out.push(row);
  }
  return out;
}

export const routes = [
  {
    method: 'GET',
    path: '/api/store',
    handler: async ({ url, ctx }) => {
      const scope = url.searchParams.get('scope') === 'project' ? 'project' : 'global';
      const cat = uiCatalog(scope, ctx.cwd);
      const pkgs = packageChecks(ctx.root, ctx);
      return {
        status: 200,
        json: {
          scope,
          pinned_commit: cat.pinned_commit,
          sources: cat.sources,
          items: cat.items,
          packages: pkgs,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/store/preview',
    mutates: true, // network reads and filesystem probes, never writes
    handler: async ({ body, ctx }) => {
      const { kind, name } = body || {};
      if (!KINDS.includes(kind)) return { status: 400, json: { error: `kind must be one of ${KINDS.join(', ')}` } };
      if (typeof name !== 'string' || !STORE_NAME_RE.test(name)) return { status: 400, json: { error: 'invalid name' } };
      const projectRefusal = refuseProjectScope(body);
      if (projectRefusal) return projectRefusal;
      const scope = body.scope === 'project' ? 'project' : 'global';
      if (kind === 'mcp') {
        if (!shippedMcpNames(ctx.root).has(name)) return { status: 404, json: { error: 'MCP server is not shipped in mcp_config.json/mcp_picks.json' } };
        const targets = missingMcpTargets(ctx.root, ctx.home || homedir(), name);
        return { status: 200, json: { kind: 'mcp', name, scope, targets, note: 'install goes through: node installer.js package mcp <name> --target <harness>' } };
      }
      try {
        const sources = loadSources(ctx.root, process.env);
        const found = findItem(sources, name);
        if (!found || (kind === 'skill' && found.type !== 'skills') || (kind === 'agent' && found.type !== 'subagents')) {
          return { status: 404, json: { error: 'not in store index' } };
        }
        const meta = previewMeta(name, kind);
        return { status: 200, json: { kind, name, scope, meta } };
      } catch (e) {
        return fail(e);
      }
    },
  },
  {
    method: 'POST',
    path: '/api/store/install',
    mutates: true,
    confirm: 'name',
    lock: 'packages',
    handler: async ({ body, ctx }) => {
      const { name } = body || {};
      if (typeof name !== 'string' || !STORE_NAME_RE.test(name)) return { status: 400, json: { error: 'invalid name' } };
      if (body.confirm !== name) return { status: 400, json: { error: `missing or wrong confirm (expected the name "${name}")` } };
      const projectRefusal = refuseProjectScope(body);
      if (projectRefusal) return projectRefusal;
      const kind = KINDS.includes(body.kind) ? body.kind : 'skill';
      const scope = body.scope === 'project' ? 'project' : 'global';
      // Existence/collision checks happen only against the fixed index or the
      // shipped MCP table; nothing from the request reaches disk as a path.
      try {
        if (kind === 'mcp') {
          const target = body.target;
          if (typeof target !== 'string' || !MCP_TARGETS.includes(target)) {
            return { status: 400, json: { error: `mcp install needs target one of: ${MCP_TARGETS.join(', ')}` } };
          }
          if (!shippedMcpNames(ctx.root).has(name)) return { status: 404, json: { error: 'MCP server is not shipped in mcp_config.json/mcp_picks.json' } };
          const res = await ctx.run('node', [join(ctx.root, 'installer.js'), 'package', 'mcp', name, '--target', target], { shell: false });
          return { status: 200, json: { ok: !!res.ok, name, kind: 'mcp', target, stdout: redact(String(res.stdout || '')), stderr: redact(String(res.stderr || '')) } };
        }
        const sources = loadSources(ctx.root, process.env);
        const found = findItem(sources, name);
        if (!found || (kind === 'skill' && found.type !== 'skills') || (kind === 'agent' && found.type !== 'subagents')) {
          return { status: 404, json: { error: 'not in store index' } };
        }
        const args = [join(ctx.root, 'bin', 'aos-store.mjs'), 'install', name, '--net'];
        if (scope === 'project') args.push('--project');
        const res = await ctx.run('node', args, { shell: false });
        return { status: 200, json: { ok: !!res.ok, name, kind, scope, stdout: redact(String(res.stdout || '')), stderr: redact(String(res.stderr || '')) } };
      } catch (e) {
        return fail(e);
      }
    },
  },
  {
    method: 'POST',
    path: '/api/store/rollback',
    mutates: true,
    confirm: 'name',
    lock: 'packages',
    handler: async ({ body, ctx }) => {
      const { name } = body || {};
      if (typeof name !== 'string' || !STORE_NAME_RE.test(name)) return { status: 400, json: { error: 'invalid name' } };
      if (body.confirm !== name) return { status: 400, json: { error: `missing or wrong confirm (expected the name "${name}")` } };
      const projectRefusal = refuseProjectScope(body);
      if (projectRefusal) return projectRefusal;
      const project = false;
      try {
        const res = rollbackInstall({ name, home: ctx.home || homedir(), project, cwd: ctx.cwd });
        return { status: 200, json: { ok: true, ...res } };
      } catch (e) {
        return fail(e);
      }
    },
  },
  {
    method: 'POST',
    path: /^\/api\/packages\/([A-Za-z0-9_-]+)\/(install|update|repair)$/,
    mutates: true,
    confirm: 'id',
    lock: 'packages',
    handler: async ({ params, body, ctx }) => {
      const [id, action] = params;
      if (!['install', 'update', 'repair'].includes(action)) return { status: 400, json: { error: 'action must be install, update or repair' } };
      if (!body || body.id !== id || body.confirm !== id) return { status: 400, json: { error: `missing or wrong confirm (expected the id "${id}")` } };
      let pk;
      try { pk = lazyCjs(ctx.root, 'lib', 'v5', 'packages.js'); } catch (e) { return { status: 500, json: { error: `package registry unavailable: ${e.message}` } }; }
      if (!pk.registry.some((p) => p.id === id)) return { status: 404, json: { error: 'unknown package id' } };
      try {
        const res = await ctx.run('node', [join(ctx.root, 'installer.js'), 'package', action, id], { shell: false });
        return { status: 200, json: { ok: !!res.ok, id, action, stdout: redact(String(res.stdout || '')), stderr: redact(String(res.stderr || '')) } };
      } catch (e) {
        return fail(e);
      }
    },
  },
];
