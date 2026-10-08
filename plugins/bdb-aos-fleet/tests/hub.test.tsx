import { expect, test } from 'claude-code/testing'

import { demoPlan, demoFleet, demoGate } from '../hooks/register'

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
`

const HUB_MOUNT = (bodyColumns: number) => ({
  plugin: 'bdb-aos-fleet',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'aos-hub',
  props: { bodyColumns } as never,
})

const spy = { fills: 0, opened: [] as string[] }

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const hubMocks = (on: any, nowMs: { n: number }, files: Record<string, string>, demo: boolean, reads: string[] = []) => {
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
  on('ui.open', () => {
    spy.opened.push('aos-hub')
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

test('the tab bar shows Fleet | Gate | Plan and the fleet body is rendered by default', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  hubMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(HUB_MOUNT(80) as never)
  const json = JSON.stringify(await pane.drawn())
  expect(json).toContain('"Fleet"')
  expect(json).toContain('"Gate"')
  expect(json).toContain('"Plan"')
  expect(json).toContain('demo-orchestrator')
  expect(json).not.toContain('GRANTS')
})

test('pressing tab-gate shows GRANTS and PRESETS', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  hubMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(HUB_MOUNT(80) as never)
  await pane.press({ key: 'tab-gate' } as never)
  const json = JSON.stringify(await pane.drawn())
  expect(json).toContain('GRANTS')
  expect(json).toContain('PRESETS')
})

test('pressing tab-plan shows the plan body for a mocked plan file', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  hubMocks(on, nowMs, { 'production_artifacts/00_execution_plan.md': FIXTURE }, false, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(HUB_MOUNT(80) as never)
  await pane.press({ key: 'tab-plan' } as never)
  const json = JSON.stringify(await pane.drawn())
  expect(json).toContain('Alpha')
  expect(json).toContain('✓')
  expect(reads.some(r => r.includes('production_artifacts/00_execution_plan.md'))).toBe(true)
})

test('the active tab is drawn as Text, the other two as Buttons with keys tab-fleet / tab-gate / tab-plan', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  hubMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(HUB_MOUNT(80) as never)
  let drawn = await pane.drawn()
  const fleetNode = findNode(drawn, 'tab-fleet') as { type?: string }
  const gateNode = findNode(drawn, 'tab-gate') as { type?: string }
  const planNode = findNode(drawn, 'tab-plan') as { type?: string }
  expect(fleetNode).toBeUndefined()
  expect(JSON.stringify(drawn)).toContain('"backgroundColor":"#2ea043"')
  expect(gateNode.type).toBe('Button')
  expect(planNode.type).toBe('Button')
  await pane.press({ key: 'tab-gate' } as never)
  drawn = await pane.drawn()
  expect((findNode(drawn, 'tab-fleet') as { type?: string }).type).toBe('Button')
  expect(findNode(drawn, 'tab-gate')).toBeUndefined()
  expect(JSON.stringify(drawn)).toContain('"backgroundColor":"#d7a017"')
  expect((findNode(drawn, 'tab-plan') as { type?: string }).type).toBe('Button')
})

test('pressing tabs never calls prompt.fill', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  spy.fills = 0
  hubMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(HUB_MOUNT(80) as never)
  await pane.press({ key: 'tab-gate' } as never)
  await pane.press({ key: 'tab-plan' } as never)
  await pane.press({ key: 'tab-fleet' } as never)
  expect(spy.fills).toBe(0)
})

test('command.run aos-hub with an arg opens on that tab', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  const files = { 'production_artifacts/00_execution_plan.md': FIXTURE }
  hubMocks(on, nowMs, files, false, reads)
  spy.opened = []
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'aos-hub', args: 'plan' } as never)
  const pane = await $.ui.mount(HUB_MOUNT(80) as never)
  const json = JSON.stringify(await pane.drawn())
  expect(spy.opened).toContain('aos-hub')
  expect(json).toContain('Alpha')
  expect(findNode(JSON.parse(json), 'tab-plan')).toBeUndefined()
  expect(json).toContain('"backgroundColor":"#6a9be0"')
})

test('demo mode works in all three tabs', async ($, on) => {
  const nowMs = { n: 60_000 }
  const reads: string[] = []
  hubMocks(on, nowMs, {}, true, reads)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount(HUB_MOUNT(80) as never)
  await pane.press({ key: 'tab-gate' } as never)
  let json = JSON.stringify(await pane.drawn())
  expect(json).toContain('SOFT')
  expect(json).toContain('push-feature')
  await pane.press({ key: 'tab-plan' } as never)
  json = JSON.stringify(await pane.drawn())
  expect(json).toContain('Setup Pulse rig')
  await pane.press({ key: 'tab-fleet' } as never)
  json = JSON.stringify(await pane.drawn())
  expect(json).toContain('demo-orchestrator')
  expect(reads.some(r => r.includes('PLAN'))).toBe(false)
  expect(reads.some(r => r.includes('go-grant'))).toBe(false)
})
