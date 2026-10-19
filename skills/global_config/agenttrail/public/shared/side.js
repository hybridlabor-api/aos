// Map side panel: project/plan switchers, "Needs you" GO cards, sessions, gate modes.
// Text nodes only (no innerHTML with data). Talks to this map server: GET /side/model, POST /side/decision.
(() => {
  const $ = (id) => document.getElementById(id)
  const TOKEN = (document.querySelector('meta[name="trail-side-token"]') || {}).content || ''
  const wide = () => matchMedia('(min-width:1100px)').matches
  let model = null, open = wide(), scopes = {}, busy = new Set(), lastSwitchSig = ''
  try { const v = localStorage.getItem('at-side'); if (v) open = v === '1' } catch { /* private mode */ }

  function el(tag, cls, text, attrs) {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    for (const k in attrs || {}) n.setAttribute(k, attrs[k])
    return n
  }
  const ago = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? s + 's' : s < 5400 ? Math.round(s / 60) + 'm' : s < 172800 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd' }
  const chip = (text, cls) => el('span', 'chip ' + (cls || text), text)

  function setOpen(v) {
    open = v
    try { localStorage.setItem('at-side', v ? '1' : '0') } catch { /* ignore */ }
    document.querySelector('.workspace').classList.toggle('side-on', open)
    $('side').hidden = !open
    $('side-toggle').setAttribute('aria-expanded', String(open))
  }

  function toast(msg) { const t = $('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 5000) }

  async function decide(id, decision) {
    if (busy.has(id)) return
    busy.add(id); render()
    try {
      const r = await fetch('side/decision', { method: 'POST', headers: { 'content-type': 'application/json', 'x-trail-csrf': TOKEN }, body: JSON.stringify({ id, decision, scope: scopes[id] || 'once' }) })
      const j = await r.json().catch(() => ({}))
      toast(r.ok ? (decision === 'approve' ? 'Approved (' + (scopes[id] || 'once') + ')' : 'Denied') : 'Rejected: ' + (j.error || r.status))
    } catch { toast('Could not reach the map server') }
    busy.delete(id); refresh()
  }

  function goCard(r) {
    const c = el('article', 'go', null, { 'aria-label': 'GO request from ' + r.session })
    const top = el('div', 'go-top')
    top.append(chip(r.risk, r.risk === 'destructive' || r.risk === 'hard' ? 'bad' : 'warn'), el('span', 'muted small', ago(r.age) + ' ago'))
    const who = el('div', 'go-who'); who.append('Session ', el('b', null, r.session))
    const cmd = el('div', 'cmd'); cmd.append(el('code', null, r.command || '(command hidden)'))
    c.append(top, who, cmd)
    if (!r.decidable) { c.append(el('p', 'muted small', 'Hard block: needs a typed GO in the session.')); return c }
    const act = el('div', 'go-act')
    const lab = el('label', null, 'Scope ')
    const sel = el('select', null, null, { 'aria-label': 'Approval scope' })
    for (const [v, t] of [['once', 'Once'], ['15m', '15 min'], ['session', 'Session']]) { const o = el('option', null, t); o.value = v; sel.append(o) }
    sel.value = scopes[r.id] || 'once'
    sel.addEventListener('change', () => { scopes[r.id] = sel.value })
    lab.append(sel)
    const ok = el('button', 'btn primary', 'Approve', { type: 'button' }), no = el('button', 'btn', 'Deny', { type: 'button' })
    ok.disabled = no.disabled = busy.has(r.id)
    ok.addEventListener('click', () => decide(r.id, 'approve'))
    no.addEventListener('click', () => decide(r.id, 'deny'))
    act.append(lab, ok, no)
    c.append(act)
    return c
  }

  function render() {
    if (!model) return
    const n = model.requests.length
    $('need-n').textContent = n ? String(n) : ''
    $('need-n').hidden = !n
    const needs = $('side-needs'); needs.textContent = ''
    if (!model.available) needs.append(el('p', 'muted small', 'Go-gate module not found; no requests to show.'))
    else if (!n) needs.append(el('p', 'muted small', 'Nothing waiting for you.'))
    for (const r of model.requests) needs.append(goCard(r))

    const sess = $('side-sessions'); sess.textContent = ''
    if (!model.sessions.length) sess.append(el('p', 'muted small', 'No registered sessions.'))
    for (const s of model.sessions) {
      const row = el('div', 'sess')
      const a = el('div', 's1'); a.append(el('b', null, s.name), chip(s.status, s.status === 'working' ? 'running' : 'idle'))
      const b = el('div', 's2'); b.append(el('span', 'role r-' + s.role, s.role), el('span', null, s.harness), el('span', null, s.lastSeen ? 'seen ' + ago(model.now - s.lastSeen) + ' ago' : 'seen unknown'))
      row.append(a, b); sess.append(row)
    }
    const gm = $('side-gate'); gm.textContent = ''
    if (!model.modes.length) gm.append(el('p', 'muted small', 'No gate state yet.'))
    for (const m of model.modes) { const row = el('div', 'gm'); row.append(el('span', null, m.session), chip(m.mode, 'mode')); gm.append(row) }
    for (const g of model.grants) { const row = el('div', 'gm'); row.append(el('span', null, g.sessionKey + ' / ' + g.scope), el('span', 'muted small', g.minutesLeft + 'm left')); gm.append(row) }
  }

  async function refresh() {
    try { model = await (await fetch('side/model')).json(); render() } catch { /* server restarting */ }
  }

  // Project / plan switchers are built from the boards the page already tracks (W / M globals).
  function switchers() {
    const boards = (typeof boardsAll === 'function' ? boardsAll() : []) || []
    const sig = JSON.stringify(boards.map((b) => [b.port, b.project, b.planFile])) + (typeof M !== 'undefined' && M ? M.port : '')
    if (sig === lastSwitchSig) return
    lastSwitchSig = sig
    const cur = typeof M !== 'undefined' && M ? M.port : null
    const sp = $('sw-proj'), sl = $('sw-plan')
    sp.textContent = ''
    const projects = [...new Map(boards.map((b) => [b.project, b])).values()]
    for (const b of projects) { const o = el('option', null, b.project); o.value = String(b.port); sp.append(o) }
    const curBoard = boards.find((b) => b.port === cur) || boards[0]
    if (curBoard) sp.value = String((projects.find((b) => b.project === curBoard.project) || curBoard).port)
    sl.textContent = ''
    for (const b of boards.filter((x) => curBoard && x.project === curBoard.project)) { const o = el('option', null, b.planFile || 'PLAN.md'); o.value = String(b.port); sl.append(o) }
    if (curBoard) sl.value = String(curBoard.port)
    const known = el('optgroup', null, null, { label: 'Known repos (start map)' })
    window.__knownRepos = window.__knownRepos || null
    if (window.__knownRepos) for (const p of window.__knownRepos) { const o = el('option', null, p.split('/').pop()); o.value = 'repo:' + p; known.append(o) }
    if (known.children.length) sp.append(known)
  }
  const go = (v) => {
    if (v.startsWith('repo:') && typeof pickSuggestion === 'function') { pickSuggestion(v.slice(5)); return }
    const port = +v
    if (typeof flyToRegion === 'function') flyToRegion(port)
    if (port !== (typeof M !== 'undefined' && M ? M.port : port)) toast('Showing board on :' + port)
  }

  window.addEventListener('DOMContentLoaded', () => {
    $('side-toggle').addEventListener('click', () => setOpen(!open))
    $('side-close').addEventListener('click', () => setOpen(false))
    $('sw-proj').addEventListener('change', (e) => { go(e.target.value); lastSwitchSig = '' })
    $('sw-plan').addEventListener('change', (e) => go(e.target.value))
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && !wide()) setOpen(false) })
    matchMedia('(min-width:1100px)').addEventListener('change', (e) => setOpen(e.matches))
    setOpen(open)
    fetch('suggest').then((r) => r.json()).then((l) => { window.__knownRepos = Array.isArray(l) ? l.slice(0, 20) : []; lastSwitchSig = '' }).catch(() => {})
    refresh(); switchers(); setInterval(refresh, 3000); setInterval(switchers, 700)
  })
})()
