'use strict';
// HTTP guard for the hub: exact Host, exact Origin, Sec-Fetch-Site with the
// plan-canvas exemptions, mutation rules (POST + JSON + token + confirm +
// 8 KB body), single-flight locks, static security headers.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';

// The repo nests skills under global_config/; an install (~/.agents) keeps them flat.
const guardLib = ['../../skills/plan-canvas/scripts/lib/loopback-guard.js', '../../skills/global_config/plan-canvas/scripts/lib/loopback-guard.js']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!guardLib) throw new Error('AOS Hub: plan-canvas loopback-guard.js not found (skill plan-canvas missing from the install)');
const { embedAncestors, isEmbedNavigation } = await import(guardLib.href);

export { embedAncestors, isEmbedNavigation };

export const MAX_BODY = 8192;

export function buildCsp(env = process.env) {
  const ancestors = embedAncestors(env);
  const frameAncestors = ancestors.length > 0
    ? `frame-ancestors 'self' ${ancestors.join(' ')}`
    : "frame-ancestors 'none'";
  return `default-src 'self'; style-src 'self'; script-src 'self'; ${frameAncestors}; object-src 'none'; base-uri 'none'; form-action 'none'`;
}

export const CSP = buildCsp();

export function securityHeaders(env = process.env) {
  return {
    'content-security-policy': buildCsp(env),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  };
}

export function send(res, status, body, type = 'application/json') {
  // Never crash or double-respond on an already-gone socket; every request
  // path must end in exactly one send().
  if (!res || res.writableEnded || res.destroyed) return;
  const headers = { ...securityHeaders(), 'content-type': type };
  try {
    res.writeHead(status, headers);
    res.end(type === 'application/json' && typeof body !== 'string' ? JSON.stringify(body) : body);
  } catch { /* socket already gone */ }
}

// Exact host:port check (stronger than loopback-guard's hostname-only check).
export function hostOk(hostHeader, port) {
  return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
}

// Origin absent is fine; when present it must be exactly the hub's own origin.
export function originOk(originHeader, port) {
  if (originHeader === undefined || originHeader === null || originHeader === '') return true;
  return originHeader === `http://127.0.0.1:${port}` || originHeader === `http://localhost:${port}`;
}

function fetchSite(value) {
  if (value === undefined || value === null || value === '') return 'absent';
  return String(value).trim().toLowerCase();
}

// plan-canvas exemptions: static reads and top-level navigations only.
export function fetchSiteOk({ method, path, site, mode, dest }, env = process.env) {
  const site_ = fetchSite(site);
  if (site_ === 'same-origin' || site_ === 'none' || site_ === 'absent') return true;
  if (site_ !== 'same-site' && site_ !== 'cross-site') return false;
  if (method !== 'GET') return false;
  if (path === '/' && mode === 'navigate' && dest === 'document') return true;
  if (path === '/' && isEmbedNavigation({ 'sec-fetch-dest': dest, 'sec-fetch-mode': mode }) && embedAncestors(env).length > 0) return true;
  if (site_ === 'same-site' && (path === '/canvas' || path.startsWith('/canvas/')) && isEmbedNavigation({ 'sec-fetch-dest': dest, 'sec-fetch-mode': mode }) && embedAncestors(env).length > 0) return true;
  if ((path === '/ao-embed-bridge.js' || path.startsWith('/ui/')) && (mode === 'no-cors' || mode === 'navigate')) return true;
  return false;
}

// The presented token is hashed, then compared with timingSafeEqual against
// the stored sha256 digest of the process token.
export function tokenOk(given, wantSha256Hex) {
  const digest = createHash('sha256').update(String(given ?? '')).digest();
  const want = Buffer.from(wantSha256Hex, 'hex');
  return digest.length === want.length && timingSafeEqual(digest, want);
}

export function newToken() {
  return randomBytes(32).toString('hex');
}

export function shaToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

// One running action per lock name; a second request gets 409 busy.
export class FlightLock {
  constructor() { this.running = new Map(); }
  tryLock(name) {
    if (this.running.has(name)) return false;
    this.running.set(name, true);
    return true;
  }
  release(name) {
    this.running.delete(name);
  }
  // Returns false synchronously when busy, else a promise for fn's result (the lock is released when it settles).
  run(name, fn) {
    if (!this.tryLock(name)) return false;
    return Promise.resolve().then(fn).finally(() => this.release(name));
  }
  has(name) { return this.running.has(name); }
}

// Typed confirm: either a literal value (e.g. 'hub') or a field name
// ('id'|'name'), in which case body.confirm must repeat the referenced
// body field (i.e. {id, confirm: id}).
export function confirmOk(body, confirmField) {
  if (!body || typeof body !== 'object') return false;
  if (confirmField === 'id' || confirmField === 'name') {
    const target = body[confirmField];
    return typeof target === 'string' && target !== '' && body.confirm === target;
  }
  return body.confirm === confirmField;
}

export function contentTypeJson(req) {
  const ct = String(req.headers['content-type'] || '');
  return /^\s*application\/json\s*(?:;.*)?$/i.test(ct);
}