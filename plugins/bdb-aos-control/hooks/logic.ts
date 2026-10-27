// Pure Control-mod logic. No claude-code runtime import and no JSX, so node --test can load it.
// Node 24 strips types natively: keep this file to erasable syntax (no enums, no parameter properties).
import type { EngineInterface } from 'claude-code'
import type {
  ContextProfileName,
  FleetActivity,
  FleetProgress,
  FleetRole,
  FleetSession,
  GateProfile,
  GitStage,
  GitWorktreeItem,
  InstallProfileName,
  PipelineState,
  ServiceStatus,
} from '../types'
import { redact } from './lib.ts'
import type { TtlCache } from './lib.ts'

const ROLES: FleetRole[] = ['master', 'task-manager', 'orchestrator', 'worker']


// ---------------------------------------------------------------------------
// Install / context profile helpers (same logic as lib/v5/context-profiles.js)
// ---------------------------------------------------------------------------

const INSTALL_PROFILES: InstallProfileName[] = ['minimal', 'standard', 'full']
export const CONTEXT_PROFILES: Record<ContextProfileName, { estimate: number }> = {
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

export const roleFromName = (name: string): FleetRole =>
  /master/i.test(name)
    ? 'master'
    : /task.?manager/i.test(name)
      ? 'task-manager'
      : /orchestr/i.test(name)
        ? 'orchestrator'
        : 'worker'

export function parseProfile(text: string): GateProfile | null {
  const m = /^profile:\s*(strict|work|off)\b(?:\s*\((?:(\d+) min left|no expiry)\))?/m.exec(text)
  if (!m) return null
  const note = /^note:\s*(.+)$/m.exec(text)?.[1]?.trim()
  return { profile: m[1] as GateProfile['profile'], minutesLeft: m[2] ? Number(m[2]) : null, ...(note ? { note } : {}) }
}

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
      gate: raw.gate && typeof raw.gate === 'object' && !Array.isArray(raw.gate)
        ? Object.fromEntries(Object.entries(raw.gate).map(([k, v]) => [k, v === 'pass' || v === 'fail' || v === 'skip' ? v : 'unknown']))
        : {},
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

export async function buildWorktreeItems(
  $: EngineInterface,
  root: string,
  state: PipelineState | null,
  cache?: TtlCache,
  now = 0,
): Promise<GitWorktreeItem[]> {
  // TTL cache: 1 + 2 subprocesses per worktree otherwise run on every 5 s tick
  const cached = <T,>(key: string, load: () => Promise<T>) => (cache ? cache.get(key, now, load) : load())
  const probeFailed = (why: string) => new Error(`git probe failed: ${redact(why).slice(0, 100)}`)
  const r = await cached(`list:${root}`, () => $.process.run(['git', '-C', root, 'worktree', 'list', '--porcelain'])).catch(err => {
    throw probeFailed(err instanceof Error ? err.message : String(err))
  })
  if (r.exitCode !== 0) throw probeFailed(r.stderr || `exit ${r.exitCode}`)
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

const ACTIVITIES: FleetActivity[] = ['working', 'idle', 'attention']

// external JSON: enums fall back safely so a malformed file can never crash a render
const count = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0)

const validProgress = (p: unknown): FleetProgress | undefined => {
  if (!p || typeof p !== 'object') return undefined
  const r = p as Record<string, unknown>
  const total = count(r.total)
  return { total, done: Math.min(count(r.done), total), blocked: count(r.blocked), source: r.source === 'tasks' ? 'tasks' : 'plan' }
}

export const redactSession = (s: FleetSession): FleetSession => {
  const name = redact(String(s.name ?? s.id ?? 'unknown'))
  return {
    ...s,
    id: String(s.id ?? name),
    name,
    role: ROLES.includes(s.role) ? s.role : roleFromName(name),
    activity: ACTIVITIES.includes(s.activity) ? s.activity : 'idle',
    ...(s.reason ? { reason: redact(String(s.reason)) } : {}),
    ...(s.phase ? { phase: redact(String(s.phase)) } : {}),
    ...(s.repo ? { repo: redact(String(s.repo)) } : {}),
    ...(s.branch ? { branch: redact(String(s.branch)) } : {}),
    ...(s.trailNode ? { trailNode: redact(String(s.trailNode)) } : {}),
    cwd: redact(String(s.cwd ?? '')),
    progress: validProgress(s.progress),
    updatedAt: Number(s.updatedAt) || 0,
  }
}

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

export const renderErrorText = (err: unknown) =>
  `AOS Control: render error: ${redact(err instanceof Error ? err.message : String(err)).slice(0, 80)}`
