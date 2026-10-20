// Minimal writer for the "agenttrail" list in ~/.aos/endpoints.json (schema 1, docs/one-port.md).
// Best effort: discovery must never break a map.
import { update } from '../../plan-canvas/scripts/lib/endpoints-lite.js'

export function announceTrail({ repo, port }) {
  update(doc => { doc.agenttrail = [...doc.agenttrail.filter(m => m && m.port !== port), { repo, url: `http://127.0.0.1:${port}`, port, pid: process.pid }] })
  process.on('exit', () => update(doc => { doc.agenttrail = doc.agenttrail.filter(m => m && m.pid !== process.pid) }))
}
