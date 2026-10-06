import { expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const SESSION = {
  id: 'a1',
  name: 'TASK MANAGER',
  role: 'task-manager',
  activity: 'attention',
  reason: 'GO: git push',
  repo: 'aos',
  branch: 'main',
  cwd: '/x',
  updatedAt: Date.now(),
}

let now = Date.now()
const entry = (name: string) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })
const crowd = [
  { ...SESSION, id: 'a1', name: 'AO Orchestrator', role: 'orchestrator', reason: 'GO: git push --force origin' },
  { ...SESSION, id: 'a2', name: 'TASK MANAGER', reason: '1 GO' },
  { ...SESSION, id: 'a3', name: 'playbook builder', role: 'worker', activity: 'working', reason: undefined },
  { ...SESSION, id: 'a4', name: 'docs worker', role: 'worker', activity: 'working', reason: undefined },
  { ...SESSION, id: 'a5', name: 'sleeper', role: 'worker', activity: 'idle', reason: undefined },
]

// Each test advances the clock past the 15 s peer-refresh throttle so the task list is read again.
function mockCrowd(on: On, listAgeMin?: number) {
  now += 60_000
  const updated =
    listAgeMin === undefined ? undefined : new Date(now - listAgeMin * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  on('env.get', () => ({ value: '/home' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: crowd.map(s => entry(`${s.id}.json`)) }))
  on('fs.read', (_$, e) => ({
    value: e.path.endsWith('state.json')
      ? JSON.stringify({ updated, tasks: [] })
      : JSON.stringify({ ...crowd.find(s => e.path.endsWith(`${s.id}.json`)), updatedAt: now - 1000 }),
  }))
  on('clock.now', () => ({ value: now }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
}

const texts = (node: unknown): { props?: { wrap?: string } }[] =>
  node && typeof node === 'object'
    ? [
        ...((node as { type?: string }).type === 'Text' ? [node as never] : []),
        ...Object.values(node).flatMap(texts),
      ]
    : []

const plain = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(plain).join('') : node && typeof node === 'object' ? plain((node as { children?: unknown }).children) : ''

async function band($: Engine, bodyColumns: number) {
  await $.command.run({ command: 'aos-fleet', args: '' } as never)
  const ui = await $.ui.mount({
    plugin: 'bdb-aos-fleet',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns } as never,
  })
  return ui.drawn()
}

test('a narrow band truncates every Text and drops chips into +k more', async ($, on) => {
  mockCrowd(on)
  const drawn = await band($, 50)
  const all = texts(drawn)
  expect(all.length).toBeGreaterThan(3)
  expect(all.every(t => t.props?.wrap === 'truncate-end')).toBe(true)
  const json = JSON.stringify(drawn)
  expect(json).toContain('AO Orchestrator')
  expect(plain(drawn)).toMatch(/\+\d+ more/)
  expect(plain(drawn).length).toBeLessThanOrEqual(48)
  expect(json).not.toContain('sleeper')
})

test('a wide band shows every chip and the idle count, no +k more', async ($, on) => {
  mockCrowd(on)
  const json = JSON.stringify(await band($, 160))
  expect(json).toContain('TASK MANAGER')
  expect(json).toContain('playbook builder')
  expect(json).toContain('1 idle')
  expect(json).not.toContain('more')
})

test('a task list older than 15 minutes is marked stale on the fleet line', async ($, on) => {
  mockCrowd(on, 40)
  expect(JSON.stringify(await band($, 160))).toContain('list 40m old')
})

test('the band draws every reporting session', async ($, on) => {
  on('env.get', () => ({ value: '/home' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [{ name: 'a1.json', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: JSON.stringify(SESSION) }))
  on('clock.now', () => ({ value: SESSION.updatedAt + 1000 }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.command.run({ command: 'aos-fleet', args: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'bdb-aos-fleet',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as never,
    })
    expect(JSON.stringify(await ui.drawn())).toContain('TASK MANAGER')
    expect(JSON.stringify(await ui.drawn())).toContain('GO: git push')
  }

  const pane = await $.ui.mount({
    plugin: 'bdb-aos-fleet',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'aos-fleet',
    props: { bodyColumns: 80 } as never,
  })
  expect(await pane.findAll({ type: 'Raster' })).toHaveLength(1)
})
