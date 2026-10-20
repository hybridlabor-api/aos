// Loads the real public/shared/map.js in a vm context with a minimal DOM stub
// and runs the render/layout functions against a model snapshot (plan + runs).
// Regression guard: a runtime exception in any of these stops the first paint
// and leaves the page stuck on "Connecting to the live monitor…".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAP = path.join(root, 'skills/global_config/agenttrail/public/shared/map.js')
const CSS = path.join(root, 'skills/global_config/agenttrail/public/shared/map.css')

function makeEl(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    style: { cssText: '', display: '', setProperty() {} },
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false } },
    setAttribute() {}, getAttribute() { return null },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null },
    querySelectorAll() { return [] },
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800 } },
    appendChild() {},
    closest() { return null },
    onclick: null,
  }
}

function loadMap() {
  const els = new Map()
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id) }
  const storage = new Map()
  const sandbox = {
    console, Date, Math, JSON, Set, String, Number, Object, Array,
    requestAnimationFrame: () => {},
    setTimeout, clearTimeout,
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: {
      documentElement: { dataset: {} },
      body: makeEl('body'),
      title: '',
      getElementById: (id) => getEl(id),
      createElement: (tag) => makeEl(tag),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    window: { addEventListener() {}, open() {} },
  }
  sandbox.window.document = sandbox.document
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(MAP, 'utf8'), sandbox, { filename: 'map.js' })
  return sandbox
}

function setM(sb, model) { vm.runInContext(`M = ${JSON.stringify(model)}`, sb) }

function modelSnapshot() {
  const now = Date.now()
  const comps = []
  const needsPool = [[], ['c1'], ['c1'], ['c2'], ['c3'], ['c3'], ['c4'], ['c5'], ['c6'], ['c7'], ['c8'], ['c9']]
  for (let i = 1; i <= 12; i++) {
    comps.push({
      id: `c${i}`, level: 'component', parent: null, title: `Component ${i} with a fairly long title`,
      status: i === 5 ? 'active' : i < 5 ? 'done' : 'pending', kind: i === 1 ? 'human' : 'agent',
      tech: `tech${i}`, needs: needsPool[i - 1], links: [], laneLabel: i > 6 ? 'Lane B' : 'Lane A',
      filesList: [], recent: i === 5 ? [{ file: 'src/app/map.js', at: now - 5000, n: 2 }] : [],
      touchedAt: i === 5 ? now - 5000 : null, by: i === 5 ? 'claude' : null,
    })
  }
  comps.push({ id: 'c13', level: 'component', parent: null, title: 'Wrap 13th', status: 'pending', kind: 'agent', tech: 't', needs: ['c1'], links: [], filesList: [], recent: [], touchedAt: null, by: null })
  const tasks = []
  for (let i = 1; i <= 12; i++) {
    for (let t = 1; t <= (i % 3) + 1; t++) {
      tasks.push({ id: `c${i}-t${t}`, level: 'task', parent: `c${i}`, title: `Task ${t} of ${i}`, status: t === 1 && i === 5 ? 'active' : 'done', tech: '', needs: [], by: 'claude' })
    }
  }
  // A task whose parent is not in the plan (and one with parent null) — both must not throw.
  tasks.push({ id: 'orphan-t', level: 'task', parent: 'ghost', title: 'Orphan', status: 'active', tech: '', needs: [], by: 'claude' })
  tasks.push({ id: 'nullparent-t', level: 'task', parent: null, title: 'No parent', status: 'active', tech: '', needs: [], by: 'claude' })
  return {
    port: 43110, project: 'demo', session: { project: 'demo', id: 's1' }, planFile: null, hasPlan: true,
    plan: [...comps, ...tasks], aosPlan: true,
    runs: [{ id: 'r1', agent: 'claude', componentId: 'c5', ended: false, startedAt: now - 60000, todos: [{ content: 'todo a', status: 'in_progress' }, { content: 'todo b', status: 'pending' }], path: [{ c: 'c4', at: now - 30000 }, { c: 'c5', at: now - 10000 }], subagents: [], recentTools: [{ name: 'Read', detail: 'map.js', at: now - 4000, ms: 12 }] }],
    handoffs: [], hotFiles: {}, asks: [], activity: { at: now - 30000 }, recentActivity: [{ file: 'src/app/map.js', at: now - 5000, n: 2 }], tree: [], planStale: { stale: false, minutes: 0 }, lints: [],
  }
}

test('renderGraph() runs the real map.js against a plan+runs snapshot without throwing', () => {
  const sb = loadMap()
  setM(sb, modelSnapshot())
  sb.renderGraph()
  assert.ok(sb.document.getElementById('graph').innerHTML.length > 1000, 'graph markup rendered')
})

test('task lookups tolerate a model without plan (first render before data)', () => {
  const sb = loadMap()
  assert.equal(sb.graphTaskIsOpen({ id: 't', parent: 'p', status: 'active' }), false)
  setM(sb, { ...modelSnapshot(), plan: undefined })
  assert.equal(sb.graphTaskIsOpen({ id: 't', parent: 'p', status: 'active' }), false)
  assert.equal(sb.kids('x').length, 0) // vm-realm array: deepStrictEqual fails on the foreign prototype
})

test('expanded lists with more than 3 tasks get the scroll class and CSS caps them at 360px', () => {
  const sb = loadMap()
  const m = modelSnapshot()
  for (let t = 1; t <= 5; t++) m.plan.push({ id: `c5-many${t}`, level: 'task', parent: 'c5', title: `Bulk ${t}`, status: 'pending', tech: '', needs: [], by: 'claude' })
  setM(sb, m)
  sb.renderGraph()
  assert.match(sb.document.getElementById('graph').innerHTML, /task-capsules list scroll/)
  const css = fs.readFileSync(CSS, 'utf8')
  assert.match(css, /\.task-capsules\.list\.scroll\{[^}]*max-height:360px[^}]*overflow-y:auto/)
})

test('12 parallel nodes + 1 merge node lay out at most 2:1 wide (height <= width)', () => {
  const sb = loadMap()
  const phases = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, level: 'component', parent: null, title: `P${i}`, status: 'pending', needs: [], links: [] }))
  phases.push({ id: 'merge', level: 'component', parent: null, title: 'Merge', status: 'pending', needs: phases.map((p) => p.id), links: [] })
  setM(sb, { port: 1, session: { project: 'x' }, plan: phases, runs: [] })
  const L = sb.laneLayout(phases)
  for (const p of phases) assert.ok(Number.isFinite(L.pos[p.id].x) && Number.isFinite(L.pos[p.id].y), `finite coords for ${p.id}`)
  assert.ok(new Set(phases.slice(0, 12).map((p) => L.pos[p.id].x)).size > 1, 'rank wrapped into several sub-columns')
  assert.ok(L.pos.merge.x > Math.max(...phases.slice(0, 12).map((p) => L.pos[p.id].x)), 'merge stays to the right of its inputs')
  assert.ok(L.height <= L.width, `bounding box ${L.width}x${L.height}`)
})
