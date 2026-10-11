// One-time enrolment page. The code comes from the user's own terminal; the hub stores
// the public key only. No external requests, text only into the DOM.
const CSRF = (document.querySelector('meta[name="csrf-token"]') || { getAttribute: () => '' }).getAttribute('content')

const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s) => {
  const p = String(s).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(p + '='.repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0)).buffer
}

async function post(route, body) {
  const r = await fetch(`/v1/gate/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-trail-csrf': CSRF },
    body: JSON.stringify(body),
  })
  let data = {}
  try { data = await r.json() } catch { /* no body */ }
  return { ok: r.ok, status: r.status, data }
}

async function enrol() {
  const out = document.getElementById('out')
  out.textContent = 'checking the code…'
  try {
    const b = await post('enroll-begin', { code: document.getElementById('code').value })
    if (!b.ok) { out.textContent = `refused: ${b.data.error || b.status}`; return }
    const o = b.data.publicKey
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: fromB64u(o.challenge),
        rp: o.rp,
        user: { id: fromB64u(o.user.id), name: o.user.name, displayName: o.user.displayName },
        pubKeyCredParams: o.pubKeyCredParams,
        authenticatorSelection: o.authenticatorSelection,
        attestation: 'none',
        timeout: o.timeout,
      },
    })
    const done = await post('enroll-finish', {
      credentialId: cred.id,
      clientDataJSON: toB64u(cred.response.clientDataJSON),
      publicKey: toB64u(cred.response.getPublicKey()),
    })
    out.textContent = done.ok ? 'enrolled; you can close this tab' : `refused: ${done.data.error || done.status}`
  } catch {
    out.textContent = 'cancelled'
  }
}

document.getElementById('go').addEventListener('click', enrol)
