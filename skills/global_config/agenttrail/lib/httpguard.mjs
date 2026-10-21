// Transport hardening for the hub. Every comparison here is exact: a regex that
// "looks right" is how a Host or Origin allowlist turns into a bypass.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { embedAncestors, frameAncestors } from '../../plan-canvas/scripts/lib/loopback-guard.js'

export { embedAncestors }

export const MAX_BODY_BYTES = 16 * 1024

export function buildCsp(env = process.env, extra = []) {
  return ["default-src 'self'", "script-src 'self'", ...extra, frameAncestors(embedAncestors(env)), "base-uri 'none'", "form-action 'none'"].join('; ')
}

export function csrfToken() {
  return crypto.randomBytes(24).toString('base64url')
}

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i

// *.localhost never resolves publicly in browsers, so a named loopback Host is rebinding-safe.
function localhostName(hostname) {
  const labels = hostname.split('.')
  return labels.length >= 2 && labels[labels.length - 1].toLowerCase() === 'localhost' && labels.every((l) => LABEL.test(l))
}

export function hostOk(host, port, { click = false } = {}) {
  if (typeof host !== 'string' || host === '') return false
  const allowed = click ? [`localhost:${port}`] : [`localhost:${port}`, `127.0.0.1:${port}`]
  if (allowed.includes(host)) return true
  const suffix = `:${port}`
  return !click && host.endsWith(suffix) && localhostName(host.slice(0, -suffix.length))
}

export function originOk(origin, port) {
  return typeof origin === 'string' && origin === `http://localhost:${port}`
}

export function sameOriginFetchSite(headers) {
  const site = headers['sec-fetch-site']
  if (site === undefined) return true
  return site === 'same-origin'
}

export function contentTypeOk(req) {
  return req.headers['content-type'] === 'application/json'
}

export function csrfOk(headers, token) {
  return typeof headers['x-trail-csrf'] === 'string' && headers['x-trail-csrf'] === token
}

export function securityHeaders(res, env = process.env, extraCsp = []) {
  const ancestors = embedAncestors(env)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', buildCsp(env, extraCsp))
  if (ancestors.length === 0) {
    res.setHeader('X-Frame-Options', 'DENY')
  }
}

export function readJson(req, res, { maxBytes = MAX_BODY_BYTES } = {}) {
  if (!contentTypeOk(req)) {
    res.writeHead(415).end()
    return Promise.resolve({ ok: false, status: 415 })
  }
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let done = false
    const finish = (value) => { if (!done) { done = true; resolve(value) } }
    req.on('data', (chunk) => {
      if (done) return
      size += chunk.length
      if (size > maxBytes) {
        res.writeHead(413).end()
        finish({ ok: false, status: 413 })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      let value
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
        res.writeHead(400).end()
        finish({ ok: false, status: 400 })
        return
      }
      finish({ ok: true, value })
    })
    req.on('error', () => finish({ ok: false, status: 400 }))
  })
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']
const TAURI_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']

// Read-only CORS: default allowlist is loopback origins only; `extra` are exact origins, '*' allows any.
export function corsOriginAllowed(origin, extra = []) {
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return false
  if (extra.includes('*') || extra.includes(origin)) return true
  if (TAURI_ORIGINS.includes(origin)) return true
  let u
  try { u = new URL(origin) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password || u.origin !== origin) return false
  return LOOPBACK_HOSTS.includes(u.hostname) || localhostName(u.hostname)
}

// Env (comma list) beats the file; a bad file logs one line and falls back to defaults.
export function loadCorsOrigins(env = process.env, file = path.join(os.homedir(), '.aos', 'agenttrail.json'), log = console.error) {
  if (typeof env.AOS_TRAIL_CORS_ORIGINS === 'string') return env.AOS_TRAIL_CORS_ORIGINS.split(',').map((x) => x.trim()).filter(Boolean)
  let raw
  try { raw = fs.readFileSync(file, 'utf8') } catch { return [] }
  try {
    const list = JSON.parse(raw).corsOrigins
    if (list === undefined) return []
    if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) throw new Error('corsOrigins must be a string array')
    return list
  } catch (e) {
    log(`agenttrail: ignoring ${file}: ${e.message}`)
    return []
  }
}

// Returns true when the request was fully handled (preflight or rejected preflight).
export function corsRead(req, res, extra, port) {
  if (!hostOk(req.headers.host, port)) { res.writeHead(403).end(); return true }
  const origin = req.headers.origin
  const ok = origin !== undefined && corsOriginAllowed(origin, extra)
  if (req.method === 'OPTIONS') {
    if (!ok) { res.writeHead(403).end(); return true }
    res.writeHead(204, {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET',
      'access-control-allow-headers': 'cache-control, last-event-id, accept',
      'access-control-max-age': '600',
      vary: 'Origin',
    }).end()
    return true
  }
  res.setHeader('Vary', 'Origin')
  if (ok) res.setHeader('Access-Control-Allow-Origin', origin)
  return false
}
