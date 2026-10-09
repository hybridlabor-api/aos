// Builds the attestationObject (fmt "none") a platform authenticator returns at enrolment,
// from a createSoftAuth() authenticator: a tiny CBOR encoder (ints, bytes, text, maps) and the COSE ES256 key.
import crypto from 'node:crypto'

const head = (major, n) => {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 256) return Buffer.from([(major << 5) | 24, n])
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255])
  const b = Buffer.alloc(5)
  b[0] = (major << 5) | 26
  b.writeUInt32BE(n, 1)
  return b
}

export function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v)
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]) }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v])
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])])
  throw new Error('unsupported')
}

export function coseKey(jwk) {
  return new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]])
}

// over: authData (raw Buffer replacing the built one), fmt, attStmt (Map), flags
export function attestationObject(auth, over = {}) {
  const credId = Buffer.from(auth.credentialId, 'base64url')
  const idLen = Buffer.alloc(2)
  idLen.writeUInt16BE(credId.length)
  const authData = over.authData ?? Buffer.concat([
    crypto.createHash('sha256').update('localhost').digest(),
    Buffer.from([over.flags ?? 0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    idLen,
    credId,
    cbor(coseKey(auth.publicKeyJwk)),
  ])
  return cbor(new Map([['fmt', over.fmt ?? 'none'], ['attStmt', over.attStmt ?? new Map()], ['authData', authData]]))
}
