import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetActivity, FleetProgress, FleetRole, FleetSelf, FleetSession } from '../types'

const PANE = 'aos-fleet'
const STALE_MS = 5 * 60_000
const ROLES: FleetRole[] = ['master', 'task-manager', 'orchestrator', 'worker']
const ATTENTION_PHASES = ['ready_to_ship', 'escalated']

const fleet = atom({ plugin: 'bdb-aos-fleet', key: 'fleet' } as const, [])
const frame_ = atom({ plugin: 'bdb-aos-fleet', key: 'frame' } as const, 0)
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

type Extras = { progress: Map<string, FleetProgress>; waits: Map<string, string>; boards?: { project: string; p: FleetProgress }[] }
let extras: Extras = { progress: new Map(), waits: new Map() }

type TaskState = {
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
  return { progress, waits, ports }
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
  extras = { progress: next.progress, waits: next.waits, boards: shown }
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
      const command = e.tool === 'Bash' ? e.command.slice(0, 80) : String(e.tool)
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

  // token-weather's line for this session, then one line for the fleet.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, fleet)
    if (e.props.hasSurvey || (list.length === 0 && !reading)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const wide = e.props.bodyColumns >= 70
    const others = list.filter(s => s.id !== id)
    const idle = others.filter(s => s.activity === 'idle')
    const busy = others.filter(s => s.activity !== 'idle')

    const weatherLine = reading && (
      <Box flexDirection="row" paddingX={1}>
        <Text color={weather(reading.percent).color} bold>
          {weather(reading.percent).icon}  {weather(reading.percent).word}
        </Text>
        <Text>  {Math.round(reading.percent)}% of context</Text>
        <Text dimColor>  {short(reading.tokens)} / {short(reading.window)}</Text>
        {wide && history.length > 1 && <Text dimColor>   last turns </Text>}
        {wide && history.length > 1 && <Text color={weather(reading.percent).color}>{sparkline(history)}</Text>}
        {reading.percent >= 75 && <Text color={weather(reading.percent).color}>   {weather(reading.percent).advice}</Text>}
      </Box>
    )

    const fleetLine = others.length > 0 && (
      <Box flexDirection="row" paddingX={1}>
        <Text dimColor>fleet </Text>
        {busy.map(s => (
          <Text key={s.id}>
            {'  '}
            <Text color={DOT[s.activity].color}>{DOT[s.activity].glyph}</Text>{' '}
            <Text color={hex(roleColor(s))}>{fit(s.name, 18)}</Text>
            {s.reason && <Text color="yellow"> {s.reason}</Text>}
            {wide && s.progress && !s.reason && <Text dimColor> {s.progress.done}/{s.progress.total}</Text>}
          </Text>
        ))}
        {idle.length > 0 && <Text dimColor>{'  '}○ {idle.length} idle</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {weatherLine}
        {fleetLine}
      </Box>
    )
  })
}
