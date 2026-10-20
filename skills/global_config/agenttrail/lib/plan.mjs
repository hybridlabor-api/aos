// ---------- PLAN.md parser (convention v2: components, owner-first names) ----------
// `## Plain-language name {#id}` = a component of the system, not a phase.
// `tech:` under a component or task carries the engineer phrasing.
// `needs: [id]` = directed sequencing edge; `links: [id]` = undirected coupling.
const NODE_RE = /^##\s+(.+?)\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i
const TASK_RE = /^\s*[-*]\s+\[( |x|~|!)\]\s+(.+?)\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i
const NEEDS_RE = /^needs:\s*\[([^\]]*)\]\s*$/i
const LINKS_RE = /^links:\s*\[([^\]]*)\]\s*$/i
const FILES_RE = /^files:\s*\[([^\]]*)\]\s*$/i
const TECH_RE = /^\s*tech:\s*(.+?)\s*$/i
const BY_RE = /^\s*by:\s*(.+?)\s*$/i
const FROM_RE = /^\s*(?:from|horizon):\s*(agent|roadmap|now|backlog)\s*$/i
const KIND_RE = /^\s*kind:\s*([a-z][a-z-]*)\s*$/i
const URL_RE = /^\s*url:\s*(\S+)\s*$/i
const DECISIONS_RE = /^##\s+decisions\s*$/i
const idList = s => s.split(',').map(x => x.trim()).filter(Boolean)

export function parsePlan(text) {
  const nodes = [] // ordered
  const decisions = []
  let title = ''
  let curComponent = null
  let lastNode = null // tech: lines attach to the most recent component or task
  let inDecisions = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!title && /^#\s+/.test(line)) { title = line.replace(/^#\s+/, ''); continue }
    if (DECISIONS_RE.test(line)) { inDecisions = true; curComponent = null; lastNode = null; continue }
    let m
    if ((m = line.match(NODE_RE))) {
      inDecisions = false
      curComponent = { id: m[2], title: m[1], level: 'component', parent: null, needs: [], links: [], files: [], tech: '', by: '', kind: '', url: '', status: 'pending' }
      lastNode = curComponent
      nodes.push(curComponent)
      continue
    }
    if (inDecisions) {
      if (/^\s*[-*]\s+/.test(line)) decisions.push(line.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    if ((m = line.match(TASK_RE))) {
      const status = m[1] === 'x' ? 'done' : m[1] === '~' ? 'active' : m[1] === '!' ? 'blocked' : 'pending'
      lastNode = { id: m[3], title: m[2], level: 'task', parent: curComponent ? curComponent.id : null, needs: [], links: [], tech: '', by: '', src: '', status }
      nodes.push(lastNode)
      continue
    }
    if ((m = line.match(TECH_RE))) { if (lastNode) lastNode.tech = m[1]; continue }
    if ((m = line.match(KIND_RE))) { if (curComponent) curComponent.kind = m[1].toLowerCase(); continue }
    if ((m = line.match(URL_RE))) { if (curComponent) curComponent.url = m[1]; continue }
    if ((m = line.match(BY_RE))) { if (lastNode) lastNode.by = m[1]; continue }
    if ((m = line.match(FROM_RE))) { if (lastNode) { const v = m[1].toLowerCase(); lastNode.src = v === 'now' ? 'agent' : v === 'backlog' ? 'roadmap' : v } continue }
    if ((m = line.match(NEEDS_RE))) { if (curComponent) curComponent.needs = idList(m[1]); continue }
    if ((m = line.match(LINKS_RE))) { if (curComponent) curComponent.links = idList(m[1]); continue }
    if ((m = line.match(FILES_RE))) { if (curComponent) curComponent.files = idList(m[1]); continue }
  }
  // derive component status from its tasks — blocked wins (it demands attention)
  for (const c of nodes.filter(n => n.level === 'component')) {
    const kids = nodes.filter(n => n.parent === c.id)
    if (kids.some(k => k.status === 'blocked')) c.status = 'blocked'
    else if (kids.some(k => k.status === 'active')) c.status = 'active'
    else if (kids.length && kids.every(k => k.status === 'done')) c.status = 'done'
  }
  return { nodes, decisions, title }
}

export function lintPlan(parsed, planText) {
  const out = []
  const comps = parsed.nodes.filter(n => n.level === 'component')
  const tasks = parsed.nodes.filter(n => n.level === 'task')
  if (!planText.length || (comps.length === 1 && tasks.length <= 1)) return out
  const ids = new Set()
  for (const n of parsed.nodes) { if (ids.has(n.id)) out.push(`duplicate id {#${n.id}}`); ids.add(n.id) }
  const compIds = new Set(comps.map(c => c.id))
  for (const c of comps) {
    for (const e of [...c.needs, ...c.links]) if (!compIds.has(e)) out.push(`${c.id}: edge to unknown component "${e}"`)
    if (!c.files.length) out.push(`${c.id}: no files: globs — the live layer can't pin work to it`)
  }
  for (const t of tasks) if (t.status === 'done' && !t.tech) out.push(`[x] "${t.title}" cites no evidence (tech: line)`)
  if (comps.length > 9) out.push(`${comps.length} components — over the 5–9 governor, consider merging`)
  return out.slice(0, 12)
}
// First open (declared `- [ ]`, in file order) task under a component — what an
// AOS_TRAIL_NODE worker's node maps to while it works. Blocked and done tasks
// are never auto-promoted.
export function firstOpenTaskId(nodes, componentId) {
  for (const n of nodes) if (n.level === 'task' && n.parent === componentId && n.status === 'pending') return n.id
  return null
}

// Ticking from the outside in: a worker or dispatcher names a task id and a
// mode — --doing (`[~]`), --done (`[x]`, the default), --todo (`[ ]`). Exactly
// the one line carrying `{#<task-id>}` moves between the states each mode
// accepts (done takes in-progress work too, todo takes done work back). The
// from value is the character class of the mark it may sit on — its own
// brackets are part of the pattern (so it needs literal-bracket escapes
// around it), to is the mark written.
const TICK_MODES = {
  doing: { from: '[ ]', to: '~' },
  done: { from: '[ ~]', to: 'x' },
  todo: { from: '[~x]', to: ' ' }
}
export function tickTask(text, taskId, mode = 'done') {
  const m = TICK_MODES[mode]
  if (!m) return { text, changed: false }
  const matches = [...String(text || '').matchAll(new RegExp(`^\\s*[-*]\\s+\\[${m.from}\\]\\s+.*\\{#${taskId}\\}\\s*$`, 'gm'))]
  if (matches.length !== 1) return { text, changed: false }
  const line = matches[0][0]
  const flipped = line.replace(/^(\s*[-*]\s+)\[.\]/, `$1[${m.to}]`)
  return { text: String(text).replace(line, flipped), changed: true }
}
