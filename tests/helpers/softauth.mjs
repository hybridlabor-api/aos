// A software ES256 WebAuthn authenticator for tests. It builds the same bytes a platform
// authenticator would: authData = rpIdHash || flags || signCount, signature over
// authData || sha256(clientDataJSON). Shared by the hub click tests and the gate tests.
import crypto from 'node:crypto'

const sha256 = (data) => crypto.createHash('sha256').update(data).digest()
const b64u = (buf) => Buffer.from(buf).toString('base64url')

export const FLAG_UP = 0x01
export const FLAG_UV = 0x04

export function createSoftAuth({ origin, rpId = 'localhost' }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const credentialId = b64u(crypto.randomBytes(32))
  let counter = 0

  return {
    credentialId,
    publicKeyJwk: publicKey.export({ format: 'jwk' }),
    publicKeySpki: b64u(publicKey.export({ format: 'der', type: 'spki' })),

    register(challenge, over = {}) {
      const clientData = { type: 'webauthn.create', challenge, origin, crossOrigin: false, ...over }
      return {
        credentialId,
        clientDataJSON: b64u(JSON.stringify(clientData)),
        publicKey: b64u(publicKey.export({ format: 'der', type: 'spki' })),
      }
    },

    // over: flags, rpId, origin, type, challenge, counter (explicit value), key (another private key)
    sign(challenge, over = {}) {
      counter = over.counter !== undefined ? over.counter : counter + 1
      const authData = Buffer.concat([
        sha256(over.rpId ?? rpId),
        Buffer.from([over.flags ?? (FLAG_UP | FLAG_UV)]),
        Buffer.from([(counter >>> 24) & 255, (counter >>> 16) & 255, (counter >>> 8) & 255, counter & 255]),
      ])
      const clientDataJSON = Buffer.from(JSON.stringify({
        type: over.type ?? 'webauthn.get',
        challenge: over.challenge ?? challenge,
        origin: over.origin ?? origin,
        crossOrigin: false,
      }))
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), over.key ?? privateKey)
      return {
        id: credentialId,
        authenticatorData: b64u(authData),
        clientDataJSON: b64u(clientDataJSON),
        signature: b64u(signature),
      }
    },

    otherKey: () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey,
  }
}
