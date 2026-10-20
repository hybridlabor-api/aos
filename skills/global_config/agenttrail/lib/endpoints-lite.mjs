// Minimal writer for the "agenttrail" list in ~/.aos/endpoints.json (schema 1, docs/one-port.md).
// Best effort: discovery must never break a map.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function update(mutate) {
  try {
    const file = path.join(process.env.HOME || os.homedir(), '.aos', 'endpoints.json')
    let doc = {}
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* missing or broken: start fresh */ }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) doc = {}
    doc.schema = 1
    doc.hub = typeof doc.hub === 'string' ? doc.hub : 'http://127.0.0.1:7900'
    doc.services = doc.services && typeof doc.services === 'object' ? doc.services : {}
    doc.agenttrail = Array.isArray(doc.agenttrail) ? doc.agenttrail : []
    mutate(doc)
    doc.updated = new Date().toISOString()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2))
    fs.renameSync(tmp, file)
  } catch { /* best effort */ }
}

export function announceTrail({ repo, port }) {
  update(doc => { doc.agenttrail = [...doc.agenttrail.filter(m => m && m.port !== port), { repo, url: `http://127.0.0.1:${port}`, port, pid: process.pid }] })
  process.on('exit', () => update(doc => { doc.agenttrail = doc.agenttrail.filter(m => m && m.pid !== process.pid) }))
}
