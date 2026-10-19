// Side panel data and decisions for the map server: GO requests, sessions, gate modes.
// Reads the gate through gatepanel.mjs (read-only). The only write is a decision receipt
// (<home>/.aos/go/<key>.local-<id>.json) that the gate itself validates: this module decides nothing.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadGate, panel } from './gatepanel.mjs'
import { readA2aRegistry } from './sessions.mjs'

export const RECEIPT_TTL_MS = 10 * 60 * 1000
export const REQUEST_MAX_AGE_MS = 10 * 60 * 1000
const STALE_MS = 5 * 60 * 1000
export const GRANT_MS = { '15m': 15 * 60 * 1000, session: 2 * 60 * 60 * 1000 }
export const BROAD_SCOPES = ['destructive', 'push-main']
// A map click never approves these, once or as a grant: they need a typed GO in the terminal.
const NEVER_CLICK = ['destructive', 'push-main', 'publish']
const KEY_RE = /^[a-z0-9._-]{1,128}$/
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export class DecisionError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status }
}

export const roleOf = (name) => (/master/i.test(name) ? 'master' : /orchestr|mgmt|manager|cloud/i.test(name) ? 'orchestrator' : 'worker')
export const riskOf = (r) => {
  const sc = r.scopes || []
  if (r.hard) return 'hard'
  if (sc.some((s) => BROAD_SCOPES.includes(s))) return 'destructive'
  if (sc.includes('publish')) return 'publish'
  if (sc.some((s) => /push|merge/.test(s))) return 'push'
  return sc[0] || 'command'
}

const goDir = (home) => path.join(home, '.aos', 'go')

async function gateOf(gateMod) { return gateMod === undefined ? loadGate() : gateMod }

export async function sideModel({ now = Date.now(), home = os.homedir(), gateMod, dismissed = new Set(), registry } = {}) {
  const mod = await gateOf(gateMod)
  const g = await panel({ now, gate: mod || undefined })
  const reg = registry || readA2aRegistry(path.join(home, '.aos', 'sessions'))
  const nameByKey = new Map()
  for (const r of g.requests) if (r.sessionName) nameByKey.set(r.sessionKey, r.sessionName)
  const sessions = reg.map((s) => {
    let seen = 0
    try { seen = fs.statSync(path.join(home, '.aos', 'sessions', `${s.name}.json`)).mtimeMs } catch { /* no file */ }
    return { name: s.name, role: roleOf(s.name), harness: s.harness, cwd: s.cwd, status: s.alive ? 'working' : 'idle', lastSeen: seen || null }
  })
  return {
    available: g.available,
    requests: g.requests.filter((r) => !dismissed.has(r.id)).map((r) => ({
      id: r.id, sessionKey: r.sessionKey, session: r.sessionName || nameByKey.get(r.sessionKey) || r.sessionKey,
      command: r.command, risk: riskOf(r), scopes: r.scopes, age: now - r.ts, decidable: !r.hard && r.click !== false,
      cmdHash: r.cmdHash,
    })),
    sessions,
    modes: g.modes.map((m) => ({ session: nameByKey.get(m.sessionKey) || m.sessionKey.replace(/^name-/, ''), sessionKey: m.sessionKey, mode: m.mode })),
    grants: g.grants,
    now,
  }
}

// The command hash stays server-side: the page never sees it.
export const publicModel = (m) => ({ ...m, requests: m.requests.map(({ cmdHash, ...r }) => r) })

function writeNew(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
  try { fs.linkSync(tmp, file) } catch (e) {
    throw new DecisionError(e && e.code === 'EEXIST' ? 'request-decided' : 'write-failed', e && e.code === 'EEXIST' ? 409 : 500)
  } finally { try { fs.unlinkSync(tmp) } catch { /* gone */ } }
}

// The gate scans at most 32 receipts per key and deletes nothing, so stale ones are pruned here.
export function pruneStale(key, { now = Date.now(), home = os.homedir() } = {}) {
  const dir = goDir(home)
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.startsWith(`${key}.local-`)) } catch { return 0 }
  let gone = 0
  for (const n of names) {
    try {
      const f = path.join(dir, n)
      let stale = false
      if (n.endsWith('.json.used')) stale = fs.statSync(f).mtimeMs < now - 30 * 60 * 1000
      else if (n.endsWith('.json')) {
        let exp = NaN
        try { exp = JSON.parse(fs.readFileSync(f, 'utf8')).payload.expires_at } catch { /* unreadable */ }
        stale = Number.isFinite(exp) ? exp < now - STALE_MS : fs.statSync(f).mtimeMs < now - STALE_MS
      }
      if (stale) { fs.unlinkSync(f); gone += 1 }
    } catch { /* raced or gone */ }
  }
  return gone
}

// input: { id, decision: 'approve'|'deny', scope: 'once'|'15m'|'session' }
export async function decide(input, { now = Date.now(), home = os.homedir(), gateMod, dismissed } = {}) {
  if (!input || typeof input.id !== 'string' || !ID_RE.test(input.id)) throw new DecisionError('bad-request-id')
  const r = (await sideModel({ now, home, gateMod })).requests.find((x) => x.id === input.id)
  if (!r) throw new DecisionError('unknown-request', 404)
  if (input.decision === 'deny') { dismissed?.add(r.id); return { ok: true, decision: 'deny' } }
  if (input.decision !== 'approve') throw new DecisionError('bad-decision')
  if (!r.decidable) throw new DecisionError('request-hard', 403)
  if (!KEY_RE.test(r.sessionKey) || !r.cmdHash) throw new DecisionError('request-unbound', 409)
  if (r.age < 0) throw new DecisionError('request-future', 409)
  if (r.age > REQUEST_MAX_AGE_MS) throw new DecisionError('request-stale', 409)
  const scopes = [...new Set(r.scopes || [])].sort()
  if (!scopes.length || scopes.some((s) => NEVER_CLICK.includes(s))) throw new DecisionError('broad-needs-terminal', 403)
  const scope = input.scope || 'once'
  if (scope !== 'once' && !GRANT_MS[scope]) throw new DecisionError('bad-scope')
  const dir = goDir(home)
  pruneStale(r.sessionKey, { now, home })
  const once = path.join(dir, `${r.sessionKey}.local-${r.id}.json`)
  const grant = path.join(dir, `${r.sessionKey}.local-g-${r.id}.json`)
  if (fs.existsSync(once) || fs.existsSync(grant)) throw new DecisionError('request-decided', 409)
  if (scope === 'once') {
    const p = { v: 1, kind: 'go', request_id: r.id, session_key: r.sessionKey, cmd_hash: r.cmdHash, scopes: r.scopes, ms: 0, issued_at: now, expires_at: now + RECEIPT_TTL_MS, nonce: crypto.randomBytes(16).toString('hex') }
    writeNew(once, { payload: p, via: 'map-click' })
    return { ok: true, decision: 'approve', scope, expiresAt: p.expires_at }
  }
  const ms = GRANT_MS[scope]
  const p = { v: 1, kind: 'grant', request_id: r.id, session_key: r.sessionKey, cmd_hash: '', scopes, ms, issued_at: now, expires_at: now + ms, nonce: crypto.randomBytes(16).toString('hex') }
  writeNew(grant, { payload: p, via: 'map-click' })
  return { ok: true, decision: 'approve', scope, expiresAt: p.expires_at }
}
