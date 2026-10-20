'use strict';
// AOS Hub HTTP server. Guard applies to every request; route modules are
// statically imported with the WP1 route contract:
//   { method, path|RegExp, mutates, confirm?, lock?, handler({url, params, body, ctx}) }
// Handlers never check auth — the server does.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedAncestors, fetchSiteOk, FlightLock, confirmOk, contentTypeJson, hostOk, newToken, originOk, securityHeaders, send, shaToken, tokenOk, MAX_BODY } from './guard.mjs';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), 'ui');

// Static reads resolved by exact known filenames only. No request value ever
// reaches the filesystem as a path component we did not pick ourselves.
const STATIC_FILES = (() => {
  const names = ['hub.css', 'app.js', 'plans.js', 'services.js', 'catalog.js', 'store.js', 'router.js'];
  const map = new Map();
  for (const n of names) {
    try {
      statSync(join(UI_DIR, n));
      map.set(`/ui/${n}`, { file: n, type: n.endsWith('.html') ? 'text/html; charset=utf-8' : n.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' });
    } catch { /* missing stub: not served */ }
  }
  // Shared design tokens: the canonical copy lives in lib/ui-tokens (fixed path, never request-derived).
  try {
    const tokens = join(UI_DIR, '..', '..', 'ui-tokens', 'aos-tokens.css');
    statSync(tokens);
    map.set('/ui/aos-tokens.css', { file: tokens, type: 'text/css; charset=utf-8', abs: true });
  } catch { /* not served */ }
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

// The REAL child runner used as the default ctx.run when a test/CLI does not
// inject its own. execFile with shell:false so no shell string is ever built.
// The env is a copy of process.env WITHOUT AOS_HUB_TOKEN and without any
// variable whose name looks secret-shaped; the explicit allow-list below is
// exempt from that scrub and NODE_OPTIONS is dropped (a hijacked NODE_OPTIONS
// would let a child process run arbitrary preload code).
const RUN_ENV_ALLOW = new Set(['PATH', 'HOME', 'LANG', 'TMPDIR', 'USER', 'SHELL']);
const SECRETISH = /(TOKEN|SECRET|PASSWORD|KEY)/i;

export function defaultRun(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.AOS_HUB_TOKEN;
    for (const k of Object.keys(env)) {
      if (k === 'NODE_OPTIONS') { delete env[k]; continue; }
      if (RUN_ENV_ALLOW.has(k)) continue;
      if (SECRETISH.test(k)) delete env[k];
    }
    execFile(cmd, args, {
      shell: false,
      cwd: opts.cwd,
      timeout: opts.timeout ?? 120000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env,
    }, (err, stdout, stderr) => {
      // Never throws: failure surfaces as ok:false with the exit code.
      resolve({
        ok: !err,
        code: err && Number.isInteger(err.code) ? err.code : err ? null : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

function defaultCtx(overrides = {}) {
  // Any child spawned from a hub handler must never inherit AOS_HUB_TOKEN:
  // the real runner above (the default ctx.run) scrubs the env itself; spawn
  // helpers in route modules should default env to ctx.cleanEnv.
  const { AOS_HUB_TOKEN: _tokenScrubbed, ...cleanEnv } = process.env;
  void _tokenScrubbed;
  return {
    root: join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
    home: undefined,
    cwd: process.cwd(),
    cleanEnv,
    // The stub that used to sit here silently faked {ok:true} for every
    // install/package/launchctl/npm/codesign call. The default is now the
    // real runner; injecting ctx.run (tests) replaces it entirely.
    run: defaultRun,
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

  // Every RegExp route must be anchored at registration time; a RegExp like
  // /abc/ would match anywhere in a path and turn captures into garbage.
  // String routes match the raw path exactly; RegExp routes return an ARRAY
  // of decoded captures, string routes an empty object.
  for (const r of routes) {
    if (r.path instanceof RegExp) {
      const s = String(r.path.source);
      if (!s.startsWith('^') || !s.endsWith('$')) {
        throw new Error(`route ${r.method} ${r.path}: RegExp paths must be anchored (^...$)`);
      }
    }
  }

  // Request target handling, done on the RAW URL string (no base-rewritten
  // URL object, which silently normalizes): exactly one leading '/', no
  // percent-encoded dot segments, no backslash, no NUL in the path.
  const safePath = (rawUrl) => {
    const s = String(rawUrl || '');
    if (!s.startsWith('/') || s.startsWith('//')) return null;
    const path = s.split('?')[0].split('#')[0];
    if (path.includes('\\') || path.includes('\0')) return null;
    if (/%2e|%5c|%00/i.test(path)) return null;
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { return null; }
    if (decoded.includes('\\') || decoded.includes('\0')) return null;
    if (decoded.split('/').some((seg) => seg === '.' || seg === '..')) return null;
    return path;
  };

  const matchRoute = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      if (typeof r.path === 'string') { if (r.path === pathname) return { route: r, params: {} }; continue; }
      const m = pathname.match(r.path);
      if (!m) continue;
      const caps = m.slice(1).map((c) => {
        try { c = decodeURIComponent(c); } catch { return null; }
        return c;
      });
      if (caps.some((c) => c === null || !/^[A-Za-z0-9_-]+$/.test(c))) continue;
      return { route: r, params: caps };
    }
    return null;
  };

  // Generic 500s: body never carries e.message; the detail goes to stderr
  // tagged with a random 8-hex id the client can quote.
  const internalError = (res, e) => {
    const id = randomBytes(4).toString('hex');
    try { console.error(`hub 500 id=${id}:`, e instanceof Error ? (e.stack || e.message) : e); } catch { /* stderr gone */ }
    return send(res, 500, { error: 'internal error', id });
  };

  // Shutdown triggered by a route (/api/shutdown): runs only after the
  // response is flushed ('finish'), never before. Removes hub.json, closes
  // the server and its sockets; a hard-exit timer (2 s) backstops close.
  // ctx.shutdownHub, when provided, replaces the default teardown.
  let shuttingDown = false;
  const shutdownNow = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // OpenWiki graph viewers are our child processes: they die with the hub,
    // never after it (dynamic import — services.mjs is absent from this
    // module's static graph on purpose).
    try {
      import('./services.mjs').then((m) => m.stopViewers && m.stopViewers()).catch(() => {});
    } catch { /* module already gone */ }
    const hard = setTimeout(() => process.exit(0), 2000);
    if (hard.unref) hard.unref();
    const finish = () => {
      try { server.close(() => process.exit(0)); } catch { process.exit(0); }
      server.closeAllConnections();
    };
    try { if (ctx.hubJsonPath) unlinkSync(ctx.hubJsonPath); } catch { /* already gone */ }
    try { if (typeof ctx.shutdownHub === 'function') ctx.shutdownHub(); else finish(); }
    catch { try { finish(); } catch { process.exit(0); } }
  };
  const respond = (res, status, json) => {
    const wantsShutdown = !!ctx.requestShutdown;
    send(res, status, json);
    if (wantsShutdown) res.once('finish', shutdownNow);
  };

  const server = createServer(async (req, res) => {
    // A client that aborts mid-request must never crash the server with an
    // unhandled 'error' event on the streams.
    req.on('error', () => {});
    res.on('error', () => {});
    try {
      const rawUrl = String(req.url || '');
      if (!rawUrl.startsWith('/') || rawUrl.startsWith('//')) return send(res, 400, { error: 'bad request target' });
      const pathname = safePath(rawUrl);
      if (pathname === null) return send(res, 404, { error: 'not found' });
      // Raw path used everywhere; no URL object rewriting against a base.
      const fakeUrl = new URL(`http://127.0.0.1${pathname}`);
      const port_ = boundPort ?? server.address()?.port ?? port;
      const handlers = { url: fakeUrl, pathname };

      if (req.socket.remoteAddress && !/^127\.0\.0\.1$/.test(req.socket.remoteAddress.replace(/^::ffff:/, ''))) {
        return send(res, 403, { error: 'forbidden' });
      }
      if (!hostOk(req.headers.host || '', port_)) return send(res, 403, { error: 'bad host' });
      if (!originOk(req.headers.origin, port_)) return send(res, 403, { error: 'bad origin' });
      const sf = { site: req.headers['sec-fetch-site'], mode: req.headers['sec-fetch-mode'], dest: req.headers['sec-fetch-dest'] };

      // One-port front door: tool prefixes (/canvas, /memb, ...) under the same guards as the hub's own routes.
      if (ctx.proxy && ctx.proxy.find(pathname)) {
        if (!fetchSiteOk({ ...sf, method: req.method, path: pathname })) return send(res, 403, { error: 'bad fetch site' });
        return await ctx.proxy.handle({ req, res, pathname, hubToken: tokenSha });
      }

      if (req.method === 'GET') {
        // Static reads: fixed filenames only. A path like /ui/../server.mjs
        // never matches a known filename, so it 404s without touching disk.
        if (STATIC_FILES.has(pathname)) {
          if (!fetchSiteOk({ ...sf, method: 'GET', path: pathname })) return send(res, 403, { error: 'bad fetch site' });
          const { file, type, abs } = STATIC_FILES.get(pathname);
          const body = readFileSync(abs ? file : join(UI_DIR, file));
          res.writeHead(200, { ...securityHeaders(), 'content-type': type });
          return res.end(body);
        }
        if (pathname === '/ao-embed-bridge.js') {
          if (!fetchSiteOk({ ...sf, method: 'GET', path: pathname })) return send(res, 403, { error: 'bad fetch site' });
          const bridgePath = join(UI_DIR, 'ao-embed-bridge.js');
          try {
            const body = readFileSync(bridgePath);
            res.writeHead(200, { ...securityHeaders(), 'content-type': 'application/javascript; charset=utf-8' });
            return res.end(body);
          } catch {
            return send(res, 404, { error: 'not found' });
          }
        }
        if (pathname === '/') {
          // Top-level navigation exemption: same-site + navigate + document.
          if (!fetchSiteOk({ ...sf, method: 'GET', path: '/' })) return send(res, 403, { error: 'bad fetch site' });
          const html = getShell(token);
          res.writeHead(200, { ...securityHeaders(), 'content-type': 'text/html; charset=utf-8' });
          return res.end(html);
        }
        if (!fetchSiteOk({ ...sf, method: 'GET', path: pathname })) return send(res, 403, { error: 'bad fetch site' });
      } else {
        if (!fetchSiteOk({ ...sf, method: req.method, path: pathname })) return send(res, 403, { error: 'bad fetch site' });
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      }

      const hit = matchRoute(req.method, pathname);
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

      const run = () => route.handler({ url: handlers.url, pathname, params, body, ctx });
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
          return internalError(res, e);
        }
        if (winner === false) return send(res, 409, { error: 'busy', lock: route.lock });
        let out;
        try { out = await winner; }
        catch (e) {
          // run's .finally releases the lock even on rejection.
          if (e && e.message === 'body too large') return send(res, 413, { error: e.message });
          if (e && Number.isInteger(e.status) && e.status >= 400 && e.status < 500) return send(res, e.status, { error: e.message });
          return internalError(res, e);
        }
        if (!out || typeof out !== 'object') return internalError(res, new Error('handler returned an unexpected shape'));
        return respond(res, out.status || 200, out.json ?? {});
      }
      const out = await run();
      if (!out || typeof out !== 'object') return internalError(res, new Error('handler returned an unexpected shape'));
      return respond(res, out.status || 200, out.json ?? {});
    } catch (e) {
      return internalError(res, e);
    }
  });

  const getShell = (tok) => {
    const ancestors = embedAncestors();
    let html = readFileSync(join(UI_DIR, 'index.html'), 'utf8');
    // The token meta is injected only here, on GET / — never on /ui/* files.
    html = html.replace('__AOS_HUB_TOKEN__', tok);
    if (ancestors.length > 0) {
      const metaTag = `<meta name="ao-embed-ancestors" content="${ancestors.join(' ').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}">`;
      const inject = `${metaTag}\n<script src="ao-embed-bridge.js"></script>`;
      html = html.includes('</head>') ? html.replace('</head>', `${inject}\n</head>`) : `${inject}\n${html}`;
    }
    return html;
  };

  return {
    server,
    token,
    ctx,
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
