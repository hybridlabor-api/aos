import { expect, test } from 'claude-code/testing'

import { demoPlan, parsePlan, planStats } from '../hooks/register'

const FIXTURE = `# demo
\`\`\`mermaid
graph TD
\`\`\`
Some prose here.
## Alpha {#alpha}
needs: [beta]
- [x] Done thing {#t1}
  by: claude
- [~] Doing thing {#t2}
  by: codex
- [ ] Todo thing {#t3}
  from: agy
- [!] Stuck thing {#t4}
  by: opencode
`

test('parsePlan covers marks, by/from, needs, ignores mermaid and prose', () => {
  const comps = parsePlan(FIXTURE)
  expect(comps.length).toBe(1)
  expect(comps[0]!.id).toBe('alpha')
  expect(comps[0]!.name).toBe('Alpha')
  expect(comps[0]!.needs).toEqual(['beta'])
  expect(comps[0]!.tasks.map(t => t.mark)).toEqual(['x', '~', ' ', '!'])
  expect(comps[0]!.tasks.map(t => t.by)).toEqual(['claude', 'codex', 'agy', 'opencode'])
})

test('parsePlan handles a sample-plan excerpt', () => {
  const excerpt = `# bdb-aos-fleet — Claude Code mod
## Show the fleet above the prompt {#band}
files: [plugins/bdb-aos-fleet/hooks/**]
- [x] Token-weather line for this session {#weather}
  by: claude
- [~] Small figures in the fleet line {#band-v2}
  by: claude
## Show and prepare go-gate approvals {#gate}
needs: [band]
- [x] Read-only gate status {#gate-panel}
  by: claude
`
  const comps = parsePlan(excerpt)
  expect(comps.map(c => c.id)).toEqual(['band', 'gate'])
  expect(comps[1]!.needs).toEqual(['band'])
  expect(comps[0]!.tasks.length).toBe(2)
})

test('planStats states', () => {
  const mk = (marks: string[]) => ({ id: 'c', name: 'C', needs: [], tasks: marks.map((m, i) => ({ id: `t${i}`, text: 't', mark: m as ' ' })) })
  expect(planStats(mk(['x', 'x'])).state).toBe('Completed')
  expect(planStats(mk(['x', '!', ' '])).state).toBe('Blocked')
  expect(planStats(mk(['~', ' '])).state).toBe('Underway')
  expect(planStats(mk(['x', ' '])).state).toBe('Underway')
  expect(planStats(mk([' ', ' '])).state).toBe('Waiting')
  expect(planStats(mk([])).state).toBe('Waiting')
})

test('parsePlan truncates at 200 tasks', () => {
  const lines = ['## Big {#big}', ...Array.from({ length: 250 }, (_, i) => `- [ ] task ${i} {#t${i}}`)]
  const comps = parsePlan(lines.join('\n'))
  expect(comps[0]!.tasks.length).toBe(200)
})

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const planMocks = (on: any, nowMs: { n: number }, files: Record<string, string>, demo: boolean, reads: string[] = []) => {
  on('env.get', (_$: unknown, e: unknown) => ({ value: demo && JSON.stringify(e).includes('AOS_FLEET_DEMO') ? '1' : '/home' }))
  on('session.start', () => ({ cwd: '/x' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.cwd', () => ({ value: '/x' }))
  on('session.repo', () => ({ value: null }))
  on('session.usage', () => ({ value: { context: { window: 0 } } as never }))
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
  on('fs.write', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: undefined } as never))
  on('process.run', () => ({ value: { stdout: 'main', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
}

const PLAN_MOUNT = (bodyColumns: number) => ({
  plugin: 'bdb-aos-fleet',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'aos-plan',
  props: { bodyColumns } as never,
})

test('the pane draws names, bars and mark rows from mocked fs.read', async ($, on) => {
  planMocks(on, { n: 60_000 }, { 'production_artifacts/00_execution_plan.md': FIXTURE }, false)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'aos-plan', args: '' } as never)
  const pane = await $.ui.mount(PLAN_MOUNT(80) as never)
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Alpha')
  expect(drawn).toContain('■')
  for (const g of ['✓', '●', '✗', '○']) expect(drawn).toContain(g)
  expect(drawn).toContain('C')
})

test('empty state text when no plan file', async ($, on) => {
  planMocks(on, { n: 60_000 }, {}, false)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(PLAN_MOUNT(80) as never)
  expect(JSON.stringify(await pane.drawn())).toContain('no plan file found (PLAN.md or production_artifacts/00_execution_plan.md)')
})

test('demo mode draws demo components and never reads plan files', async ($, on) => {
  const reads: string[] = []
  planMocks(on, { n: 60_000 }, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(PLAN_MOUNT(80) as never)
  const drawn = JSON.stringify(await pane.drawn())
  for (const c of demoPlan()) expect(drawn).toContain(c.name)
  expect(reads.some(r => r.includes('PLAN'))).toBe(false)
})

test('two-column wide and stacked narrow', async ($, on) => {
  planMocks(on, { n: 60_000 }, { 'production_artifacts/00_execution_plan.md': FIXTURE }, false)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const wide = await $.ui.mount(PLAN_MOUNT(96) as never)
  expect(JSON.stringify(await wide.drawn())).toContain('col-left')
  expect(JSON.stringify(await wide.drawn())).toContain('col-right')
  await wide.unmount()
  const narrow = await $.ui.mount(PLAN_MOUNT(80) as never)
  const nd = JSON.stringify(await narrow.drawn())
  expect(nd).toContain('"stack"')
  expect(nd).not.toContain('col-left')
})
