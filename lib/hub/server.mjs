'use strict';
// AOS Hub HTTP server. Guard applies to every request; route modules are
// statically imported with the WP1 route contract:
//   { method, path|RegExp, mutates, confirm?, lock?, handler({url, params, body, ctx}) }
// Handlers never check auth — the server does.
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSiteOk, FlightLock, confirmOk, contentTypeJson, hostOk, newToken, originOk, securityHeaders, send, shaToken, tokenOk, MAX_BODY } from './guard.mjs';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), 'ui');

// Static reads resolved by exact known filenames only. No request value ever
// reaches the filesystem as a path component we did not pick ourselves.
const STATIC_FILES = (() => {
  const names = ['hub.css', 'app.js', 'plans.js', 'services.js', 'catalog.js', 'store.js'];
  const map = new Map();
  for (const n of names) {
    try {
      statSync(join(UI_DIR, n));
      map.set(`/ui/${n}`, { file: n, type: n.endsWith('.html') ? 'text/html; charset=utf-8' : n.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' });
    } catch { /* missing stub: not served */ }
  }
  return map;
})();

// Body is drained, never destroyed mid-upload: destroying the socket before
// the 413 reaches the client turns the size limit into "socket hang up".
// Transfer-encoding chunked (no content-length) is handled by the overflow
// flag + the final raw.length check; a hard stop covers abusive streams.
const readBody = (req) => new Promise((ok, fail) => {
  const chunks = [];
  let size = 0;
  let overflow = false;
  req.on('data', (c) => {
    if (overflow) return;
    size += c.length;
    if (size > MAX_BODY + (1024 * 1024)) { fail(new Error('body too large')); req.destroy(); return; }
    if (size > MAX_BODY) { overflow = true; return; }
    chunks.push(c);
  });
  req.on('end', () => ok({ raw: Buffer.concat(chunks), overflow }));
  req.on('error', fail);
});

function defaultCtx(overrides = {}) {
  return {
    root: join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
    home: undefined,
    cwd: process.cwd(),
    run(cmd, args, opts = {}) { return Promise.resolve({ ok: true, stdout: '', stderr: '' }); },
    log: () => {},
    now: () => Date.now(),
    ...overrides,
  };
}

export function createHub({ port = 7900, home, ctx: ctxOverrides, routes = [] } = {}) {
  const ctx = defaultCtx({ ...ctxOverrides, home });
  // A detached child receives its token from the spawning parent via env so
  // hub.json (written by the parent) matches the running server. Otherwise
  // the token is fresh per process.
  const token = (ctxOverrides && ctxOverrides.tokenEnv) || newToken();
  const tokenSha = shaToken(token);
  const locks = new FlightLock();
  let boundPort = null;

  const matchRoute = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      if (typeof r.path === 'string') { if (r.path === pathname) return { route: r, params: {} }; continue; }
      const m = pathname.match(r.path);
      if (m) return { route: r, params: m.slice(1) };
    }
    return null;
  };

  const server = createServer(async (req, res) => {
    // A client that aborts mid-request must never crash the server with an
    // unhandled 'error' event on the streams.
    req.on('error', () => {});
    res.on('error', () => {});
    try {
      const url = new URL(req.url || '/', 'http://x');
      const port_ = boundPort ?? server.address()?.port ?? port;

      if (req.socket.remoteAddress && !/^127\.0\.0\.1$/.test(req.socket.remoteAddress.replace(/^::ffff:/, ''))) {
        return send(res, 403, { error: 'forbidden' });
      }
      if (!hostOk(req.headers.host || '', port_)) return send(res, 403, { error: 'bad host' });
      if (!originOk(req.headers.origin, port_)) return send(res, 403, { error: 'bad origin' });
      const sf = { site: req.headers['sec-fetch-site'], mode: req.headers['sec-fetch-mode'], dest: req.headers['sec-fetch-dest'] };

      if (req.method === 'GET') {
        // Static reads: fixed filenames only. A path like /ui/../server.mjs
        // never matches a known filename, so it 404s without touching disk.
        if (STATIC_FILES.has(url.pathname)) {
          if (!fetchSiteOk({ ...sf, method: 'GET', path: url.pathname })) return send(res, 403, { error: 'bad fetch site' });
          const { file, type } = STATIC_FILES.get(url.pathname);
          const body = readFileSync(join(UI_DIR, file));
          res.writeHead(200, { ...securityHeaders(), 'content-type': type });
          return res.end(body);
        }
        if (url.pathname === '/') {
          // Top-level navigation exemption: same-site + navigate + document.
          if (!fetchSiteOk({ ...sf, method: 'GET', path: '/' })) return send(res, 403, { error: 'bad fetch site' });
          const html = getShell(token);
          res.writeHead(200, { ...securityHeaders(), 'content-type': 'text/html; charset=utf-8' });
          return res.end(html);
        }
        if (!fetchSiteOk({ ...sf, method: 'GET', path: url.pathname })) return send(res, 403, { error: 'bad fetch site' });
      } else {
        if (!fetchSiteOk({ ...sf, method: req.method, path: url.pathname })) return send(res, 403, { error: 'bad fetch site' });
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      }

      const hit = matchRoute(req.method, url.pathname);
      if (!hit) return send(res, 404, { error: 'not found' });
      const { route, params } = hit;

      if (!route.mutates && req.method === 'POST') {
        return send(res, 405, { error: 'read-only route' });
      }

      let body;
      if (route.mutates) {
        if (!contentTypeJson(req)) return send(res, 415, { error: 'content-type must be application/json' });
        if (!tokenOk(req.headers['x-aos-hub-token'] || '', tokenSha)) return send(res, 401, { error: 'unauthorized' });
        const declared = Number(req.headers['content-length'] || 0);
        if (declared > MAX_BODY) return send(res, 413, { error: 'body too large (max 8 KB)' });
        let raw;
        try {
          const { raw: bodyBuf, overflow } = await readBody(req);
          raw = overflow ? null : bodyBuf;
        } catch { raw = null; }
        if (raw === null || raw.length > MAX_BODY) return send(res, 413, { error: 'body too large (max 8 KB)' });
        try { body = JSON.parse(raw.toString('utf8') || '{}'); }
        catch { return send(res, 400, { error: 'invalid JSON body' }); }
        if (route.confirm && !confirmOk(body, route.confirm)) return send(res, 400, { error: `missing or wrong confirm field (expected "${route.confirm}")` });
      }

      const run = () => route.handler({ url, params, body, ctx });
      if (route.lock) {
        // FlightLock.run is synchronous when busy: a plain `false` means a
        // 409 right away, a promise means we own the lock and await the
        // result. Treating `false` as awaitable would hang; trusting a sync
        // throw would skip the release — so both shapes are handled here.
        let winner;
        try {
          winner = locks.run(route.lock, run);
        } catch (e) {
          locks.release(route.lock);
          return send(res, 500, { error: e.message });
        }
        if (winner === false) return send(res, 409, { error: 'busy', lock: route.lock });
        let out;
        try { out = await winner; }
        catch (e) {
          // run's .finally releases the lock even on rejection.
          if (e && e.message === 'body too large') return send(res, 413, { error: e.message });
          return send(res, e && e.status ? e.status : 500, { error: e.message });
        }
        if (!out || typeof out !== 'object') return send(res, 500, { error: 'handler returned an unexpected shape' });
        return send(res, out.status || 200, out.json ?? {});
      }
      const out = await run();
      if (!out || typeof out !== 'object') return send(res, 500, { error: 'handler returned an unexpected shape' });
      return send(res, out.status || 200, out.json ?? {});
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  });

  let shellCache;
  const getShell = (tok) => {
    if (shellCache) return shellCache;
    const html = readFileSync(join(UI_DIR, 'index.html'), 'utf8');
    // The token meta is injected only here, on GET / — never on /ui/* files.
    shellCache = html.replace('__AOS_HUB_TOKEN__', tok);
    return shellCache;
  };

  return {
    server,
    token,
    listen: () => new Promise((ok, bad) => {
      server.once('error', bad);
      server.listen(port, '127.0.0.1', () => {
        boundPort = server.address().port;
        server.removeListener('error', bad);
        ok();
      });
    }),
    close: () => new Promise((ok) => {
      if (!server.listening) return ok();
      server.close(() => ok());
      server.closeAllConnections();
    }),
  };
}
