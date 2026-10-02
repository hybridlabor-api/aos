'use strict';

/**
 * Annotation endpoint for a running dev app (the "annotate" half of Plan
 * Canvas). server.js hands requests for `/annotate.js` and `/api/annotate/*`
 * here after the Host check and before the Origin/fetch-site gate, because the
 * caller is a page on a different loopback origin by design.
 *
 * Trust model: a per-session token (only its SHA-256 is stored) bound to one
 * exact loopback app origin. The endpoint can queue `kind:"annotation"` items
 * and nothing else, so an app page can never approve, chat or end a session.
 */

const crypto = require('crypto');

const { normalizeOrigin } = require('./annotation-schema');

const KEY_RE = /^[a-f0-9]{12}$/;
const ROUTE_RE = /^\/api\/annotate\/([a-f0-9]{12})(\/token)?$/;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TOKEN_BODY_BYTES = 4 * 1024;
const MAX_ITEMS_PER_POST = 20;
const MAX_PENDING = 200;
const RATE_PER_MINUTE = 60;
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_TTL_MS = 1000;
const MAX_TOKEN_HEADER = 200;
const SERVER_HOST = '127.0.0.1';

const STUB_CLIENT_JS =
  "'use strict';\n(() => { try { console.warn('[aos-annotate] client layer not installed in this build'); } catch (_) {} })();\n";

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function loadClientJs(version) {
  let mod;
  try {
    mod = require('./annotate-client');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return STUB_CLIENT_JS;
    throw error;
  }
  return mod.annotateClientJs({ transport: 'fetch', version });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

class HttpError extends Error {
  constructor(status, code, message, headers) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

// Stops reading at the cap; the caller answers 413 and drops the socket.
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return reject(new HttpError(413, 'too_large', 'body too large', { connection: 'close' }));
    }
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        reject(new HttpError(413, 'too_large', 'body too large', { connection: 'close' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
    return undefined;
  });
}

function parseJsonObject(text) {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function isJsonContentType(value) {
  return typeof value === 'string' && /^application\/json\s*(;|$)/i.test(value.trim());
}

function createAnnotateHandler({ store, version = '0.0.0', onQueued = () => {}, now = Date.now, log = () => {} } = {}) {
  if (!store) throw new Error('createAnnotateHandler requires a session store');
  const buckets = new Map(); // key -> { tokens, at }

  function takeRate(key) {
    const t = now();
    const bucket = buckets.get(key) || { tokens: RATE_PER_MINUTE, at: t };
    bucket.tokens = Math.min(RATE_PER_MINUTE, bucket.tokens + Math.max(0, t - bucket.at) * (RATE_PER_MINUTE / 60000));
    bucket.at = t;
    buckets.set(key, bucket);
    if (bucket.tokens < 1) return Math.max(1, Math.ceil((1 - bucket.tokens) / (RATE_PER_MINUTE / 60)));
    bucket.tokens -= 1;
    return 0;
  }

  function corsHeaders(origin, { preflight = false, privateNetwork = false } = {}) {
    const headers = { 'access-control-allow-origin': origin, vary: 'Origin' };
    if (preflight) {
      headers['access-control-allow-methods'] = 'POST';
      headers['access-control-allow-headers'] = 'content-type, x-aos-annotate-token';
      headers['access-control-max-age'] = '600';
      if (privateNetwork) headers['access-control-allow-private-network'] = 'true';
    }
    return headers;
  }

  function issueToken(key, origin, ttlMs = DEFAULT_TTL_MS) {
    const bound = normalizeOrigin(origin);
    if (!bound) throw new HttpError(400, 'bad_origin', 'origin must be http://127.0.0.1|localhost|[::1]:<1024-65535>');
    const session = store.get(key);
    if (!session) throw new HttpError(404, 'unknown_session', 'unknown session');
    if (session.status === 'ended') throw new HttpError(409, 'ended', 'session already ended');
    const token = crypto.randomBytes(32).toString('base64url');
    const createdAt = now();
    const expiresAt = createdAt + Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ttlMs));
    store.setAnnotateToken(key, { tokenSha256: sha256(token).toString('hex'), origin: bound, createdAt, expiresAt });
    buckets.delete(key);
    return { token, origin: bound, expiresAt };
  }

  function serveScript(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed', code: 'method' }, { allow: 'GET' });
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'cross-origin',
      'x-aos-annotate-version': version
    });
    return res.end(loadClientJs(version));
  }

  async function handleToken(req, res, key) {
    if (req.method !== 'POST') throw new HttpError(405, 'method', 'method not allowed', { allow: 'POST' });
    // Browsers always send Origin or Sec-Fetch-Site; only the CLI sends neither.
    if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) {
      throw new HttpError(403, 'browser_forbidden', 'token issuing is CLI-only');
    }
    const body = parseJsonObject(await readBody(req, MAX_TOKEN_BODY_BYTES));
    if (!body) throw new HttpError(400, 'json', 'invalid JSON body');
    let ttlMs = DEFAULT_TTL_MS;
    if (body.ttlMs !== undefined) {
      if (typeof body.ttlMs !== 'number' || !Number.isFinite(body.ttlMs) || body.ttlMs < MIN_TTL_MS) {
        throw new HttpError(400, 'bad_ttl', 'ttlMs must be a number of at least 1000');
      }
      ttlMs = body.ttlMs;
    }
    const issued = issueToken(key, body.origin, ttlMs);
    const base = `http://${SERVER_HOST}:${req.socket.localPort}`;
    const src = `${base}/annotate.js?v=${encodeURIComponent(version)}`;
    const scriptTag = `<script src="${src}" data-session="${key}" data-token="${issued.token}"></script>`;
    const bookmarklet =
      `javascript:(function(){var s=document.createElement('script');s.src='${src}';` +
      `s.setAttribute('data-session','${key}');s.setAttribute('data-token','${issued.token}');` +
      `document.documentElement.appendChild(s)})()`;
    return sendJson(res, 200, {
      token: issued.token,
      origin: issued.origin,
      expiresAt: new Date(issued.expiresAt).toISOString(),
      scriptTag,
      bookmarklet
    });
  }

  function handlePreflight(req, res, key) {
    const record = store.getAnnotateToken(key);
    const origin = req.headers.origin;
    // An expired token still gets the preflight so the POST can answer 401 token_expired readably.
    if (!record || typeof origin !== 'string' || origin !== record.origin) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ error: 'forbidden', code: 'origin' }));
    }
    const privateNetwork = req.headers['access-control-request-private-network'] === 'true';
    res.writeHead(204, corsHeaders(origin, { preflight: true, privateNetwork }));
    return res.end();
  }

  async function handlePost(req, res, key) {
    const session = store.get(key);
    if (!session) throw new HttpError(404, 'unknown_session', 'unknown session');
    const record = store.getAnnotateToken(key);
    // The bound origin may read every answer (including 401 token errors) so the
    // page can show "link expired"; any other origin gets no CORS headers at all.
    const cors = record && req.headers.origin === record.origin ? corsHeaders(record.origin) : {};
    try {
      const header = req.headers['x-aos-annotate-token'];
      if (typeof header !== 'string' || header.length === 0) throw new HttpError(401, 'no_token', 'token required');
      // No record means no bound origin to compare, so this stays 401 rather than 403.
      if (!record) throw new HttpError(401, 'token', 'invalid token');
      if (now() >= record.expiresAt) throw new HttpError(401, 'token_expired', 'token expired');
      if (req.headers.origin !== record.origin) throw new HttpError(403, 'origin', 'origin not allowed');
      if (header.length > MAX_TOKEN_HEADER) throw new HttpError(401, 'token', 'invalid token');
      const expected = Buffer.from(String(record.tokenSha256), 'hex');
      const presented = sha256(header);
      if (expected.length !== presented.length || !crypto.timingSafeEqual(expected, presented)) {
        throw new HttpError(401, 'token', 'invalid token');
      }
      const retryAfter = takeRate(key);
      if (retryAfter) throw new HttpError(429, 'rate', 'too many requests', { 'retry-after': String(retryAfter) });
      if (!isJsonContentType(req.headers['content-type'])) {
        throw new HttpError(415, 'content_type', 'content-type must be application/json');
      }
      const body = parseJsonObject(await readBody(req, MAX_BODY_BYTES));
      if (!body) throw new HttpError(400, 'json', 'invalid JSON body');
      const items = Object.hasOwn(body, 'items') ? body.items : undefined;
      if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS_PER_POST) {
        throw new HttpError(400, 'items', `items must be an array of 1-${MAX_ITEMS_PER_POST}`);
      }
      if (session.status === 'ended') throw new HttpError(409, 'ended', 'session already ended');
      if (session.pendingFeedback.length + items.length > MAX_PENDING) {
        throw new HttpError(429, 'queue_full', 'too many pending annotations; the agent has not picked them up');
      }
      const result = store.queueFeedback(key, items, { origin: 'app', boundOrigin: record.origin });
      if (!result) throw new HttpError(409, 'ended', 'session already ended');
      onQueued(key);
      return sendJson(
        res,
        200,
        { status: 'queued', accepted: result.accepted.length, rejected: result.rejected, pending: result.pending },
        cors
      );
    } catch (error) {
      if (error instanceof HttpError) error.headers = { ...cors, ...error.headers };
      throw error;
    }
  }

  function handles(pathname) {
    return pathname === '/annotate.js' || (typeof pathname === 'string' && pathname.startsWith('/api/annotate/'));
  }

  async function handle(req, res, url) {
    try {
      if (url.pathname === '/annotate.js') return serveScript(req, res);
      const match = ROUTE_RE.exec(url.pathname);
      if (!match || !KEY_RE.test(match[1])) throw new HttpError(404, 'not_found', 'not found');
      const [, key, tokenSuffix] = match;
      if (tokenSuffix) return await handleToken(req, res, key);
      if (req.method === 'OPTIONS') return handlePreflight(req, res, key);
      if (req.method === 'POST') return await handlePost(req, res, key);
      throw new HttpError(405, 'method', 'method not allowed', { allow: 'POST, OPTIONS' });
    } catch (error) {
      if (res.headersSent) return res.end();
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message, code: error.code }, error.headers);
        if (error.status === 413) res.once('finish', () => req.destroy());
        return undefined;
      }
      log(`[plan-canvas] annotate error: ${error && error.message}`);
      return sendJson(res, 500, { error: 'internal error', code: 'internal' });
    }
  }

  return { handles, handle, issueToken };
}

module.exports = { MAX_BODY_BYTES, MAX_ITEMS_PER_POST, MAX_PENDING, RATE_PER_MINUTE, createAnnotateHandler };
