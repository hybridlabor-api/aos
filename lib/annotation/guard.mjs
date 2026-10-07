'use strict';
// WP2 — annotation-plan-canvas guard: per-process token, exact Origin + Host
// binding, loopback-only cookie, Sec-Fetch-Site + POST+JSON-only writes,
// body size cap. Pattern reused from lib/hub/guard.mjs; token helpers are
// imported, not copied.
import { hostOk as hubHostOk, contentTypeJson, newToken as hubNewToken, tokenOk as hubTokenOk, shaToken as hubShaToken } from '../hub/guard.mjs';

export const guardErrorCodes = {
  HOST: 'E_HOST',
  ORIGIN: 'E_ORIGIN',
  TOKEN: 'E_TOKEN',
  FETCH_SITE: 'E_FETCH_SITE',
  METHOD: 'E_METHOD',
  BODY: 'E_BODY',
  QUERY_TOKEN: 'E_QUERY_TOKEN',
};

export const COOKIE_NAME = 'aos_ann';
export const MAX_BODY = 32768;
export const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export class GuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
  }
}

// Per-process token: 32 random bytes, hex. Never logged by any caller in this file.
export function newToken() {
  return hubNewToken();
}

// Re-exported Hub guard crypto (constant-time compare over sha256 digests).
export const tokenOk = hubTokenOk;
export const shaToken = hubShaToken;

// Exact host:port. Loopback spellings only, the given port only, no wildcards,
// no suffix matching (DNS-rebinding Hosts fail here). Reused from lib/hub/guard.mjs.
export function hostAllowed(host, port) {
  return Boolean(hubHostOk(String(host ?? ''), port));
}

// Exact allowlisted origin (the canvas/proxy origin on this port, both loopback
// spellings only). No wildcards, no suffix matching, 'null' refused.
export function originAllowed(origin, port) {
  const o = String(origin ?? '');
  return o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`;
}

// Origin and Host must agree exactly: no 127.0.0.1-vs-localhost mismatch.
// origin like 'http://localhost:9091' must match a host 'localhost:9091'.
export function originHostMatch(origin, host, port) {
  const source = new URL(origin);
  return source.hostname + ':' + String(port) === String(host);
}

function fetchSite(value) {
  if (value === undefined || value === null || value === '') return 'absent';
  return String(value).trim().toLowerCase();
}

// Annotation API rule: browser-context requests must be same-origin (or carry
// no fetch-metadata, e.g. curl). same-site / cross-site are always refused.
export function fetchSiteReadOnlyOk(site) {
  const s = fetchSite(site);
  return s === 'same-origin' || s === 'none' || s === 'absent';
}

export function fetchSiteWriteOk(site) {
  const s = fetchSite(site);
  return s === 'same-origin' || s === 'absent';
}

export function parseCookies(header) {
  const out = new Map();
  const text = String(header ?? '');
  for (const part of text.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key || !value) continue;
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

// Cookie name → presented token value, or null.
export function cookieToken(header) {
  const value = parseCookies(header).get(COOKIE_NAME);
  return typeof value === 'string' ? value : null;
}

// Issued only over this process's loopback port: HttpOnly, SameSite=Strict,
// Path scoped to the annotation API, no Domain, no Secure (plain-http loopback).
export function issueCookie(token, ttlSeconds = TOKEN_TTL_SECONDS) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/aos-api; Max-Age=${ttlSeconds}`;
}

// Token presented in the URL is refused even when it would be valid.
const QUERY_TOKEN_KEYS = new Set(['token', 'aos_token', 'auth_token', 'access_token', 'session_token', 't']);

export function queryHasToken(rawUrl) {
  const i = String(rawUrl ?? '').indexOf('?');
  if (i < 0) return false;
  const qs = new URLSearchParams(String(rawUrl ?? '').slice(i + 1));
  for (const key of QUERY_TOKEN_KEYS) {
    if (qs.has(key)) return true;
  }
  return false;
}

// Request body reader with a hard cap; rejects (surface as E_BODY) when the
// declared or received size exceeds it. Reads at most cap bytes.
export function readBody(req, cap = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (!Number.isFinite(declared) || declared < 0 || declared > cap) {
      reject(new GuardError(guardErrorCodes.BODY, `declared body size ${declared} exceeds cap ${cap}`));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > cap) {
        reject(new GuardError(guardErrorCodes.BODY, `body exceeds cap ${cap}`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Orchestrated pure check; throws typed GuardError on every reject path.
export function checkRequest(req, config = {}) {
  const port = config.port;
  const tokenSha = config.tokenSha;
  const wantJsonBody = config.wantJsonBody !== false;
  const headers = req.headers;
  const host = headers.host ?? '';
  if (!hostAllowed(host, port)) throw new GuardError(guardErrorCodes.HOST, `unallowed Host "${host}"`);
  const origin = headers.origin ?? '';
  if (!originAllowed(origin, port)) throw new GuardError(guardErrorCodes.ORIGIN, `unallowed Origin`);
  if (!originHostMatch(origin, host, port)) throw new GuardError(guardErrorCodes.ORIGIN, 'Origin and Host mismatch');
  const site = headers['sec-fetch-site'];
  if (!fetchSiteReadOnlyOk(site)) throw new GuardError(guardErrorCodes.FETCH_SITE, `Sec-Fetch-Site refused`);
  if (queryHasToken(req.url ?? '')) throw new GuardError(guardErrorCodes.QUERY_TOKEN, 'token in query string refused');
  const method = String(req.method ?? '').toUpperCase();
  const presented = cookieToken(headers.cookie);
  if (!presented || !tokenOk(presented, tokenSha)) throw new GuardError(guardErrorCodes.TOKEN, 'missing or invalid token cookie');
  if (method === 'POST') {
    if (!contentTypeJson(req)) throw new GuardError(guardErrorCodes.METHOD, 'writes must be POST with application/json');
    if (!fetchSiteWriteOk(site)) throw new GuardError(guardErrorCodes.FETCH_SITE, 'cross-site writes refused');
  } else if (method !== 'GET') {
    throw new GuardError(guardErrorCodes.METHOD, `method ${method} not allowed`);
  }
}
