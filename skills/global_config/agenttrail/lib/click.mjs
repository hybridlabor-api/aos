// Click path of the hub: WebAuthn enrolment, per-click challenges and receipts.
// The hub never decides anything itself. A receipt is only the signed proof of a
// physical, user-verified click; the go-gate re-verifies it against the pinned public
// key and does not trust this module. No secret exists here: the credential file
// holds a public key only, and nothing in this module logs an assertion or a payload.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const RP_ID = 'localhost'
export const CHALLENGE_TTL_MS = 60 * 1000
export const ENROL_TTL_MS = 5 * 60 * 1000
export const ENROL_TRIES = 3
export const RECEIPT_TTL_MS = 10 * 60 * 1000 // same as the gate's TOKEN_TTL_MS
export const GRANT_CHOICES_MS = [15 * 60 * 1000, 2 * 60 * 60 * 1000, 24 * 60 * 60 * 1000]
const LONG_GRANT_MS = GRANT_CHOICES_MS[2]
export const BROAD_SCOPES = ['destructive', 'push-main']
const MAX_PENDING_CHALLENGES = 64
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Harness markers; best effort, the TTY check is the one that carries weight.
const HARNESS_ENV = ['AOS_ACP_CLIENT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX', 'CODEX_THREAD_ID', 'OPENCODE', 'GEMINI_CLI']

const KEY_RE = /^[a-z0-9._-]{1,128}$/
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const B64U_RE = /^[A-Za-z0-9_-]*$/

export class ClickError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest()
const b64u = (buf) => Buffer.from(buf).toString('base64url')

function fromB64u(value, max = 4096) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !B64U_RE.test(value)) throw new ClickError('bad-encoding')
  return Buffer.from(value, 'base64url')
}

export const stores = (home = os.homedir()) => ({ gate: path.join(home, '.aos', 'gate'), go: path.join(home, '.aos', 'go') })

// Fixed key order: the challenge is a hash of exactly this serialization.
export function canonicalPayload(p) {
  return JSON.stringify({
    v: 1,
    kind: p.kind,
    request_id: p.request_id,
    session_key: p.session_key,
    cmd_hash: p.cmd_hash,
    scopes: p.scopes,
    ms: p.ms,
    issued_at: p.issued_at,
    expires_at: p.expires_at,
    nonce: p.nonce,
  })
}

export const challengeOf = (payload) => b64u(sha256(canonicalPayload(payload)))

export function enrolRefusal({ stdinTTY, stdoutTTY, env }) {
  if (!stdinTTY || !stdoutTTY) return 'enrolment needs your own terminal (stdin and stdout must be a TTY)'
  const found = HARNESS_ENV.find((k) => env && env[k])
  if (found) return `refusing to enrol from inside an agent harness (${found} is set); run it in a plain terminal`
  return null
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

// tmp + rename, 0600. The tmp name is per process and exclusive.
function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
  fs.renameSync(tmp, file)
}

const codeHash = (salt, code) => sha256(`${salt}:${code}`)

// CLI side: writes the pending record. The code goes to the terminal only and is never
// returned by any HTTP route, so an HTTP caller cannot learn it.
export function createEnrolCode({ home, now = Date.now(), replace = false } = {}) {
  const dir = stores(home).gate
  if (!replace && readCredentialFile(dir)) throw new ClickError('already-enrolled', 409)
  let code = ''
  for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
  const salt = crypto.randomBytes(8).toString('hex')
  const expiresAt = now + ENROL_TTL_MS
  writeAtomic(path.join(dir, 'trail-enroll.json'), { v: 1, salt, hash: codeHash(salt, code).toString('hex'), expires_at: expiresAt, tries: 0, used: false, replace: !!replace })
  return { code, expiresAt }
}

function readCredentialFile(dir) {
  const c = readJsonFile(path.join(dir, 'trail-credential.json'))
  if (!c || c.v !== 1 || typeof c.id !== 'string' || !c.publicKey || c.publicKey.kty !== 'EC' || c.publicKey.crv !== 'P-256') return null
  return c
}

export function verifyAssertion({ credential, assertion, expectedChallenge, origin, rpId = RP_ID }) {
  if (!assertion || typeof assertion !== 'object') throw new ClickError('bad-assertion')
  const authData = fromB64u(assertion.authenticatorData)
  const clientDataBuf = fromB64u(assertion.clientDataJSON)
  const signature = fromB64u(assertion.signature)
  if (authData.length < 37) throw new ClickError('bad-authenticator-data')
  let clientData
  try { clientData = JSON.parse(clientDataBuf.toString('utf8')) } catch { throw new ClickError('bad-client-data') }
  if (!clientData || clientData.type !== 'webauthn.get') throw new ClickError('wrong-type', 403)
  if (clientData.challenge !== expectedChallenge) throw new ClickError('challenge-mismatch', 403)
  if (clientData.origin !== origin || clientData.crossOrigin === true) throw new ClickError('wrong-origin', 403)
  if (!crypto.timingSafeEqual(authData.subarray(0, 32), sha256(rpId))) throw new ClickError('wrong-rp', 403)
  const flags = authData[32]
  if (!(flags & 0x01)) throw new ClickError('user-presence-missing', 403)
  if (!(flags & 0x04)) throw new ClickError('user-verification-missing', 403)
  if (assertion.id !== credential.id) throw new ClickError('wrong-credential', 403)
  let ok = false
  try {
    const key = crypto.createPublicKey({ key: credential.publicKey, format: 'jwk' })
    ok = crypto.verify('sha256', Buffer.concat([authData, sha256(clientDataBuf)]), { key, dsaEncoding: 'der' }, signature)
  } catch { ok = false }
  if (!ok) throw new ClickError('bad-signature', 403)
  const signCount = authData.readUInt32BE(33)
  if (signCount !== 0 && signCount < (credential.signCount || 0)) throw new ClickError('counter-regressed', 403)
  return { signCount }
}

// gate: async () => null | { requests[], sessionKeys[], scopes[], maxGrantMs }
export function createClick({ port, home, now = Date.now, gate }) {
  const { gate: gateDir, go: goDir } = stores(home)
  const origin = `http://localhost:${port}`
  const challenges = new Map()
  const decided = new Set()
  let enrol = null

  const credential = () => readCredentialFile(gateDir)
  const pendingFile = path.join(gateDir, 'trail-enroll.json')
  const dropPending = () => { try { fs.unlinkSync(pendingFile) } catch { /* already gone */ } }
  const receiptFile = (key, id) => path.join(goDir, `${key}.click-${id}.json`)

  const isDecided = (key, id) => {
    if (decided.has(id) || fs.existsSync(receiptFile(key, id))) return true
    try { return fs.readFileSync(path.join(goDir, '.consumed'), 'utf8').split('\n').some((l) => l.trim() === id || l.trim() === `click-${id}`) } catch { return false }
  }

  function enrolBegin({ code }) {
    const t = now()
    const pending = readJsonFile(pendingFile)
    if (!pending || pending.v !== 1) throw new ClickError('no-pending-enrolment', 409)
    if (t > pending.expires_at) { dropPending(); throw new ClickError('code-expired', 410) }
    if (pending.used) throw new ClickError('code-used', 403)
    if (pending.tries >= ENROL_TRIES) { dropPending(); throw new ClickError('too-many-tries', 429) }
    if (credential() && !pending.replace) throw new ClickError('already-enrolled', 409)
    const given = typeof code === 'string' ? code.trim().toUpperCase() : ''
    const want = Buffer.from(pending.hash, 'hex')
    const got = codeHash(pending.salt, given)
    if (given.length !== 8 || want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
      pending.tries += 1
      if (pending.tries >= ENROL_TRIES) dropPending()
      else writeAtomic(pendingFile, pending)
      throw new ClickError('wrong-code', 403)
    }
    writeAtomic(pendingFile, { ...pending, used: true })
    const challenge = b64u(crypto.randomBytes(32))
    enrol = { challenge, at: t, replace: !!pending.replace }
    return {
      publicKey: {
        challenge,
        rp: { id: RP_ID, name: 'agenttrail' },
        user: { id: b64u(crypto.randomBytes(16)), name: 'agenttrail', displayName: 'agenttrail' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { userVerification: 'required', residentKey: 'discouraged' },
        attestation: 'none',
        timeout: CHALLENGE_TTL_MS,
      },
    }
  }

  function enrolFinish({ credentialId, clientDataJSON, publicKey }) {
    const e = enrol
    enrol = null
    if (!e) throw new ClickError('no-enrolment-in-progress', 409)
    if (now() - e.at > CHALLENGE_TTL_MS) throw new ClickError('challenge-expired', 410)
    if (credential() && !e.replace) throw new ClickError('already-enrolled', 409)
    let clientData
    try { clientData = JSON.parse(fromB64u(clientDataJSON).toString('utf8')) } catch { throw new ClickError('bad-client-data') }
    if (!clientData || clientData.type !== 'webauthn.create') throw new ClickError('wrong-type', 403)
    if (clientData.challenge !== e.challenge) throw new ClickError('challenge-mismatch', 403)
    if (clientData.origin !== origin || clientData.crossOrigin === true) throw new ClickError('wrong-origin', 403)
    fromB64u(credentialId, 1024)
    let jwk
    try {
      const key = crypto.createPublicKey({ key: fromB64u(publicKey, 1024), format: 'der', type: 'spki' })
      jwk = key.export({ format: 'jwk' })
    } catch { throw new ClickError('bad-public-key') }
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new ClickError('bad-public-key')
    writeAtomic(path.join(gateDir, 'trail-credential.json'), {
      v: 1,
      id: credentialId,
      publicKey: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      signCount: 0,
      created: new Date(now()).toISOString(),
      origin,
    })
    dropPending()
    return { ok: true }
  }

  async function buildPayload(input, g) {
    const issued = now()
    const base = { v: 1, nonce: crypto.randomBytes(16).toString('hex'), issued_at: issued }
    if (input.decision === 'go') {
      if (typeof input.requestId !== 'string' || !ID_RE.test(input.requestId)) throw new ClickError('bad-request-id')
      const r = g.requests.find((x) => x.id === input.requestId)
      if (!r) throw new ClickError('unknown-request', 404)
      if (r.hard || r.click === false) throw new ClickError('request-hard', 403)
      if (!KEY_RE.test(r.sessionKey || '') || !r.cmdHash) throw new ClickError('request-unbound', 409)
      if (isDecided(r.sessionKey, r.id)) throw new ClickError('request-decided', 409)
      return { ...base, kind: 'go', request_id: r.id, session_key: r.sessionKey, cmd_hash: r.cmdHash, scopes: r.scopes, ms: 0, expires_at: issued + RECEIPT_TTL_MS }
    }
    if (input.decision === 'grant') {
      if (typeof input.sessionKey !== 'string' || !g.sessionKeys.includes(input.sessionKey) || !KEY_RE.test(input.sessionKey)) throw new ClickError('unknown-session', 404)
      if (!Array.isArray(input.scopes) || !input.scopes.length || input.scopes.length > 16) throw new ClickError('bad-scopes')
      const scopes = [...new Set(input.scopes)].sort()
      if (scopes.some((s) => typeof s !== 'string' || !g.scopes.includes(s))) throw new ClickError('bad-scopes')
      if (!GRANT_CHOICES_MS.includes(input.ms) || input.ms > g.maxGrantMs) throw new ClickError('bad-duration')
      if ((input.ms === LONG_GRANT_MS || scopes.some((s) => BROAD_SCOPES.includes(s))) && input.broad !== true) throw new ClickError('broad-needs-confirmation')
      return { ...base, kind: 'grant', request_id: `g-${crypto.randomBytes(12).toString('hex')}`, session_key: input.sessionKey, cmd_hash: '', scopes, ms: input.ms, expires_at: issued + input.ms }
    }
    throw new ClickError('bad-decision')
  }

  async function challenge(input) {
    if (!credential()) throw new ClickError('no-credential', 409)
    const g = await gate()
    if (!g) throw new ClickError('gate-unavailable', 503)
    const payload = await buildPayload(input, g)
    const t = now()
    for (const [k, v] of challenges) if (t - v.at > CHALLENGE_TTL_MS) challenges.delete(k)
    if (challenges.size >= MAX_PENDING_CHALLENGES) throw new ClickError('too-many-challenges', 429)
    const ch = challengeOf(payload)
    challenges.set(payload.request_id, { payload, challenge: ch, at: t })
    return {
      requestId: payload.request_id,
      publicKey: { challenge: ch, rpId: RP_ID, timeout: CHALLENGE_TTL_MS, userVerification: 'required', allowCredentials: [{ type: 'public-key', id: credential().id }] },
      summary: { kind: payload.kind, sessionKey: payload.session_key, scopes: payload.scopes, ms: payload.ms, expiresAt: payload.expires_at },
    }
  }

  async function confirm({ requestId, assertion }) {
    if (typeof requestId !== 'string' || !ID_RE.test(requestId)) throw new ClickError('bad-request-id')
    const entry = challenges.get(requestId)
    challenges.delete(requestId) // single use, also when verification fails
    if (!entry) throw new ClickError('no-challenge', 410)
    if (now() - entry.at > CHALLENGE_TTL_MS) throw new ClickError('challenge-expired', 410)
    const cred = credential()
    if (!cred) throw new ClickError('no-credential', 409)
    const { payload } = entry
    if (payload.kind === 'go') {
      const g = await gate()
      const r = g && g.requests.find((x) => x.id === payload.request_id)
      if (!r) throw new ClickError('unknown-request', 404)
      if (r.hard || r.click === false) throw new ClickError('request-hard', 403)
      if (r.cmdHash !== payload.cmd_hash || r.sessionKey !== payload.session_key) throw new ClickError('challenge-mismatch', 403)
    }
    if (isDecided(payload.session_key, payload.request_id)) throw new ClickError('request-decided', 409)

    const { signCount } = verifyAssertion({ credential: cred, assertion, expectedChallenge: entry.challenge, origin })
    if (signCount > (cred.signCount || 0)) writeAtomic(path.join(gateDir, 'trail-credential.json'), { ...cred, signCount })

    // link() fails when the receipt exists: deciding twice cannot overwrite the first.
    fs.mkdirSync(goDir, { recursive: true, mode: 0o700 })
    const tmp = `${receiptFile(payload.session_key, payload.request_id)}.${process.pid}.tmp`
    const body = { payload, assertion: { id: assertion.id, authenticatorData: assertion.authenticatorData, clientDataJSON: assertion.clientDataJSON, signature: assertion.signature } }
    fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600, flag: 'wx' })
    try { fs.linkSync(tmp, receiptFile(payload.session_key, payload.request_id)) } catch (e) {
      throw new ClickError(e && e.code === 'EEXIST' ? 'request-decided' : 'receipt-write-failed', e && e.code === 'EEXIST' ? 409 : 500)
    } finally { try { fs.unlinkSync(tmp) } catch { /* tmp already gone */ } }
    decided.add(payload.request_id)
    return { ok: true, kind: payload.kind, expiresAt: payload.expires_at }
  }

  // Tightening only: no WebAuthn, the gate treats the file like a `hard` for that session.
  async function revoke({ sessionKey }) {
    const g = await gate()
    if (!g) throw new ClickError('gate-unavailable', 503)
    if (typeof sessionKey !== 'string' || !KEY_RE.test(sessionKey) || !g.sessionKeys.includes(sessionKey)) throw new ClickError('unknown-session', 404)
    writeAtomic(path.join(gateDir, `${sessionKey}.revoke.json`), { ts: new Date(now()).toISOString() })
    return { ok: true }
  }

  return { enrolBegin, enrolFinish, challenge, confirm, revoke, enrolled: () => !!credential() }
}
