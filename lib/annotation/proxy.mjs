'use strict';
// WP3 — loopback reverse proxy for the annotation canvas. Loopback listener,
// every request (HTTP and WebSocket upgrade) passes lib/annotation/guard.mjs
// checkRequest, one fixed allowlisted upstream (SSRF closed by construction,
// never derived from request data), one-shot HTML overlay injection, header
// rewriting, raw byte tunneling for upgrades. Upstream bodies are untrusted
// data: never interpreted, never logged.
import net from 'node:net';
import http from 'node:http';
import zlib from 'node:zlib';
import { GuardError, checkRequest, shaToken } from './guard.mjs';

export const OVERLAY_VERSION = '0.1.0';
export const DEFAULT_PORTS = Object.freeze(rangePorts(5173, 5199));
export const DEFAULTS = Object.freeze({
  maxHtmlBytes: 8 * 1024 * 1024,
  upstreamTimeoutMs: 30000,
  wsIdleTimeoutMs: 120000,
  maxConcurrent: 256,
  maxHeaderBytes: 16384,
});

function rangePorts(from, to) {
  const out = [];
  for (let p = from; p <= to; p++) out.push(p);
  return out;
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'host', 'content-length',
]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function isLoopbackName(name) {
  return name === '127.0.0.1' || name === 'localhost';
}

// Pure. The allowlist is closed by default: loopback spellings only, and the
// port must be in the explicitly allowlisted set (CLI ports or the default
// Vite range). Never throws on input shape alone concerns beyond shape.
export function parseUpstream(spec, allowPorts = DEFAULT_PORTS) {
  const text = String(spec ?? '').trim();
  const m = /^(?:https?:\/\/)?([^/:?#]+):(\d+)$/.exec(text);
  if (!m) throw new GuardError('E_UPSTREAM', 'upstream must be host:port');
  const host = m[1];
  const port = Number(m[2]);
  if (!isLoopbackName(host)) throw new GuardError('E_UPSTREAM', 'upstream host must be loopback');
  if (!allowPorts.includes(port)) throw new GuardError('E_UPSTREAM', `upstream port ${port} not allowlisted`);
  return { host, port };
}

export function upstreamOriginOf(up) {
  return `http://${up.host}:${up.port}`;
}

// Pure. Decide what to do with an upstream Location header.
// - root-relative or same-upstream absolute: pass / rewrite into proxied path
// - anything else (off-allowlist host, wrong port, other scheme, garbage): block
// Never 'follow': the upstream may not cause the proxy to fetch a new origin,
// and the request path is never rewritten into a different upstream.
export function rewriteLocation(value, { upstreamOrigin } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return { action: 'block' };
  if (raw.startsWith('//')) return absoluteWeak(raw);
  if (raw.startsWith('/')) return { action: 'pass', value: raw };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { action: 'block' };
  }
  if (url.protocol !== 'http:' || !isLoopbackName(url.hostname)) return { action: 'block' };
  return sameUpstream(url, upstreamOrigin);
}

function absoluteWeak(raw) {
  let url;
  try {
    url = new URL(`http:${raw}`);
  } catch {
    return { action: 'block' };
  }
  if (!isLoopbackName(url.hostname)) return { action: 'block' };
  return { action: 'rewrite', value: url.pathname + url.search };
}

function sameUpstream(url, upstreamOrigin) {
  if (!upstreamOrigin) return { action: 'block' };
  if (`http://${url.hostname}:${url.port}` === upstreamOrigin) {
    return { action: 'rewrite', value: url.pathname + url.search };
  }
  if (`http://${url.hostname}:${url.port}` === upstreamOrigin.replace('127.0.0.1', 'localhost')) {
    return { action: 'rewrite', value: url.pathname + url.search };
  }
  return { action: 'block' };
}

// Pure. Loopback dev servers do not need Domain pinning; drop it so the cookie
// stays on the proxy's own origin. Path attributes pass through unchanged.
export function rewriteSetCookieLine(line) {
  const parts = String(line ?? '').split(';');
  const kept = [];
  for (let i = 0; i < parts.length; i++) {
    const name = String(parts[i]).trim().split('=')[0].toLowerCase();
    if (i > 0 && name === 'domain') continue;
    kept.push(parts[i]);
  }
  return kept.join(';');
}

// Pure. Index just before '</body>' (case-insensitive) or the end.
export function findInjectPoint(html) {
  const text = String(html);
  const i = text.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? i : text.length;
}

// Pure. Exactly one version-pinned nonce-qualified tag, injected at most once
// per response by construction (one call site, one insertion).
export function overlayTag({ version = OVERLAY_VERSION, nonce } = {}) {
  return `<script src="/__aos_annot/overlay.js?v=${version}" nonce="${nonce}"></script>`;
}

export function injectOverlay(html, tagOptions) {
  const tag = overlayTag(tagOptions);
  const text = String(html);
  const point = findInjectPoint(text);
  return text.slice(0, point) + tag + text.slice(point);
}

// Strict CSP for the proxy's own routes: payload scripts get this exact nonce,
// no inline, no eval, connect-src self, no framing.
export function overlaySecurityHeaders(nonce) {
  return {
    'content-security-policy':
      `default-src 'none'; script-src 'self' 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  };
}

function decodeBody(buffer, encoding) {
  return new Promise((resolve, reject) => {
    const enc = String(encoding ?? '').toLowerCase();
    if (!enc) return resolve(buffer);
    const callback = (err, out) => (err ? reject(err) : resolve(out));
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzip(buffer, callback);
    if (enc === 'deflate') return zlib.inflate(buffer, callback);
    if (enc === 'br') return zlib.brotliDecompress(buffer, callback);
    resolve(buffer);
  });
}

function writeJsonError(res, status, code) {
  if (!res || res.writableEnded || res.destroyed) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'close',
  });
  res.end(JSON.stringify({ error: code }));
}

const GUARD_STATUS = new Map([
  ['E_HOST', 403],
  ['E_ORIGIN', 403],
  ['E_TOKEN', 403],
  ['E_FETCH_SITE', 403],
  ['E_METHOD', 405],
  ['E_BODY', 413],
  ['E_QUERY_TOKEN', 403],
]);

function guardErrorCode(err) {
  return err instanceof GuardError ? err.code : 'E_INTERNAL';
}

function guardStatus(err) {
  return GUARD_STATUS.get(guardErrorCode(err)) ?? 403;
}

// Browser navigations and subresource loads legitimately omit Origin, unlike
// the JSON-RPC API the guard was written for. When Origin is absent we pin it
// to the already-exact loopback Host, so the guard's binding checks still hold
// with a single code path. Origin present = checked verbatim by the guard.
function withDerivedOrigin(req) {
  if (req.headers.origin === undefined) {
    req.headers.origin = `http://${req.headers.host ?? ''}`;
  }
  return req;
}

export async function createProxy(options = {}) {
  const port = options.port ?? 0;
  const tokenSha = options.tokenSha ?? shaToken(options.token ?? '');
  const upstream = options.upstream ?? null;
  const caps = {
    maxHtmlBytes: options.maxHtmlBytes ?? DEFAULTS.maxHtmlBytes,
    upstreamTimeoutMs: options.upstreamTimeoutMs ?? DEFAULTS.upstreamTimeoutMs,
    wsIdleTimeoutMs: options.wsIdleTimeoutMs ?? DEFAULTS.wsIdleTimeoutMs,
    maxConcurrent: options.maxConcurrent ?? DEFAULTS.maxConcurrent,
    maxHeaderBytes: options.maxHeaderBytes ?? DEFAULTS.maxHeaderBytes,
  };
  const state = { active: 0 };
  const nonce = options.nonce ?? '__aos-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);

  if (upstream === null) throw new GuardError('E_UPSTREAM', 'upstream origin required');

  const cfg = { port, tokenSha, upstream, caps, nonce };
  const server = http.createServer({ maxHeaderSize: 65536 }, onRequest(state, cfg));
  server.on('upgrade', onUpgrade(state, cfg));
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  // The guard binds to the exact listening port; port 0 means "assigned here".
  cfg.port = server.address().port;
  return { server, port: cfg.port, nonce, caps };
}

function servingOverlay(req) {
  const path = String(req.url ?? '').split('?')[0];
  return path === '/__aos_annot/overlay.js';
}

function serveOverlay(proxy, res) {
  const body = `window.__AOS_ANNOT = { version: "${OVERLAY_VERSION}" };\n`;
  res.writeHead(200, {
    ...overlaySecurityHeaders(proxy.nonce),
    'content-type': 'text/javascript; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

// Orchestration per request; each check stays a pure call.
function onRequest(state, proxy) {
  return (req, res) => {
    try {
      assertHeaderSize(proxy, req.rawHeaders);
      checkRequest(withDerivedOrigin(req), { port: proxy.port, tokenSha: proxy.tokenSha });
    } catch (err) {
      return writeJsonError(res, guardStatus(err), guardErrorCode(err));
    }
    if (servingOverlay(req)) return serveOverlay(proxy, res);
    if (state.active >= proxy.caps.maxConcurrent) return writeJsonError(res, 429, 'E_BUSY');
    state.active += 1;
    let finished = false;
    forward(proxy, req, res, () => {
      if (finished) return;
      finished = true;
      state.active -= 1;
    });
  };
}

// The request path selects a resource on the fixed upstream only; a different
// schema/scheme is impossible (http only, no CONNECT, upgrades limited below).
function cleanRequestHeaders(req, upstream) {
  const headers = {};
  for (const name of Object.keys(req.headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    headers[name] = req.headers[name];
  }
  headers.accept = req.headers.accept ?? '*/*';
  headers.host = `${upstream.host}:${upstream.port}`;
  return headers;
}

function assertHeaderSize(proxy, rawHeaders) {
  let bytes = 0;
  for (const line of rawHeaders) bytes += Buffer.byteLength(line) + 2;
  if (bytes > proxy.caps.maxHeaderBytes) {
    throw new GuardError('E_HEADERS', 'request headers exceed size cap');
  }
}

function forward(proxy, req, res, done) {
  const up = proxy.upstream;
  const upstreamReq = http.request(
    {
      host: '127.0.0.1',
      port: up.port,
      method: req.method,
      path: req.url,
      headers: cleanRequestHeaders(req, up),
    },
    (upRes) => {
      respond(proxy, res, upRes);
      done();
    },
  );
  upstreamReq.setTimeout(proxy.caps.upstreamTimeoutMs, () => {
    upstreamReq.destroy(new GuardError('E_TIMEOUT', 'upstream timed out'));
  });
  upstreamReq.on('error', () => {
    writeJsonError(res, 502, 'E_UPSTREAM');
    done();
  });
  req.on('aborted', () => upstreamReq.destroy());
  req.pipe(upstreamReq);
}

function respond(proxy, res, upRes) {
  const headers = { ...upRes.headers };
  const status = upRes.statusCode ?? 502;
  delete headers['content-security-policy'];
  delete headers['x-frame-options'];
  if (REDIRECT_STATUS.has(status) && headers.location !== undefined) {
    const decision = rewriteLocation(headers.location, { upstreamOrigin: upstreamOriginOf(proxy.upstream) });
    if (decision.action === 'block') return writeJsonError(res, 502, 'E_REDIRECT_OFF_ALLOWLIST');
    if (decision.action === 'rewrite') headers.location = decision.value;
  }
  if (headers['set-cookie'] !== undefined) {
    headers['set-cookie'] = (Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [headers['set-cookie']])
      .map(rewriteSetCookieLine);
  }
  const type = String(headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('text/html')) {
    finishStream(res, status, headers, upRes);
    return;
  }
  respondHtml(proxy, res, upRes, status, headers);
}

function finishStream(res, status, headers, upRes) {
  res.writeHead(status, headers);
  upRes.pipe(res);
  upRes.on('error', () => res.destroy());
}

function respondHtml(proxy, res, upRes, status, headers) {
  const cap = proxy.caps.maxHtmlBytes;
  const chunks = [];
  let size = 0;
  let oversize = false;
  upRes.on('data', (chunk) => {
    size += chunk.length;
    if (size > cap) {
      oversize = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  const send = () => {
    if (oversize) {
      headers['x-aos-annot'] = 'skipped';
      finishStream(res, status, headers, upRes);
      return;
    }
    Promise.all([
      decodeBody(Buffer.concat(chunks), headers['content-encoding']),
    ])
      .then(([body]) => {
        delete headers['content-encoding'];
        const html = body.toString('utf8');
        const out = injectOverlay(html, { nonce: proxy.nonce });
        const outBuf = Buffer.from(out, 'utf8');
        headers['x-aos-annot'] = 'rewritten';
        headers['content-length'] = String(outBuf.length);
        res.writeHead(status, headers);
        res.end(outBuf);
      })
      .catch(() => {
        headers['x-aos-annot'] = 'skipped';
        finishStream(res, status, headers, upRes);
      });
  };
  upRes.on('end', send);
  upRes.on('error', () => writeJsonError(res, 502, 'E_UPSTREAM'));
}

// Only Vite HMR and the dev server's own ws endpoint. The path can never
// select a different upstream because the upstream is fixed in config.
export function upgradePathOk(url) {
  const path = String(url ?? '').split('?')[0];
  if (path.startsWith('/_vite')) return true;
  // Vite 5+ HMR connects its websocket on the root path; it is still the same
  // fixed upstream and passes the full guard, so it is allowed.
  return path === '/' || path === '/ws' || path.startsWith('/ws/');
}

function onUpgrade(state, proxy) {
  return (req, socket, head) => {
    try {
      assertHeaderSize(proxy, req.rawHeaders);
      checkRequest(withDerivedOrigin(req), { port: proxy.port, tokenSha: proxy.tokenSha });
      if (!upgradePathOk(req.url)) throw new GuardError('E_UPGRADE_PATH', 'upgrade path not allowed');
    } catch (err) {
      socket.write('HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\nconnection: close\r\n\r\n');
      socket.end(JSON.stringify({ error: guardErrorCode(err) }));
      return;
    }
    if (state.active >= proxy.caps.maxConcurrent) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nconnection: close\r\n\r\n');
      socket.end(JSON.stringify({ error: 'E_BUSY' }));
      return;
    }
    state.active += 1;
    let finished = false;
    tunnel(proxy, req, socket, head, () => {
      if (finished) return;
      finished = true;
      state.active -= 1;
    });
  };
}

function tunnel(proxy, req, socket, head, done) {
  const up = proxy.upstream;
  const upstreamSocket = net.connect(up.port, '127.0.0.1');
  upstreamSocket.setNoDelay(true);
  socket.setNoDelay(true);
  const close = () => {
    done();
    socket.destroy();
    upstreamSocket.destroy();
  };
  socket.setTimeout(proxy.caps.wsIdleTimeoutMs, close);
  upstreamSocket.setTimeout(proxy.caps.wsIdleTimeoutMs, close);
  upstreamSocket.once('connect', () => {
    const lines = [];
    lines.push(`GET ${req.url} HTTP/1.1`);
    lines.push(`Host: ${up.host}:${up.port}`);
    for (const [name, value] of Object.entries(req.headers)) {
      const lower = name.toLowerCase();
      if (lower === 'host' || lower === 'connection' || lower === 'upgrade' || lower === 'content-length') continue;
      lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }
    lines.push('Connection: Upgrade');
    lines.push('Upgrade: websocket');
    upstreamSocket.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket);
    upstreamSocket.pipe(socket);
  });
  upstreamSocket.once('error', close);
  socket.once('error', close);
  socket.once('close', close);
  upstreamSocket.once('close', close);
}

export const __testing = { decodeBody };
