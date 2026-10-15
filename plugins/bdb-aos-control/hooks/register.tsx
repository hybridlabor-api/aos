import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  ContextProfile,
  FleetActivity,
  FleetProgress,
  FleetRole,
  FleetSession,
  GateProfile,
  GateState,
  GitStage,
  GitWorktreeItem,
  PipelineState,
  ServiceStatus,
} from '../types'

const PANE = 'aos-control'
const STALE_MS = 5 * 60_000
const ROLES: FleetRole[] = ['master', 'task-manager', 'orchestrator', 'worker']

const tab_ = atom({ plugin: 'bdb-aos-control', key: 'tab' } as const, 'fleet' as const)
const fleet_ = atom({ plugin: 'bdb-aos-control', key: 'fleet' } as const, [] as FleetSession[])
const pipeline_ = atom({ plugin: 'bdb-aos-control', key: 'pipeline' } as const, null as PipelineState | null)
const gitWorktrees_ = atom({ plugin: 'bdb-aos-control', key: 'gitWorktrees' } as const, [] as GitWorktreeItem[])
const profile_ = atom({ plugin: 'bdb-aos-control', key: 'profile' } as const, null as GateProfile | null)
const gate_ = atom({ plugin: 'bdb-aos-control', key: 'gate' } as const, { mode: 'soft', grants: [], raw: '' } as GateState)
const contextProfile_ = atom({ plugin: 'bdb-aos-control', key: 'contextProfile' } as const, null as ContextProfile | null)
const services_ = atom({ plugin: 'bdb-aos-control', key: 'services' } as const, [] as ServiceStatus[])
const message_ = atom({ plugin: 'bdb-aos-control', key: 'message' } as const, '')
const frame_ = atom({ plugin: 'bdb-aos-control', key: 'frame' } as const, 0)

type PaneInput = Parameters<EngineInterface['ui']['resolve']>[0] & { props: { bodyColumns?: number } }

// ---------------------------------------------------------------------------
// Minimal fleet helpers (copied from bdb-aos-fleet so this plugin is self-contained)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Logo: half-block Raster control dial
// ---------------------------------------------------------------------------

const LOGO_W = 8
const LOGO_PIXELS = ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', '.XXXXXX.']

export function logoCells() {
  const color = 0x2ea043
  const words: number[] = []
  for (let r = 0; r < LOGO_PIXELS.length; r += 2) {
    for (let c = 0; c < LOGO_W; c++) {
      const top = LOGO_PIXELS[r]![c] === 'X'
      const bottom = LOGO_PIXELS[r + 1]![c] === 'X'
      const glyph = top && bottom ? 0x2588 : top ? 0x2580 : bottom ? 0x2584 : 0x20
      words.push(glyph, glyph === 0x20 ? DEFAULT_COLOR : color, DEFAULT_COLOR)
    }
  }
  const bytes = new Uint8Array(Uint32Array.from(words).buffer) as Uint8Array & { toBase64(): string }
  return bytes.toBase64()
}

// ---------------------------------------------------------------------------
// Gate / profile helpers (copied/minimal from bdb-aos-fleet)
// ---------------------------------------------------------------------------

const GRANT_BAR = 10
const GRANT_DEFAULT_MIN = 120

export const grantBar = (minutesLeft: number) => {
  const total = Math.max(GRANT_DEFAULT_MIN, minutesLeft)
  const on = Math.max(0, Math.min(GRANT_BAR, Math.ceil((minutesLeft / total) * GRANT_BAR)))
  return { on, off: GRANT_BAR - on }
}

export const grantColor = (minutesLeft: number) =>
  minutesLeft >= 30 ? 'green' : minutesLeft >= 10 ? 'yellow' : 'red'

export const timeLeft = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min}m`)

export function parseGateStatus(text: string): GateState {
  const mode = /: mode (\w+)/.exec(text)?.[1] ?? 'soft'
  const grants = [...text.matchAll(/^\s+grant (\S+) until \S+ \((-?\d+) min left/gm)].map(m => ({
    scope: m[1]!,
    minutesLeft: Number(m[2]),
  }))
  return { mode, grants, raw: text.trim() }
}

export function parseProfile(text: string): GateProfile | null {
  const m = /^profile:\s*(strict|work|off)\b(?:\s*\((?:(\d+) min left|no expiry)\))?/m.exec(text)
  if (!m) return null
  const note = /^note:\s*(.+)$/m.exec(text)?.[1]?.trim()
  return { profile: m[1] as GateProfile['profile'], minutesLeft: m[2] ? Number(m[2]) : null, ...(note ? { note } : {}) }
}

const MODE_COLOR: Record<string, string> = { hard: 'green', soft: 'yellow', off: 'red' }
const PROFILE_COLOR: Record<string, string> = { strict: 'gray', work: 'yellow', off: 'red' }

// ---------------------------------------------------------------------------
// Pipeline helpers
// ---------------------------------------------------------------------------

const PHASES: PipelineState['phase'][] = ['define', 'plan', 'build', 'verify', 'review', 'ready_to_ship', 'ship', 'done', 'escalated']

export function parsePipelineState(text: string): PipelineState | null {
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object') return null
    if (!PHASES.includes(raw.phase)) return null
    return {
      run_id: String(raw.run_id ?? ''),
      goal: String(raw.goal ?? ''),
      phase: raw.phase,
      iteration: Number(raw.iteration ?? 0),
      max_iterations: Number(raw.max_iterations ?? 1),
      gate: raw.gate && typeof raw.gate === 'object' ? raw.gate : {},
      findings: Array.isArray(raw.findings)
        ? raw.findings
            .filter((f: unknown) => f && typeof f === 'object')
            .map((f: Record<string, unknown>) => ({
              id: String(f.id ?? ''),
              severity: f.severity === 'blocking' || f.severity === 'advisory' ? f.severity : 'advisory',
              node: String(f.node ?? ''),
              status: f.status === 'open' || f.status === 'fixed' || f.status === 'wont_fix' ? f.status : 'open',
              summary: f.summary ? String(f.summary) : undefined,
            }))
        : [],
      approvals: Array.isArray(raw.approvals) ? raw.approvals : [],
      needs_human: !!raw.needs_human,
      artifacts: raw.artifacts && typeof raw.artifacts === 'object' ? raw.artifacts : undefined,
    }
  } catch {
    return null
  }
}

export function pipelineCounts(state: PipelineState) {
  const open = state.findings.filter(f => f.status === 'open')
  return {
    open: open.length,
    fixed: state.findings.filter(f => f.status === 'fixed').length,
    wontFix: state.findings.filter(f => f.status === 'wont_fix').length,
    blocking: open.filter(f => f.severity === 'blocking').length,
    advisory: open.filter(f => f.severity === 'advisory').length,
    gates: Object.entries(state.gate),
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export function parseWorktrees(text: string): Array<{ path: string; head: string; branch: string; bare: boolean }> {
  const out: Array<{ path: string; head: string; branch: string; bare: boolean }> = []
  let current: Partial<{ path: string; head: string; branch: string; bare: boolean }> = {}
  for (const raw of text.split('\n')) {
    const t = raw.trim()
    if (t === '') continue
    if (t.startsWith('worktree ')) {
      if (current.path) out.push({ path: current.path, head: current.head ?? '', branch: current.branch ?? '', bare: !!current.bare })
      current = { path: t.slice('worktree '.length).trim() }
    } else if (t.startsWith('HEAD ')) {
      current.head = t.slice('HEAD '.length).trim()
    } else if (t.startsWith('branch ')) {
      current.branch = t.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    } else if (t === 'bare') {
      current.bare = true
    } else if (t === 'detached') {
      current.branch = '(detached)'
    }
  }
  if (current.path) out.push({ path: current.path, head: current.head ?? '', branch: current.branch ?? '', bare: !!current.bare })
  return out
}

export function parseStatusBranch(text: string): { branch: string; ahead: number; behind: number; dirty: number } {
  let branch = '(unknown)'
  let ahead = 0
  let behind = 0
  let dirty = 0
  for (const raw of text.split('\n')) {
    if (raw.startsWith('## ')) {
      const header = raw.slice(3)
      const m = /^([^\.\s]+)(?:\.\.\.\S+)?\s*(?:\[([^\]]*)\])?/.exec(header)
      if (m) branch = m[1]!
      const ab = /ahead\s+(\d+)/.exec(header)
      const be = /behind\s+(\d+)/.exec(header)
      if (ab) ahead = Number(ab[1])
      if (be) behind = Number(be[1])
    } else if (raw.trim() !== '') {
      dirty++
    }
  }
  return { branch, ahead, behind, dirty }
}

function agentNameFromBranch(branch: string, path: string): string | undefined {
  if (branch === '(detached)' || branch === '(unknown)') return undefined
  const base = branch.replace(/^feat\//, '').replace(/^feature\//, '').replace(/-/g, ' ')
  if (base && base !== branch) return base
  const seg = path.split('/').pop() ?? ''
  if (seg && !/^main|master$/.test(seg)) return seg.replace(/^aos-wt-/, '')
  return undefined
}

function isAgentWorktree(path: string, branch: string, mainRoot: string): boolean {
  if (path === mainRoot) return false
  if (/aos-wt-|\.aos\/wt|agent-|worker-/.test(path)) return true
  if (/^(feat|feature|agent|work)\//.test(branch)) return true
  return path !== mainRoot
}

function stageForWorktree(dirty: number, ahead: number, merged: boolean, openFindings: number): GitStage {
  if (merged) return 'merged'
  if (dirty > 0) return 'editing'
  if (openFindings > 0) return 'committed'
  if (ahead > 0 || dirty === 0) return 'reviewed'
  return 'committed'
}

const STAGE_GLYPH: Record<GitStage, { glyph: string; color: string }> = {
  editing: { glyph: '✎', color: 'yellow' },
  committed: { glyph: '●', color: 'cyan' },
  reviewed: { glyph: '✓', color: 'green' },
  merged: { glyph: '◆', color: 'blue' },
}

export async function buildWorktreeItems(
  $: EngineInterface,
  root: string,
  state: PipelineState | null,
): Promise<GitWorktreeItem[]> {
  const r = await $.process.run(['git', '-C', root, 'worktree', 'list', '--porcelain']).catch(() => null)
  if (!r || r.exitCode !== 0) return []
  const worktrees = parseWorktrees(r.stdout)
  const main = worktrees.find(w => !w.bare && (w.branch === 'main' || w.branch === 'master')) ?? worktrees[0]
  const mainRoot = main?.path ?? root
  const items: GitWorktreeItem[] = []
  for (const w of worktrees) {
    if (w.bare) continue
    const status = await $.process.run(['git', '-C', w.path, 'status', '--porcelain=v1', '-b']).catch(() => null)
    const sb = status && status.exitCode === 0 ? parseStatusBranch(status.stdout) : { branch: w.branch, ahead: 0, behind: 0, dirty: 0 }
    const mergedR = await $.process.run(['git', '-C', w.path, 'branch', '--merged', 'origin/main', '--format=%(refname:short)']).catch(() => null)
    const merged = mergedR && mergedR.exitCode === 0 ? mergedR.stdout.split('\n').some(b => b.trim() === sb.branch) : false
    const agentName = agentNameFromBranch(sb.branch, w.path)
    const openFindings = state?.findings.filter(f => f.status === 'open' && agentName && f.node.toLowerCase().includes(agentName.toLowerCase().split(' ')[0]!)).length ?? 0
    const stage = stageForWorktree(sb.dirty, sb.ahead, merged, openFindings)
    items.push({
      path: w.path,
      branch: sb.branch,
      head: w.head.slice(0, 8),
      stage,
      dirtyCount: sb.dirty,
      aheadCount: sb.ahead,
      behindCount: sb.behind,
      isAgentWorktree: isAgentWorktree(w.path, sb.branch, mainRoot),
      agentName,
      findingsOpen: openFindings,
      findingsTotal: state?.findings.filter(f => agentName && f.node.toLowerCase().includes(agentName.toLowerCase().split(' ')[0]!)).length ?? 0,
    })
  }
  return items
}

// ---------------------------------------------------------------------------
// Control helpers
// ---------------------------------------------------------------------------

export function parseServices(text: string): ServiceStatus[] {
  try {
    const raw = JSON.parse(text)
    if (Array.isArray(raw)) {
      return raw
        .filter((s: unknown) => s && typeof s === 'object')
        .map((s: Record<string, unknown>) => ({
          id: String(s.id ?? ''),
          name: String(s.name ?? s.id ?? ''),
          status: s.status === 'running' || s.status === 'down' ? s.status : 'unknown',
          port: typeof s.port === 'number' ? s.port : undefined,
        }))
    }
  } catch { /* fall through */ }
  return []
}

const KNOWN_SERVICES: Array<Pick<ServiceStatus, 'id' | 'name' | 'port'>> = [
  { id: 'memb', name: 'memB', port: 8088 },
  { id: 'synapse', name: 'Synapse', port: 7781 },
  { id: 'gateway', name: 'Gateway', port: 9080 },
  { id: 'hub', name: 'Hub', port: 7900 },
]

export async function probeServices($: EngineInterface): Promise<ServiceStatus[]> {
  const out: ServiceStatus[] = []
  for (const s of KNOWN_SERVICES) {
    const status: ServiceStatus['status'] = s.port
      ? await $.http.fetch(`http://127.0.0.1:${s.port}/health`).then(r => r?.ok ? 'running' : 'down').catch(() => 'unknown')
      : 'unknown'
    out.push({ ...s, status })
  }
  return out
}

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------

const isDemo = async ($: EngineInterface) => (await $.env.get('AOS_FLEET_DEMO')) === '1'

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

export const demoPipeline = (): PipelineState => ({
  run_id: 'demo-1',
  goal: 'Build the AOS Control cockpit',
  phase: 'build',
  iteration: 1,
  max_iterations: 3,
  gate: { lint: 'pass', typecheck: 'pass', tests: 'pass', a11y: 'skip', seo: 'skip', security: 'pass' },
  findings: [
    { id: 'f1', severity: 'advisory', node: 'ui_ux', status: 'fixed', summary: 'Raster logo could be larger' },
    { id: 'f2', severity: 'blocking', node: 'engineering', status: 'open', summary: 'source-guard rejects a second prompt fill call' },
  ],
  approvals: [],
  needs_human: false,
})

async function loadFleet($: EngineInterface) {
  if (await isDemo($)) {
    await update($, fleet_, () => demoFleet())
    return
  }
  const home = await $.env.get('HOME')
  const dir = `${home}/.aos/fleet`
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
      // half-written by another session
    }
  }
  sessions.sort((a, b) => RANK[a.activity] - RANK[b.activity] || a.name.localeCompare(b.name))
  await update($, fleet_, () => sessions)
}

async function loadPipeline($: EngineInterface) {
  if (await isDemo($)) {
    await update($, pipeline_, () => demoPipeline())
    return
  }
  const cwd = await $.session.cwd()
  const repo = await $.session.repo().catch(() => null)
  const root = (repo as { root?: string } | null)?.root ?? cwd
  try {
    const text = await $.fs.read(`${root}/production_artifacts/state.json`)
    const parsed = parsePipelineState(text)
    await update($, pipeline_, () => parsed)
  } catch {
    await update($, pipeline_, () => null)
  }
}

async function loadGit($: EngineInterface) {
  if (await isDemo($)) {
    await update($, gitWorktrees_, () => [
      { path: '~/demo/aos', branch: 'main', head: 'abc1234', stage: 'merged', dirtyCount: 0, aheadCount: 0, behindCount: 0, isAgentWorktree: false },
      { path: '~/demo/aos-wt-control', branch: 'feat/aos-control', head: 'def5678', stage: 'reviewed', dirtyCount: 0, aheadCount: 2, behindCount: 0, isAgentWorktree: true, agentName: 'control', findingsOpen: 0, findingsTotal: 2 },
    ])
    return
  }
  const cwd = await $.session.cwd()
  const repo = await $.session.repo().catch(() => null)
  const root = (repo as { root?: string } | null)?.root ?? cwd
  const state = await read($, pipeline_)
  const items = await buildWorktreeItems($, root, state).catch(() => [])
  await update($, gitWorktrees_, () => items)
}

async function loadGate($: EngineInterface) {
  if (await isDemo($)) {
    await update($, gate_, () => ({ mode: 'soft', grants: [{ scope: 'push-feature', minutesLeft: 74 }], raw: 'AOS go-gate, session demo: mode soft' }))
    return
  }
  const home = await $.env.get('HOME')
  const r = await $.process.run(['node', `${home}/.claude/hooks/go-grant.mjs`, '--status', '--session', await $.session.id()]).catch(() => null)
  await update($, gate_, () => (r && r.exitCode === 0 ? parseGateStatus(r.stdout) : { mode: 'soft', grants: [], raw: '' }))
}

async function loadProfile($: EngineInterface) {
  if (await isDemo($)) {
    await update($, profile_, () => ({ profile: 'work', minutesLeft: 187 }))
    return
  }
  const home = await $.env.get('HOME')
  let found: GateProfile | null = null
  for (const cmd of [['aos-gate', 'status'], ['node', `${home}/.agents/bin/aos-gate.mjs`, 'status']]) {
    try {
      const r = await $.process.run(cmd)
      found = r.exitCode === 0 ? parseProfile(r.stdout) : null
    } catch {
      found = null
    }
    if (found) break
  }
  await update($, profile_, () => found)
}

async function loadContextProfile($: EngineInterface) {
  const name = await $.env.get('AOS_CONTEXT_PROFILE').catch(() => '')
  await update($, contextProfile_, () => (name ? { name } : { name: 'full' }))
}

async function loadServices($: EngineInterface) {
  if (await isDemo($)) {
    await update($, services_, () => KNOWN_SERVICES.map(s => ({ ...s, status: 'running' as const })))
    return
  }
  const home = await $.env.get('HOME')
  const hub = await $.http.fetch(`http://127.0.0.1:7900/api/services`).catch(() => null)
  if (hub?.ok) {
    const list = parseServices(hub.text)
    if (list.length) {
      await update($, services_, () => list)
      return
    }
  }
  const file = await $.fs.read(`${home}/.aos/hub.json`).catch(() => null)
  if (file) {
    const list = parseServices(file)
    if (list.length) {
      await update($, services_, () => list)
      return
    }
  }
  const probed = await probeServices($).catch(() => [])
  await update($, services_, () => probed)
}

async function loadAll($: EngineInterface) {
  await loadFleet($)
  await loadPipeline($)
  await loadGit($)
  await loadGate($)
  await loadProfile($)
  await loadContextProfile($)
  await loadServices($)
}

// ---------------------------------------------------------------------------
// Prompt prefill safety: the only place that writes to the prompt box
// ---------------------------------------------------------------------------

async function fillPreset($: EngineInterface, text: string) {
  if ((await $.prompt.read()).text) {
    await update($, message_, () => 'Prompt is not empty – clear it first')
    return
  }
  await $.prompt.fill({ text })
  await update($, message_, () => `▸ in your prompt: ${text}`)
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const TAB_ACCENT: Record<ControlTab, number> = { fleet: 0x2ea043, pipeline: 0x6a9be0, git: 0xd4709a, control: 0xd7a017 }
const TAB_LABEL: Record<ControlTab, string> = { fleet: 'Fleet', pipeline: 'Pipeline', git: 'Git', control: 'Control' }
const TAB_KEY: Record<ControlTab, string> = { fleet: 'f', pipeline: 'p', git: 'g', control: 'c' }

async function renderHeader($: EngineInterface, e: PaneInput) {
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const Raster = 'Raster' in ui ? ui.Raster : undefined
  const active = await read($, tab_)
  return (
    <Box key="header" flexDirection="row" marginBottom={1}>
      {Raster ? (
        <Raster key="logo" columns={LOGO_W} rows={2} cells={logoCells()} />
      ) : (
        <Text key="logo-fallback" color="green">◆</Text>
      )}
      <Text key="title" bold>{' '}AOS Control</Text>
      <Text key="tab-name" dimColor>{' · '}{TAB_LABEL[active]}</Text>
    </Box>
  )
}

const BAR = 8
export const filled = (p: FleetProgress) => (p.total ? Math.round((p.done / p.total) * BAR) : 0)

async function renderFleetBody($: EngineInterface, e: PaneInput) {
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const Raster = 'Raster' in ui ? ui.Raster : undefined
  const list = await read($, fleet_)
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
                <Text bold color={hex(roleColor(s))}>{fit(s.name, CARD - 2)}</Text>
                <Text color={DOT[s.activity].color}>{DOT[s.activity].glyph} {fit(s.reason ?? (s.activity === 'working' ? s.phase ?? 'working' : 'idle'), CARD - 4)}</Text>
                {s.progress ? (
                  <Box flexDirection="row">
                    <Text color="green">{'■'.repeat(filled(s.progress))}</Text>
                    <Text dimColor>{'■'.repeat(BAR - filled(s.progress))}</Text>
                    <Text dimColor>{' '}{s.progress.done}/{s.progress.total}</Text>
                  </Box>
                ) : (
                  <Text> </Text>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

const PIPELINE_BAR = 10

async function renderPipelineBody($: EngineInterface, e: PaneInput) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const state = await read($, pipeline_)
  if (!state) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No production_artifacts/state.json found in this repo.</Text>
      </Box>
    )
  }
  const counts = pipelineCounts(state)
  const wide = (e.props.bodyColumns ?? 80) >= 96
  const phaseIndex = PHASES.indexOf(state.phase)
  const phaseStrip = (
    <Box key="phases" flexDirection="row" marginBottom={1}>
      {PHASES.map((p, i) => {
        const label = p.replace(/_/g, ' ').toUpperCase()
        if (i === phaseIndex) {
          return <Text key={p} bold backgroundColor="#6a9be0" color="black">{` ${label} `}</Text>
        }
        if (i < phaseIndex) {
          return <Text key={p} color="green">{` ${label} `}</Text>
        }
        return <Text key={p} dimColor>{` ${label} `}</Text>
      })}
    </Box>
  )
  const summary = (
    <Box key="summary" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold wrap="truncate-end">{state.run_id}</Text>
        <Text dimColor wrap="truncate-end">{state.iteration}/{state.max_iterations} repairs</Text>
      </Box>
      <Text dimColor wrap="truncate-end">{state.goal}</Text>
      {state.needs_human && <Text color="yellow">▲ needs human</Text>}
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">findings {counts.open} open ({counts.blocking} blocking)</Text>
        <Text dimColor wrap="truncate-end">{counts.fixed} fixed · {counts.wontFix} wont_fix</Text>
      </Box>
    </Box>
  )
  const gateCard = (
    <Box key="gates" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
      <Text bold>GATES</Text>
      {counts.gates.length === 0 ? (
        <Text dimColor>no gates recorded</Text>
      ) : (
        counts.gates.map(([k, v]) => (
          <Box key={`gate-${k}`} flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">{k}</Text>
            <Text color={v === 'pass' ? 'green' : v === 'fail' ? 'red' : 'gray'}>{v}</Text>
          </Box>
        ))
      )}
    </Box>
  )
  const nodes = Array.from(new Set(state.findings.map(f => f.node)))
  const findingsCard = (
    <Box key="findings" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>FINDINGS BY NODE</Text>
      {nodes.length === 0 ? (
        <Text dimColor>no findings</Text>
      ) : (
        nodes.map(node => {
          const nodeOpen = state.findings.filter(f => f.node === node && f.status === 'open')
          const nodeTotal = state.findings.filter(f => f.node === node).length
          const bar = Math.round((nodeOpen.filter(f => f.severity === 'blocking').length / Math.max(1, nodeTotal)) * PIPELINE_BAR)
          return (
            <Box key={`find-${node}`} flexDirection="row" justifyContent="space-between">
              <Text wrap="truncate-end">{node}</Text>
              <Box flexDirection="row">
                <Text color="green">{'■'.repeat(PIPELINE_BAR - bar)}</Text>
                <Text color="red">{'■'.repeat(bar)}</Text>
                <Text dimColor>{' '}{nodeOpen.length}/{nodeTotal}</Text>
              </Box>
            </Box>
          )
        })
      )}
      <Box flexDirection="row" marginTop={1}>
        <Button key="resume" plain label="resume graph" hotkey="r" onPress={() => void fillPreset($, '/startcycle-graph')} />
      </Box>
    </Box>
  )
  const body = wide ? (
    <Box key="cols" flexDirection="row">
      <Box key="col-left" flexGrow={1} flexDirection="column">{summary}{findingsCard}</Box>
      <Box key="col-right" flexGrow={1} flexDirection="column">{gateCard}</Box>
    </Box>
  ) : (
    <Box key="stack" flexDirection="column">{summary}{gateCard}{findingsCard}</Box>
  )
  return (
    <Box flexDirection="column">
      {phaseStrip}
      {body}
    </Box>
  )
}

async function renderGitBody($: EngineInterface, e: PaneInput) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const items = await read($, gitWorktrees_)
  if (items.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No git worktrees found.</Text>
      </Box>
    )
  }
  const wide = (e.props.bodyColumns ?? 80) >= 96
  const stageBadge = (stage: GitStage) => {
    const { glyph, color } = STAGE_GLYPH[stage]
    return <Text color={color}>{glyph} {stage}</Text>
  }
  const rows = items.map((w, i) => (
    <Box key={`wt-${i}`} flexDirection="row" justifyContent="space-between">
      <Box key={`wt-${i}-l`} flexDirection="row">
        {stageBadge(w.stage)}
        <Text dimColor wrap="truncate-end">{' '}{w.isAgentWorktree ? (w.agentName ?? 'agent') : 'project'}</Text>
        <Text wrap="truncate-end">{' '}{fit(w.branch, 24)}</Text>
      </Box>
      <Box key={`wt-${i}-r`} flexDirection="row">
        <Text dimColor wrap="truncate-end">{w.head}</Text>
        {w.dirtyCount > 0 && <Text color="yellow">{' '}{w.dirtyCount} dirty</Text>}
        {w.aheadCount > 0 && <Text color="cyan">{' '}+{w.aheadCount}</Text>}
        {w.behindCount > 0 && <Text color="red">{' '}-{w.behindCount}</Text>}
        {w.findingsTotal !== undefined && w.findingsTotal > 0 && (
          <Text color={w.findingsOpen ? 'red' : 'green'}>{' '}{w.findingsTotal - (w.findingsOpen ?? 0)}/{w.findingsTotal} findings</Text>
        )}
      </Box>
    </Box>
  ))
  const main = items.find(w => !w.isAgentWorktree) ?? items[0]
  const root = main?.path ?? '.'
  return (
    <Box flexDirection="column">
      <Box key="git-head" flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold>WORKTREES</Text>
        <Box flexDirection="row">
          <Button key="fetch" plain label="fetch" hotkey="F" onPress={() => void fillPreset($, `git -C ${root} fetch origin`)} />
          <Button key="prune" plain label="prune" hotkey="P" onPress={() => void fillPreset($, `git -C ${root} worktree prune`)} />
        </Box>
      </Box>
      {wide ? (
        <Box key="git-cols" flexDirection="row">
          <Box flexGrow={1} flexDirection="column">{rows.filter((_, i) => i % 2 === 0)}</Box>
          <Box flexGrow={1} flexDirection="column">{rows.filter((_, i) => i % 2 === 1)}</Box>
        </Box>
      ) : (
        <Box key="git-stack" flexDirection="column">{rows}</Box>
      )}
      <Text dimColor wrap="truncate-end">stages: editing → committed → reviewed → merged (local only, no fetch)</Text>
    </Box>
  )
}

async function renderControlBody($: EngineInterface, e: PaneInput) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const gate = await read($, gate_)
  const prof = await read($, profile_)
  const ctx = await read($, contextProfile_)
  const services = await read($, services_)
  const wide = (e.props.bodyColumns ?? 80) >= 96
  const gateCard = (
    <Box key="gate" flexDirection="column" borderStyle="round" borderColor={MODE_COLOR[gate.mode] ?? 'yellow'} paddingX={1} marginBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>GO-GATE</Text>
        <Text color={MODE_COLOR[gate.mode] ?? 'yellow'}>{gate.mode.toUpperCase()}</Text>
      </Box>
      {gate.grants.length === 0 ? (
        <Text dimColor>no active grants</Text>
      ) : (
        gate.grants.map(g => (
          <Box key={`grant-${g.scope}`} flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">{g.scope}</Text>
            <Text color={grantColor(g.minutesLeft)}>{timeLeft(g.minutesLeft)} left</Text>
          </Box>
        ))
      )}
      <Box flexDirection="row" marginTop={1}>
        <Button key="status" plain label="status" hotkey="s" onPress={() => void fillPreset($, 'gogate status')} />
        <Box marginRight={1} />
        <Button key="grant" plain label="grant 2h" hotkey="g" onPress={() => void fillPreset($, 'gogate grant push-feature,github-write 2h')} />
      </Box>
    </Box>
  )
  const profileCard = (
    <Box key="profile" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
      <Text bold>PROFILE</Text>
      {prof ? (
        <Text color={PROFILE_COLOR[prof.profile]}>
          {prof.profile} · {prof.minutesLeft === null ? 'no expiry' : `${timeLeft(prof.minutesLeft)} left`}
        </Text>
      ) : (
        <Text dimColor>profile not found</Text>
      )}
      {ctx && <Text dimColor>context: {ctx.name}</Text>}
      <Box flexDirection="row" marginTop={1}>
        <Button key="profile-work" plain label="work" onPress={() => void fillPreset($, 'aos-gate profile work')} />
        <Box marginRight={1} />
        <Button key="profile-strict" plain label="strict" onPress={() => void fillPreset($, 'aos-gate profile strict')} />
      </Box>
    </Box>
  )
  const servicesCard = (
    <Box key="services" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
      <Text bold>SERVICES</Text>
      {services.length === 0 ? (
        <Text dimColor>no service status</Text>
      ) : (
        services.map(s => (
          <Box key={`svc-${s.id}`} flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">{s.name}{s.port ? `:${s.port}` : ''}</Text>
            <Box flexDirection="row">
              <Text color={s.status === 'running' ? 'green' : s.status === 'down' ? 'red' : 'gray'}>{s.status}</Text>
              <Box marginRight={1} />
              <Button key={`restart-${s.id}`} plain label="restart" onPress={() => void fillPreset($, `aos service restart ${s.id}`)} />
            </Box>
          </Box>
        ))
      )}
    </Box>
  )
  const diagnosticsCard = (
    <Box key="diagnostics" flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>DIAGNOSTICS</Text>
      <Box flexDirection="row">
        <Button key="doctor" plain label="aos doctor" hotkey="d" onPress={() => void fillPreset($, 'aos doctor')} />
        <Box marginRight={1} />
        <Button key="update" plain label="aos update" onPress={() => void fillPreset($, 'aos update')} />
      </Box>
    </Box>
  )
  const body = wide ? (
    <Box key="cols" flexDirection="row">
      <Box key="col-left" flexGrow={1} flexDirection="column">{gateCard}{profileCard}</Box>
      <Box key="col-right" flexGrow={1} flexDirection="column">{servicesCard}{diagnosticsCard}</Box>
    </Box>
  ) : (
    <Box key="stack" flexDirection="column">{gateCard}{profileCard}{servicesCard}{diagnosticsCard}</Box>
  )
  return <Box flexDirection="column">{body}</Box>
}

// ---------------------------------------------------------------------------
// Public register hook
// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'aos-control', description: 'Show the AOS Control cockpit' })
    await loadAll($).catch(() => undefined)
    $.clock.every(30_000, () => void loadGate($).catch(() => undefined))
    $.clock.every(30_000, () => void loadProfile($).catch(() => undefined))
    $.clock.every(30_000, () => void loadServices($).catch(() => undefined))
    $.clock.every(5_000, () => void loadFleet($))
    $.clock.every(5_000, () => void loadPipeline($).catch(() => undefined))
    $.clock.every(5_000, () => void loadGit($).catch(() => undefined))
    $.clock.every(700, () => void update($, frame_, f => f + 1).catch(() => undefined))
    return result
  })

  on('command.run', { command: 'aos-control' }, async ($, e) => {
    if (e.args) {
      const arg = e.args.trim() as ControlTab
      if (arg === 'fleet' || arg === 'pipeline' || arg === 'git' || arg === 'control') {
        await update($, tab_, () => arg)
      }
    }
    await loadAll($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: 'AOS Control' })
    return { text: 'AOS Control pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const active = await read($, tab_)
    const header = await renderHeader($, e)
    let body: unknown
    switch (active) {
      case 'fleet': body = await renderFleetBody($, e); break
      case 'pipeline': body = await renderPipelineBody($, e); break
      case 'git': body = await renderGitBody($, e); break
      case 'control': body = await renderControlBody($, e); break
    }
    const tabs = (['fleet', 'pipeline', 'git', 'control'] as ControlTab[]).map(k => {
      const label = TAB_LABEL[k]
      const hotkey = TAB_KEY[k]
      return active === k ? (
        <Text key={`tab-${k}`} bold backgroundColor={hex(TAB_ACCENT[k])} color="black">{label}</Text>
      ) : (
        <Button key={`tab-${k}`} plain label={label} hotkey={hotkey} onPress={() => void update($, tab_, () => k)} />
      )
    })
    const msg = await read($, message_)
    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="row">{tabs}</Box>
        <Text dimColor wrap="truncate-end">{'\u2500'.repeat(e.props.bodyColumns ?? 80)}</Text>
        {body}
        {msg && <Text color="yellow" wrap="truncate-end">{msg}</Text>}
      </Box>
    )
  })
}
