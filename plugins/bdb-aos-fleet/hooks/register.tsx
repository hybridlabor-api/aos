import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetActivity, FleetProgress, FleetRole, FleetSelf, FleetSession, GateBlock, GateState } from '../types'

const PANE = 'aos-fleet'
const GATE_PANE = 'gogate-panel'
const STALE_MS = 5 * 60_000
const ROLES: FleetRole[] = ['master', 'task-manager', 'orchestrator', 'worker']
const ATTENTION_PHASES = ['ready_to_ship', 'escalated']

const fleet = atom({ plugin: 'bdb-aos-fleet', key: 'fleet' } as const, [])
const frame_ = atom({ plugin: 'bdb-aos-fleet', key: 'frame' } as const, 0)
const gate = atom({ plugin: 'bdb-aos-fleet', key: 'gate' } as const, { mode: 'soft', grants: [], raw: '' })
const gateMsg = atom({ plugin: 'bdb-aos-fleet', key: 'gateMsg' } as const, '')
const blocks = atom({ plugin: 'bdb-aos-fleet', key: 'blocks' } as const, [] as GateBlock[])
const self = atom({ plugin: 'bdb-aos-fleet', key: 'self' } as const, {
  activity: 'idle',
})

export const roleFromName = (name: string): FleetRole =>
  /master/i.test(name)
    ? 'master'
    : /task.?manager/i.test(name)
      ? 'task-manager'
      : /orchestr/i.test(name)
        ? 'orchestrator'
        : 'worker'

export const groupProjects = (list: readonly FleetSession[]) => {
  const projects = new Map<string, FleetSession[]>()
  for (const s of list) {
    const key = s.repo ? `${s.repo}${s.branch ? `@${s.branch}` : ''}` : '(no repo)'
    projects.set(key, [...(projects.get(key) ?? []), s])
  }
  return [...projects].map(([key, sessions]) => ({
    key,
    sessions,
    phase: sessions.find(s => s.phase)?.phase,
  }))
}

const RANK: Record<FleetActivity, number> = { attention: 0, working: 1, idle: 2 }
const CARD = 18
const ROLE_COLOR: Record<FleetRole, number> = {
  master: 0xd97757,
  'task-manager': 0xd4709a,
  orchestrator: 0x6a9be0,
  worker: 0x6cc4b0,
}
const DEFAULT_COLOR = 0x01000000

const SPRITE_W = 8
const SPRITE_BODY = ['.XXXXXX.', 'XX.XX.XX', '.XXXXXX.']
const SPRITE_LEGS = [['.X....X.'], ['X.X..X.X']]

const dim = (rgb: number) =>
  (((rgb >> 16) & 0xff) * 0.4) << 16 | (((rgb >> 8) & 0xff) * 0.4) << 8 | ((rgb & 0xff) * 0.4)

export const roleColor = (s: FleetSession) =>
  s.activity === 'idle' ? dim(ROLE_COLOR[s.role]) : ROLE_COLOR[s.role]

export const fit = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`

// Half blocks pack two sprite pixel rows into one terminal row.
export function spriteCells(s: FleetSession, frame: number) {
  const color = roleColor(s)
  const pixels = [...SPRITE_BODY, ...SPRITE_LEGS[s.activity === 'working' ? frame % 2 : 0]!]
  const words: number[] = []
  for (let r = 0; r < pixels.length; r += 2) {
    for (let c = 0; c < SPRITE_W; c++) {
      const top = pixels[r]![c] === 'X'
      const bottom = pixels[r + 1]![c] === 'X'
      const glyph = top && bottom ? 0x2588 : top ? 0x2580 : bottom ? 0x2584 : 0x20
      words.push(glyph, glyph === 0x20 ? DEFAULT_COLOR : color, DEFAULT_COLOR)
    }
  }
  const bytes = new Uint8Array(Uint32Array.from(words).buffer) as Uint8Array & { toBase64(): string }
  return bytes.toBase64()
}

const DOT: Record<FleetActivity, { glyph: string; color: string }> = {
  attention: { glyph: '▲', color: 'yellow' },
  working: { glyph: '●', color: 'green' },
  idle: { glyph: '○', color: 'gray' },
}

const PRESETS = [
  { label: 'release 2h', text: 'gogate grant push-feature,github-write,merge,publish 2h', frees: 'push-feature · github-write · merge · publish', color: 'red' },
  { label: 'feature 2h', text: 'gogate grant push-feature,github-write 2h', frees: 'push-feature · github-write', color: 'yellow' },
  { label: 'soft', text: 'gogate soft', frees: '', color: undefined },
  { label: 'hard', text: 'gogate hard', frees: '', color: undefined },
  { label: 'status', text: 'gogate status', frees: '', color: undefined },
]
// Card colours: HARD is the safe ask (green), SOFT the waiting state (yellow), OFF the danger (red).
const MODE_COLOR: Record<string, string> = { hard: 'green', soft: 'yellow', off: 'red' }
const LOCK_COLOR: Record<string, number> = { hard: 0x2ea043, soft: 0xd7a017, off: 0xd9534f }
const LOCK_PIXELS: Record<string, string[]> = {
  hard: ['.XXXX.', 'XX..XX', 'XXXXXX', 'XXXXXX'],
  soft: ['XXXXXX', 'X....X', 'XXXXXX', 'XXXXXX'],
  off: ['.XXXXX', 'X...X.', 'XXXXXX', 'XXXXXX'],
}
const LOCK_GLYPH: Record<string, string> = { hard: '🔒', soft: '🔓', off: '🔓' }
const MEANING: Record<string, string> = {
  hard: 'every guarded command needs a GO',
  soft: 'guarded commands wait until you grant or type GO',
  off: 'gate does not block anything',
}
const SEG_MODES = ['hard', 'soft', 'off'] as const
const MAX_BLOCKS = 3
const CMD_MAX = 60
const DEMO_MIN = 74

export const demoGate = (): GateState => ({
  mode: 'soft',
  grants: [
    { scope: 'push-feature', minutesLeft: DEMO_MIN },
    { scope: 'github-write', minutesLeft: DEMO_MIN },
  ],
  raw: 'AOS go-gate, session demo: mode soft',
})

export const demoFleet = (): FleetSession[] =>
  ['demo-orchestrator', 'demo-web', 'demo-api'].map(name => ({
    id: `demo:${name}`,
    name,
    role: roleFromName(name),
    activity: 'working',
    repo: name.replace('demo-', ''),
    cwd: `~/demo/${name.replace('demo-', '')}`,
    updatedAt: 0,
  }))

export const demoBlocks = (now: number): GateBlock[] => [
  { cmd: 'git push origin feat/demo-landing', at: now - 3 * 60_000 },
  { cmd: 'npm publish', at: now - 8 * 60_000 },
]

// Mask secrets first, then truncate — the masked result must never leak a token tail.
export const maskCommand = (cmd: string) => {
  const s = cmd
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[bp]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{12,})/g, '***')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer ***')
    .replace(/(--(?:token|password|secret|api-key)[= ])[^\s&"']+/gi, '$1***')
    .replace(/\b[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=[^\s&"']+/gi, m => `${m.split('=')[0]}=***`)
    .replace(/\b[A-Za-z0-9]{32,}\b/g, '***')
  return s.length > CMD_MAX ? `${s.slice(0, CMD_MAX - 1)}…` : s
}

export const presetForCommand = (cmd: string) =>
  /merge|publish/i.test(cmd) ? PRESETS[0]!.text : PRESETS[1]!.text

const isDemo = async ($: EngineInterface) => (await $.env.get('AOS_FLEET_DEMO')) === '1'
const GRANT_BAR = 10
const GRANT_DEFAULT_MIN = 120
const LIST_STALE_MIN = 15
const MORE_W = 10

export const grantBar = (minutesLeft: number) => {
  const total = Math.max(GRANT_DEFAULT_MIN, minutesLeft)
  const on = Math.max(0, Math.min(GRANT_BAR, Math.ceil((minutesLeft / total) * GRANT_BAR)))
  return { on, off: GRANT_BAR - on }
}

// Grant rows turn yellow under 30 minutes and red under 10.
export const grantColor = (minutesLeft: number) =>
  minutesLeft >= 30 ? 'green' : minutesLeft >= 10 ? 'yellow' : 'red'

// The hero lock as half-block pixel cells; packed like spriteCells (two pixel rows per screen row).
const LOCK_W = 6
export function lockCells(mode: string) {
  const color = LOCK_COLOR[mode] ?? LOCK_COLOR.soft!
  const pixels = LOCK_PIXELS[mode] ?? LOCK_PIXELS.soft!
  const words: number[] = []
  for (let r = 0; r < pixels.length; r += 2) {
    for (let c = 0; c < LOCK_W; c++) {
      const top = pixels[r]![c] === 'X'
      const bottom = pixels[r + 1]![c] === 'X'
      const glyph = top && bottom ? 0x2588 : top ? 0x2580 : bottom ? 0x2584 : 0x20
      words.push(glyph, glyph === 0x20 ? DEFAULT_COLOR : color, DEFAULT_COLOR)
    }
  }
  const bytes = new Uint8Array(Uint32Array.from(words).buffer) as Uint8Array & { toBase64(): string }
  return bytes.toBase64()
}

// How many chips (own width each, 2-cell gaps) fit; leaves room for "+k more" when any are dropped.
export function chipsThatFit(widths: readonly number[], budget: number) {
  const take = (room: number) => {
    let used = 0
    let n = 0
    for (const w of widths) {
      if (used + (n ? 2 : 0) + w > room) break
      used += (n ? 2 : 0) + w
      n++
    }
    return n
  }
  const n = take(budget)
  return n < widths.length ? take(budget - MORE_W) : n
}

export const listAge = (updated: string | undefined, now: number) => {
  const t = updated ? new Date(updated).getTime() : NaN
  return Number.isNaN(t) ? 0 : Math.floor((now - t) / 60_000)
}

export function parseGateStatus(text: string): GateState {
  const mode = /: mode (\w+)/.exec(text)?.[1] ?? 'soft'
  const grants = [...text.matchAll(/^\s+grant (\S+) until \S+ \((-?\d+) min left/gm)].map(m => ({
    scope: m[1]!,
    minutesLeft: Number(m[2]),
  }))
  return { mode, grants, raw: text.trim() }
}

export const timeLeft = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min}m`)

async function readGate($: EngineInterface) {
  if (await isDemo($)) {
    await update($, gate, () => demoGate())
    return
  }
  const home = await $.env.get('HOME')
  const r = await $.process.run(['node', `${home}/.claude/hooks/go-grant.mjs`, '--status', '--session', await $.session.id()])
  await update($, gate, () => parseGateStatus(r.stdout))
}

// The only place that writes the prompt box, and only from a Button press.
async function openGatePane($: EngineInterface) {
  await readGate($).catch(() => undefined)
  await $.ui.open({ id: GATE_PANE, title: 'go-gate' })
}

async function fillPreset($: EngineInterface, text: string) {
  if ((await $.prompt.read()).text) return update($, gateMsg, () => 'Prompt is not empty – clear it first')
  await $.prompt.fill({ text })
  return update($, gateMsg, () => `▸ in your prompt: ${text}`)
}

let dir = ''
let id = ''
let project: Pick<FleetSession, 'repo' | 'branch' | 'phase' | 'cwd'> & {
  pipelineReason?: string
} = { cwd: '' }

function setSelf($: EngineInterface, patch: Partial<FleetSelf>) {
  return update($, self, s => ({ ...s, ...patch }))
}

let peers: FleetSession[] = []
let peersAt = 0

// Sessions without this mod still show, from ListAgents: busy or idle, never why.
export function parsePeers(text: string, now: number): FleetSession[] {
  return [...text.matchAll(/^\s+(.+?) \[([0-9a-f]+)\]\s+·\s+\S+\s+·\s+(\S+)/gm)].map(m => ({
    id: `peer:${m[2]}`,
    name: m[1]!,
    role: roleFromName(m[1]!),
    activity: m[3] === 'idle' ? 'idle' : 'working',
    reason: m[3] === 'idle' || m[3] === 'busy' ? undefined : m[3],
    cwd: '',
    updatedAt: now,
    unmanaged: true,
  }))
}

const BAR = 8

// token-weather's scale: the forecast word doubles as the advice.
const WEATHER = [
  { upTo: 25, icon: '☀', word: 'Clear', advice: 'ok', color: 'yellow' },
  { upTo: 50, icon: '☁', word: 'Cloudy', advice: 'ok', color: 'cyan' },
  { upTo: 75, icon: '☂', word: 'Showers', advice: 'ok', color: 'blue' },
  { upTo: 90, icon: '☇', word: 'Storm', advice: 'compact soon', color: 'magenta' },
  { upTo: Infinity, icon: '↯', word: 'Compact now', advice: 'compact or start a new session', color: 'red' },
]
const BARS = '▁▂▃▄▅▆▇█'
export const sparkline = (values: readonly number[]) => {
  const top = Math.max(...values, 1)
  return values.map(v => BARS[Math.min(7, Math.floor((v / top) * 7))]).join('')
}
export const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

let reading: { tokens: number; window: number; percent: number } | undefined
let history: number[] = []

async function takeReading($: EngineInterface) {
  const { context } = await $.session.usage()
  if (!context.window) return
  const tokens = context.tokens ?? 0
  reading = { tokens, window: context.window, percent: context.percent ?? (tokens / context.window) * 100 }
  if (tokens > 0) history = [...history, tokens].slice(-12)
  $.ui.invalidate('ui.render')
}

export const weather = (percent: number) => WEATHER.find(w => percent < w.upTo) ?? WEATHER[WEATHER.length - 1]!
export const filled = (p: FleetProgress) => (p.total ? Math.round((p.done / p.total) * BAR) : 0)

type Extras = {
  progress: Map<string, FleetProgress>
  waits: Map<string, string>
  boards?: { project: string; p: FleetProgress }[]
  updated?: string
}
let extras: Extras = { progress: new Map(), waits: new Map() }

type TaskState = {
  updated?: string
  sessions?: Record<string, { map_url?: unknown }>
  tasks?: { owner?: string; status?: string }[]
}
type BoardSummary = { project?: string; components?: { status?: string }[] }

// TASK MANAGER's list says who waits on a GO or on Tim; agenttrail boards say how far each plan is.
export function tasksExtras(state: TaskState): Extras & { ports: Map<string, number[]> } {
  const progress = new Map<string, FleetProgress>()
  const waits = new Map<string, string>()
  const byOwner = new Map<string, string[]>()
  for (const t of state.tasks ?? []) {
    if (!t.owner || !t.status || t.status === 'geparkt') continue
    const key = t.owner.toLowerCase()
    byOwner.set(key, [...(byOwner.get(key) ?? []), t.status])
  }
  for (const [owner, statuses] of byOwner) {
    const n = (s: string) => statuses.filter(x => x === s).length
    progress.set(owner, { done: n('erledigt'), total: statuses.length, blocked: 0, source: 'tasks' })
    const parts = [n('wartet-auf-GO') && `${n('wartet-auf-GO')} GO`, n('wartet-auf-Tim') && `${n('wartet-auf-Tim')} Tim`]
    if (parts.some(Boolean)) waits.set(owner, parts.filter(Boolean).join(' · '))
  }
  const ports = new Map<string, number[]>()
  for (const [name, info] of Object.entries(state.sessions ?? {})) {
    const found = [...JSON.stringify(info.map_url ?? '').matchAll(/:(\d{4,5})/g)].map(m => Number(m[1]))
    if (found.length) ports.set(name.toLowerCase(), found)
  }
  return { progress, waits, ports, updated: state.updated }
}

export function boardProgress(boards: readonly BoardSummary[]): FleetProgress | undefined {
  const all = boards.flatMap(b => b.components ?? [])
  if (!all.length) return undefined
  const n = (s: string) => all.filter(c => c.status === s).length
  return { done: n('done'), total: all.length, blocked: n('blocked'), source: 'plan' }
}

async function loadExtras($: EngineInterface) {
  const home = await $.env.get('HOME')
  const state: TaskState = JSON.parse(await $.fs.read(`${home}/.aos/tasks/state.json`))
  const next = tasksExtras(state)
  const boards = new Map<number, BoardSummary>()
  for (const port of new Set([...next.ports.values()].flat())) {
    const r = await $.http.fetch(`http://127.0.0.1:${port}/summary`).catch(() => null)
    if (r?.ok) boards.set(port, JSON.parse(r.text))
  }
  for (const [name, ports] of next.ports) {
    const p = boardProgress(ports.flatMap(port => boards.get(port) ?? []))
    if (p) next.progress.set(name, p)
  }
  const shown = [...boards.values()].flatMap(b => {
    const p = boardProgress([b])
    return p && b.project ? [{ project: b.project, p }] : []
  })
  extras = { progress: next.progress, waits: next.waits, boards: shown, updated: next.updated }
}

async function listAgents($: EngineInterface) {
  const listed = await $.tool.call({ tool: 'ListAgents' })
  const text = 'text' in listed && listed.text ? listed.text : ''
  peers = parsePeers(text, await $.clock.now())
  peersAt = await $.clock.now()
  return /This session is (.+?) \[/.exec(text)?.[1]
}

async function resolveName($: EngineInterface) {
  const env = await $.env.get('AOS_SESSION_NAME')
  if (env) return env
  return listAgents($)
}

async function readProject($: EngineInterface) {
  const cwd = await $.session.cwd()
  const repo = await $.session.repo()
  const root = repo?.root ?? cwd
  const git = await $.process.run(['git', '-C', root, 'branch', '--show-current']).catch(() => null)
  let phase: string | undefined
  let pipelineReason: string | undefined
  try {
    const state = JSON.parse(await $.fs.read(`${root}/production_artifacts/state.json`))
    phase = typeof state.phase === 'string' ? state.phase : undefined
    if (state.needs_human) pipelineReason = 'pipeline needs you'
    else if (phase && ATTENTION_PHASES.includes(phase)) pipelineReason = `pipeline ${phase}`
  } catch {
    // no graph run in this repo
  }
  project = {
    cwd,
    repo: repo ? root.split('/').pop() : undefined,
    branch: git && git.exitCode === 0 ? git.stdout.trim() || undefined : undefined,
    phase,
    pipelineReason,
  }
}

async function publish($: EngineInterface, ended = false) {
  if (await isDemo($)) return
  if (!id) return
  dir ||= `${await $.env.get('HOME')}/.aos/fleet`
  const me = await read($, self)
  const name = me.name ?? id.slice(0, 8)
  const pipelineAttention = me.activity !== 'working' && project.pipelineReason
  const record: FleetSession = {
    id,
    name,
    role: me.role ?? roleFromName(name),
    activity: pipelineAttention ? 'attention' : me.activity,
    reason: pipelineAttention ? project.pipelineReason : me.reason,
    repo: project.repo,
    branch: project.branch,
    phase: project.phase,
    cwd: project.cwd,
    updatedAt: await $.clock.now(),
    context: reading?.percent,
    ended,
  }
  await $.fs.write(`${dir}/${id}.json`, JSON.stringify(record, null, 2))
}

async function loadFleet($: EngineInterface) {
  if (await isDemo($)) {
    await update($, fleet, () => demoFleet())
    return
  }
  dir ||= `${await $.env.get('HOME')}/.aos/fleet`
  if (!(await $.fs.exists(dir))) return
  const now = await $.clock.now()
  const entries = await $.fs.list(dir)
  const sessions: FleetSession[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      const s: FleetSession = JSON.parse(await $.fs.read(`${dir}/${entry.name}`))
      if (!s.ended && now - s.updatedAt < STALE_MS) sessions.push(s)
    } catch {
      // half-written by another session; next tick reads it
    }
  }
  // ponytail: ListAgents spawns the PreToolUse hooks, so peers refresh every 15 s, not every tick
  if (now - peersAt > 15_000) {
    await listAgents($).catch(() => undefined)
    await loadExtras($).catch(() => undefined)
  }
  const known = new Set(sessions.map(s => s.name))
  sessions.push(...peers.filter(p => !known.has(p.name)))
  for (const [i, s] of sessions.entries()) {
    const key = s.name.toLowerCase()
    const wait =
      extras.waits.get(key) ?? (s.context !== undefined && s.context >= 90 ? `${Math.round(s.context)}% ctx` : undefined)
    sessions[i] = {
      ...s,
      progress: extras.progress.get(key),
      ...(wait && s.activity !== 'attention' ? { activity: 'attention', reason: wait } : {}),
    }
  }
  sessions.sort((a, b) => RANK[a.activity] - RANK[b.activity] || a.name.localeCompare(b.name))
  await update($, fleet, () => sessions)
}

async function tick($: EngineInterface) {
  if ((await read($, fleet)).some(s => s.activity === 'working')) await update($, frame_, f => f + 1)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.ui.status(undefined)
    id = await $.session.id()
    await $.command.register({ name: 'aos-fleet', description: 'Show the AOS fleet pane' })
    await $.command.register({ name: 'gogate-panel', description: 'Show the go-gate status and grant presets' })
    await $.command.register({
      name: 'aos-role',
      description: `Set this session's AOS role: ${ROLES.join(' | ')}`,
    })
    const name = await resolveName($).catch(() => undefined)
    if (name) await setSelf($, { name })
    await readProject($)
    await takeReading($).catch(() => undefined)
    await publish($)
    await loadFleet($)
    await readGate($).catch(() => undefined)
    $.clock.every(30_000, () => void readGate($).catch(() => undefined))
    $.clock.every(5_000, () => void loadFleet($))
    $.clock.every(30_000, () => void publish($))
    $.clock.every(700, () => void tick($))

    const me = await read($, self)
    if ((me.role ?? roleFromName(me.name ?? '')) !== 'worker') {
      void $.ui.open({ id: PANE, title: 'AOS fleet' })
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    await publish($, true)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await setSelf($, { activity: 'working', reason: undefined })
    void publish($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    await takeReading($).catch(() => undefined)
    const me = await read($, self)
    if (me.activity !== 'attention') await setSelf($, { activity: 'idle', reason: undefined })
    const name = await resolveName($).catch(() => undefined)
    if (name) await setSelf($, { name })
    await readProject($)
    await publish($)
    await readGate($).catch(() => undefined)
    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await setSelf($, { activity: 'attention', reason: `allow? ${e.tool_name}` })
    await publish($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'ListAgents') return next(e)
    if (e.tool === 'AskUserQuestion') {
      await setSelf($, { activity: 'attention', reason: 'question' })
      await publish($)
    }
    const result = await next(e)
    const blocked = result.isError && result.text && /go-gate/i.test(result.text)
    if (blocked) {
      const command = e.tool === 'Bash' ? maskCommand(e.command) : String(e.tool)
      if (!(await isDemo($))) {
        const at = await $.clock.now()
        await update($, blocks, list => [{ cmd: command, at }, ...list].slice(0, MAX_BLOCKS))
      }
      await setSelf($, { activity: 'attention', reason: `GO: ${command}` })
      await publish($)
    } else if ((await read($, self)).activity === 'attention') {
      await setSelf($, { activity: 'working', reason: undefined })
      await publish($)
    }
    return result
  })

  on('command.run', { command: 'aos-fleet' }, async $ => {
    await loadFleet($)
    await $.ui.open({ id: PANE, title: 'AOS fleet' })
    return { text: 'AOS fleet pane opened.' }
  })

  on('command.run', { command: 'gogate-panel' }, async $ => {
    await openGatePane($)
    return { text: 'go-gate pane opened.' }
  })

  on('command.run', { command: 'aos-role' }, async ($, e) => {
    const role = e.args.trim() as FleetRole
    if (!ROLES.includes(role)) return { text: `Unknown role "${e.args}". Use: ${ROLES.join(', ')}` }
    await setSelf($, { role })
    await publish($)
    await loadFleet($)
    return { text: `AOS role set to ${role}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const Raster = 'Raster' in ui ? ui.Raster : undefined
    const list = await read($, fleet)
    const frame = await read($, frame_)
    const fits = Math.max(1, Math.floor((e.props.bodyColumns ?? 80) / CARD))
    if (!Raster) return <Text dimColor>The fleet cards need the terminal.</Text>
    const rows: FleetSession[][] = []
    for (let i = 0; i < list.length; i += fits) rows.push(list.slice(i, i + fits))
    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No sessions reporting yet.</Text>}
        {rows.map((shown, i) => (
          <Box key={`row-${i}`} flexDirection="column" marginBottom={1}>
            <Box flexDirection="row">
              {shown.map(s => (
                <Box key={s.id} flexDirection="column" width={CARD}>
                  <Raster key={`sprite-${s.id}`} columns={SPRITE_W} rows={2} cells={spriteCells(s, frame)} />
                  <Text bold={s.id === id} color={hex(roleColor(s))}>
                    {fit(s.name, CARD - 2)}
                  </Text>
                  <Text color={DOT[s.activity].color}>
                    {DOT[s.activity].glyph} {fit(s.reason ?? (s.activity === 'working' ? s.phase ?? 'working' : 'idle'), CARD - 4)}
                  </Text>
                  {s.progress ? (
                    <Box flexDirection="row">
                      <Text color="green">{'■'.repeat(filled(s.progress))}</Text>
                      <Text dimColor>{'■'.repeat(BAR - filled(s.progress))}</Text>
                      <Text dimColor>
                        {' '}
                        {s.progress.done}/{s.progress.total}
                      </Text>
                      {s.progress.blocked > 0 && <Text color="yellow"> !{s.progress.blocked}</Text>}
                    </Box>
                  ) : (
                    <Text> </Text>
                  )}
                  {s.context !== undefined ? (
                    <Text color={weather(s.context).color}>
                      {weather(s.context).icon} {Math.round(s.context)}% {weather(s.context).advice}
                    </Text>
                  ) : (
                    <Text> </Text>
                  )}
                </Box>
              ))}
                      </Box>
          </Box>
        ))}
        <Text dimColor wrap="truncate-end">
          {(extras.boards ?? []).map(b => `${b.project} ${b.p.done}/${b.p.total}`).join('   ')}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: GATE_PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Raster = 'Raster' in ui ? ui.Raster : undefined
    const { mode, grants, raw } = await read($, gate)
    const msg = await read($, gateMsg)
    const width = e.props.bodyColumns
    const scopeW = Math.max(...grants.map(x => x.scope.length), 0)
    const demo = await isDemo($)
    const nowMs = await $.clock.now()
    const blockList = demo ? demoBlocks(nowMs) : await read($, blocks)
    const segment = (m: (typeof SEG_MODES)[number]) => {
      if (m === mode)
        return (
          <Text key={`seg-${m}`} bold backgroundColor={MODE_COLOR[m]} color="black">
            {` ${m.toUpperCase()} `}
          </Text>
        )
      if (m === 'off')
        return (
          <Text key={`seg-${m}`} color={MODE_COLOR[m]}>
            {` ${m.toUpperCase()} `}
          </Text>
        )
      return (
        <Button
          key={`seg-${m}`}
          plain
          label={m.toUpperCase()}
          onPress={() => void fillPreset($, m === 'hard' ? 'gogate hard' : 'gogate soft')}
        />
      )
    }
    // HERO
    const heroCard = (
      <Box key="hero" flexDirection="column" borderStyle="round" borderColor={MODE_COLOR[mode] ?? 'yellow'} paddingX={1} marginBottom={1}>
        <Box key="hero-head" flexDirection="row" justifyContent="space-between">
          <Box key="hero-left" flexDirection="row">
            {Raster ? (
              <Raster key="lock" columns={6} rows={2} cells={lockCells(mode)} />
            ) : (
              <Text key="lock-fallback" color={MODE_COLOR[mode] ?? 'yellow'}>
                {LOCK_GLYPH[mode] ?? '🔒'}
              </Text>
            )}
            <Text key="mode-word" bold>
              {' '}
              {mode.toUpperCase()}
            </Text>
          </Box>
          <Text key="hero-tag" dimColor wrap="truncate-end">
            go-gate
          </Text>
        </Box>
        <Text key="hero-meaning" dimColor wrap="truncate-end">
          {MEANING[mode] ?? MEANING.soft}
        </Text>
        <Box key="hero-segments" flexDirection="row">
          {SEG_MODES.map((m, i) => (
            <Box key={`seg-slot-${m}`} flexDirection="row">
              {i > 0 && <Text>{'   '}</Text>}
              {segment(m)}
            </Box>
          ))}
        </Box>
      </Box>
    )
    // GRANTS
    const grantsCard = (
      <Box key="grants" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
        <Box key="grants-head" flexDirection="row" justifyContent="space-between">
          <Text bold>GRANTS</Text>
          <Text dimColor wrap="truncate-end">
            {grants.length} active
          </Text>
        </Box>
        {grants.length === 0 ? (
          <Text dimColor wrap="truncate-end">
            no grants — guarded commands stay blocked
          </Text>
        ) : (
          grants.map(x => {
            const bar = grantBar(x.minutesLeft)
            return (
              <Box key={`grant-${x.scope}`} flexDirection="row" justifyContent="space-between">
                <Box key={`grant-${x.scope}-l`} flexDirection="row">
                  <Text wrap="truncate-end">{x.scope.padEnd(scopeW)}</Text>
                  <Text color={grantColor(x.minutesLeft)}>{'■'.repeat(bar.on)}</Text>
                  <Text dimColor>{'□'.repeat(bar.off)}</Text>
                </Box>
                <Text dimColor wrap="truncate-end">
                  {timeLeft(x.minutesLeft)} left
                </Text>
              </Box>
            )
          })
        )}
      </Box>
    )
    // LAST BLOCKED
    const blockedCard = (
      <Box key="blocked" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>LAST BLOCKED</Text>
        {blockList.length === 0 ? (
          <Text dimColor wrap="truncate-end">
            nothing blocked yet
          </Text>
        ) : (
          blockList.map((b, i) => {
            const mins = Math.max(0, Math.round((nowMs - b.at) / 60_000))
            return (
              <Box key={`row-blk-${i}`} flexDirection="row" justifyContent="space-between">
                <Box key={`row-blk-${i}-l`} flexDirection="row">
                  <Text color="yellow">▸ </Text>
                  <Button key={`blk-${i}`} plain label={b.cmd} onPress={() => void fillPreset($, presetForCommand(b.cmd))} />
                </Box>
                <Text dimColor wrap="truncate-end">
                  {mins}m ago
                </Text>
              </Box>
            )
          })
        )}
      </Box>
    )
    // PRESETS
    const presetRow = (p: (typeof PRESETS)[number], i: number, primary: boolean) => (
      <Box key={`row-${p.label}`} flexDirection="row">
        {p.color && <Text color={p.color}>● </Text>}
        <Button
          key={p.label}
          label={p.label}
          hotkey={String(i + 1)}
          {...(primary ? { variant: 'primary' as const } : { plain: true as const })}
          onPress={() => void fillPreset($, p.text)}
        />
        {p.frees && (
          <Text dimColor wrap="truncate-end">
            {'  '}
            {p.frees}
          </Text>
        )}
      </Box>
    )
    const presetsCard = (
      <Box key="presets" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>PRESETS</Text>
        {presetRow(PRESETS[0]!, 0, true)}
        {presetRow(PRESETS[1]!, 1, false)}
        <Box key="row-compact" flexDirection="row">
          <Text color="gray">● </Text>
          {PRESETS.slice(2).map((p, i) => (
            <Box key={`cp-${p.label}`} marginRight={1}>
              <Button key={p.label} label={p.label} hotkey={String(i + 3)} plain onPress={() => void fillPreset($, p.text)} />
            </Box>
          ))}
        </Box>
      </Box>
    )
    const wide = width >= 96
    const body = wide ? (
      <Box key="cols" flexDirection="row">
        <Box key="col-left" flexGrow={1} flexDirection="column">
          {heroCard}
          {presetsCard}
        </Box>
        <Box key="col-right" flexGrow={1} flexDirection="column">
          {grantsCard}
          {blockedCard}
        </Box>
      </Box>
    ) : (
      <Box key="stack" flexDirection="column">
        {heroCard}
        {grantsCard}
        {blockedCard}
        {presetsCard}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {body}
        {raw && !/: mode \w+/.test(raw) && (
          <Text dimColor wrap="truncate-end">
            {raw}
          </Text>
        )}
        {msg && (
          <Text color="yellow" wrap="truncate-end">
            {msg}
          </Text>
        )}
        <Text dimColor wrap="truncate-end">
          click prefills your prompt · you press Enter to record
        </Text>
      </Box>
    )
  })

  // token-weather's line for this session, then one line for the fleet.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, fleet)
    const g = await read($, gate)
    if (e.props.hasSurvey || (list.length === 0 && !reading && !g.raw)) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const wide = e.props.bodyColumns >= 70
    const others = list.filter(s => s.id !== id)
    const idle = others.filter(s => s.activity === 'idle')
    const busy = others.filter(s => s.activity !== 'idle')

    const frame = await read($, frame_)
    const age = listAge(extras.updated, await $.clock.now())

    const weatherLine = (reading || g.raw) && (
      <Box flexDirection="row" paddingX={1}>
        <Text wrap="truncate-end">
          {reading && (
            <Text color={weather(reading.percent).color} bold wrap="truncate-end">
              {weather(reading.percent).icon}  {weather(reading.percent).word}
            </Text>
          )}
          {reading && <Text wrap="truncate-end">  {Math.round(reading.percent)}% of context</Text>}
          {reading && (
            <Text dimColor wrap="truncate-end">
              {'  '}
              {short(reading.tokens)} / {short(reading.window)}
            </Text>
          )}
          {reading && wide && history.length > 1 && <Text dimColor wrap="truncate-end">   last turns </Text>}
          {reading && wide && history.length > 1 && (
            <Text color={weather(reading.percent).color} wrap="truncate-end">
              {sparkline(history)}
            </Text>
          )}
          {reading && reading.percent >= 75 && (
            <Text color={weather(reading.percent).color} wrap="truncate-end">
              {'   '}
              {weather(reading.percent).advice}
            </Text>
          )}
        </Text>
      </Box>
    )

    // The gate sits first so the weather text, not the button, is what truncates.
    const gateLine = g.raw && (
      <Box flexDirection="row" paddingX={1}>
        <Text color={MODE_COLOR[g.mode] ?? 'yellow'}>● </Text>
        <Button key="gate" plain label={`gate ${g.mode}`} onPress={() => void openGatePane($)} />
        <Text dimColor wrap="truncate-end">
          {g.grants.map(x => ` · ${x.scope} ${timeLeft(x.minutesLeft)}`).join('')}
          {'   '}
        </Text>
      </Box>
    )

    const room = Math.max(1, e.props.bodyColumns - 2)
    const reasonMax = Math.min(24, Math.max(8, Math.floor(room / 3)))
    const chips = busy.map(s => ({
      key: s.id,
      color: hex(roleColor(s)),
      glyph: s.activity === 'working' && frame % 2 ? '▄▀▀▄' : '█▀▀█',
      name: fit(s.name, 18),
      tail: s.reason ? fit(s.reason, reasonMax) : s.progress ? `${s.progress.done}/${s.progress.total}` : '',
      attention: s.activity === 'attention',
    }))
    const idleText = idle.length > 0 ? `○ ${idle.length} idle` : ''
    const staleText = age > LIST_STALE_MIN ? `· list ${timeLeft(age)} old` : ''
    const widths = [
      ...chips.map(c => c.glyph.length + 1 + c.name.length + (c.tail ? 1 + c.tail.length : 0)),
      ...(idleText ? [idleText.length] : []),
      ...(staleText ? [staleText.length] : []),
    ]
    const n =chipsThatFit(widths, room)
    const shownChips = chips.slice(0, n)
    const more = chips.length - shownChips.length
    const idleShown = idleText && n > chips.length
    const staleShown = staleText && n > chips.length + (idleText ? 1 : 0)

    const fleetLine = others.length > 0 && (
      <Box flexDirection="row" paddingX={1}>
        <Text wrap="truncate-end">
          {shownChips.map((c, i) => (
            <Text key={c.key} wrap="truncate-end">
              {i > 0 && '  '}
              <Text color={c.color} wrap="truncate-end">
                {c.glyph}
              </Text>{' '}
              <Text color={c.color} wrap="truncate-end">
                {c.name}
              </Text>
              {c.tail && (
                <Text color={c.attention ? 'yellow' : undefined} dimColor={!c.attention} wrap="truncate-end">
                  {' '}
                  {c.tail}
                </Text>
              )}
            </Text>
          ))}
          {more > 0 && (
            <Text dimColor wrap="truncate-end">
              {'  '}+{more} more
            </Text>
          )}
          {idleShown && (
            <Text dimColor wrap="truncate-end">
              {'  '}
              {idleText}
            </Text>
          )}
          {staleShown && (
            <Text dimColor wrap="truncate-end">
              {'  '}
              {staleText}
            </Text>
          )}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {gateLine}
          {weatherLine}
        </Box>
        {fleetLine}
      </Box>
    )
  })
}
