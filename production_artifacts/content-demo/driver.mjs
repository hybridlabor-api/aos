#!/usr/bin/env node
// Replays a fictional 36 s "live build" of the Pulse demo plan: edits PLAN.md and posts trail-event/1 events.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PLAN_SRC = path.join(HERE, 'PLAN.md')
export const DEFAULT_DIR = '/tmp/pulse-demo'
export const PLAN_TITLE = '# Launch: Pulse show-control app'
export const AGENTS = ['claude', 'codex', 'agy', 'opencode']
export const SESSIONS = AGENTS.map((agent, i) => ({
  agent,
  id: `demo-${i + 1}`,
  name: ['pulse-orch', 'pulse-ui', 'pulse-engine', 'pulse-qa'][i],
}))

const NODE_RE = /^##\s+(.+?)\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i
const TASK_RE = /^\s*[-*]\s+\[( |x|~|!)\]\s+(.+?)\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i
const LIST_RE = /^(needs|files):\s*\[([^\]]*)\]\s*$/i
const BY_RE = /^(\s*by:\s*)(\S+)\s*$/i

export function parsePlan(text) {
  const comps = []
  const tasks = []
  let title = ''
  let cur = null
  let last = null
  for (const line of text.split('\n')) {
    let m
    if (!title && /^#\s+/.test(line)) { title = line.replace(/^#\s+/, ''); continue }
    if ((m = line.match(NODE_RE))) { cur = { id: m[2], title: m[1], needs: [], files: [] }; comps.push(cur); last = null; continue }
    if ((m = line.match(TASK_RE))) { last = { id: m[3], title: m[2], comp: cur?.id ?? null, mark: m[1], by: '' }; tasks.push(last); continue }
    if ((m = line.match(BY_RE))) { if (last) last.by = m[2]; continue }
    if ((m = line.match(LIST_RE))) { if (cur) cur[m[1].toLowerCase()] = m[2].split(',').map((s) => s.trim()).filter(Boolean) }
  }
  return { title, comps, tasks }
}

export function applyEdit(text, { taskId, mark, by }) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => TASK_RE.test(l) && l.includes(`{#${taskId}}`))
  if (i < 0) throw new Error(`task ${taskId} not found`)
  if (mark) lines[i] = lines[i].replace(/\[( |x|~|!)\]/, `[${mark}]`)
  if (by) {
    for (let j = i + 1; j < Math.min(i + 4, lines.length) && !TASK_RE.test(lines[j]); j += 1) {
      if (BY_RE.test(lines[j])) { lines[j] = lines[j].replace(BY_RE, `$1${by}`); break }
    }
  }
  return lines.join('\n')
}

function atomicEdit(file, edit) {
  const next = applyEdit(fs.readFileSync(file, 'utf8'), edit)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, next)
  fs.renameSync(tmp, file)
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FILES = {
  'brand-site': ['site/index.html', 'site/hero.css', 'site/pricing.html', 'site/copy/launch.md'],
  'core-engine': ['src/engine/clock.ts', 'src/engine/cues.ts', 'src/engine/history.ts', 'src/engine/project.ts', 'src/engine/autosave.ts'],
  'cue-editor': ['ui/CueList.tsx', 'ui/Timeline.tsx', 'ui/Inspector.tsx', 'ui/shortcuts.ts', 'ui/theme.css'],
  'hw-bridges': ['src/bridges/artnet.ts', 'src/bridges/osc.ts', 'src/bridges/discovery.ts', 'src/bridges/latency.ts'],
  'qa-release': ['tests/e2e/rehearsal.spec.ts', 'tests/soak/run8h.ts', 'build/installers.mjs', 'scripts/release.sh'],
  docs: ['docs/quickstart.md', 'docs/reference.md', 'docs/release-notes.md'],
}
const TOOLS = ['Edit', 'Write', 'Bash']
const BASH = ['npm test', 'npm run lint', 'npm run build', 'node scripts/check.mjs']
const NOTES = ['Looks good so far', 'Running the checks again', 'Tightening the edge cases', 'Wiring it into the main flow', 'Small cleanup pass']
const WAIT_TASK = 'release-tag'
const STUCK_NOTE = 'No devices answer on the subnet'

// Pure and deterministic: same plan + duration + cwd => same steps.
export function buildTimeline(plan, duration = 36, cwd = DEFAULT_DIR) {
  const rng = mulberry32(1337)
  const D = duration * 1000
  const k = D / 36000
  const out = []
  const push = (atMs, events, edit) => out.push({ atMs: Math.round(atMs), ...(edit ? { edit } : {}), events })
  const ev = (s, kind, extra = {}) => ({ v: 1, agent: s.agent, session: { id: s.id, name: s.name }, cwd, kind, ...extra })
  const sess = (agent) => SESSIONS[AGENTS.indexOf(agent)] ?? SESSIONS[0]
  const task = (t, status) => ({ id: t.id, status, plan: 'PLAN.md' })

  SESSIONS.forEach((s, i) => push(i * 150 * k, [ev(s, 'session.start', { message: `${s.name} online` })]))

  const active = plan.tasks.filter((t) => t.mark !== 'x')
  const stuck = active.find((t) => t.mark === '!')
  if (stuck) {
    const s = sess(stuck.by)
    push(400 * k, [ev(s, 'task.update', { task: task(stuck, 'stuck') })])
    push(900 * k, [ev(s, 'blocker', { message: STUCK_NOTE })])
  }

  const eligible = active.filter((t) => t.mark !== '!' && t.id !== WAIT_TASK)
  const handoff = new Map()
  eligible.forEach((t, i) => {
    if (i % 5 === 3) handoff.set(t.id, AGENTS[(AGENTS.indexOf(t.by) + 1 + (i % 3)) % AGENTS.length])
  })

  const end = D - 900 * k
  AGENTS.forEach((agent, li) => {
    const lane = active.filter((t) => t.by === agent)
    const si = lane.findIndex((t) => t.mark === '!')
    if (si > 1) lane.splice(1, 0, lane.splice(si, 1)[0])
    const gap = 120 * k
    const first = (900 + li * 220) * k
    const weights = lane.map(() => 0.8 + 0.5 * rng())
    const wsum = weights.reduce((a, b) => a + b, 0)
    const unit = (end - first - gap * (lane.length - 1)) / wsum
    let s0 = first
    lane.forEach((t, ti) => {
      const len = unit * weights[ti]
      const e0 = s0 + len
      const home = sess(t.by)
      const hand = handoff.get(t.id)
      const mid = s0 + len / 2
      const files = FILES[t.comp] ?? FILES.docs
      const pick = () => files[Math.floor(rng() * files.length)]

      push(s0, [ev(home, 'task.update', { task: task(t, 'doing') }), ev(home, 'note', { message: t.mark === '!' ? 'Found devices via multicast fallback' : `Starting: ${t.title}` })], { taskId: t.id, mark: '~' })
      if (hand) {
        const to = sess(hand)
        push(mid, [ev(home, 'note', { message: `Handing off to ${to.name}` }), ev(to, 'task.update', { task: task(t, 'doing') })], { taskId: t.id, by: hand })
      }
      if (t.id === WAIT_TASK) {
        push(s0 + len * 0.35, [ev(home, 'waiting', { message: 'needs a GO for the release tag' })])
        push(s0 + len * 0.7, [ev(home, 'note', { message: 'GO received, tagging' })])
      }

      let now = s0 + 450 * k
      while (now < e0 - 450 * k) {
        const s = hand && now >= mid ? sess(hand) : home
        const tool = TOOLS[Math.floor(rng() * TOOLS.length)]
        const detail = tool === 'Bash' ? BASH[Math.floor(rng() * BASH.length)] : pick()
        const info = { tool: { name: tool, detail }, ...(tool === 'Bash' ? {} : { file: detail }) }
        const burst = now >= 20000 * k && now <= 25000 * k
        push(now, [ev(s, 'tool.pre', info)])
        push(now + 220 * k, [ev(s, 'tool.post', info)])
        if (rng() < 0.3) push(now + 330 * k, [ev(s, 'note', { message: NOTES[Math.floor(rng() * NOTES.length)] })])
        now += (burst ? 380 : 950 + rng() * 300) * k
      }

      const fin = hand ? sess(hand) : home
      push(e0, [ev(fin, 'tool.post', { tool: { name: 'Bash', detail: 'npm test' } }), ev(fin, 'task.update', { task: task(t, 'done') })], { taskId: t.id, mark: 'x' })
      s0 = e0 + gap
    })
  })

  SESSIONS.forEach((s, i) => push(D - 150 * k + i * 30 * k, [ev(s, 'session.stop')]))
  return out.map((s, i) => [s, i]).sort((a, b) => a[0].atMs - b[0].atMs || a[1] - b[1]).map(([s]) => s)
}

export function checkDir(dir) {
  if (!path.isAbsolute(dir)) throw new Error('--dir must be an absolute path')
  const user = os.userInfo().username
  if ((user && user.length > 2 && dir.includes(user)) || dir === os.homedir() || dir.startsWith(os.homedir() + path.sep)) {
    throw new Error('--dir must not be inside the home directory or contain the username')
  }
}

function setup(dir) {
  checkDir(dir)
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir)
    const plan = path.join(dir, 'PLAN.md')
    const ours = entries.includes('PLAN.md') && fs.readFileSync(plan, 'utf8').startsWith(PLAN_TITLE)
    if (entries.length && !ours) throw new Error(`${dir} is not empty and holds no PLAN.md of this demo`)
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(PLAN_SRC, path.join(dir, 'PLAN.md'))
  console.log(`copied PLAN.md to ${dir}`)
  if (fs.existsSync(path.join(dir, '.git'))) return console.log('.git exists, no git init')
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' })
  execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' })
  git('config', 'user.name', 'demo')
  git('config', 'user.email', 'demo@example.invalid')
  git('add', 'PLAN.md')
  git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init demo')
  console.log('git init + commit "init demo"')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function post(port, events) {
  const body = JSON.stringify(events.map((e) => ({ ...e, ts: new Date().toISOString() })))
  return fetch(`http://127.0.0.1:${port}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(300),
  }).catch(() => {})
}

function parseArgs(argv) {
  const o = { dir: DEFAULT_DIR, duration: 36, speed: 1, port: 5350, dryRun: false, setup: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--dry-run') o.dryRun = true
    else if (a === '--setup') o.setup = true
    else if (a === '--dir') o.dir = argv[++i]
    else if (a === '--duration') o.duration = Number(argv[++i])
    else if (a === '--speed') o.speed = Number(argv[++i])
    else if (a === '--port') o.port = Number(argv[++i])
    else throw new Error(`unknown argument ${a}`)
  }
  if (!(o.duration > 0) || !(o.speed > 0) || !(o.port > 0)) throw new Error('duration, speed and port must be positive numbers')
  return o
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.setup) return setup(o.dir)
  let planFile
  if (o.dryRun) {
    planFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-dry-')), 'PLAN.md')
    fs.copyFileSync(PLAN_SRC, planFile)
    o.speed = 50
  } else {
    checkDir(o.dir)
    planFile = path.join(o.dir, 'PLAN.md')
    if (!fs.existsSync(planFile)) throw new Error(`no PLAN.md in ${o.dir}, run --setup first`)
  }
  const steps = buildTimeline(parsePlan(fs.readFileSync(planFile, 'utf8')), o.duration, o.dir)
  const pending = []
  let edits = 0
  let events = 0
  const t0 = performance.now()
  for (const s of steps) {
    const wait = s.atMs / o.speed - (performance.now() - t0)
    if (wait > 0) await sleep(wait)
    const t = (s.atMs / 1000).toFixed(2).padStart(6)
    if (s.edit) {
      atomicEdit(planFile, s.edit)
      edits += 1
      if (o.dryRun) console.log(`${t}s EDIT ${JSON.stringify(s.edit)}`)
    }
    events += s.events.length
    if (o.dryRun) for (const e of s.events) console.log(`${t}s EVENT ${JSON.stringify(e)}`)
    else pending.push(post(o.port, s.events))
  }
  await Promise.allSettled(pending)
  console.log(`summary: ${steps.length} steps, ${edits} plan edits, ${events} events${o.dryRun ? ` (dry run, plan copy ${planFile})` : ''}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(String(e.message || e)); process.exitCode = 1 })
}
