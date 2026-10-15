import { expect, test } from 'claude-code/testing'

import {
  buildWorktreeItems,
  demoFleet,
  demoPipeline,
  logoCells,
  parseGateStatus,
  parsePipelineState,
  parseProfile,
  parseServices,
  parseStatusBranch,
  parseWorktrees,
} from '../hooks/register'

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
  on('env.get', (_$: unknown, e: unknown) => {
    const key = JSON.stringify(e)
    if (demo && key.includes('AOS_FLEET_DEMO')) return { value: '1' }
    if (key.includes('AOS_CONTEXT_PROFILE')) return { value: 'worker' }
    if (key.includes('HOME')) return { value: '/home' }
    return { value: '' }
  })
  on('session.start', () => ({ cwd: '/x' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.cwd', () => ({ value: '/x' }))
  on('session.repo', () => ({ value: null }))
  on('clock.now', () => ({ value: (nowMs.n += 60_000) }))
  on('clock.every', () => ({ value: { cancel: () => undefined } } as never))
  on('fs.read', (_$: unknown, e: unknown) => {
    const path = JSON.stringify(e)
    reads.push(path)
    for (const [k, v] of Object.entries(files)) {
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
  on('http.fetch', () => ({ ok: false, text: '' }))
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

test('logoCells returns a base64 string', () => {
  expect(typeof logoCells()).toBe('string')
  expect(logoCells().length).toBeGreaterThan(0)
})

test('parseGateStatus handles mode and grants', () => {
  const g = parseGateStatus('AOS go-gate, session sid: mode hard\n  grant push-feature until 2026-01-01T00:00:00Z (15 min left)')
  expect(g.mode).toBe('hard')
  expect(g.grants).toEqual([{ scope: 'push-feature', minutesLeft: 15 }])
})

test('parseProfile parses strict with minutes', () => {
  const p = parseProfile('profile: strict (30 min left)\nnote: none')
  expect(p).toEqual({ profile: 'strict', minutesLeft: 30, note: 'none' })
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

test('pressing tab-control renders gate, profile and services', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  controlMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(CONTROL_MOUNT(80) as never)
  await pane.press({ key: 'tab-control' } as never)
  const json = JSON.stringify(await pane.drawn())
  expect(json).toContain('GO-GATE')
  expect(json).toContain('PROFILE')
  expect(json).toContain('SERVICES')
  expect(json).toContain('DIAGNOSTICS')
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

test('buildWorktreeItems derives stages from git output and pipeline state', async ($, on) => {
  const runs: Array<{ cmd: string[]; out: string }> = []
  on('process.run', (_$: unknown, e: unknown) => {
    const cmd = (e as { command?: string[] }).command ?? []
    const key = cmd.join(' ')
    if (key.includes('worktree list')) {
      runs.push({ cmd, out: 'list' })
      return {
        value: {
          stdout: 'worktree /repo/main\nHEAD abc1234\nbranch refs/heads/main\n\nworktree /repo/wt1\nHEAD def5678\nbranch refs/heads/feat/ui\n',
          stderr: '',
          exitCode: 0,
        },
      }
    }
    if (key.includes('status')) {
      return {
        value: {
          stdout: key.includes('wt1') ? '## feat/ui...origin/feat/ui [ahead 2]\n' : '## main...origin/main\n',
          stderr: '',
          exitCode: 0,
        },
      }
    }
    if (key.includes('branch --merged')) {
      return {
        value: {
          stdout: key.includes('wt1') ? '' : 'main\n',
          stderr: '',
          exitCode: 0,
        },
      }
    }
    return { value: { stdout: '', stderr: '', exitCode: 1 } }
  })
  on('env.get', () => ({ value: '/home' }))
  on('session.cwd', () => ({ value: '/repo/main' }))
  on('session.repo', () => ({ value: { root: '/repo/main' } }))
  const state = parsePipelineState(PIPELINE_FIXTURE)
  const items = await buildWorktreeItems($, '/repo/main', state)
  expect(items.map(i => [i.branch, i.stage, i.isAgentWorktree])).toEqual([
    ['main', 'merged', false],
    ['feat/ui', 'reviewed', true],
  ])
})
