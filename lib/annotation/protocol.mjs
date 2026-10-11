'use strict';
// WP7 — agent protocol under /aos-api (node http style, no framework).
// Read-only collect + idempotent reply only. Negative allowlist: any other
// route returns 404. Same-origin only, no CORS headers, logs omit query.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { queryHasToken } from './guard.mjs';

const __req = createRequire(import.meta.url);
const MODEL_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/global_config/plan-canvas/scripts/lib/plan-canvas/annotation-model.js');
const model = __req(MODEL_PATH);

export const MAX_BODY = 32768;
export const RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60 * 1000;
const COOKIE_NAME = 'aos_ann';

const hits = new Map(); // ip -> number[]

export function resetRateLimit() { hits.clear(); }

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_LIMIT;
}

function tokenOk(presented, tokenSha) {
  if (typeof presented !== 'string' || !tokenSha) return false;
  try {
    const a = Buffer.from(crypto.createHash('sha256').update(presented).digest('hex'));
    const b = Buffer.from(String(tokenSha));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
export function shaToken(t) {
  return crypto.createHash('sha256').update(String(t ?? '')).digest('hex');
}

function parseCookies(header) {
  const out = new Map();
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim();
    if (k && v && !out.has(k)) out.set(k, v);
  }
  return out;
}

function log(method, pathname) {
  // query strings never logged
  process.stdout.write(`[aos-api] ${method} ${pathname}\n`);
}

function send(res, status, obj, extra = {}) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(body);
}

function readBody(req, cap = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (!Number.isFinite(declared) || declared < 0 || declared > cap) {
      const e = new Error('body cap'); e.code = 'E_BODY'; req.resume(); reject(e); return;
    }
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) { const e = new Error('body cap'); e.code = 'E_BODY'; reject(e); try { req.destroy(); } catch {} return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function checkGuard(req, { port, tokenSha }) {
  const host = String(req.headers.host ?? '');
  const okHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  if (!okHost) { const e = new Error('host'); e.code = 'E_HOST'; throw e; }
  const origin = String(req.headers.origin ?? '');
  const okOrigin = origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
  if (!okOrigin) { const e = new Error('origin'); e.code = 'E_ORIGIN'; throw e; }
  // Origin/Host agreement (guard.mjs originHostMatch)
  try {
    const u = new URL(origin);
    if (`${u.hostname}:${port}` !== host) { const e = new Error('mismatch'); e.code = 'E_ORIGIN'; throw e; }
  } catch { const e = new Error('origin'); e.code = 'E_ORIGIN'; throw e; }
  const site = String(req.headers['sec-fetch-site'] ?? 'absent').trim().toLowerCase();
  const method = String(req.method ?? '').toUpperCase();
  if (method === 'POST') {
    if (site !== 'same-origin' && site !== 'absent') { const e = new Error('fetch'); e.code = 'E_FETCH_SITE'; throw e; }
  } else if (site !== 'same-origin' && site !== 'none' && site !== 'absent') {
    const e = new Error('fetch'); e.code = 'E_FETCH_SITE'; throw e;
  }
  if (queryHasToken(req.url)) { const e = new Error('query'); e.code = 'E_QUERY_TOKEN'; throw e; }
  const presented = parseCookies(req.headers.cookie).get(COOKIE_NAME) ?? null;
  if (!presented || !tokenOk(presented, tokenSha)) { const e = new Error('token'); e.code = 'E_TOKEN'; throw e; }
}

// Markdown "copy for AI" exporter (redacted data, labelled unverified, no execution).
export function copyForAi(threads) {
  const list = Array.isArray(threads) ? threads : [];
  const redact = typeof model.redactText === 'function' ? model.redactText : (s) => s;
  return list.map((t) => {
    const anchor = t.anchor || {}; const fp = anchor.fingerprint || {};
    const lines = [
      `note ${t.id} (${t.status}, text_source: app-page (unverified))`,
      anchor.selector ? `selector: ${anchor.selector}` : '',
      fp.tagName ? `tag: ${fp.tagName}` : '',
      `note: ${redact(t.markupText)}`,
      ...(t.replies || []).map((r) => `  reply (${r.authorKind}): ${redact(r.body)}`),
    ];
    return lines.filter(Boolean).join('\n');
  }).join('\n\n');
}

function redactThreadsForCollect(threads) {
  const redact = typeof model.redactText === 'function' ? model.redactText : (s) => s;
  return (Array.isArray(threads) ? threads : []).map((t) => ({
    ...t,
    markupText: redact(t.markupText),
    markup: t.markup ? { ...t.markup, text: typeof t.markup.text === 'string' ? redact(t.markup.text) : t.markup.text } : t.markup,
    replies: (t.replies || []).map((r) => ({ ...r, body: redact(r.body) })),
  }));
}

export function createHandler({ stateDir, port, tokenSha, token } = {}) {
  const sha = tokenSha ?? (token ? shaToken(token) : '');
  return async function handler(req, res) {
    const rawUrl = String(req.url ?? '/');
    const pathname = rawUrl.split('?')[0];
    const method = String(req.method ?? 'GET').toUpperCase();
    log(method, pathname);
    try {
      checkGuard(req, { port, tokenSha: sha });
    } catch (e) {
      return send(res, 403, { error: e.code || 'E_TOKEN' });
    }
    const ip = req.socket?.remoteAddress || 'local';
    if (rateLimited(ip)) return send(res, 429, { error: 'E_RATE' });

    if (method === 'GET' && pathname === '/aos-api/collect') {
      const pageId = new URL(rawUrl, 'http://x').searchParams.get('pageId') || 'default';
      const payload = model.collectPayload(stateDir, pageId);
      payload.threads = redactThreadsForCollect(payload.threads);
      const etag = payload.etag;
      if (req.headers['if-none-match'] && req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag, 'cache-control': 'no-store' });
        return res.end();
      }
      // `await` passthrough: echo back awaited upstream marker if requested
      const out = { ...payload, await: 'passthrough' };
      return send(res, 200, out, { etag });
    }
    if (method === 'POST' && pathname === '/aos-api/reply') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        return send(res, 405, { error: 'E_METHOD' });
      }
      let body;
      try { body = await readBody(req); }
      catch (e) { return send(res, 413, { error: 'E_BODY' }); }
      let input;
      try { input = JSON.parse(body.toString('utf8')); }
      catch { return send(res, 400, { error: 'E_INVALID' }); }
      const pageId = typeof input.pageId === 'string' ? input.pageId : 'default';
      const r = model.appendReply(stateDir, pageId, input);
      if (!r.ok) return send(res, 400, { error: r.reason || 'E_INVALID' });
      return send(res, 200, { ok: true, duplicate: !!r.duplicate, id: r.id ?? r.existingId ?? null, await: 'passthrough' });
    }
    // Negative allowlist: no side-effect or execution endpoints.
    return send(res, 404, { error: 'E_NOT_FOUND' });
  };
}
