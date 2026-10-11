// trail-event/1 — the one contract every harness reports through.
// Validation is strict about what it accepts and silent about what it drops: an
// unknown field is removed, an unknown kind is refused.
import http from 'node:http'
import path from 'node:path'

export const MAX_BODY_BYTES = 16 * 1024
const MAX_SKEW_MS = 24 * 60 * 60 * 1000

export const KINDS = Object.freeze([
  'session.start', 'session.end', 'session.stop', 'tool.pre', 'tool.post',
  'task.update', 'waiting', 'blocker', 'go.request', 'note',
])
export const AGENTS = Object.freeze(['claude', 'opencode', 'agy', 'codex', 'other'])
const TASK_STATUS = Object.freeze(['todo', 'doing', 'done', 'stuck'])

const CONTROL = /[\u0000-\u001f\u007f]/g
const clean = (s, max) => String(s).replace(CONTROL, '').slice(0, max)
const plain = (v) => (typeof v === 'string' || typeof v === 'number' ? v : undefined)

export function validateEvent(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'event must be an object' }
  if (input.v !== 1) return { ok: false, error: 'v must be 1' }

  const kind = plain(input.kind)
  if (!kind || !KINDS.includes(kind)) return { ok: false, error: `unknown kind "${String(input.kind).slice(0, 40)}"` }

  const agent = plain(input.agent)
  if (!agent) return { ok: false, error: 'agent is required' }

  const sessionId = input.session && plain(input.session.id)
  if (!sessionId) return { ok: false, error: 'session.id is required' }

  const cwd = plain(input.cwd)
  if (!cwd || !path.isAbsolute(String(cwd))) return { ok: false, error: 'cwd must be an absolute path' }

  let ts = now
  if (input.ts !== undefined) {
    ts = Date.parse(plain(input.ts))
    if (!Number.isFinite(ts)) return { ok: false, error: 'ts is not a timestamp' }
    if (Math.abs(ts - now) > MAX_SKEW_MS) return { ok: false, error: 'ts is more than 24h away from now' }
  }

  const out = {
    v: 1,
    ts: new Date(ts).toISOString(),
    agent: AGENTS.includes(agent) ? agent : 'other',
    session: { id: clean(sessionId, 128) },
    cwd: clean(cwd, 1024),
    kind,
  }
  const name = input.session && plain(input.session.name)
  if (name) out.session.name = clean(name, 64)
  if (input.tool && typeof input.tool === 'object') {
    const tn = plain(input.tool.name)
    if (tn) {
      out.tool = { name: clean(tn, 80) }
      const td = plain(input.tool.detail)
      if (td) out.tool.detail = clean(td, 300)
    }
  }
  if (input.task && typeof input.task === 'object') {
    const id = plain(input.task.id)
    const status = plain(input.task.status)
    // A malformed task is a contract violation, not something to drop quietly:
    // a task.update without a task would look like "nothing to do".
    if (!id) return { ok: false, error: 'task.id is required when task is present' }
    if (!TASK_STATUS.includes(status)) return { ok: false, error: `unknown task status "${String(input.task.status).slice(0, 40)}"` }
    out.task = { id: clean(id, 128), status }
    const plan = plain(input.task.plan)
    if (plan) out.task.plan = clean(plan, 300)
  }
  const file = plain(input.file)
  if (file) out.file = clean(file, 300)
  const message = plain(input.message)
  if (message) out.message = clean(message, 500)
  if (input.ref && typeof input.ref === 'object') {
    const ref = {}
    const a2a = plain(input.ref.a2a_task)
    const gate = plain(input.ref.gate_request)
    if (a2a) ref.a2a_task = clean(a2a, 128)
    if (gate) ref.gate_request = clean(gate, 128)
    if (Object.keys(ref).length) out.ref = ref
  }
  return { ok: true, value: out }
}

const HOOK_KIND = {
  SessionStart: 'session.start',
  SessionEnd: 'session.end',
  Stop: 'session.stop',
  PreToolUse: 'tool.pre',
  PostToolUse: 'tool.post',
  Notification: 'waiting',
  SubagentStop: 'note',
}

const TODO_STATUS = { pending: 'todo', in_progress: 'doing', completed: 'done', done: 'done' }

export function fromLegacyHook(payload, { now = Date.now() } = {}) {
  if (!payload || typeof payload !== 'object') return null
  const hook = String(payload.hook_event_name || '')
  const ev = {
    v: 1,
    ts: new Date(now).toISOString(),
    agent: String(payload.agent || 'claude'),
    session: { id: String(payload.session_id || '') },
    cwd: String(payload.cwd || ''),
  }

  const todos = payload.tool_name === 'TodoWrite' || payload.tool_name === 'Todowrite'
    ? (Array.isArray(payload.tool_input?.todos) ? payload.tool_input.todos : null)
    : payload.tool_name === 'update_plan' && Array.isArray(payload.tool_input?.plan)
      ? payload.tool_input.plan.map((p) => ({ content: p.step, status: p.status }))
      : null

  if (todos) {
    const doing = todos.find((t) => t.status === 'in_progress' || t.status === 'doing')
    const item = doing || todos.find((t) => t.status === 'completed' || t.status === 'done') || todos[0]
    const status = TODO_STATUS[String(item?.status)] || 'todo'
    ev.kind = 'task.update'
    ev.task = { id: String(item?.content || 'todo').slice(0, 128), status }
    if (payload.tool_input?.plan_path) ev.task.plan = String(payload.tool_input.plan_path).slice(0, 300)
  } else if (HOOK_KIND[hook]) {
    ev.kind = HOOK_KIND[hook]
    if (ev.kind === 'tool.pre' || ev.kind === 'tool.post') {
      ev.tool = { name: String(payload.tool_name || '').slice(0, 80) }
      const input = payload.tool_input || {}
      const file = input.file_path || input.notebook_path || input.path
      if (file) {
        const rel = String(file).startsWith(String(payload.cwd || ''))
          ? String(file).slice(String(payload.cwd || '').length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
          : String(file)
        ev.tool.detail = rel.slice(0, 300)
        if (rel && !path.isAbsolute(rel)) ev.file = rel.slice(0, 300)
      }
    }
    if (ev.kind === 'waiting' && payload.message) ev.message = String(payload.message).slice(0, 500)
    // The trail relay stamps AOS_TRAIL_NODE / AOS_TRAIL_PLAN onto the payload as `task`.
    if (payload.task?.id) ev.task = { id: String(payload.task.id).slice(0, 128), status: 'doing', ...(payload.task.plan ? { plan: String(payload.task.plan).slice(0, 300) } : {}) }
  } else {
    return null
  }

  const r = validateEvent(ev, { now })
  return r.ok ? r.value : null
}

export function buildEvent(args, { cwd, env = {}, now = Date.now(), ppid } = {}) {
  const dir = cwd || process.cwd()
  const agent = String(args.agent || env.AOS_HARNESS || 'other')
  const session = String(args.session || env.AOS_SESSION_ID || env.CLAUDE_SESSION_ID || '').slice(0, 128)
  const id = session || `auto-${shortHash(`${dir}\0${ppid ?? process.ppid}`)}`
  const ev = {
    v: 1,
    ts: new Date(now).toISOString(),
    agent,
    session: { id },
    cwd: dir,
    kind: String(args.kind || 'note'),
  }
  if (args.name) ev.session.name = String(args.name)
  if (args.tool) ev.tool = { name: String(args.tool), ...(args.detail ? { detail: String(args.detail) } : {}) }
  if (args.task) ev.task = { id: String(args.task), status: String(args.status || 'doing'), ...(args.plan ? { plan: String(args.plan) } : {}) }
  if (args.file) ev.file = String(args.file)
  if (args.message) ev.message = String(args.message)
  return ev
}

function shortHash(s) {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// Fire-and-forget by contract: a reporting hook must never block a tool call.
export function emit(event, { port = Number(process.env.AGENTTRAIL_PORT) || 5350, timeoutMs = 300, host = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    const body = Buffer.from(JSON.stringify(event ?? {}), 'utf8')
    let req
    try {
      req = http.request({ host, port, path: '/v1/events', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': body.length } }, (res) => { res.resume(); res.on('end', () => finish(res.statusCode)) })
    } catch { return finish(0) }
    req.setTimeout(timeoutMs, () => { req.destroy(); finish(0) })
    req.on('error', () => finish(0))
    req.end(body)
  })
}