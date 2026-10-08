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
import { randomBytes } from 'node:crypto';
import { COOKIE_NAME, GuardError, checkRequest, shaToken, MAX_BODY } from './guard.mjs';

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
  'proxy-authorization', 'te', 'trailer', 'host',
]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

// Hop-by-hop headers must never be forwarded in either direction; 'host' and
// 'content-length' are handled separately upstream of this filter.
const RESPONSE_HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization',
]);

function stripResponseHeaders(headers) {
  for (const name of RESPONSE_HOP_BY_HOP) delete headers[name];
}

function isLoopbackName(name) {
  const n = String(name ?? '').toLowerCase();
  return n === '127.0.0.1' || n === 'localhost' || n === '::1' || n === '[::1]';
}

// The guard's own token cookie must never reach the upstream app: HTTP or the
// hand-built upgrade request. Returns undefined when nothing remains.
function filterRequestCookie(value) {
  const text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  const kept = [];
  for (const part of text.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const name = (eq < 0 ? trimmed : trimmed.slice(0, eq)).trim().toLowerCase();
    if (name === COOKIE_NAME) continue;
    kept.push(trimmed);
  }
  return kept.length ? kept.join('; ') : undefined;
}

// Lowercased name of a Set-Cookie line's cookie.
function setCookieLineName(line) {
  const text = String(line ?? '');
  const eq = text.indexOf('=');
  return eq < 0 ? '' : text.slice(0, eq).trim().toLowerCase();
}

// Pure. The allowlist is closed by default: loopback spellings only, and the
// port must be in the explicitly allowlisted set (CLI ports or the default
// Vite range). Never throws on input shape alone concerns beyond shape.
export function parseUpstream(spec, allowPorts = DEFAULT_PORTS) {
  const text = String(spec ?? '').trim();
  const mb = /^(?:https?:\/\/)?(\[[^\]/?#]+\]):(\d+)$/.exec(text);
  const m = mb ?? /^(?:https?:\/\/)?([^/:?#]+):(\d+)$/.exec(text);
  if (!m) throw new GuardError('E_UPSTREAM', 'upstream must be host:port');
  const host = m[1];
  const port = Number(m[2]);
  if (!isLoopbackName(host)) throw new GuardError('E_UPSTREAM', 'upstream host must be loopback');
  if (!allowPorts.includes(port)) throw new GuardError('E_UPSTREAM', `upstream port ${port} not allowlisted`);
  return { host, port };
}

export function upstreamOriginOf(up) {
  const h = String(up.host).includes(':') && !String(up.host).startsWith('[') ? `[${up.host}]` : up.host;
  return `http://${h}:${up.port}`;
}

// Pure. Decide what to do with an upstream Location header.
// - root-relative or same-upstream absolute: pass / rewrite into proxied path
// - anything else (off-allowlist host, wrong port, other scheme, garbage): block
// Browsers normalize the second path character: '/\evil.com' and '/%2f...'
// spellings parse as protocol-relative '//evil.com', so a Location whose
// second character is '/' or '\' is protocol-relative in effect and blocked.
// Backslashes (some parsers treat them as slashes) and control characters in a
// Location header are also blocked; a Location header value can never contain
// raw CR/LF through this layer but escaped or stripped control bytes are not
// trustworthy anywhere downstream either.
export function rewriteLocation(value, { upstreamOrigin } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return { action: 'block' };
  if (raw.includes('\\')) return { action: 'block' };
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { action: 'block' };
  if (raw.startsWith('//')) return absoluteWeak(raw, upstreamOrigin);
  if (raw.length > 1 && (raw[1] === '/' || raw[1] === '\\')) return { action: 'block' };
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

function absoluteWeak(raw, upstreamOrigin) {
  let url;
  try {
    url = new URL(`http:${raw}`);
  } catch {
    return { action: 'block' };
  }
  if (!isLoopbackName(url.hostname)) return { action: 'block' };
  if (upstreamOrigin) return sameUpstream(url, upstreamOrigin);
  return { action: 'rewrite', value: url.pathname + url.search };
}

function sameUpstream(url, upstreamOrigin) {
  if (!upstreamOrigin) return { action: 'block' };
  let upHost = '';
  let upPort = '';
  try {
    const u = new URL(upstreamOrigin);
    upHost = u.hostname;
    upPort = u.port;
  } catch { return { action: 'block' }; }
  const norm = (h) => String(h ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  const loop = new Set(['127.0.0.1', 'localhost', '::1']);
  if (String(url.port) === String(upPort) && loop.has(norm(url.hostname)) && loop.has(norm(upHost)) && norm(url.hostname) !== '' ) {
    // same port and both loopback spellings: treat as same upstream
    if (norm(url.hostname) === norm(upHost) || (loop.has(norm(url.hostname)) && loop.has(norm(upHost)))) {
      return { action: 'rewrite', value: url.pathname + url.search };
    }
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

// Pure. Index just before '</body>' (case-insensitive) or the end. The
// original string is scanned directly with a case-insensitive regex — index
// math against a separately lowercased copy is never used, so mixed-case
// '<BODY>' tags land at the right offset without surrogate/length drift.
export function findInjectPoint(html) {
  const text = String(html);
  let last = -1;
  for (const match of text.matchAll(/<\/body>/gi)) last = match.index;
  return last >= 0 ? last : text.length;
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

// Pure. The app's own CSP is never deleted: the injected script's nonce is
// appended to the app's existing script-src directive (a script-src directive
// is added only when the app CSP has one to extend — no CSP in, no CSP out).
// report-only CSPs get the same treatment in the matching response header.
export function cspWithNonce(csp, nonce) {
  const directives = String(csp ?? '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
  const scriptSrc = directives.findIndex((d) => d.toLowerCase().startsWith('script-src'));
  const token = `'nonce-${nonce}'`;
  if (scriptSrc >= 0) directives[scriptSrc] = `${directives[scriptSrc]} ${token}`;
  else directives.push(`script-src ${token}`);
  return directives.join('; ');
}

// The app sent no CSP: the proxy sends none. A present CSP keeps every
// directive, with only the injected nonce appended per response nonce.
function applyCspNonce(headers, nonce) {
  let touched = false;
  if (headers['content-security-policy'] !== undefined) {
    headers['content-security-policy'] = cspWithNonce(headers['content-security-policy'], nonce);
    touched = true;
  }
  if (headers['content-security-policy-report-only'] !== undefined) {
    headers['content-security-policy-report-only'] = cspWithNonce(
      headers['content-security-policy-report-only'],
      nonce,
    );
  }
  return touched;
}

function decodeBody(buffer, encoding, maxOutputLength = Infinity) {
  return new Promise((resolve, reject) => {
    const enc = String(encoding ?? '').toLowerCase();
    if (!enc) return resolve(buffer);
    const opts = Number.isFinite(maxOutputLength) ? { maxOutputLength } : undefined;
    const callback = (err, out) => (err ? reject(err) : resolve(out));
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzip(buffer, opts, callback);
    if (enc === 'deflate') return zlib.inflate(buffer, opts, callback);
    if (enc === 'br') return zlib.brotliDecompress(buffer, opts, callback);
    resolve(buffer);
  });
}

function writeJsonError(res, status, code) {
  if (!res || res.writableEnded || res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  const body = Buffer.from(JSON.stringify({ error: code }), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    connection: 'close',
  });
  res.end(body);
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

const liveProxyPorts = new Set();
export async function createProxy(options = {}) {
  const port = options.port ?? 0;
  const tokenSha = options.tokenSha ?? shaToken(options.token ?? '');
  const upstreamRaw = options.upstream ?? null;
  const caps = {
    maxHtmlBytes: options.maxHtmlBytes ?? DEFAULTS.maxHtmlBytes,
    upstreamTimeoutMs: options.upstreamTimeoutMs ?? DEFAULTS.upstreamTimeoutMs,
    wsIdleTimeoutMs: options.wsIdleTimeoutMs ?? DEFAULTS.wsIdleTimeoutMs,
    maxConcurrent: options.maxConcurrent ?? DEFAULTS.maxConcurrent,
    maxHeaderBytes: options.maxHeaderBytes ?? DEFAULTS.maxHeaderBytes,
    maxBodyBytes: options.maxBodyBytes ?? MAX_BODY,
  };
  const state = { active: 0 };
  // F7: per-response nonces are generated fresh for every HTML rewrite; this
  // nonce covers only the proxy's own overlay route CSP.
  const nonce = options.nonce ?? randomBytes(16).toString('base64url');
  const embedOrigin = options.embedOrigin ?? null;

  if (upstreamRaw === null) throw new GuardError('E_UPSTREAM', 'upstream origin required');
  // F6: the configured upstream goes through the same strict parser as the
  // CLI path (loopback host, allowlisted port only). options.allowedPorts
  // REPLACES the default allowlist and must never be fed from user config.
  const allowPorts = (options.allowedPorts ?? DEFAULT_PORTS).slice();
  const upstream = parseUpstream(
    typeof upstreamRaw === 'string' ? upstreamRaw : `${upstreamRaw.host}:${upstreamRaw.port}`,
    allowPorts,
  );

  const cfg = { port, tokenSha, upstream, caps, nonce, embedOrigin };
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
  if (cfg.port === upstream.port || liveProxyPorts.has(upstream.port)) {
    server.close();
    throw new GuardError('E_UPSTREAM', 'upstream port must differ from the proxy listen port');
  }
  liveProxyPorts.add(cfg.port);
  server.once('close', () => liveProxyPorts.delete(cfg.port));
  return { server, port: cfg.port, nonce, caps, embedOrigin };
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

export function requestPathOk(url) {
  const u = String(url ?? '');
  if (!u.startsWith('/') || u.startsWith('//')) return false;
  if (u.includes('\\')) return false;
  if (/^https?:/i.test(u)) return false;
  const path = u.split('?')[0].split('#')[0];
  if (/(^|\/)\.\.(\/|$)/.test(path)) return false;
  const low = path.toLowerCase();
  if (low.includes('%2e%2e') || low.includes('.%2e') || low.includes('%2e.') || low.includes('%5c')) return false;
  return true;
}

// Orchestration per request; each check stays a pure call.
function onRequest(state, proxy) {
  return (req, res) => {
    try {
      assertHeaderSize(proxy, req.rawHeaders);
      // F13 policy split: forwarded app traffic may use the full dev-server
      // method set (the upstream app's own content-type rules apply); the
      // POST+application/json rule stays enforced on the proxy's own
      // /__aos_annot/ endpoints only.
      checkRequest(withDerivedOrigin(req), {
        port: proxy.port,
        tokenSha: proxy.tokenSha,
        wantJsonBody: servingOverlay(req),
      });
    } catch (err) {
      return writeJsonError(res, guardStatus(err), guardErrorCode(err));
    }
    if (!requestPathOk(req.url)) return writeJsonError(res, 400, 'E_PATH');
    if (/chunked/i.test(String(req.headers['transfer-encoding'] ?? '')) && ['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(String(req.method ?? '').toUpperCase())) { req.resume(); return writeJsonError(res, 400, 'E_CHUNKED_BODY'); }
    if (servingOverlay(req)) return serveOverlay(proxy, res);
    if (state.active >= proxy.caps.maxConcurrent) return writeJsonError(res, 429, 'E_BUSY');
    state.active += 1;
    let released = false;
    // Exactly-once slot release: fires when the response finishes or the
    // client closes (either ends the response), and on upstream error.
    const release = () => {
      if (released) return;
      released = true;
      state.active -= 1;
    };
    res.on('finish', release);
    res.on('close', release);
    forward(proxy, req, res, release);
  };
}

// The request path selects a resource on the fixed upstream only; a different
// schema/scheme is impossible (http only, no CONNECT, upgrades limited below).
function cleanRequestHeaders(req, upstream) {
  const headers = {};
  for (const name of Object.keys(req.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'content-length' && req.headers['transfer-encoding'] !== undefined) continue;
    if (lower === 'authorization') continue;
    headers[name] = req.headers[name];
  }
  if (headers.cookie !== undefined) {
    const filtered = filterRequestCookie(headers.cookie);
    if (filtered === undefined) delete headers.cookie;
    else headers.cookie = filtered;
  }
  headers.accept = req.headers.accept ?? '*/*';
  headers['accept-encoding'] = 'identity';
  headers.host = `${upstream.host.includes(':') && !upstream.host.startsWith('[') ? `[${upstream.host}]` : upstream.host}:${upstream.port}`;
  return headers;
}

function assertHeaderSize(proxy, rawHeaders) {
  let bytes = 0;
  for (const line of rawHeaders) bytes += Buffer.byteLength(line) + 2;
  if (bytes > proxy.caps.maxHeaderBytes) {
    throw new GuardError('E_HEADERS', 'request headers exceed size cap');
  }
}

function stripBrackets(host) {
  const h = String(host ?? '');
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

function forward(proxy, req, res, release) {
  const up = proxy.upstream;
  if (req.headers['content-length'] !== undefined) {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > proxy.caps.maxBodyBytes) {
      release();
      req.resume();
      return writeJsonError(res, 413, 'E_BODY');
    }
  }
  let upRes = null;
  const upstreamReq = http.request(
    {
      host: stripBrackets(up.host),
      port: up.port,
      method: req.method,
      path: req.url,
      headers: cleanRequestHeaders(req, up),
    },
    (response) => {
      upRes = response;
      respond(proxy, res, response);
    },
  );
  upstreamReq.setTimeout(proxy.caps.upstreamTimeoutMs, () => {
    upstreamReq.destroy(new GuardError('E_TIMEOUT', 'upstream timed out'));
  });
  upstreamReq.on('error', () => {
    release();
    writeJsonError(res, 502, 'E_UPSTREAM');
  });
  req.on('aborted', () => upstreamReq.destroy());
  let seenBytes = 0;
  let capped = false;
  req.on('data', (chunk) => {
    seenBytes += chunk.length;
    if (!capped && seenBytes > proxy.caps.maxBodyBytes) {
      capped = true;
      release();
      req.unpipe(upstreamReq);
      upstreamReq.destroy();
      writeJsonError(res, 413, 'E_BODY');
    }
  });
  // The slot ends when the response ends or the client walks away; destroying
  // both sides here is the client-close cleanup so nothing leaks.
  res.on('close', () => {
    release();
    upstreamReq.destroy();
    if (upRes) upRes.destroy();
  });
  req.pipe(upstreamReq);
}

function respond(proxy, res, upRes) {
  const headers = { ...upRes.headers };
  const status = upRes.statusCode ?? 502;
  stripResponseHeaders(headers);
  // F8: the app's CSP is kept everywhere; the nonce is appended at rewrite
  // time (respondHtml). X-Frame-Options is kept unless the canvas embeds the
  // app (embedOrigin set), in which case framing is the point.
  if (proxy.embedOrigin !== null) delete headers['x-frame-options'];
  if (REDIRECT_STATUS.has(status) && headers.location !== undefined) {
    const decision = rewriteLocation(headers.location, { upstreamOrigin: upstreamOriginOf(proxy.upstream) });
    if (decision.action === 'block') {
      // F5: a blocked redirect must not wedge the upstream socket — drain its
      // data so the connection can be closed/reused.
      upRes.resume();
      return writeJsonError(res, 502, 'E_REDIRECT_OFF_ALLOWLIST');
    }
    if (decision.action === 'rewrite') headers.location = decision.value;
  }
  if (headers['set-cookie'] !== undefined) {
    const lines = (Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [headers['set-cookie']])
      .filter((line) => setCookieLineName(line) !== COOKIE_NAME)
      .map(rewriteSetCookieLine);
    if (lines.length === 0) delete headers['set-cookie'];
    else headers['set-cookie'] = lines;
  }
  const type = String(headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('text/html')) {
    finishStream(res, status, headers, upRes);
    return;
  }
  if (!contentEncodingOk(headers['content-encoding'])) {
    headers['x-aos-annot'] = 'skipped';
    finishStream(res, status, headers, upRes);
    return;
  }
  respondHtml(proxy, res, upRes, status, headers);
}

function contentEncodingOk(value) {
  if (value === undefined) return true;
  const parts = String(value).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.length > 1) return false;
  return parts[0] === '' || parts[0] === 'identity' || parts[0] === 'gzip' || parts[0] === 'x-gzip' || parts[0] === 'deflate' || parts[0] === 'br';
}

function finishStream(res, status, headers, upRes) {
  res.writeHead(status, headers);
  upRes.pipe(res);
  upRes.on('error', () => res.destroy());
  upRes.on('aborted', () => res.destroy());
  upRes.on('close', () => { if (!upRes.complete) res.destroy(); });
}

// Only responses the slow path rewrites carry a nonce: one fresh 128-bit
// nonce per HTML response (never reused across responses or shared with the
// overlay route), placed only in the injected tag attribute and in the app's
// own CSP script-src. Skip paths keep the untouched original headers.
function charsetNonUtf8(headers) {
  const type = String(headers['content-type'] ?? '');
  const m = /charset=([^\s;]+)/i.exec(type);
  if (!m) return false;
  const cs = String(m[1]).trim().replace(/^"(.*)"$/, '$1').toLowerCase();
  return cs !== '' && cs !== 'utf-8' && cs !== 'utf8';
}

function sendSkipped(res, status, headers, chunks) {
  headers['x-aos-annot'] = 'skipped';
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, headers);
  res.end(Buffer.concat(chunks));
}

function respondHtml(proxy, res, upRes, status, headers) {
  const cap = proxy.caps.maxHtmlBytes;
  const chunks = [];
  let size = 0;
  let oversize = false;
  upRes.on('data', (chunk) => {
    if (oversize) {
      res.write(chunk);
      return;
    }
    size += chunk.length;
    if (size > cap) {
      // too big to rewrite: flush what was buffered and stream the rest untouched
      oversize = true;
      headers['x-aos-annot'] = 'skipped';
      res.writeHead(status, headers);
      for (const c of chunks) res.write(c);
      chunks.length = 0;
      res.write(chunk);
      return;
    }
    chunks.push(chunk);
  });
  const send = () => {
    if (oversize) {
      res.end();
      return;
    }
    Promise.all([
      decodeBody(Buffer.concat(chunks), headers['content-encoding'], cap),
    ])
      .then(([body]) => {
        if (charsetNonUtf8(headers)) {
          // F12: a declared non-UTF-8 charset means byte offsets and the
          // UTF-8 decode used for injection are untrustworthy — skip entirely.
          headers['x-aos-annot'] = 'skipped';
          delete headers['content-encoding'];
          delete headers['content-length'];
          if (res.writableEnded || res.destroyed) return;
          res.writeHead(status, headers);
          res.end(body);
          return;
        }
        delete headers['content-encoding'];
        delete headers['content-length'];
        // F7: fresh nonce per HTML response.
        const nonce = randomBytes(16).toString('base64url');
        const html = body.toString('utf8');
        const out = injectOverlay(html, { nonce });
        if (headers['content-security-policy'] !== undefined || headers['content-security-policy-report-only'] !== undefined) {
          applyCspNonce(headers, nonce);
        }
        const outBuf = Buffer.from(out, 'utf8');
        headers['x-aos-annot'] = 'rewritten';
        headers['content-length'] = String(outBuf.length);
        res.writeHead(status, headers);
        res.end(outBuf);
      })
      .catch(() => {
        // Decode failed: the upstream stream has already ended (this only
        // runs from 'end'), so never pipe it again. Send the buffered raw
        // chunks unchanged with the original headers, marked skipped.
        sendSkipped(res, status, headers, chunks);
      });
  };
  upRes.on('end', send);
  upRes.on('error', () => {
    if (res.writableEnded || res.destroyed) return;
    writeJsonError(res, 502, 'E_UPSTREAM');
  });
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
      if (!requestPathOk(req.url)) throw new GuardError('E_PATH', 'bad request path');
    } catch (err) {
      const body = Buffer.from(JSON.stringify({ error: guardErrorCode(err) }), 'utf8');
      socket.write(`HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body.toString('utf8')}`);
      socket.end();
      return;
    }
    if (state.active >= proxy.caps.maxConcurrent) {
      const busyBody = Buffer.from(JSON.stringify({ error: 'E_BUSY' }), 'utf8');
      socket.write(
        `HTTP/1.1 429 Too Many Requests\r\ncontent-type: application/json\r\ncontent-length: ${busyBody.length}\r\nconnection: close\r\n\r\n${busyBody.toString('utf8')}`,
      );
      socket.end();
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

// F11: the hand-built upgrade request forwards an explicit header allowlist
// plus the (already stripped) Cookie, and never a value containing CR or LF.
const WS_FORWARD_HEADERS = new Set([
  'origin', 'user-agent', 'sec-websocket-key', 'sec-websocket-version',
  'sec-websocket-protocol', 'sec-websocket-extensions',
]);

function wsForwardLines(proxy, req) {
  const up = proxy.upstream;
  const lines = [`GET ${req.url} HTTP/1.1`, `Host: ${String(up.host).includes(':') && !String(up.host).startsWith('[') ? `[${up.host}]` : up.host}:${up.port}`];
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (lower === 'cookie') {
      const filtered = filterRequestCookie(value);
      if (filtered === undefined) continue;
      if (/[\r\n]/.test(filtered)) return null;
      lines.push(`Cookie: ${filtered}`);
      continue;
    }
    if (!WS_FORWARD_HEADERS.has(lower)) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      const text = String(v ?? '');
      if (/[\r\n\u0000-\u001f\u007f]/.test(text)) return null;
    }
    lines.push(`${name}: ${values.join(', ')}`);
  }
  lines.push('Connection: Upgrade', 'Upgrade: websocket');
  return lines;
}

function tunnel(proxy, req, socket, head, done) {
  const up = proxy.upstream;
  const forwardLines = wsForwardLines(proxy, req);
  if (forwardLines === null) {
    const body = Buffer.from(JSON.stringify({ error: 'E_UPSTREAM' }), 'utf8');
    const response = `HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body.toString('utf8')}`;
    socket.end(response, () => socket.destroy());
    socket.once('close', () => socket.destroy());
    done();
    return;
  }
  const upstreamSocket = net.connect(up.port, stripBrackets(up.host));
  upstreamSocket.setNoDelay(true);
  socket.setNoDelay(true);
  const close = () => {
    done();
    socket.destroy();
    upstreamSocket.destroy();
  };
  // F11: non-101 first response line (or injected header values) → typed 502
  // JSON to the client, then both sockets are destroyed.
  const fail = () => {
    done();
    socket.destroy();
    upstreamSocket.destroy();
  };
  socket.setTimeout(proxy.caps.wsIdleTimeoutMs, close);
  upstreamSocket.setTimeout(proxy.caps.wsIdleTimeoutMs, close);
  let relayed = false;
  const buffered = [];
  upstreamSocket.once('connect', () => {
    upstreamSocket.write(forwardLines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstreamSocket.write(head);
    upstreamSocket.on('data', function onData(chunk) {
      if (relayed) {
        socket.write(chunk);
        return;
      }
      buffered.push(chunk);
      const buf = Buffer.concat(buffered);
      const raw = buf.toString('latin1');
      const sep = raw.indexOf('\r\n\r\n');
      if (sep < 0) return;
      if (!raw.startsWith('HTTP/1.1 101')) {
        buffered.length = 0;
        const body = Buffer.from(JSON.stringify({ error: 'E_UPSTREAM' }), 'utf8');
        socket.write(
          `HTTP/1.1 502 Bad Gateway\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body.toString('utf8')}`,
        );
        socket.end();
        return fail();
      }
      relayed = true;
      upstreamSocket.removeListener('data', onData);
      // Relay the upstream 101 (and any bytes already past its header block),
      // then hand both streams over to raw bidirectional tunneling.
      socket.write(buf);
      socket.pipe(upstreamSocket);
      upstreamSocket.pipe(socket);
    });
  });
  upstreamSocket.once('error', close);
  socket.once('error', close);
  socket.once('close', close);
  upstreamSocket.once('close', close);
}

export const __testing = { decodeBody };
