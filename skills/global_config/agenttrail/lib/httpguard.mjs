// Transport hardening for the hub. Every comparison here is exact: a regex that
// "looks right" is how a Host or Origin allowlist turns into a bypass.
import crypto from 'node:crypto'
import { embedAncestors, frameAncestors } from '../../plan-canvas/scripts/lib/loopback-guard.js'

export { embedAncestors }

export const MAX_BODY_BYTES = 16 * 1024

export function buildCsp(env = process.env, extra = []) {
  return ["default-src 'self'", "script-src 'self'", ...extra, frameAncestors(embedAncestors(env)), "base-uri 'none'", "form-action 'none'"].join('; ')
}

export function csrfToken() {
  return crypto.randomBytes(24).toString('base64url')
}

export function hostOk(host, port, { click = false } = {}) {
  if (typeof host !== 'string' || host === '') return false
  const allowed = click ? [`localhost:${port}`] : [`localhost:${port}`, `127.0.0.1:${port}`]
  return allowed.includes(host)
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