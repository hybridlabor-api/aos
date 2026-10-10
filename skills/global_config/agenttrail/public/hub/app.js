// The hub board. Vanilla JS, no external requests, no inline script or style.
// Every value that came off the wire goes into the DOM as a text node — never as
// markup — so a session name or a command preview cannot become a tag.
// An Approve button exists only once a platform authenticator is enrolled (model.gate.enrolled):
// the click asks the OS for Touch ID, and the gate re-verifies the signature itself.
// Without an enrolled credential a GO is answered by typing it, so only copy text shows.

const CSRF = (() => {
  const meta = document.querySelector('meta[name="csrf-token"]')
  return meta ? meta.getAttribute('content') : ''
})()

function el(tag, props, children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v == null ? '' : String(v)
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of [].concat(children || [])) if (c !== null && c !== undefined) node.appendChild(c)
  return node
}

let enrolled = false

const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s) => {
  const p = String(s).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(p + '='.repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0)).buffer
}

async function postGate(route, body) {
  const r = await fetch(`/v1/gate/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-trail-csrf': CSRF },
    body: JSON.stringify(body),
  })
  let data = {}
  try { data = await r.json() } catch { /* an empty body carries no error code */ }
  return { ok: r.ok, status: r.status, data }
}

// challenge -> OS prompt -> confirm. Every step reports the hub's error code as text.
async function approve(item, out) {
  out.textContent = 'asking for Touch ID…'
  try {
    const c = await postGate('challenge', { requestId: item.id, decision: 'go' })
    if (!c.ok) { out.textContent = `refused: ${c.data.error || c.status}`; return }
    const o = c.data.publicKey
    const got = await navigator.credentials.get({
      publicKey: {
        challenge: fromB64u(o.challenge),
        rpId: o.rpId,
        timeout: o.timeout,
        userVerification: 'required',
        allowCredentials: (o.allowCredentials || []).map((a) => ({ type: a.type, id: fromB64u(a.id) })),
      },
    })
    const r = got.response
    const done = await postGate('confirm', {
      requestId: c.data.requestId,
      assertion: { id: got.id, authenticatorData: toB64u(r.authenticatorData), clientDataJSON: toB64u(r.clientDataJSON), signature: toB64u(r.signature) },
    })
    out.textContent = done.ok ? 'approved; the command can be retried within 10 minutes' : `refused: ${done.data.error || done.status}`
  } catch {
    out.textContent = 'cancelled'
  }
}

function approveRow(item) {
  const out = el('span', { class: 'dim', text: '' })
  const btn = el('button', { type: 'button', class: 'approve', text: 'Approve (Touch ID)' })
  btn.addEventListener('click', () => { approve(item, out) })
  return el('div', { class: 'copy-row' }, [btn, out])
}

function revokeRow(sessionKey) {
  const out = el('span', { class: 'dim', text: '' })
  const btn = el('button', { type: 'button', text: 'revoke session' })
  btn.addEventListener('click', async () => {
    const r = await postGate('revoke', { sessionKey }).catch(() => null)
    out.textContent = r && r.ok ? 'revoked' : `refused: ${(r && r.data.error) || 'error'}`
  })
  return el('div', { class: 'copy-row' }, [btn, out])
}

const clear = (node) => { while (node && node.firstChild) node.removeChild(node.firstChild) }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Cards whose task list is expanded. Collapsed by default: only active, blocked
// and next-due tasks stay visible until the control expands all.
const expandedCards = new Set()

// The exact text Tim has to type. Copy only — the hub cannot act on it.
function goText(item) {
  if (item.kind === 'go') return item.sessionKey ? `GO ${item.sessionKey}` : 'GO'
  if (item.kind === 'ask') return `gogate answer ${item.id}`
  return ''
}

function copyRow(text, label) {
  const btn = el('button', { type: 'button', text: label || 'copy' })
  const out = el('span', { class: 'dim', text: '' })
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text)
      out.textContent = 'copied'
    } catch { out.textContent = 'copy it by hand' }
    setTimeout(() => { out.textContent = '' }, 2000)
  })
  return el('div', { class: 'copy-row' }, [el('code', { class: 'cmd', text }), btn, out])
}

function ageText(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

const doingText = (s) => {
  if (s.currentTool) return `${s.currentTool.name}${s.currentTool.detail ? ' ' + s.currentTool.detail : ''}`
  if (s.currentTask) return `task ${s.currentTask.id} (${s.currentTask.status})`
  if (s.waiting) return s.waiting
  if (s.lastFile) return s.lastFile
  return ''
}

function renderWaiting(model) {
  const list = document.getElementById('waiting-list')
  clear(list)
  const items = model.waiting || []
  document.getElementById('waiting-count').textContent = items.length ? `(${items.length})` : ''
  if (!items.length) {
    list.appendChild(el('li', { class: 'dim', text: 'nothing is waiting on you' }))
    return
  }
  for (const item of items) {
    const tags = []
    if (item.kind === 'go') tags.push(el('span', { class: 'tag go', text: item.decision ? 'GO request' : 'GO request (hard)' }))
    else if (item.kind === 'claim') tags.push(el('span', { class: 'tag', text: 'untrusted' }))
    else if (item.kind === 'waiting' || item.kind === 'idle-session') tags.push(el('span', { class: 'tag wait', text: item.kind }))
    else if (item.kind === 'ask') tags.push(el('span', { class: 'tag wait', text: 'question' }))
    else if (item.kind === 'task') tags.push(el('span', { class: 'tag blocked', text: item.stalled ? 'stalled' : 'stuck' }))

    const what = el('div', { class: 'what' }, [el('div', {}, tags)])
    if (item.command) what.appendChild(el('div', {}, [el('code', { class: 'cmd', text: item.command })]))
    else if (item.question) what.appendChild(el('div', { text: item.question }))
    else if (item.title) what.appendChild(el('div', { text: item.title }))
    else if (item.message) what.appendChild(el('div', { text: item.message }))
    else if (item.sessionId) what.appendChild(el('div', { class: 'dim', text: item.sessionId }))

    if (item.decision) what.appendChild(copyRow(goText(item), 'copy GO text'))
    if (item.decision && item.click !== false && enrolled) what.appendChild(approveRow(item))
    if (item.kind === 'claim') what.appendChild(el('div', { class: 'meta', text: 'this is an agent’s own claim — no gate request backs it' }))

    const meta = el('div', { class: 'meta', text: ageText(item.age) })
    list.appendChild(el('li', { class: 'row' }, [what, meta]))
  }
}

function renderSessions(model) {
  const body = document.getElementById('sessions-body')
  clear(body)
  const sessions = model.sessions || []
  document.getElementById('sessions-count').textContent = sessions.length ? `(${sessions.length})` : ''
  if (!sessions.length) {
    body.appendChild(el('span', { class: 'dim', text: 'no session is reporting' }))
    return
  }
  const stateTag = { working: 'ok', 'waiting-for-you': 'wait', idle: '', ended: '' }
  for (const s of sessions) {
    const doing = doingText(s)
    body.appendChild(el('div', { class: 'sess', title: s.cwd || '' }, [
      el('b', { text: (s.harnesses || [s.harness]).join(' ') }),
      el('span', { class: 'trunc', text: s.name || baseName(s.cwd) || '—' }),
      el('span', { class: `tag ${stateTag[s.state] || ''}`.trim(), text: s.state }),
      doing ? el('span', { class: 'dim trunc', text: doing }) : null,
      el('span', { class: 'dim', text: ageText(s.age) }),
    ]))
  }
}

function taskSection(plan) {
  const tasks = plan.tasks || []
  if (!tasks.length) return null
  const expanded = expandedCards.has(plan.planKey)
  const shown = expanded ? tasks : visibleEntries(tasks)
  const wrap = el('div', { class: 'tasks', 'data-cols': String(entryColumns(shown.length)) })
  for (const t of shown) {
    wrap.appendChild(el('div', { class: `t ${t.status}` }, [
      el('span', { class: 'id', text: `#${t.id}` }),
      el('span', { text: t.title || '' }),
    ]))
  }
  const hidden = tasks.length - shown.length
  const btn = el('button', {
    type: 'button',
    text: expanded ? 'HIDE TASKS ↑' : `SHOW TASKS ↓ (+${hidden})`,
    'aria-expanded': String(expanded),
  })
  btn.addEventListener('click', () => {
    if (expanded) expandedCards.delete(plan.planKey)
    else expandedCards.add(plan.planKey)
    refresh(true)
  })
  return el('div', { class: 'tasks-wrap' }, [wrap, btn])
}

function planCard(repo, plan, opts) {
  const card = el('article', { class: `card lifecycle-${plan.lifecycle}` })
  card.appendChild(el('h3', { text: plan.name || plan.path || 'plan' }))
  card.appendChild(el('div', { class: 'sub', text: `${repo} · ${plan.owner?.branch || 'no branch'} · ${plan.lifecycle}` }))

  const { done = 0, total = 0, stalled = 0 } = plan.progress || {}
  card.appendChild(el('progress', { value: String(done), max: String(total || 1), 'aria-label': 'tasks done' }))
  card.appendChild(el('div', { class: 'sub', text: `${done}/${total} tasks${stalled ? ` · ${stalled} stalled` : ''}` }))

  const comps = el('div', { class: 'sub' })
  for (const c of plan.components || []) {
    comps.appendChild(el('div', { class: `comp ${c.status}` }, [
      el('span', { class: 'id', text: `#${c.id}` }),
      el('span', { text: c.title || '' }),
    ]))
  }
  if ((plan.components || []).length) card.appendChild(comps)

  if ((plan.mirrors || []).length) {
    card.appendChild(el('div', { class: 'sub', text: `also checked out in: ${plan.mirrors.map((m) => m.branch || m.path).join(', ')}` }))
  }
  const tasks = taskSection(plan)
  if (tasks) card.appendChild(tasks)
  for (const d of plan.divergent || []) {
    card.appendChild(el('div', { class: 'sub' }, [
      el('span', { class: 'tag blocked', text: `divergent: ${d.tasks} task${d.tasks === 1 ? '' : 's'}` }),
      el('span', { class: 'dim', text: ` ${d.branch || d.path}` }),
    ]))
  }
  if (opts && opts.keepVisible) card.appendChild(keepVisible(plan))
  return card
}

function keepVisible(plan) {
  const btn = el('button', { type: 'button', text: plan.pinned ? 'keep visible (on)' : 'keep visible' })
  btn.addEventListener('click', () => {
    fetch('/v1/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-trail-csrf': CSRF },
      body: JSON.stringify({ planKey: plan.planKey, pinned: !plan.pinned }),
    }).then(() => refresh(true)).catch(() => {})
  })
  return btn
}

function renderPlans(model) {
  const host = document.getElementById('plans-list')
  clear(host)
  const plans = (model.repos || []).flatMap((r) => (r.plans || []).map((p) => ({ repo: r.root, plan: p })))
  if (!plans.length) {
    host.removeAttribute('data-cols')
    host.appendChild(el('div', { class: 'dim', text: 'no plan on the main view' }))
    return
  }
  // Several rows instead of one long column: a near-square grid, cards placed
  // row-major so index i sits at gridPlace(i, cols).
  const cols = gridColumns(plans.length)
  host.setAttribute('data-cols', String(cols))
  plans.forEach(({ repo, plan }, i) => {
    const { row, col } = gridPlace(i, cols)
    const card = planCard(repo, plan, { keepVisible: true })
    card.setAttribute('data-place', `${row}:${col}`)
    host.appendChild(card)
  })
}

function renderArchive(model) {
  const host = document.getElementById('archive-list')
  const items = model.archive || []
  document.getElementById('archive-count').textContent = String(items.length)
  clear(host)
  if (!items.length) {
    host.removeAttribute('data-cols')
    host.appendChild(el('div', { class: 'dim', text: 'nothing archived' }))
    return
  }
  const cols = gridColumns(items.length)
  host.setAttribute('data-cols', String(cols))
  items.forEach((plan, i) => {
    const { row, col } = gridPlace(i, cols)
    const card = planCard(plan.repoRoot, plan, { keepVisible: true })
    card.setAttribute('data-place', `${row}:${col}`)
    host.appendChild(card)
  })
}

function renderGate(model) {
  const host = document.getElementById('gate-body')
  clear(host)
  const gate = model.gate || {}
  const chip = document.getElementById('gate-mode')
  if (!gate.available) {
    chip.textContent = 'not readable'
    host.appendChild(el('div', { class: 'dim', text: 'gate module not found — nothing is shown rather than guessed' }))
    return
  }
  const modes = (gate.modes || []).map((m) => `${m.sessionKey}: ${m.mode}`).join(' · ')
  chip.textContent = modes || 'no session'

  const grants = gate.grants || []
  if (grants.length) {
    const ul = el('ul', { class: 'list' })
    for (const g of grants) {
      ul.appendChild(el('li', { class: 'row' }, [
        el('div', { class: 'what' }, [
          el('div', { text: `${g.scope} · ${g.sessionKey}` }),
          el('div', { class: 'meta', text: `until ${g.until} · ${g.minutesLeft} min left${g.session ? ' · session grant' : ''}` }),
          enrolled ? revokeRow(g.sessionKey) : null,
        ]),
      ]))
    }
    host.appendChild(el('div', {}, [el('h3', { text: 'grants with time left' }), ul]))
  }

  const requests = gate.requests || []
  if (requests.length) {
    const ul = el('ul', { class: 'list' })
    for (const r of requests) {
      const what = el('div', { class: 'what' }, [
        el('div', {}, [el('span', { class: 'tag go', text: r.click ? 'open' : 'hard, no click possible' })]),
        el('div', {}, [el('code', { class: 'cmd', text: r.command || r.id })]),
      ])
      if (r.click) what.appendChild(copyRow(`GO ${r.sessionKey}`, 'copy GO text'))
      if (r.click && enrolled) what.appendChild(approveRow(r))
      ul.appendChild(el('li', { class: 'row' }, [what, el('div', { class: 'meta', text: ageText(now0() - r.ts) })]))
    }
    host.appendChild(el('div', {}, [el('h3', { text: 'open requests' }), ul]))
  }

  const blocks = gate.blocks || []
  if (blocks.length) {
    const ul = el('ul', { class: 'list' })
    for (const b of blocks.slice(0, 10)) {
      ul.appendChild(el('li', { class: 'row' }, [
        el('div', { class: 'what' }, [
          el('div', {}, [el('span', { class: b.hard ? 'tag blocked' : 'tag', text: b.hard ? 'hard block' : 'blocked' })]),
          el('div', {}, [el('code', { class: 'cmd', text: b.command || b.why || '' })]),
        ]),
        el('div', { class: 'meta', text: ageText(now0() - b.ts) }),
      ]))
    }
    host.appendChild(el('div', {}, [el('h3', { text: 'blocks' }), ul]))
  }

  for (const r of (gate.rejected || []).slice(0, 5)) host.appendChild(el('div', { class: 'meta', text: `ignored: ${r}` }))
}

const now0 = () => (modelNow || Date.now())
let modelNow = Date.now()

// Card layout, mirrored from lib/hub-model.mjs (kept tiny; the table tests in
// tests/agenttrail-v2-ui.test.mjs pin the two copies to the same behaviour).

// Collapsed by default: active, blocked, and the next pending entry.
const visibleEntries = (entries) => {
  const list = Array.isArray(entries) ? entries : []
  const shown = list.filter((e) => e.status === 'active' || e.status === 'blocked')
  const nextDue = list.find((e) => !e.status || e.status === 'pending')
  if (nextDue && !shown.includes(nextDue)) shown.push(nextDue)
  return shown
}

// From 6 visible entries the list wraps into 2-3 columns.
const entryColumns = (count) => {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (n < 6) return 1
  if (n <= 12) return 2
  return 3
}

// The board ends up wider than tall: a near-square grid of cards.
const gridColumns = (count) => {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (n <= 1) return 1
  return Math.min(5, Math.max(2, Math.ceil(Math.sqrt(n))))
}

// Row-major placement — index i sits at (row, col) in a c-column grid.
const gridPlace = (index, cols) => {
  const c = Math.max(1, Math.floor(Number(cols) || 1))
  const i = Math.max(0, Math.floor(Number(index) || 0))
  return { row: Math.floor(i / c), col: i % c }
}

const baseName = (p) => String(p || '').split('/').filter(Boolean).pop() || ''

// /v1/model -> the board shape the shared renderer (public/shared/map.js) draws.
// One plan = one board = one region. The key doubles as the region id, so it carries no colon.
function planBoard(repo, plan, sessions) {
  const comps = plan.components || []
  const tasks = plan.tasks || []
  const taskParent = new Map(tasks.map((t) => [t.id, t.parent]))
  const runs = sessions.map((x) => ({
    id: x.id,
    agent: x.harness || (x.harnesses || [])[0] || 'agent',
    ended: x.state !== 'working',
    componentId: (x.currentTask && taskParent.get(x.currentTask.id)) || null,
    startedAt: Date.parse(x.lastEventAt) || 0,
    todos: [], path: [], subagents: [], recentTools: [],
  }))
  const project = `${baseName(repo.root)} · ${plan.name || 'plan'}`
  return {
    port: String(plan.planKey || `${repo.root}/${plan.name}`).replace(/[^A-Za-z0-9_-]/g, '_'),
    project,
    session: { project },
    hasPlan: true,
    plan: [
      ...comps.map((c) => ({ level: 'component', id: c.id, title: c.title || c.id, status: c.status || 'pending', parent: null, needs: c.needs || [], links: c.links || [], tech: c.tech || '', by: '', kind: '', url: '' })),
      ...tasks.map((t) => ({ level: 'task', id: t.id, title: t.title || t.id, status: t.status || 'pending', parent: t.parent || null, needs: [], links: [], tech: '', by: '', src: '' })),
    ],
    runs,
    handoffs: [],
    activity: { at: Date.parse(plan.lastActivity) || 0 },
  }
}

let mapFitted = false

function renderMap(model) {
  const host = document.getElementById('graph')
  if (!host || typeof renderGraph !== 'function') return
  const sessions = model.sessions || []
  const boards = []
  const plans = []
  for (const repo of model.repos || []) for (const plan of repo.plans || []) plans.push({ repo, plan })
  // Each session belongs to the one plan whose owner/mirror path is the longest prefix of its cwd.
  const owned = plans.map(() => [])
  for (const x of sessions) {
    if (!x.cwd) continue
    let best = -1, bestLen = -1
    plans.forEach(({ plan }, i) => {
      for (const r of [plan.owner && plan.owner.path, ...(plan.mirrors || []).map((m) => m.path)].filter(Boolean)) {
        if ((x.cwd === r || String(x.cwd).startsWith(r + '/')) && r.length > bestLen) { best = i; bestLen = r.length }
      }
    })
    if (best >= 0) owned[best].push(x)
  }
  plans.forEach(({ repo, plan }, i) => boards.push(planBoard(repo, plan, owned[i])))
  renderJump(boards)
  W = boards
  M = boards[0] || null
  if (!boards.length) {
    host.textContent = 'no plan on the main view'
    lastGraphKey = ''
    mapFitted = false
    return
  }
  const key = JSON.stringify(boards) + '|' + String(graphZoom < CARD_LOD)
  if (key === lastGraphKey) return
  lastGraphKey = key
  graphNeedsFit = false
  renderGraph()
  if (!mapFitted) { mapFitted = true; requestAnimationFrame(fitWorld) }
}

// One chip per plan: click flies the map to its region. Rebuilt only when the plan list changes.
let jumpKey = ''
function renderJump(boards) {
  const host = document.getElementById('plan-jump')
  if (!host) return
  const key = boards.map((b) => b.port + b.project).join('|')
  if (key === jumpKey) return
  jumpKey = key
  clear(host)
  if (!boards.length) return
  const fit = el('button', { type: 'button', text: 'fit all' })
  fit.addEventListener('click', () => { if (typeof fitWorld === 'function') fitWorld() })
  host.appendChild(fit)
  for (const b of boards) {
    const btn = el('button', { type: 'button', text: b.project })
    btn.addEventListener('click', () => { if (typeof flyToRegion === 'function') flyToRegion(b.port) })
    host.appendChild(btn)
  }
}

function renderBar(model) {
  modelNow = Date.parse(model.now) || Date.now()
  document.getElementById('port').textContent = `port ${model.port ?? '—'}`
  const g = model.gate || {}
  enrolled = !!g.enrolled
  const note = document.getElementById('waiting-note')
  if (note) note.textContent = enrolled
    ? 'Approve asks for your fingerprint each time. It approves exactly the command shown, once. Typing GO still works.'
    : 'A GO request can only be answered by you, by typing it. Nothing on this page can approve anything. Run aos-trail enroll in your own terminal to enable Touch ID approval.'
  document.getElementById('gate').textContent = g.available ? `gate readable · ${(g.requests || []).length} open${enrolled ? ' · enrolled' : ''}` : 'gate not readable'
  document.getElementById('clock').textContent = new Date(modelNow).toLocaleTimeString()
}

function render(model) {
  renderBar(model)
  renderWaiting(model)
  renderSessions(model)
  renderPlans(model)
  renderMap(model)
  renderGate(model)
  renderArchive(model)
}

function refresh(fresh) {
  fetch(`/v1/model${fresh ? '?fresh=1' : ''}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { if (m) render(m) })
    .catch(() => {})
}

function connect() {
  if (typeof EventSource === 'undefined') { refresh(); return }
  const es = new EventSource('/v1/stream')
  es.onmessage = (ev) => {
    try { render(JSON.parse(ev.data)) } catch { /* a partial frame must not kill the board */ }
  }
  es.onerror = () => { /* the browser retries; the tick keeps the board fresh anyway */ }
}

function start() {
  if (!document.getElementById('waiting-list')) return false
  document.getElementById('archive-toggle').addEventListener('click', () => {
    const list = document.getElementById('archive-list')
    const open = list.hasAttribute('hidden')
    if (open) list.removeAttribute('hidden')
    else list.setAttribute('hidden', '')
    document.getElementById('archive-toggle').setAttribute('aria-expanded', String(open))
  })
  refresh(true)
  connect()
  setInterval(() => refresh(), 10000)
  return true
}

if (start()) globalThis.__trailStarted = true
globalThis.__trail = { planBoard, render, renderWaiting, renderSessions, renderPlans, renderGate, renderArchive, ageText, goText, doingText, el, clear, start, visibleEntries, entryColumns, gridColumns, gridPlace }