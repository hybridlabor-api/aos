'use strict';
// WP2: real service routes, replacing the WP1 stub. The contract from WP1
// stays: { method, path|RegExp, mutates, confirm?, lock?, handler({url, params, body, ctx}) => {status, json} }.
// Handlers never check auth (the server does); they validate ids against the
// fixed registry and never let a request value become a path, a free argv
// token or a shell string.
import {
  byId,
  statusService,
  serviceMeta,
  controlService,
  readServiceLog,
  startViewer,
  openWikiProjects,
} from './services.mjs';

const ID_RE = /^[A-Za-z0-9_-]+$/;
const LOG_NAME_RE = /^[A-Za-z0-9_.-]+$/;

const fail = (e) => ({ status: e?.status && Number.isInteger(e.status) ? e.status : 400, json: { ok: false, error: e?.message || String(e) } });

export const routes = [
  {
    method: 'GET',
    path: '/api/services/meta', // exact route first: "meta" alone is not an id route
    handler: async ({ url, ctx }) => ({
      status: 200,
      json: await serviceMeta(ctx, { force: url.searchParams.has('force') || url.searchParams.get('force') === '1' }),
    }),
  },
  {
    method: 'GET',
    path: '/api/services',
    handler: async ({ ctx }) => ({ status: 200, json: { services: await statusService(ctx) } }),
  },
  {
    method: 'GET',
    path: /^\/api\/services\/([A-Za-z0-9_-]+)\/log$/,
    handler: async ({ url, params, ctx }) => {
      const id = params[0];
      if (!ID_RE.test(id) || !byId.has(id)) return { status: 400, json: { error: 'unknown service' } };
      const name = String(url.searchParams.get('name') || '');
      if (!LOG_NAME_RE.test(name)) return { status: 400, json: { error: 'bad log name' } }; // rejects '../x'
      try {
        const text = await readServiceLog(ctx, id, name);
        return { status: 200, json: { ok: true, text } };
      } catch (e) {
        return { status: e?.message === 'unknown log' ? 404 : 400, json: { error: e.message } };
      }
    },
  },
  {
    method: 'POST',
    path: /^\/api\/services\/([A-Za-z0-9_-]+)\/start$/,
    mutates: true,
    lock: 'services',
    handler: async ({ params, ctx }) => {
      const id = params[0];
      if (!ID_RE.test(id) || !byId.has(id)) return { status: 400, json: { error: 'unknown service' } };
      try {
        const res = await controlService(ctx, id, 'start');
        return { status: 200, json: { ok: true, id, action: 'start', ...res } };
      } catch (e) { return fail(e); }
    },
  },
  {
    // stop|restart: typed confirm (body must repeat {id, confirm: id}); the
    // server guard checks it too when the route goes through createHub.
    method: 'POST',
    path: /^\/api\/services\/([A-Za-z0-9_-]+)\/(stop|restart)$/,
    mutates: true,
    confirm: 'id',
    lock: 'services',
    handler: async ({ params, body, ctx }) => {
      const [id, action] = params;
      if (!ID_RE.test(id) || !byId.has(id)) return { status: 400, json: { error: 'unknown service' } };
      if (!body || body.confirm !== id || body.id !== id) return { status: 400, json: { error: `missing or wrong confirm (expected the id "${id}")` } };
      try {
        const res = await controlService(ctx, id, action);
        return { status: 200, json: { ok: true, id, action, ...res } };
      } catch (e) { return fail(e); }
    },
  },
  {
    method: 'POST',
    path: '/api/services/openwiki/visualize',
    mutates: true,
    handler: async ({ body, ctx }) => {
      const project = body && typeof body.project === 'string' ? body.project : '';
      if (!project) return { status: 400, json: { error: 'project required' } };
      // Only a project from the discovered list may be visualized; the port
      // is chosen server-side.
      try {
        if (!openWikiProjects(ctx).some((p) => p.path === project)) {
          return { status: 400, json: { error: 'unknown project' } };
        }
        const res = await startViewer(ctx, project, ctx.viewerOpts || undefined);
        return { status: 200, json: { ok: true, ...res } };
      } catch (e) { return fail(e); }
    },
  },
];
