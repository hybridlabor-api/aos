'use strict';
// One-port front door: the hub on 127.0.0.1:7900 forwards path prefixes to the
// local tools. Plain node:http, loopback upstreams only, no new dependency.
//
// X-Forwarded-Prefix is sent on every route; a tool that honours it is marked safe:true.
// Prefix-safe check (done by reading each tool's HTML/JS, no tool uses
// WebSockets; plan-canvas and agenttrail use SSE, which streams through):
// every tool emits root-absolute URLs (/api/..., /shared/map.js, /events,
// /canvas/<key>, /assets/...), so a page served under a prefix would load
// nothing. Browser navigations to those prefixes therefore redirect to the
// tool's own port; non-navigation requests (curl, API clients) are proxied.
// Set safe:true on a route only for a tool that emits relative URLs.
import { request } from 'node:http';
import { tokenOk } from './guard.mjs';
import { probeTrailPorts } from './routes-plans.mjs';

export const PROXY_ROUTES = [
  { prefix: '/canvas', port: 4519, safe: true }, // honours X-Forwarded-Prefix (plan-canvas server.js)
  { prefix: '/memb', port: 8088 },
  { prefix: '/synapse', port: 7781 },
  { prefix: '/trail', trail: true },
  // The store is the hub's own tab; the standalone store UI (:4322) fetches absolute /api paths.
  { prefix: '/store', redirect: '/?tab=store' },
];

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection']);
const json = (res, status, body) => { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); } res.end(JSON.stringify(body)); };
const isNavigation = (h) => (h['sec-fetch-mode'] ? h['sec-fetch-mode'] === 'navigate' : String(h.accept || '').includes('text/html'));

export const TRAIL_DOWN_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>Agenttrail not running</title>'
  + '<body style="font:16px system-ui;background:#0a0a0a;color:#ddd;max-width:34rem;margin:4rem auto;padding:0 1rem">'
  + '<h1 style="font-size:1.2rem">Agenttrail is not running</h1>'
  + '<p>No live agenttrail map was found. Start one from your repo with <code>aos-trail --ensure</code>, then reload this page.</p>'
  + '<p><a style="color:#4ade80" href="/?tab=services">Back to the Hub</a></p></body>';

export function createProxy({ routes = PROXY_ROUTES, trailPorts = probeTrailPorts } = {}) {
  // '/memb' and '/memb/x' match, '/membership' does not.
  const find = (pathname) => routes.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));

  async function target(route, rest) {
    if (!route.trail) return { port: route.port, path: rest };
    // /trail -> first live map; /trail/<port>/... -> that map, only when it is in the live list.
    const live = await trailPorts().catch(() => []);
    const m = rest.match(/^\/(\d{4,5})(\/.*)?$/);
    if (m && live.includes(Number(m[1]))) return { port: Number(m[1]), path: m[2] || '/', fwd: `${route.prefix}/${m[1]}` };
    return live.length ? { port: live[0], path: rest } : null;
  }

  // The caller (server.mjs) has already run the remote/Host/Origin/Sec-Fetch-Site guards.
  async function handle({ req, res, pathname, hubToken, hubPort }) {
    const route = find(pathname);
    const search = String(req.url).includes('?') ? String(req.url).slice(String(req.url).indexOf('?')) : '';
    if (route.redirect) {
      res.writeHead(302, { location: route.redirect, 'cache-control': 'no-store' });
      return res.end();
    }
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'method not allowed' });
    // Anything that can change state needs the hub token, same as the hub's own mutating routes.
    if (!['GET', 'HEAD'].includes(req.method) && !tokenOk(req.headers['x-aos-hub-token'] || '', hubToken)) return json(res, 401, { error: 'unauthorized' });

    // Tools that use relative URLs need the trailing slash so "api/x" resolves under the prefix.
    if (req.method === 'GET' && pathname === route.prefix && !route.trail) {
      res.writeHead(302, { location: `${route.prefix}/${search}`, 'cache-control': 'no-store' });
      return res.end();
    }
    const rest = pathname.slice(route.prefix.length) || '/';
    const t = await target(route, rest);
    if (!t && route.trail && req.method === 'GET' && isNavigation(req.headers)) {
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(TRAIL_DOWN_HTML);
    }
    if (!t) return json(res, 502, { error: route.trail ? 'no agenttrail map is running' : 'upstream unavailable' });

    if (!route.safe && req.method === 'GET' && isNavigation(req.headers)) {
      res.writeHead(302, { location: `http://127.0.0.1:${t.port}${t.path}${search}`, 'cache-control': 'no-store' });
      return res.end();
    }

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && k !== 'x-aos-hub-token') headers[k] = v;
    headers.host = `127.0.0.1:${t.port}`;
    // Contract (docs/one-port.md): every upstream gets the public prefix; the client's own value is never trusted.
    headers['x-forwarded-prefix'] = t.fwd || route.prefix;
    // The hub already pinned Origin to its own origin; the upstream pins it to itself.
    if (headers.origin) headers.origin = `http://127.0.0.1:${t.port}`;

    const up = request({ host: '127.0.0.1', port: t.port, method: req.method, path: t.path + search, headers }, (ur) => {
      const out = {};
      for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k)) out[k] = v;
      if (typeof out.location === 'string' && out.location.startsWith('/')) out.location = route.prefix + out.location;
      res.writeHead(ur.statusCode || 502, out);
      ur.pipe(res);
    });
    up.on('error', () => json(res, 502, { error: 'upstream unavailable' }));
    res.on('close', () => up.destroy());
    req.pipe(up);
  }

  return { find, handle, routes };
}
