import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  AOS,
  PROBE_TTL_MS,
  bandSegments,
  barCells,
  contextBar,
  createTtlCache,
  flowSteps,
  FLOW_STYLE,
  gateFromRun,
  kTokens,
  logoMark,
  logoRgba,
  parseGateStatus,
  redact,
  usageRows,
} from './lib'
import type { TtlCache } from './lib'
import type {
  ControlTab,
  ContextProfileName,
  FleetActivity,
  FleetProgress,
  FleetRole,
  FleetSession,
  GateProfile,
  GateState,
  GitStage,
  GitWorktreeItem,
  InstallProfileName,
  PipelineState,
  ServiceStatus,
  UsageSnapshot,
} from '../types'

export { parseGateStatus }

const PANE = 'aos-control'
const STALE_MS = 5 * 60_000
const ROLES: FleetRole[] = ['master', 'task-manager', 'orchestrator', 'worker']

const tab_ = atom({ plugin: 'bdb-aos-control', key: 'tab' } as const, 'fleet' as const)
const fleet_ = atom({ plugin: 'bdb-aos-control', key: 'fleet' } as const, [] as FleetSession[])
const pipeline_ = atom({ plugin: 'bdb-aos-control', key: 'pipeline' } as const, null as PipelineState | null)
const gitWorktrees_ = atom({ plugin: 'bdb-aos-control', key: 'gitWorktrees' } as const, [] as GitWorktreeItem[])
const profile_ = atom({ plugin: 'bdb-aos-control', key: 'profile' } as const, null as GateProfile | null)
const gate_ = atom({ plugin: 'bdb-aos-control', key: 'gate' } as const, { mode: 'unknown', grants: [], raw: '', error: 'not read yet' } as GateState)
const contextProfile_ = atom({ plugin: 'bdb-aos-control', key: 'contextProfile' } as const, 'full' as ContextProfileName)
const installProfile_ = atom({ plugin: 'bdb-aos-control', key: 'installProfile' } as const, 'standard' as InstallProfileName)
const roleHint_ = atom({ plugin: 'bdb-aos-control', key: 'roleHint' } as const, '')
const services_ = atom({ plugin: 'bdb-aos-control', key: 'services' } as const, [] as ServiceStatus[])
const message_ = atom({ plugin: 'bdb-aos-control', key: 'message' } as const, '')
const frame_ = atom({ plugin: 'bdb-aos-control', key: 'frame' } as const, 0)
const usage_ = atom({ plugin: 'bdb-aos-control', key: 'usage' } as const, null as UsageSnapshot | null)
const probeCache: TtlCache = createTtlCache(PROBE_TTL_MS)

// ---------------------------------------------------------------------------
// Install / context profile helpers (same logic as lib/v5/context-profiles.js)
// ---------------------------------------------------------------------------

const INSTALL_PROFILES: InstallProfileName[] = ['minimal', 'standard', 'full']
const CONTEXT_PROFILES: Record<ContextProfileName, { estimate: number }> = {
  full: { estimate: 70000 },
  orchestrator: { estimate: 55000 },
  worker: { estimate: 35000 },
  small: { estimate: 15000 },
}

const DEFAULT_INSTALL_PROFILE: InstallProfileName = 'standard'
const DEFAULT_CONTEXT_PROFILE: ContextProfileName = 'full'

const knownInstallProfile = (x: unknown): x is InstallProfileName =>
  typeof x === 'string' && INSTALL_PROFILES.includes(x as InstallProfileName)

const sanitizeInstallProfile = (raw: unknown): InstallProfileName =>
  knownInstallProfile(raw) ? raw : DEFAULT_INSTALL_PROFILE

const knownContextProfile = (x: unknown): x is ContextProfileName =>
  typeof x === 'string' && Object.hasOwn(CONTEXT_PROFILES, x)

const sanitizeContext = (raw: unknown): ContextProfileName =>
  knownContextProfile(raw) ? raw : DEFAULT_CONTEXT_PROFILE

export const tokenEstimate = (name: string) => {
  const n = CONTEXT_PROFILES[name as ContextProfileName]?.estimate
  if (n === undefined) return 'unknown'
  return n >= 1000 ? `~${Math.round(n / 1000)}k` : `~${n}`
}

export const roleHint = (sessionName = '') => {
  const name = String(sessionName).toLowerCase()
  if (/master|orchestrator/.test(name)) return 'full/orchestrator'
  if (/worker/.test(name)) return 'worker'
  if (/small/.test(name)) return 'small'
  return ''
}

export const parseV5Settings = (text: string) => {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    raw = {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {}
  const obj = raw as Record<string, unknown>
  return {
    installProfile: sanitizeInstallProfile(obj.profile),
    contextProfile: sanitizeContext(obj.context),
  }
}

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
const num = (h: string) => parseInt(h.slice(1), 16)
const ROLE_COLOR: Record<FleetRole, number> = {
  master: num(AOS.accent),
  'task-manager': num(AOS.warn),
  orchestrator: num(AOS.info),
  worker: num(AOS.ok),
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
  attention: { glyph: '▲', color: AOS.warn },
  working: { glyph: '●', color: AOS.ok },
  idle: { glyph: '○', color: AOS.muted },
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
  minutesLeft >= 30 ? AOS.ok : minutesLeft >= 10 ? AOS.warn : AOS.bad

export const timeLeft = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min}m`)

export function parseProfile(text: string): GateProfile | null {
  const m = /^profile:\s*(strict|work|off)\b(?:\s*\((?:(\d+) min left|no expiry)\))?/m.exec(text)
  if (!m) return null
  const note = /^note:\s*(.+)$/m.exec(text)?.[1]?.trim()
  return { profile: m[1] as GateProfile['profile'], minutesLeft: m[2] ? Number(m[2]) : null, ...(note ? { note } : {}) }
}

const MODE_COLOR: Record<string, string> = { hard: AOS.ok, soft: AOS.warn, off: AOS.bad, unknown: AOS.muted }
const PROFILE_COLOR: Record<string, string> = { strict: AOS.muted, work: AOS.warn, off: AOS.bad }

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
      run_id: redact(String(raw.run_id ?? '')),
      goal: redact(String(raw.goal ?? '')),
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
              summary: f.summary ? redact(String(f.summary)) : undefined,
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
  editing: { glyph: '✎', color: AOS.warn },
  committed: { glyph: '●', color: AOS.info },
  reviewed: { glyph: '✓', color: AOS.ok },
  merged: { glyph: '◆', color: AOS.accent },
}

export async function buildWorktreeItems(
  $: EngineInterface,
  root: string,
  state: PipelineState | null,
  cache?: TtlCache,
  now = 0,
): Promise<GitWorktreeItem[]> {
  // TTL cache: 1 + 2 subprocesses per worktree otherwise run on every 5 s tick
  const cached = <T,>(key: string, load: () => Promise<T>) => (cache ? cache.get(key, now, load) : load())
  const r = await cached(`list:${root}`, () => $.process.run(['git', '-C', root, 'worktree', 'list', '--porcelain']).catch(() => null))
  if (!r || r.exitCode !== 0) return []
  const worktrees = parseWorktrees(r.stdout)
  const main = worktrees.find(w => !w.bare && (w.branch === 'main' || w.branch === 'master')) ?? worktrees[0]
  const mainRoot = main?.path ?? root
  const items: GitWorktreeItem[] = []
  for (const w of worktrees) {
    if (w.bare) continue
    const probe = await cached(`wt:${w.path}`, async () => {
      const status = await $.process.run(['git', '-C', w.path, 'status', '--porcelain=v1', '-b']).catch(() => null)
      const sb = status && status.exitCode === 0 ? parseStatusBranch(status.stdout) : { branch: w.branch, ahead: 0, behind: 0, dirty: 0 }
      const mergedR = await $.process.run(['git', '-C', w.path, 'branch', '--merged', 'origin/main', '--format=%(refname:short)']).catch(() => null)
      const merged = mergedR && mergedR.exitCode === 0 ? mergedR.stdout.split('\n').some(b => b.trim() === sb.branch) : false
      return { sb, merged }
    })
    const { sb, merged } = probe
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

const redactSession = (s: FleetSession): FleetSession => ({
  ...s,
  name: redact(s.name),
  ...(s.reason ? { reason: redact(s.reason) } : {}),
  ...(s.phase ? { phase: redact(s.phase) } : {}),
  ...(s.repo ? { repo: redact(s.repo) } : {}),
  ...(s.branch ? { branch: redact(s.branch) } : {}),
  cwd: redact(s.cwd),
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
    // mtime first: ended sessions pile up as files and reading them all every tick stalls the pane
    if (entry.kind !== 'file' || !entry.name.endsWith('.json') || now - entry.mtimeMs >= STALE_MS) continue
    try {
      const s: FleetSession = JSON.parse(await $.fs.read(`${dir}/${entry.name}`))
      if (!s.ended && now - s.updatedAt < STALE_MS) sessions.push(redactSession(s))
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
  const items = await buildWorktreeItems($, root, state, probeCache, await $.clock.now()).catch(() => [])
  await update($, gitWorktrees_, () => items)
}

async function loadGate($: EngineInterface) {
  if (await isDemo($)) {
    await update($, gate_, () => ({ mode: 'soft', grants: [{ scope: 'push-feature', minutesLeft: 74 }], raw: 'AOS go-gate, session demo: mode soft' }))
    return
  }
  const home = await $.env.get('HOME')
  let next: GateState
  try {
    const r = await $.process.run(['node', `${home}/.claude/hooks/go-grant.mjs`, '--status', '--session', await $.session.id()])
    next = gateFromRun(r)
  } catch (err) {
    next = gateFromRun(null, err)
  }
  await update($, gate_, () => next)
}

async function loadUsage($: EngineInterface) {
  const fetchedAt = await $.clock.now()
  if (await isDemo($)) {
    const at = (min: number) => new Date(fetchedAt + min * 60_000).toISOString()
    await update($, usage_, () => ({
      fetchedAt,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 42, resetsAt: at(133) },
        { kind: 'seven_day', percentUsed: 18, resetsAt: at(3 * 1440 + 300) },
      ],
      context: {
        tokens: 61000,
        window: 200000,
        percent: 31,
        breakdown: {
          rawMaxTokens: 200000,
          percentage: 31,
          categories: [
            { name: 'System prompt', tokens: 8000, kind: 'used' },
            { name: 'Tools', tokens: 14000, kind: 'used' },
            { name: 'Memory files', tokens: 6000, kind: 'used' },
            { name: 'Messages', tokens: 33000, kind: 'used' },
            { name: 'Free space', tokens: 104000, kind: 'free' },
            { name: 'Autocompact buffer', tokens: 35000, kind: 'buffer' },
          ],
        },
      },
    }))
    return
  }
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const b = u.context.breakdown
    await update($, usage_, () => ({
      fetchedAt,
      rateLimits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
      context: {
        tokens: u.context.tokens,
        window: u.context.window,
        percent: u.context.percent,
        ...(b ? { breakdown: { rawMaxTokens: b.rawMaxTokens, percentage: b.percentage, categories: b.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })) } } : {}),
      },
    }))
  } catch {
    await update($, usage_, () => null)
  }
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

async function loadProfiles($: EngineInterface) {
  const home = await $.env.get('HOME')
  const text = await $.fs.read(`${home}/.aos/v5-settings.json`).catch(() => '{}')
  const { installProfile, contextProfile } = parseV5Settings(text)
  await update($, installProfile_, () => installProfile)
  await update($, contextProfile_, () => contextProfile)
  const sessionName = await $.env.get('AOS_SESSION_NAME').catch(() => '') || (await $.session.id())
  await update($, roleHint_, () => roleHint(sessionName))
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
  await loadProfiles($)
  await loadServices($)
  await loadUsage($)
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

const TAB_ACCENT: Record<ControlTab, string> = { fleet: AOS.ok, pipeline: AOS.info, git: AOS.accent, control: AOS.warn }
const TAB_LABEL: Record<ControlTab, string> = { fleet: 'Fleet', pipeline: 'Pipeline', git: 'Git', control: 'Control' }
const TAB_KEY: Record<ControlTab, string> = { fleet: 'f', pipeline: 'p', git: 'g', control: 'c' }

async function renderHeader($: EngineInterface, e: PaneInput) {
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const Image = 'Image' in ui ? ui.Image : undefined
  const active = await read($, tab_)
  const mark = logoMark(!!Image)
  const logo = logoRgba()
  return (
    <Box key="header" flexDirection="row" marginBottom={1}>
      {Image && mark.kind === 'image' ? (
        <Image key="logo" source={{ rgba: logo.rgba, width: logo.width, height: logo.height }} columns={4} rows={2} alt={mark.text} />
      ) : (
        <Text key="logo-fallback" bold color={AOS.accent}>{mark.text}</Text>
      )}
      <Text key="title" bold color={AOS.text}>{' '}AOS Control</Text>
      <Text key="tab-name" color={AOS.muted}>{' · '}{TAB_LABEL[active]}</Text>
    </Box>
  )
}

function Section(ui: ReturnType<EngineInterface['ui']['resolve']>, key: string, title: string, children: unknown, border: string = AOS.border) {
  const { Box, Text } = ui
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={border} paddingX={1} marginBottom={1}>
      <Text bold color={AOS.accent}>{title}</Text>
      {children as never}
    </Box>
  )
}

async function renderDeck($: EngineInterface, e: PaneInput) {
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const usage = await read($, usage_)
  const now = await $.clock.now()
  const cols = e.props.bodyColumns ?? 80
  const width = Math.max(8, Math.min(30, cols - 36))
  const rows = usageRows(usage, now)
  const ctx = contextBar(usage?.context, width)
  const usageBody = (
    <Box flexDirection="column">
      {rows.map(r => {
        const cells = barCells(r.percent ?? 0, width)
        return (
          <Box key={`usage-${r.label}`} flexDirection="row">
            <Text color={AOS.muted}>{r.label}{' '}</Text>
            <Text color={r.color}>{'█'.repeat(cells.on)}</Text>
            <Text color={AOS.border}>{'█'.repeat(cells.off)}</Text>
            <Text color={AOS.text}>{' '}{r.percent === null ? 'n/a' : `${Math.round(r.percent)}%`}</Text>
            <Text color={AOS.muted}>{' · resets '}{r.countdown}</Text>
          </Box>
        )
      })}
      {rows.every(r => r.percent === null) && <Text color={AOS.muted} wrap="truncate-end">n/a: no rate-limit reading yet (subscription + first response needed)</Text>}
    </Box>
  )
  const ctxBody = (
    <Box flexDirection="column">
      {ctx.mode === 'n/a' ? (
        <Text color={AOS.muted} wrap="truncate-end">n/a: {ctx.note}</Text>
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="row">
            {ctx.segments.map((s, i) => <Text key={`ctxseg-${i}`} color={s.color}>{'█'.repeat(s.cells)}</Text>)}
            <Text color={AOS.text}>{' '}{ctx.percent}%</Text>
          </Box>
          {ctx.segments.map((s, i) => (
            <Box key={`ctxleg-${i}`} flexDirection="row">
              <Text color={s.color}>{'■ '}</Text>
              <Text color={AOS.text} wrap="truncate-end">{s.name}</Text>
              <Text color={AOS.muted}>{' '}{kTokens(s.tokens)}</Text>
            </Box>
          ))}
          <Text color={AOS.muted} wrap="truncate-end">{ctx.note}</Text>
        </Box>
      )}
    </Box>
  )
  return (
    <Box key="deck" flexDirection="column">
      {Section(ui, 'sec-usage', 'USAGE', usageBody)}
      {Section(ui, 'sec-context', 'CONTEXT', ctxBody)}
    </Box>
  )
}

const BAR = 8
export const filled = (p: FleetProgress) => (p.total ? Math.round((p.done / p.total) * BAR) : 0)

export const filterRosterSessions = (sessions: FleetSession[]): FleetSession[] => {
  const shown: FleetSession[] = []
  const delegatedWorkers: FleetSession[] = []
  const nodeWorkers = new Map<string, FleetSession[]>()

  for (const s of sessions) {
    if (s.role !== 'worker') {
      shown.push(s)
      continue
    }
    if (s.delegated) {
      delegatedWorkers.push(s)
    } else if (s.trailNode) {
      const workers = nodeWorkers.get(s.trailNode) ?? []
      workers.push(s)
      nodeWorkers.set(s.trailNode, workers)
    }
  }

  if (delegatedWorkers.length > 0) {
    shown.push({
      id: 'delegated-collapse',
      name: `+${delegatedWorkers.length} delegated`,
      role: 'worker',
      activity: 'idle',
      cwd: '',
      updatedAt: 0,
    })
  }

  for (const [node, workers] of nodeWorkers.entries()) {
    shown.push({
      id: `node-${node}`,
      name: `packs ×${workers.length}`,
      role: 'worker',
      activity: 'idle',
      reason: node,
      cwd: '',
      updatedAt: workers[0]!.updatedAt,
    })
  }

  return shown
}

async function renderFleetBody($: EngineInterface, e: PaneInput) {
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const Raster = 'Raster' in ui ? ui.Raster : undefined
  const raw = await read($, fleet_)
  const list = filterRosterSessions(raw)
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
                    <Text color={AOS.ok}>{'■'.repeat(filled(s.progress))}</Text>
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
  const steps = flowSteps(state)
  const phaseStrip = (
    <Box key="phases" flexDirection="row" marginBottom={1}>
      {steps.flatMap((st, i) => {
        const { glyph, color } = FLOW_STYLE[st.status]
        const node = (
          <Text key={`flow-${st.phase}`} bold={st.status === 'running' || st.status === 'blocked'} color={color}>{glyph} {st.label}</Text>
        )
        return i === 0 ? [node] : [<Text key={`flow-c-${st.phase}`} color={steps[i - 1]!.status === 'done' ? AOS.ok : AOS.border}>{' ─ '}</Text>, node]
      })}
    </Box>
  )
  const summary = (
    <Box key="summary" flexDirection="column" borderStyle="round" borderColor={AOS.border} paddingX={1} marginBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold wrap="truncate-end">{state.run_id}</Text>
        <Text dimColor wrap="truncate-end">{state.iteration}/{state.max_iterations} repairs</Text>
      </Box>
      <Text dimColor wrap="truncate-end">{state.goal}</Text>
      {state.needs_human && <Text color={AOS.warn}>▲ needs human</Text>}
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">findings {counts.open} open ({counts.blocking} blocking)</Text>
        <Text dimColor wrap="truncate-end">{counts.fixed} fixed · {counts.wontFix} wont_fix</Text>
      </Box>
    </Box>
  )
  const gateCard = (
    <Box key="gates" flexDirection="column" borderStyle="round" borderColor={AOS.border} paddingX={1} marginBottom={1}>
      <Text bold color={AOS.accent}>GATES</Text>
      {counts.gates.length === 0 ? (
        <Text dimColor>no gates recorded</Text>
      ) : (
        counts.gates.map(([k, v]) => (
          <Box key={`gate-${k}`} flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">{k}</Text>
            <Text color={v === 'pass' ? AOS.ok : v === 'fail' ? AOS.bad : AOS.muted}>{v}</Text>
          </Box>
        ))
      )}
    </Box>
  )
  const nodes = Array.from(new Set(state.findings.map(f => f.node)))
  const findingsCard = (
    <Box key="findings" flexDirection="column" borderStyle="round" borderColor={AOS.border} paddingX={1}>
      <Text bold color={AOS.accent}>FINDINGS BY NODE</Text>
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
                <Text color={AOS.ok}>{'■'.repeat(PIPELINE_BAR - bar)}</Text>
                <Text color={AOS.bad}>{'■'.repeat(bar)}</Text>
                <Text dimColor>{' '}{nodeOpen.length}/{nodeTotal}</Text>
              </Box>
            </Box>
          )
        })
      )}
      <Box flexDirection="row" marginTop={1}>
        <Button key="resume" plain label="resume graph" hotkey="r" onPress={() => void fillPreset($, '/fabric-graph')} />
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
        {w.dirtyCount > 0 && <Text color={AOS.warn}>{' '}{w.dirtyCount} dirty</Text>}
        {w.aheadCount > 0 && <Text color={AOS.info}>{' '}+{w.aheadCount}</Text>}
        {w.behindCount > 0 && <Text color={AOS.bad}>{' '}-{w.behindCount}</Text>}
        {w.findingsTotal !== undefined && w.findingsTotal > 0 && (
          <Text color={w.findingsOpen ? AOS.bad : AOS.ok}>{' '}{w.findingsTotal - (w.findingsOpen ?? 0)}/{w.findingsTotal} findings</Text>
        )}
      </Box>
    </Box>
  ))
  const main = items.find(w => !w.isAgentWorktree) ?? items[0]
  const root = main?.path ?? '.'
  return (
    <Box flexDirection="column">
      <Box key="git-head" flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold color={AOS.accent}>WORKTREES</Text>
        <Box flexDirection="row">
          <Button key="fetch" plain label="fetch" onPress={() => void fillPreset($, `git -C ${root} fetch origin`)} />
          <Box marginRight={1} />
          <Button key="prune" plain label="prune" onPress={() => void fillPreset($, `git -C ${root} worktree prune`)} />
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
  const install = await read($, installProfile_)
  const hint = await read($, roleHint_)
  const services = await read($, services_)
  const wide = (e.props.bodyColumns ?? 80) >= 96
  const gateCard = (
    <Box key="gate" flexDirection="column" borderStyle="round" borderColor={MODE_COLOR[gate.mode] ?? AOS.warn} paddingX={1} marginBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={AOS.accent}>GO-GATE</Text>
        <Text color={MODE_COLOR[gate.mode] ?? AOS.warn}>{gate.mode.toUpperCase()}</Text>
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
  const gateProfileCard = (
    <Box key="gate-profile" flexDirection="column" borderStyle="round" borderColor={AOS.border} paddingX={1} marginBottom={1}>
      <Text bold color={AOS.accent}>GATE PROFILE</Text>
      {prof ? (
        <Text color={PROFILE_COLOR[prof.profile]}>
          {prof.profile} · {prof.minutesLeft === null ? 'no expiry' : `${timeLeft(prof.minutesLeft)} left`}
        </Text>
      ) : (
        <Text dimColor>profile not found</Text>
      )}
      <Box flexDirection="row" marginTop={1}>
        <Button key="profile-work" plain label="work" onPress={() => void fillPreset($, 'aos-gate profile work')} />
        <Box marginRight={1} />
        <Button key="profile-strict" plain label="strict" onPress={() => void fillPreset($, 'aos-gate profile strict')} />
      </Box>
    </Box>
  )
  const installProfileCard = (
    <Box key="install-profile" flexDirection="column" borderStyle="round" borderColor={AOS.border} paddingX={1} marginBottom={1}>
      <Text bold color={AOS.accent}>INSTALL PROFILE</Text>
      <Text color={AOS.info}>{install}</Text>
      <Box flexDirection="row" marginTop={1}>
        <Button key="install-minimal" plain label="minimal" onPress={() => void fillPreset($, 'aos --profile=minimal')} />
        <Box marginRight={1} />
        <Button key="install-standard" plain label="standard" onPress={() => void fillPreset($, 'aos --profile=standard')} />
        <Box marginRight={1} />
        <Button key="install-full" plain label="full" onPress={() => void fillPreset($, 'aos --profile=full')} />
      </Box>
    </Box>
  )
  const contextProfileCard = (
    <Box key="context-profile" flexDirection="column" borderStyle="round" borderColor={AOS.border} paddingX={1} marginBottom={1}>
      <Text bold color={AOS.accent}>CONTEXT PROFILE</Text>
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={AOS.info}>{ctx}</Text>
        <Text dimColor>estimate {tokenEstimate(ctx)}</Text>
      </Box>
      <Text dimColor>
        estimate {' '}
        {Object.keys(CONTEXT_PROFILES).map((k, i) => `${k} ${tokenEstimate(k as ContextProfileName)}`).join(' · ')}
      </Text>
      {hint && <Text dimColor>role hint: {hint}</Text>}
      <Box flexDirection="row" marginTop={1}>
        <Button key="ctx-full" plain label="full" onPress={() => void fillPreset($, 'aos context full')} />
        <Box marginRight={1} />
        <Button key="ctx-orchestrator" plain label="orchestrator" onPress={() => void fillPreset($, 'aos context orchestrator')} />
        <Box marginRight={1} />
        <Button key="ctx-worker" plain label="worker" onPress={() => void fillPreset($, 'aos context worker')} />
        <Box marginRight={1} />
        <Button key="ctx-small" plain label="small" onPress={() => void fillPreset($, 'aos context small')} />
      </Box>
    </Box>
  )
  const servicesCard = (
    <Box key="services" flexDirection="column" borderStyle="round" borderColor={AOS.border} paddingX={1} marginBottom={1}>
      <Text bold color={AOS.accent}>SERVICES</Text>
      {services.length === 0 ? (
        <Text dimColor>no service status</Text>
      ) : (
        services.map(s => (
          <Box key={`svc-${s.id}`} flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">{s.name}{s.port ? `:${s.port}` : ''}</Text>
            <Box flexDirection="row">
              <Text color={s.status === 'running' ? AOS.ok : s.status === 'down' ? AOS.bad : AOS.muted}>{s.status}</Text>
              <Box marginRight={1} />
              <Button key={`restart-${s.id}`} plain label="restart" onPress={() => void fillPreset($, `aos service restart ${s.id}`)} />
            </Box>
          </Box>
        ))
      )}
    </Box>
  )
  const diagnosticsCard = (
    <Box key="diagnostics" flexDirection="column" borderStyle="round" borderColor={AOS.border} paddingX={1}>
      <Text bold color={AOS.accent}>DIAGNOSTICS</Text>
      <Box flexDirection="row">
        <Button key="doctor" plain label="aos doctor" hotkey="d" onPress={() => void fillPreset($, 'aos doctor')} />
        <Box marginRight={1} />
        <Button key="update" plain label="aos update" onPress={() => void fillPreset($, 'aos update')} />
      </Box>
    </Box>
  )
  const body = wide ? (
    <Box key="cols" flexDirection="row">
      <Box key="col-left" flexGrow={1} flexDirection="column">{gateCard}{gateProfileCard}{installProfileCard}{contextProfileCard}</Box>
      <Box key="col-right" flexGrow={1} flexDirection="column">{servicesCard}{diagnosticsCard}</Box>
    </Box>
  ) : (
    <Box key="stack" flexDirection="column">{gateCard}{gateProfileCard}{installProfileCard}{contextProfileCard}{servicesCard}{diagnosticsCard}</Box>
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
    $.clock.every(5_000, () => void loadFleet($).catch(() => undefined))
    $.clock.every(5_000, () => void loadPipeline($).catch(() => undefined))
    $.clock.every(5_000, () => void loadGit($).catch(() => undefined))
    $.clock.every(60_000, () => void loadUsage($).catch(() => undefined))
    $.clock.every(700, () => void update($, frame_, f => f + 1).catch(() => undefined))
    return result
  })

  on('session.measure', async ($, e, next) => {
    void loadUsage($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const [gate, usage, pipeline, nowMs] = [await read($, gate_), await read($, usage_), await read($, pipeline_), await $.clock.now()]
    const segs = bandSegments({ gate, usage, phase: pipeline?.phase, needsHuman: pipeline?.needs_human, nowMs })
    const parts: unknown[] = []
    segs.forEach((sg, i) => {
      if (i > 0) parts.push(<Text key={`band-sep-${i}`} color={AOS.border}>{' │ '}</Text>)
      parts.push(<Text key={`band-${i}`} color={sg.color} bold={i === 0} wrap="truncate-end">{sg.text}</Text>)
    })
    return <Box key="band" flexDirection="row">{parts as never}</Box>
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
        <Text key={`tab-${k}`} bold backgroundColor={TAB_ACCENT[k]} color={AOS.accentInk}>{label}</Text>
      ) : (
        <Button key={`tab-${k}`} plain label={label} hotkey={hotkey} onPress={() => void update($, tab_, () => k)} />
      )
    })
    const msg = await read($, message_)
    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="row">{tabs}</Box>
        <Text color={AOS.border} wrap="truncate-end">{'\u2500'.repeat(e.props.bodyColumns ?? 80)}</Text>
        {await renderDeck($, e)}
        {body}
        {msg && <Text color={AOS.warn} wrap="truncate-end">{redact(msg)}</Text>}
      </Box>
    )
  })
}
