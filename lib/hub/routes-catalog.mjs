'use strict';
// WP3 route: one GET /api/catalog serving the built catalog with a 30 s cache
// (?refresh=1 bypasses it). No request value reaches the filesystem — the
// only query value read is the refresh flag. Search and filters run
// client-side (lib/hub/ui/catalog.js).
import { buildCatalog } from './catalog.mjs';

const TTL_MS = 30_000;
let cache = null;
let cachedAt = 0;

export function catalogCacheReset() {
  cache = null;
  cachedAt = 0;
}

export const routes = [
  {
    method: 'GET',
    path: '/api/catalog',
    handler: async ({ url, ctx }) => {
      const t = ctx.now ? () => ctx.now() : Date.now;
      const fresh = url.searchParams.get('refresh') === '1';
      if (!fresh && cache !== null && t() - cachedAt < TTL_MS) {
        return { status: 200, json: cache };
      }
      const json = buildCatalog({
        root: ctx.root,
        home: ctx.home,
        now: t,
        env: process.env,
      });
      cache = json;
      cachedAt = t();
      return { status: 200, json };
    },
  },
];
