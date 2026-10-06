#!/usr/bin/env node
// The trail hub: one daemon, one port, every repo and worktree behind it.
// It observes only — it never edits a plan file, never writes the gate store,
// and never runs an agent. Bind 127.0.0.1; nothing here is reachable off-box.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { validateEvent, fromLegacyHook, MAX_BODY_BYTES } from '../lib/events.mjs'
import { SessionTable, readA2aRegistry } from '../lib/sessions.mjs'
import { buildModel } from '../lib/hub-model.mjs'
import { panel as gatePanel, loadGate } from '../lib/gatepanel.mjs'
import { csrfToken } from '../lib/httpguard.mjs'
import { loadConfig } from '../lib/stale.mjs'
import { STATE_DIR, loadRepos, registerRepo, loadState } from '../lib/hub-state.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(__dirname, '..', 'public', 'hub')
const PROTOCOL = 3
const VERSION = '0.3.0'

const argv = process.argv.slice(2)
let port = Number(process.env.AGENTTRAIL_PORT) || 5350
let openBrowser = false
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--port') port = Number(argv[++i]) || port
  else if (argv[i] === '--open') openBrowser = true
}

const cfg = loadConfig(STATE_DIR())
const sessionTable = new SessionTable()
const clients = new Set()
const rejected = { invalid: 0, legacy: 0, foreignOrigin: 0 }
const startedAt = Date.now()

// Events decide which repos exist: any cwd inside a git repo registers it.
const known = () => {
  const map = new Map()
  for (const r of loadRepos()) map.set(r.root, r)
  return map
}

function registerFromEvent(cwd) {
  if (!cwd || typeof cwd !== 'string') return
  const map = known()
  if ([...map.keys()].some((r) => cwd === r || cwd.startsWith(`${r}/`))) return
  const dir = STATE_DIR()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  registerRepo(cwd, { dir })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

const hostOk = (host) => host === `localhost:${port}` || host === `127.0.0.1:${port}`
const clickRoute = (url) => url.startsWith('/v1/gate/')

function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
}

// CSRF token: delivered only in the same-origin HTML, required on every write.
const CSRF = csrfToken()

function readJson(req, res, { maxBytes = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    req.on('data', (c) => {
      if (done) return
      size += c.length
      if (size > maxBytes) { res.writeHead(413).end(); finish({ ok: false, status: 413 }); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (done) return
      try { finish({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) } catch { res.writeHead(400).end(); finish({ ok: false, status: 400 }) }
    })
    req.on('error', () => finish({ ok: false, status: 400 }))
  })
}

let modelCache = null
let modelCacheAt = 0
const MODEL_TTL_MS = 700

async function buildNow() {
  const gateMod = await loadGate()
  const gate = await gatePanel({ gate: gateMod, dir: gateMod ? undefined : null })
  const state = loadState()
  const a2a = readA2aRegistry(path.join(os.homedir(), '.aos', 'sessions'))
  for (const a of a2a) {
    if (!sessionTable.byId(a.name)) {
      const s = sessionTable.apply({ v: 1, ts: new Date().toISOString(), agent: a.harness, session: { id: a.name }, cwd: a.cwd, kind: a.alive ? 'note' : 'session.end' })
      if (s) s.fromRegistry = true
    }
  }
  return buildModel({ now: Date.now(), port, sessionTable, gate, asks: [], repos: [...known().values()], pinnedKeys: state.pinned, cfg })
}

// A board is not a transaction: git and the gate store are re-read, not re-queried
// per click. A short TTL keeps /v1/model inside its latency budget; events drop the
// cache so a new event shows up immediately.
async function currentModel({ fresh = false } = {}) {
  if (!fresh && modelCache && Date.now() - modelCacheAt < MODEL_TTL_MS) return modelCache
  modelCache = await buildNow()
  modelCacheAt = Date.now()
  return modelCache
}

function broadcast() {
  currentModel({ fresh: true }).then((m) => {
    const payload = `data: ${JSON.stringify(m)}\n\n`
    for (const res of clients) { try { res.write(payload) } catch { clients.delete(res) } }
  }).catch(() => { /* the model is rebuilt on the next tick */ })
}

const tick = setInterval(broadcast, 2000)
tick.unref()

async function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  const file = path.join(PUBLIC, rel)
  if (!file.startsWith(PUBLIC)) { res.writeHead(404).end(); return }
  let data = null
  try { data = fs.readFileSync(file) } catch { data = null }
  if (!data) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return }
  const type = MIME[path.extname(file)] || 'application/octet-stream'
  // The CSRF token reaches the page here and nowhere else.
  if (rel === 'index.html') res.writeHead(200, { 'content-type': type }).end(data.toString('utf8').replace('__TRAIL_CSRF__', CSRF))
  else res.writeHead(200, { 'content-type': type }).end(data)
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res)
  const urlPath = (req.url || '/').split('?')[0]

  if (req.method === 'OPTIONS') { res.writeHead(405).end(); return }
  if (!hostOk(req.headers.host)) { res.writeHead(421).end(); return }

  const origin = req.headers.origin
  // Telemetry may come from any local caller, but never from a page on another origin.
  if (origin && /^https?:/i.test(origin) && origin !== `http://localhost:${port}`) {
    rejected.foreignOrigin += 1
    res.writeHead(403).end()
    return
  }
  if (clickRoute(urlPath)) { res.writeHead(404).end(); return }

  try {
    if (req.method === 'GET' && urlPath === '/whoami') {
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ name: 'agenttrail-hub', protocol: PROTOCOL, port, version: VERSION, startedAt: new Date(startedAt).toISOString() }))
      return
    }

    if (req.method === 'GET' && urlPath === '/v1/model') {
      const fresh = (req.url || '').includes('fresh')
      const m = await currentModel({ fresh })
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(m))
      return
    }

    if (req.method === 'GET' && urlPath === '/v1/stats') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ rejected, sessions: sessionTable.sessions.size, clients: clients.size }))
      return
    }

    if (req.method === 'GET' && urlPath === '/v1/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': connected\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }

    if (req.method === 'POST' && urlPath === '/v1/events') {
      if (req.headers['content-type'] !== 'application/json') { res.writeHead(415).end(); return }
      const body = await readJson(req, res)
      if (!body.ok) return
      const incoming = Array.isArray(body.value) ? body.value : [body.value]
      let accepted = 0
      for (const raw of incoming) {
        const r = validateEvent(raw)
        if (!r.ok) { rejected.invalid += 1; continue }
        registerFromEvent(r.value.cwd)
        sessionTable.apply(r.value)
        accepted += 1
      }
      if (!incoming.length) rejected.invalid += 1
      res.writeHead(accepted ? 204 : 400, accepted ? {} : { 'content-type': 'application/json' })
        .end(accepted ? undefined : JSON.stringify({ error: 'no valid event in request' }))
      if (accepted) broadcast()
      return
    }

    if (req.method === 'POST' && urlPath === '/hook') {
      if (req.headers['content-type'] !== 'application/json') { res.writeHead(415).end(); return }
      const body = await readJson(req, res)
      if (!body.ok) return
      const payloads = Array.isArray(body.value) ? body.value : [body.value]
      for (const p of payloads) {
        const ev = fromLegacyHook(p)
        if (!ev) { rejected.legacy += 1; continue }
        registerFromEvent(ev.cwd)
        sessionTable.apply(ev)
      }
      // Always 204: a hook relay must never see an error for an event we simply
      // do not use. Unknown names are counted, not rejected.
      res.writeHead(204).end()
      broadcast()
      return
    }

    if (req.method === 'POST' && urlPath === '/v1/repos') {
      if (req.headers['x-trail-csrf'] !== CSRF) { res.writeHead(403).end(); return }
      const body = await readJson(req, res)
      if (!body.ok) return
      const root = body.value && body.value.root
      if (!root || typeof root !== 'string' || !root.startsWith('/')) { res.writeHead(400).end(); return }
      try { registerRepo(root, { planHint: body.value.planHint || null }); res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true })) } catch { res.writeHead(400).end() }
      return
    }

    if (req.method === 'GET') { await serveStatic(req, res, urlPath); return }
    res.writeHead(405).end()
  } catch (e) {
    try { res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String((e && e.message) || e).slice(0, 200) })) } catch { /* the socket is gone */ }
  }
})

const repos = () => loadRepos()

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearInterval(tick); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500).unref() })

server.on('error', async (e) => {
  if (e.code === 'EADDRINUSE') {
    // Reuse only if what holds the port is another hub; never kill anything.
    const live = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/whoami', timeout: 500 }, (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => resolve(body))
      })
      req.on('error', () => resolve(null))
      req.on('timeout', () => { req.destroy(); resolve(null) })
    })
    let who = null
    try { who = JSON.parse(live || 'null') } catch { who = null }
    if (who && who.name === 'agenttrail-hub') {
      console.log(`agenttrail-hub is already running · http://localhost:${port}`)
      process.exit(0)
    }
    console.error(`port ${port} is taken by something that is not the trail hub (${who ? who.name || 'unknown' : 'no answer'}); not touching it — pass --port <other>`)
    process.exit(1)
  }
  console.error('trail hub could not start:', e.message)
  process.exit(1)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`agenttrail-hub · http://localhost:${port} · ${repos().length ? 'watching known repos' : 'waiting for events'}`)
  if (openBrowser) import('node:child_process').then((cp) => cp.spawn('open', [`http://localhost:${port}`], { stdio: 'ignore', shell: false }).unref()).catch(() => {})
})

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearInterval(tick); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500).unref() })