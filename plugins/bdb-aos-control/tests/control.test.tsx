import { expect, test } from 'claude-code/testing'

import {
  buildWorktreeItems,
  demoFleet,
  demoPipeline,
  filterRosterSessions,
  parseGateStatus,
  parsePipelineState,
  parseProfile,
  parseServices,
  parseStatusBranch,
  parseV5Settings,
  parseWorktrees,
  redactSession,
  renderErrorText,
  roleHint,
  tokenEstimate,
} from '../hooks/register'
import {
  bandSegments,
  bandText,
  contextBar,
  createTtlCache,
  flowSteps,
  formatCountdown,
  gateFromRun,
  logoMark,
  logoRgba,
  redact,
  shq,
  usageRows,
  usageShort,
} from '../hooks/lib'

const PIPELINE_FIXTURE = JSON.stringify({
  run_id: 'run-42',
  goal: 'ship the control mod',
  phase: 'review',
  iteration: 2,
  max_iterations: 3,
  gate: { lint: 'pass', typecheck: 'fail', tests: 'skip', a11y: 'skip', seo: 'skip', security: 'pass' },
  findings: [
    { id: 'f1', severity: 'blocking', node: 'engineering', status: 'open', summary: 'missing tests' },
    { id: 'f2', severity: 'advisory', node: 'ui_ux', status: 'fixed', summary: 'logo alignment' },
  ],
  approvals: [],
  needs_human: true,
})

const CONTROL_MOUNT = (bodyColumns: number) => ({
  plugin: 'bdb-aos-control',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'aos-control',
  props: { bodyColumns } as never,
})

const spy = { fills: 0, opened: [] as string[] }

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const controlMocks = (on: any, nowMs: { n: number }, files: Record<string, string>, demo: boolean, reads: string[] = []) => {
  const defaultFiles: Record<string, string> = {
    'v5-settings.json': JSON.stringify({ profile: 'standard', context: 'worker' }),
  }
  const allFiles = { ...defaultFiles, ...files }
  on('env.get', (_$: unknown, e: unknown) => {
    const key = JSON.stringify(e)
    if (demo && key.includes('AOS_FLEET_DEMO')) return { value: '1' }
    if (key.includes('AOS_SESSION_NAME')) return { value: 'orchestrator-1' }
    if (key.includes('HOME')) return { value: '/home' }
    return { value: '' }
  })
  on('session.start', () => ({ cwd: '/x' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.cwd', () => ({ value: '/x' }))
  on('session.repo', () => ({ value: null }))
  on('clock.now', () => {
    if (nowMs.n < 0) throw new Error('boom token=abc123')
    return { value: (nowMs.n += 60_000) }
  })
  on('clock.every', () => ({ value: { cancel: 'noop' } } as never))
  on('fs.read', (_$: unknown, e: unknown) => {
    const path = JSON.stringify(e)
    reads.push(path)
    for (const [k, v] of Object.entries(allFiles)) {
      if (path.includes(k)) return { value: v }
    }
    throw new Error(`missing ${path}`)
  })
  on('fs.exists', () => ({ value: false }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => {
    spy.opened.push('aos-control')
    return { value: { isPlaced: true } } as never
  })
  on('command.register', () => ({ value: undefined } as never))
  on('prompt.fill', () => {
    spy.fills++
    return { isFilled: true }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('process.run', () => ({
    value: {
      stdout: 'AOS go-gate, session sid: mode soft\n  no active grants',
      stderr: '',
      exitCode: 0,
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('http.fetch', () => ({ value: { ok: false, text: '' } }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
}

const findNode = (node: unknown, k: string): unknown => {
  if (node && typeof node === 'object') {
    const props = (node as { props?: { key?: unknown } }).props
    if (props && String(props.key) === k) return node
    for (const v of Object.values(node)) {
      const found = findNode(v, k)
      if (found) return found
    }
  }
  return undefined
}

test('parseGateStatus handles mode and grants', () => {
  const g = parseGateStatus('AOS go-gate, session sid: mode hard\n  grant push-feature until 2026-01-01T00:00:00Z (15 min left)')
  expect(g.mode).toBe('hard')
  expect(g.grants).toEqual([{ scope: 'push-feature', minutesLeft: 15 }])
})

test('parseProfile parses strict with minutes', () => {
  const p = parseProfile('profile: strict (30 min left)\nnote: none')
  expect(p).toEqual({ profile: 'strict', minutesLeft: 30, note: 'none' })
})

test('tokenEstimate formats context profile estimates', () => {
  expect(tokenEstimate('full')).toBe('~70k')
  expect(tokenEstimate('orchestrator')).toBe('~55k')
  expect(tokenEstimate('worker')).toBe('~35k')
  expect(tokenEstimate('small')).toBe('~15k')
  expect(tokenEstimate('unknown')).toBe('unknown')
})

test('roleHint maps session names to recommended context profiles', () => {
  expect(roleHint('master')).toBe('full/orchestrator')
  expect(roleHint('orchestrator-1')).toBe('full/orchestrator')
  expect(roleHint('worker-3')).toBe('worker')
  expect(roleHint('small-model')).toBe('small')
  expect(roleHint('sid')).toBe('')
})

test('parseV5Settings reads install and context profiles with defaults', () => {
  expect(parseV5Settings(JSON.stringify({ profile: 'minimal', context: 'worker' }))).toEqual({
    installProfile: 'minimal',
    contextProfile: 'worker',
  })
  expect(parseV5Settings('not json')).toEqual({ installProfile: 'standard', contextProfile: 'full' })
  expect(parseV5Settings(JSON.stringify({ context: 'small' }))).toEqual({
    installProfile: 'standard',
    contextProfile: 'small',
  })
  expect(parseV5Settings(JSON.stringify({ profile: 'invalid', context: 'invalid' }))).toEqual({
    installProfile: 'standard',
    contextProfile: 'full',
  })
})

test('parsePipelineState validates required phase and findings', () => {
  const s = parsePipelineState(PIPELINE_FIXTURE)
  expect(s).not.toBeNull()
  expect(s!.phase).toBe('review')
  expect(s!.findings.length).toBe(2)
  expect(s!.needs_human).toBe(true)
})

test('parsePipelineState rejects invalid phase', () => {
  const s = parsePipelineState(JSON.stringify({ phase: 'invalid' }))
  expect(s).toBeNull()
})

test('parseServices handles an array of service objects', () => {
  const list = parseServices(JSON.stringify([{ id: 'hub', name: 'Hub', status: 'running', port: 7900 }]))
  expect(list).toEqual([{ id: 'hub', name: 'Hub', status: 'running', port: 7900 }])
})

test('parseWorktrees parses porcelain output with detached and branches', () => {
  const text = `worktree /repo/main
HEAD abc1234abcd1234abcd1234abcd1234abcd1234
branch refs/heads/main

worktree /repo/wt1
HEAD def5678def5678def5678def5678def5678def5
detached

worktree /repo/bare
bare
`
  const w = parseWorktrees(text)
  expect(w).toEqual([
    { path: '/repo/main', head: 'abc1234abcd1234abcd1234abcd1234abcd1234', branch: 'main', bare: false },
    { path: '/repo/wt1', head: 'def5678def5678def5678def5678def5678def5', branch: '(detached)', bare: false },
    { path: '/repo/bare', head: '', branch: '', bare: true },
  ])
})

test('parseStatusBranch extracts branch, ahead, behind and dirty count', () => {
  const text = `## feat/ui...origin/feat/ui [ahead 2, behind 1]\n M file.ts\n?? new.ts`
  const sb = parseStatusBranch(text)
  expect(sb).toEqual({ branch: 'feat/ui', ahead: 2, behind: 1, dirty: 2 })
})

test('demo helpers return placeholder data', () => {
  expect(demoFleet().map(s => s.name)).toEqual(['demo-orchestrator', 'demo-web', 'demo-api'])
  expect(demoPipeline().phase).toBe('build')
})

test('the pane header and tab bar render with demo data', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  controlMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  const json = JSON.stringify(await pane.drawn())
  expect(json).toContain('AOS Control')
  expect(json).toContain('Fleet')
  expect(json).toContain('Pipeline')
  expect(json).toContain('Git')
  expect(json).toContain('Control')
  expect(json).toContain('demo-orchestrator')
})

test('pressing tab-pipeline shows the pipeline body for a mocked state.json', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  controlMocks(on, nowMs, { 'production_artifacts/state.json': PIPELINE_FIXTURE }, false, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  await pane.press({ key: 'tab-pipeline' } as never)
  const json = JSON.stringify(await pane.drawn())
  expect(json).toContain('run-42')
  expect(json).toContain('ship the control mod')
  expect(json).toContain('needs human')
  expect(json).toContain('engineering')
  expect(reads.some(r => r.includes('production_artifacts/state.json'))).toBe(true)
})

test('pressing tab-git renders worktree rows', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  controlMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  await pane.press({ key: 'tab-git' } as never)
  const json = JSON.stringify(await pane.drawn())
  expect(json).toContain('main')
  expect(json).toContain('feat/aos-control')
  expect(json).toContain('WORKTREES')
})

test('pressing tab-control renders gate, install, context and services', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  controlMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  await pane.press({ key: 'tab-control' } as never)
  const json = JSON.stringify(await pane.drawn())
  expect(json).toContain('GO-GATE')
  expect(json).toContain('GATE PROFILE')
  expect(json).toContain('INSTALL PROFILE')
  expect(json).toContain('CONTEXT PROFILE')
  expect(json).toContain('SERVICES')
  expect(json).toContain('DIAGNOSTICS')
  expect(json).toContain('standard')
  expect(json).toContain('worker')
  expect(json).toContain('~35k')
  expect(json).toContain('role hint:')
  expect(json).toContain('full/orchestrator')
  expect(reads.some(r => r.includes('v5-settings.json'))).toBe(true)
})

test('profile switch buttons are rendered on the control tab', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  controlMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  await pane.press({ key: 'tab-control' } as never)
  const drawn = await pane.drawn()
  expect((findNode(drawn, 'install-minimal') as { type?: string }).type).toBe('Button')
  expect((findNode(drawn, 'install-standard') as { type?: string }).type).toBe('Button')
  expect((findNode(drawn, 'install-full') as { type?: string }).type).toBe('Button')
  expect((findNode(drawn, 'ctx-full') as { type?: string }).type).toBe('Button')
  expect((findNode(drawn, 'ctx-orchestrator') as { type?: string }).type).toBe('Button')
  expect((findNode(drawn, 'ctx-worker') as { type?: string }).type).toBe('Button')
  expect((findNode(drawn, 'ctx-small') as { type?: string }).type).toBe('Button')
})

test('active tab is Text, others are Buttons with the right keys', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  controlMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  let drawn = await pane.drawn()
  expect(findNode(drawn, 'tab-fleet')).toBeUndefined()
  expect((findNode(drawn, 'tab-pipeline') as { type?: string }).type).toBe('Button')
  expect((findNode(drawn, 'tab-git') as { type?: string }).type).toBe('Button')
  expect((findNode(drawn, 'tab-control') as { type?: string }).type).toBe('Button')
  await pane.press({ key: 'tab-pipeline' } as never)
  drawn = await pane.drawn()
  expect((findNode(drawn, 'tab-fleet') as { type?: string }).type).toBe('Button')
  expect(findNode(drawn, 'tab-pipeline')).toBeUndefined()
})

test('pressing tabs never calls prompt.fill', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  spy.fills = 0
  controlMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  await pane.press({ key: 'tab-pipeline' } as never)
  await pane.press({ key: 'tab-git' } as never)
  await pane.press({ key: 'tab-control' } as never)
  await pane.press({ key: 'tab-fleet' } as never)
  expect(spy.fills).toBe(0)
})

test('command.run aos-control with an arg opens on that tab', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  controlMocks(on, nowMs, { 'production_artifacts/state.json': PIPELINE_FIXTURE }, false, reads)
  spy.opened = []
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'aos-control', args: 'pipeline' } as never)
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  const json = JSON.stringify(await pane.drawn())
  expect(spy.opened).toContain('aos-control')
  expect(json).toContain('run-42')
  expect(findNode(JSON.parse(json), 'tab-pipeline')).toBeUndefined()
})

test('buildWorktreeItems derives stages from git output and pipeline state', async () => {
  const out = (stdout: string, exitCode = 0) => ({ stdout, stderr: '', exitCode })
  const fake = {
    process: {
      run: async (cmd: string[]) => {
        const key = cmd.join(' ')
        if (key.includes('worktree list')) {
          return out('worktree /repo/main\nHEAD abc1234\nbranch refs/heads/main\n\nworktree /repo/wt1\nHEAD def5678\nbranch refs/heads/feat/ui\n')
        }
        if (key.includes('status')) return out(key.includes('wt1') ? '## feat/ui...origin/feat/ui [ahead 2]\n' : '## main...origin/main\n')
        if (key.includes('branch --merged')) return out(key.includes('wt1') ? '' : 'main\n')
        return out('', 1)
      },
    },
  }
  const state = parsePipelineState(PIPELINE_FIXTURE)
  const items = await buildWorktreeItems(fake as never, '/repo/main', state)
  expect(items.map(i => [i.branch, i.stage, i.isAgentWorktree])).toEqual([
    ['main', 'merged', false],
    ['feat/ui', 'reviewed', true],
  ])
})

test('filterRosterSessions collapses 6 delegated workers into one chip', () => {
  const sessions = [
    { id: 'm1', name: 'master', role: 'master' as const, activity: 'idle' as const, cwd: '', updatedAt: 0 },
    { id: 'd1', name: 'swarm-1', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 0, delegated: true },
    { id: 'd2', name: 'swarm-2', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 0, delegated: true },
    { id: 'd3', name: 'swarm-3', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 0, delegated: true },
    { id: 'd4', name: 'swarm-4', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 0, delegated: true },
    { id: 'd5', name: 'swarm-5', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 0, delegated: true },
    { id: 'd6', name: 'swarm-6', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 0, delegated: true },
  ] as never
  const filtered = filterRosterSessions(sessions)
  expect(filtered.map(s => s.name)).toEqual(['master', '+6 delegated'])
})

test('filterRosterSessions shows master and orchestrator always', () => {
  const sessions = [
    { id: 'm1', name: 'master', role: 'master' as const, activity: 'idle' as const, cwd: '', updatedAt: 0 },
    { id: 'o1', name: 'orchestrator', role: 'orchestrator' as const, activity: 'idle' as const, cwd: '', updatedAt: 0 },
    { id: 'd1', name: 'swarm-1', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 0, delegated: true },
  ] as never
  const filtered = filterRosterSessions(sessions)
  expect(filtered.map(s => s.name)).toEqual(['master', 'orchestrator', '+1 delegated'])
})

test('filterRosterSessions groups package workers by node with count', () => {
  const sessions = [
    { id: 'm1', name: 'master', role: 'master' as const, activity: 'idle' as const, cwd: '', updatedAt: 0 },
    { id: 'p1', name: 'pack-1', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 100, trailNode: 'engineering' },
    { id: 'p2', name: 'pack-2', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 200, trailNode: 'engineering' },
    { id: 'p3', name: 'pack-3', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 300, trailNode: 'review' },
    { id: 'p4', name: 'pack-4', role: 'worker' as const, activity: 'idle' as const, cwd: '', updatedAt: 400, trailNode: 'review' },
  ] as never
  const filtered = filterRosterSessions(sessions)
  expect(filtered.map(s => s.name)).toEqual(['master', 'packs ×2', 'packs ×2'])
  expect(filtered.find(s => s.reason === 'engineering')).toBeDefined()
  expect(filtered.find(s => s.reason === 'review')).toBeDefined()
})

const NOW = Date.parse('2026-10-21T10:00:00Z')

test('logo: image path with text fallback', () => {
  expect(logoMark(true)).toEqual({ kind: 'image', text: 'AOS' })
  expect(logoMark(false)).toEqual({ kind: 'text', text: 'AOS' })
  const logo = logoRgba()
  expect(logo.width * logo.height * 4).toBe(atob(logo.rgba).length)
})

test('formatCountdown formats minutes, hours and days, n/a without a reset', () => {
  expect(formatCountdown('2026-10-21T10:45:00Z', NOW)).toBe('45m')
  expect(formatCountdown('2026-10-21T12:13:00Z', NOW)).toBe('2h13m')
  expect(formatCountdown('2026-10-24T15:00:00Z', NOW)).toBe('3d05h')
  expect(formatCountdown('2026-10-21T09:00:00Z', NOW)).toBe('now')
  expect(formatCountdown(undefined, NOW)).toBe('n/a')
})

test('usageRows and usageShort show n/a when the data path is empty', () => {
  const usage = {
    fetchedAt: NOW,
    context: { window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-21T12:00:00Z' }],
  }
  expect(usageShort(usage, NOW)).toBe('5h 24% 7d n/a')
  expect(usageRows(usage, NOW)[0]).toEqual({ label: '5h', percent: 23.5, countdown: '2h00m', color: '#5fe0a0' })
  expect(usageRows(null, NOW).every(r => r.percent === null && r.countdown === 'n/a')).toBe(true)
})

test('contextBar stacks categories with a legend, falls back to a single bar, then n/a', () => {
  const stacked = contextBar(
    {
      window: 200000,
      breakdown: {
        rawMaxTokens: 200000,
        percentage: 31,
        categories: [
          { name: 'Messages', tokens: 50000, kind: 'used' },
          { name: 'Tools', tokens: 10000, kind: 'used' },
          { name: 'Deferred tools', tokens: 9999, kind: 'deferred' },
          { name: 'Free space', tokens: 140000, kind: 'free' },
        ],
      },
    },
    20,
  )
  expect(stacked.mode).toBe('stacked')
  expect(stacked.segments.map(s => s.name)).toEqual(['Messages', 'Tools', 'Free space'])
  expect(stacked.segments.reduce((a, s) => a + s.cells, 0)).toBe(20)
  const single = contextBar({ tokens: 50000, window: 200000, percent: 25 }, 20)
  expect(single.mode).toBe('single')
  expect(single.segments.map(s => s.cells)).toEqual([5, 15])
  expect(contextBar({ window: 200000 }, 20).mode).toBe('n/a')
})

test('flowSteps renders done, running, pending and blocked', () => {
  const states = (phase: string, extra = {}) => flowSteps({ phase: phase as never, gate: {}, ...extra }).map(s => s.status)
  expect(states('build')).toEqual(['done', 'done', 'running', 'pending', 'pending', 'pending', 'pending', 'pending'])
  expect(states('review', { needs_human: true })[4]).toBe('blocked')
  expect(states('build', { gate: { lint: 'fail' } })[2]).toBe('blocked')
  expect(states('done').every(x => x === 'done')).toBe(true)
  const esc = flowSteps({ phase: 'escalated', gate: {} })
  expect(esc[esc.length - 1]).toEqual({ phase: 'escalated', label: 'ESCALATED', status: 'blocked' })
})

test('gate load failure shows unknown plus the error, never soft', () => {
  const failed = gateFromRun(null, new Error('spawn node ENOENT'))
  expect(failed.mode).toBe('unknown')
  expect(failed.error).toContain('ENOENT')
  expect(gateFromRun({ exitCode: 2, stdout: '', stderr: 'boom' }).mode).toBe('unknown')
  expect(parseGateStatus('garbage').mode).toBe('unknown')
  expect(gateFromRun({ exitCode: 0, stdout: 'AOS go-gate, session s: mode hard' }).mode).toBe('hard')
})

test('redact masks tokens, keys, Authorization and password=', () => {
  expect(redact('Authorization: Bearer abcdef1234567890')).toBe('Authorization: [redacted]')
  expect(redact('curl -H "Authorization: Basic dXNlcjpwYXNz" url')).not.toContain('dXNlcjpwYXNz')
  expect(redact('db password=hunter2 ok')).toBe('db password=[redacted] ok')
  expect(redact('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123')).not.toContain('ghp_')
  expect(redact('key sk-abcdefghijklmnopqrstuvwx end')).toBe('key [redacted] end')
  expect(redact('plain text stays')).toBe('plain text stays')
})

test('parsePipelineState redacts secrets in goal and finding summaries', () => {
  const s = parsePipelineState(JSON.stringify({ phase: 'build', goal: 'deploy with token=abc123xyz', findings: [{ id: 'f', summary: 'password=pw1' }] }))
  expect(s!.goal).toBe('deploy with token=[redacted]')
  expect(s!.findings[0]!.summary).toBe('password=[redacted]')
})

test('probe cache honours the TTL', async () => {
  const cache = createTtlCache(10_000)
  let loads = 0
  const load = async () => ++loads
  expect(await cache.get('k', 0, load)).toBe(1)
  expect(await cache.get('k', 9_999, load)).toBe(1)
  expect(await cache.get('k', 10_000, load)).toBe(2)
  expect(loads).toBe(2)
})

test('buildWorktreeItems runs git once per TTL window', async () => {
  let calls = 0
  const out = (stdout: string, exitCode = 0) => ({ stdout, stderr: '', exitCode })
  const fake = {
    process: {
      run: async (cmd: string[]) => {
        calls++
        const key = cmd.join(' ')
        if (key.includes('worktree list')) return out('worktree /repo/main\nHEAD abc\nbranch refs/heads/main\n')
        if (key.includes('status')) return out('## main...origin/main\n')
        return out('main\n')
      },
    },
  }
  const cache = createTtlCache(10_000)
  await buildWorktreeItems(fake as never, '/repo/main', null, cache, 0)
  const first = calls
  await buildWorktreeItems(fake as never, '/repo/main', null, cache, 5_000)
  expect(calls).toBe(first)
  await buildWorktreeItems(fake as never, '/repo/main', null, cache, 11_000)
  expect(calls).toBe(first * 2)
})

test('the band is one line with gate, usage and phase', () => {
  const segs = bandSegments({
    gate: { mode: 'hard', grants: [], raw: '' },
    usage: { fetchedAt: NOW, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 41 }] },
    phase: 'ready_to_ship',
    nowMs: NOW,
  })
  const text = bandText(segs)
  expect(text).toBe('AOS │ gate HARD │ 5h 10% 7d 41% │ pipeline ready to ship')
  expect(text.includes('\n')).toBe(false)
  expect(bandText(bandSegments({ gate: null, usage: null, nowMs: NOW }))).toBe('AOS │ gate UNKNOWN │ 5h n/a 7d n/a │ pipeline idle')
})

test('the band and the deck render in the mod', async ($, on) => {
  const nowMs = { n: 60_000 }
  controlMocks(on, nowMs, {}, true)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const band = await $.ui.mount({ plugin: 'bdb-aos-control', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5 } } as never)
  const bandJson = JSON.stringify(await band.drawn())
  expect(bandJson).toContain('gate SOFT')
  expect(bandJson).toContain('5h 42%')
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  const json = JSON.stringify(await pane.drawn())
  expect(json).toContain('USAGE')
  expect(json).toContain('resets 2h')
  expect(json).toContain('CONTEXT')
  expect(json).toContain('Messages')
})

test('redact masks prefixed identifiers and JSON forms', () => {
  expect(redact('DB_PASSWORD=hunter2')).toBe('DB_PASSWORD=[redacted]')
  expect(redact('OPENAI_API_KEY=abc123')).toBe('OPENAI_API_KEY=[redacted]')
  expect(redact('GITHUB_TOKEN: xyz')).toBe('GITHUB_TOKEN: [redacted]')
  expect(redact('{"password": "p w", "ok": 1}')).toBe('{"password": [redacted], "ok": 1}')
  expect(redact("{'client_secret':'s3'}")).not.toContain('s3')
  expect(redact('"Authorization": "Bearer abcdef123456"')).not.toContain('abcdef123456')
})

test('redactSession falls back safely for bad enums and redacts text', () => {
  const s = redactSession({ id: 'x', name: 'worker-token=abc', role: 'bogus', activity: 'sleeping', cwd: '/x', updatedAt: 1, trailNode: 'API_KEY=k1' } as never)
  expect(s.role).toBe('worker')
  expect(s.activity).toBe('idle')
  expect(s.name).toBe('worker-token=[redacted]')
  expect(s.trailNode).toBe('API_KEY=[redacted]')
})

test('shq single-quotes prefilled values', () => {
  expect(shq("a'b c")).toBe("'a'\\''b c'")
})

test('probe cache dedupes in-flight loads and evicts expired entries', async () => {
  const cache = createTtlCache(10_000)
  let loads = 0
  const load = async () => ++loads
  await Promise.all([cache.get('a', 0, load), cache.get('a', 1, load)])
  expect(loads).toBe(1)
  await cache.get('b', 20_000, load)
  expect(cache.size()).toBe(1)
})

test('band shows the short gate error next to UNKNOWN', () => {
  const t = bandText(bandSegments({ gate: { mode: 'unknown', grants: [], raw: '', error: 'spawn ENOENT' }, usage: null, nowMs: NOW }))
  expect(t).toContain('gate UNKNOWN (spawn ENOENT)')
})

test('a throwing render becomes a one-line redacted error box', async ($, on) => {
  const nowMs = { n: 60_000 }
  controlMocks(on, nowMs, {}, true)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  nowMs.n = -1
  const band = await $.ui.mount({ plugin: 'bdb-aos-control', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5 } } as never)
  const bandJson = JSON.stringify(await band.drawn())
  expect(bandJson).toContain('render error')
  expect(bandJson).not.toContain('abc123')
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  expect(JSON.stringify(await pane.drawn())).toContain('render error')
  expect(renderErrorText(new Error('x password=p'))).toBe('AOS Control: render error: x password=[redacted]')
})
