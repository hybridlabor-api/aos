// Read-only view of the go-gate's own state. The hub never writes into the gate store:
// every function here only reads, and the gate module is used exactly as its author
// intended — by calling its own effectiveGate().
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import os from 'node:os'

const CONTROL = /[\u0000-\u001f\u007f]/g
const URL_CREDS = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi
const SECRET_FLAG = /(--?(?:password|passwd|token|secret|key|api[-_]?key|auth)\s*[= ]\s*)("[^"]*"|'[^']*'|\S+)/gi
const BEARER = /\b(bearer|basic)\s+\S+/gi
const HEADER_ARG = /(--header|-H)(\s+(?:"[^"]*"|'[^']*'|\S+))?/g

export function scrub(text, max = 200) {
  if (typeof text !== 'string') return ''
  let out = text.replace(CONTROL, '')
  out = out.replace(URL_CREDS, '$1***@')
  out = out.replace(SECRET_FLAG, '$1***')
  out = out.replace(BEARER, '$1 ***')
  out = out.replace(HEADER_ARG, '$1 ***')
  return out.length > max ? out.slice(0, max) : out
}

export function parseLogLine(line) {
  if (typeof line !== 'string') return null
  const m = line.match(/^(\S+)\s+(.*)$/)
  if (!m) return null
  const ts = Date.parse(m[1])
  if (!Number.isFinite(ts)) return null
  const rest = m[2]
  if (rest.startsWith('rejected:')) return { ts, kind: 'reject', text: rest.slice('rejected:'.length).trim() }
  const allow = rest.match(/^(?:grant|off|token):\s*allowed\s+("(?:[^"\\]|\\.)*")\s*$/)
  if (allow) {
    let command = allow[1]
    try { command = JSON.parse(allow[1]) } catch { /* keep the quoted form */ }
    return { ts, kind: 'allow', command: String(command) }
  }
  // "deny[ hard]" and "denied:" share the prefix "den"; the hard marker is captured,
// never sliced by offset.
  const deny = rest.match(/^den(?:y|ied)(\[\s*hard\s*\])?[:\s]+(.*?)\s*"((?:[^"\\]|\\.)*)"\s*::\s*(.*)$/)
  if (deny) return { ts, kind: 'deny', hard: !!deny[1], why: deny[2].trim(), command: deny[3], reason: deny[4].trim() }
  return { ts, kind: 'other', text: rest }
}

export function filterStateKeys(keys) {
  return (keys || []).filter((k) => typeof k === 'string' && !/\.(req|revoke)$/.test(k) && k !== 'trail-credential')
}

export async function loadGate(modPath = process.env.AOS_GOGATE_PATH) {
  const target = modPath || path.join(os.homedir(), '.claude', 'hooks', 'go-gate.mjs')
  try {
    const mod = await import(pathToFileURL(target).href)
    return typeof mod?.listStateKeys === 'function' ? mod : null
  } catch { return null }
}

const safe = (fn, fallback) => { try { return fn() } catch { return fallback } }

const EMPTY = () => ({ available: false, blocks: [], requests: [], grants: [], modes: [], rejected: [], reason: 'gate module not found' })

export async function panel({ now = Date.now(), gate, dir } = {}) {
  if (!gate || typeof gate.listStateKeys !== 'function') return EMPTY()
  const gdir = dir || (typeof gate.gateDir === 'function' ? safe(gate.gateDir, null) : null)
  if (!gdir) return EMPTY()
  const keys = filterStateKeys(safe(() => gate.listStateKeys(), []))
  const ttl = typeof gate.TOKEN_TTL_MS === 'number' ? gate.TOKEN_TTL_MS : 10 * 60 * 1000

  const blocks = []
  const requests = []
  const grants = []
  const modes = []
  const rejected = []

  for (const key of keys) {
    const log = safe(() => fs.readFileSync(path.join(gdir, `${key}.log`), 'utf8'), '')
    const lines = log.split('\n').filter(Boolean).map(parseLogLine).filter(Boolean)

    for (const l of lines) {
      if (l.kind !== 'deny') continue
      blocks.push({
        sessionKey: key,
        ts: l.ts,
        command: scrub(l.command),
        why: scrub(l.why || ''),
        reason: scrub(l.reason || ''),
        hard: l.hard,
        click: false,
        source: 'log',
      })
    }

    const marker = safe(() => JSON.parse(fs.readFileSync(path.join(gdir, `${key}.block`), 'utf8')), null)
    if (marker && Number.isFinite(Date.parse(marker.ts))) {
      blocks.push({ sessionKey: key, ts: Date.parse(marker.ts), command: '', why: 'blocked recently', reason: '', hard: false, click: false, source: 'block-marker' })
    }

    const rec = safe(() => JSON.parse(fs.readFileSync(path.join(gdir, `${key}.req.json`), 'utf8')), null)
    for (const r of (Array.isArray(rec) ? rec : rec ? [rec] : [])) {
      if (!r || !r.id) continue
      const ts = Date.parse(r.ts)
      if (!Number.isFinite(ts)) continue
      const allowedLater = lines.some((l) => l.kind === 'allow' && l.ts > ts && (
        (l.command && l.command === r.cmd_preview) ||
        (r.cmd_hash && typeof gate.textHash === 'function' && gate.textHash(l.command) === r.cmd_hash)
      ))
      if (allowedLater) continue
      if (!(now < ts + ttl)) continue // older than a GO token: the decision was made elsewhere
      requests.push({
        id: r.id,
        sessionKey: r.session_key || key,
        sessionName: r.session_name || '',
        cwd: r.cwd || '',
        ts,
        command: scrub(r.cmd_preview || ''),
        cmdHash: r.cmd_hash || '',
        scopes: Array.isArray(r.scopes) ? r.scopes : [],
        hard: !!r.hard,
        click: !r.hard,
        age: now - ts,
      })
    }

    const state = safe(() => gate.readState(key), null) || {}
    const source = typeof state.transcript === 'string' ? state.transcript : ''
    const cmds = source ? safe(() => gate.gogateCommandsFor(source), []) : []
    const eff = safe(() => gate.effectiveGate(key, { source, cmds, opencode: source.startsWith('opencode:') }, now), { mode: 'soft', grants: [], rejected: [] })
    modes.push({ sessionKey: key, mode: eff.mode })
    for (const g of (Array.isArray(eff.grants) ? eff.grants : [])) {
      if (!Number.isFinite(g.until) || !(now < g.until)) continue
      grants.push({
        sessionKey: key,
        scope: g.scope,
        until: new Date(g.until).toISOString(),
        minutesLeft: Math.ceil((g.until - now) / 60000),
        session: !!g.session,
      })
    }
    for (const r of (Array.isArray(eff.rejected) ? eff.rejected : [])) rejected.push(`${key}: ${r}`)
  }

  return { available: true, blocks, requests, grants, modes, rejected }
}