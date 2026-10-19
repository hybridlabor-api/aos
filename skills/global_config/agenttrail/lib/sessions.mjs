// The control room's view: which sessions exist, and which of them need Tim.
// Sessions are merged by session id so one agent's events never split into
// several rows; a GO request only ever arrives from the gate's own files.
import fs from 'node:fs'
import path from 'node:path'

const IDLE_MS = 15 * 60 * 1000
const ENDED_KEEP_MS = 24 * 60 * 60 * 1000 // ponytail: linear sweep per apply, fine for hundreds of sessions

export function mergeKey(event) {
  const id = event?.session?.id
  if (id) return String(id)
  const agent = event?.agent || 'unknown'
  const cwd = event?.cwd || ''
  const pid = event?.pid ?? ''
  return `${agent}:${cwd}:${pid}`
}

export class SessionTable {
  constructor({ now = () => Date.now(), idleMs = IDLE_MS } = {}) {
    this.now = now
    this.idleMs = idleMs
    this.sessions = new Map()
  }

  byId(id) { return this.sessions.get(id) }

  all() { return [...this.sessions.values()].sort((a, b) => b.lastEventAt - a.lastEventAt) }

  pruneEnded() {
    const cutoff = this.now() - ENDED_KEEP_MS
    for (const [k, s] of this.sessions) if (s.done && s.lastEventAt < cutoff) this.sessions.delete(k)
  }

  apply(event) {
    if (!event || typeof event !== 'object') return null
    const key = mergeKey(event)
    const at = Date.parse(event.ts) || this.now()
    let s = this.sessions.get(key)
    if (!s) {
      this.pruneEnded()
      s = {
        id: key,
        harnesses: [],
        name: '',
        cwd: event.cwd || '',
        repoId: '',
        branch: '',
        state: 'working',
        currentTool: null,
        currentTask: null,
        touched: [],
        lastFile: '',
        waiting: null,
        goClaim: null,
        ended: false,
        done: false,
        lastEventAt: at,
        fromRegistry: false,
      }
      this.sessions.set(key, s)
    }

    const harness = String(event.agent || 'other')
    if (!s.harnesses.includes(harness)) s.harnesses.push(harness)
    if (event.session?.name) s.name = String(event.session.name)
    if (event.cwd) s.cwd = event.cwd
    if (event.repoId) s.repoId = event.repoId
    if (event.branch) s.branch = event.branch
    s.harness = s.harnesses[0]
    s.lastEventAt = Math.max(s.lastEventAt, at)

    // A relayed node (AOS_TRAIL_NODE) rides on any event; task.update keeps its own path.
    if (event.task?.plan && event.kind !== 'task.update' && event.kind !== 'session.stop' && event.kind !== 'session.end') s.currentTask = event.task

    switch (event.kind) {
      case 'session.start':
        s.ended = false
        s.done = false
        s.waiting = null
        s.state = 'working'
        break
      case 'tool.pre':
        s.ended = false
        s.done = false
        s.waiting = null
        s.currentTool = event.tool || null
        s.state = 'working'
        break
      case 'tool.post':
        s.ended = false
        s.done = false
        s.waiting = null
        s.currentTool = null
        if (event.file) s.lastFile = event.file
        s.state = 'working'
        break
      case 'task.update':
        s.currentTask = event.task || null
        s.state = 'working'
        break
      case 'session.stop':
        // Stop means the agent handed control back, not that it finished.
        s.ended = true
        s.done = false
        s.currentTool = null
        this.release(s, event.task || s.currentTask, at)
        s.state = 'waiting-for-you'
        break
      case 'session.end':
        s.ended = true
        s.done = true
        s.currentTool = null
        this.release(s, event.task || s.currentTask, at)
        s.state = 'ended'
        break
      case 'waiting':
      case 'blocker':
        s.ended = false
        s.done = false
        s.waiting = String(event.message || '').slice(0, 500)
        s.state = 'waiting-for-you'
        break
      case 'go.request':
        // An untrusted claim. It never becomes a decision and never waits.
        s.goClaim = String(event.message || 'agent claims it waits for GO').slice(0, 500)
        break
      default:
        break
    }

    if (s.state !== 'ended' && s.state !== 'waiting-for-you' && this.now() - s.lastEventAt > this.idleMs) s.state = 'idle'
    return s
  }

  // Clears the live node and remembers it as touched. Never marks it done: the plan file decides that.
  release(s, task, at) {
    if (s.currentTask?.plan) s.currentTask = null
    if (!task?.id || !task.plan) return
    s.touched = s.touched.filter((t) => !(t.id === task.id && t.plan === (task.plan || ''))).concat({ id: task.id, plan: task.plan || '', at }).slice(-50)
  }
}

const defaultIsAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

export function readA2aRegistry(dir, { isAlive = defaultIsAlive } = {}) {
  let files = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { return [] }
  const out = []
  for (const f of files) {
    let entry
    try { entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
    if (!entry || typeof entry !== 'object' || !entry.name) continue
    const pid = Number(entry.pid)
    const alive = Number.isInteger(pid) ? !!isAlive(pid) : false
    out.push({
      name: String(entry.name),
      harness: String(entry.harness || 'other'),
      cwd: String(entry.cwd || ''),
      pid: Number.isInteger(pid) ? pid : null,
      url: typeof entry.url === 'string' ? entry.url : '',
      alive,
      ended: !alive,
      fromRegistry: true,
    })
  }
  return out
}

// One list for "waiting for Tim". GO requests first — they are the only items that
// carry a decision — then everything else by age, oldest first.
export function waitingList({ sessions = [], gate = null, asks = [], plans = [] }, { now = Date.now() } = {}) {
  const items = []

  for (const r of (gate?.requests || [])) {
    items.push({
      tier: 0,
      kind: 'go',
      id: r.id,
      sessionKey: r.sessionKey,
      command: r.command,
      scopes: r.scopes || [],
      at: r.ts,
      age: Math.max(0, now - r.ts),
      decision: r.click === true,
      source: 'gate',
      label: r.click === true ? 'GO request' : 'GO request (hard block, no click possible)',
    })
  }

  for (const s of sessions) {
    if (s.goClaim) {
      items.push({
        tier: 1, kind: 'claim', sessionId: s.id, at: s.lastEventAt,
        age: Math.max(0, now - s.lastEventAt), label: 'agent claims it waits for GO', message: s.goClaim, source: 'event',
      })
    }
    if (s.ended && !s.done) {
      // Stop without done: the agent handed control back and is not finished.
      items.push({
        tier: 1, kind: 'idle-session', sessionId: s.id, at: s.lastEventAt,
        age: Math.max(0, now - s.lastEventAt), harness: s.harness, cwd: s.cwd, source: 'event',
      })
    } else if (s.state === 'waiting-for-you') {
      items.push({
        tier: 1, kind: 'waiting', sessionId: s.id, message: s.waiting || '', at: s.lastEventAt,
        age: Math.max(0, now - s.lastEventAt), harness: s.harness, cwd: s.cwd, source: 'event',
      })
    }
  }

  for (const a of asks) {
    if (!a || a.status !== 'pending') continue
    const ts = Date.parse(a.askedAt) || now
    items.push({
      tier: 1, kind: 'ask', id: a.id, question: a.question || '', askedBy: a.askedBy || '', at: ts,
      age: Math.max(0, now - ts), source: 'ask',
    })
  }

  for (const plan of plans) {
    for (const t of (plan.tasks || [])) {
      const stalled = Array.isArray(plan.stalled) && plan.stalled.includes(t.id)
      if (t.status !== 'blocked' && !stalled) continue
      const ts = Date.parse(t.updatedAt) || now
      items.push({
        tier: 1, kind: 'task', plan: plan.name || '', taskId: t.id, title: t.title || '',
        stalled, at: ts, age: Math.max(0, now - ts), source: 'plan',
      })
    }
  }

  items.sort((a, b) => a.tier - b.tier || b.age - a.age)
  return items
}