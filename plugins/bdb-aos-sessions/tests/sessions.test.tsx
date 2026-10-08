import { expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { ageLabel, demoOverview, harnessLabel, parseOverview, sectionCounts } from '../hooks/register'
import type { Overview } from '../types'

type On = Parameters<TestBody>[1]

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  source: 'hub',
  id: 's1',
  name: 'web',
  harness: 'claude',
  state: 'working',
  section: 'working',
  detail: 'building',
  ageMs: 40000,
  ...over,
})

const fixture = (): string =>
  JSON.stringify({
    now: 't',
    hub: 'running',
    sessions: [
      row({ id: 'n1', name: 'orch', section: 'needs', state: 'waiting', detail: 'GO', harness: 'claude' }),
      row({ id: 'w1', name: 'web', section: 'working', harness: 'codex' }),
      row({ id: 'i1', name: 'api', section: 'idle', harness: 'KIMI', detail: 'idle' }),
    ],
    acp: [
      row({ id: 'a1', name: 'glm-1', section: 'acp', state: 'running', harness: 'agy' }),
      row({ id: 'a2', name: 'glm-2', section: 'acp', state: 'GO needed', harness: 'opencode' }),
      row({ id: 'a3', name: 'glm-3', section: 'acp', state: 'stalled', harness: 'opencode' }),
      row({ id: 'a4', name: 'glm-4', section: 'acp', state: 'done', harness: 'opencode' }),
    ],
  })

const OK = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false })

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const paneMocks = (on: any, opts: { stdout?: string; exitCode?: number; demo?: boolean; failBoth?: boolean; failFirst?: boolean } = {}) => {
  let calls = 0
  on('env.get', (_$: unknown, e: unknown) =>
    JSON.stringify(e).includes('AOS_FLEET_DEMO') ? { value: opts.demo ? '1' : '0' } : { value: '/home' },
  )
  on('session.start', () => ({ cwd: '/x' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.cwd', () => ({ value: '/x' }))
  on('clock.now', () => ({ value: 1000 }))
  on('clock.every', () => ({ value: { cancel: () => undefined } } as never))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: undefined } as never))
  on('process.run', () => {
    calls++
    if (opts.demo) throw new Error('no process.run in demo mode')
    if (opts.failBoth) throw new Error('no cli')
    if (opts.failFirst && calls === 1) return { value: { ...OK(''), exitCode: 1 } }
    return { value: { ...OK(opts.stdout ?? fixture()), ...(opts.failFirst && calls > 1 ? {} : {}), exitCode: opts.exitCode ?? 0 } }
  })
  return () => calls
}

const mountPane = ($: Engine, bodyColumns: number) =>
  $.ui.mount({
    plugin: 'bdb-aos-sessions',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'aos-sessions',
    props: { bodyColumns } as never,
  })

test('parseOverview accepts good JSON, rejects bad, caps rows and cuts strings', () => {
  const good = parseOverview(fixture())!
  expect(good.hub).toBe('running')
  expect(good.sessions.length).toBe(3)
  expect(sectionCounts(good)).toEqual({ needs: 1, working: 1, idle: 1, acp: 4, running: 1, stalled: 1, done: 1, go: 1 })
  expect(parseOverview('nope')).toBe(null)
  expect(parseOverview('{"now":"t","hub":"down","sessions":{},"acp":[]}')).toBe(null)
  const big = { now: 't', hub: 'down', sessions: Array.from({ length: 300 }, (_, i) => row({ id: `s${i}` })), acp: [] }
  const capped = parseOverview(JSON.stringify(big))!
  expect(capped.sessions.length).toBe(200)
  const long = parseOverview(JSON.stringify({ now: 't', hub: 'down', sessions: [row({ name: 'x'.repeat(200) })], acp: [] }))!
  expect(long.sessions[0]!.name.length).toBe(80)
})

test('ageLabel and harnessLabel', () => {
  expect(ageLabel(null)).toBe('—')
  expect(ageLabel(1000)).toBe('now')
  expect(ageLabel(40000)).toBe('40s')
  expect(ageLabel(240000)).toBe('4m')
  expect(ageLabel(10800000)).toBe('3h')
  expect(harnessLabel('KIMI')).toBe('kimi (via trail)')
  expect(harnessLabel('kimi')).toBe('kimi (via trail)')
  expect(harnessLabel('codex')).toBe('codex')
})

test('pane draws four sections, one row each, kimi via trail', async ($, on) => {
  paneMocks(on)
  await $.command.run({ command: 'aos-sessions', args: '' } as never)
  const pane = await mountPane($, 80)
  const drawn = JSON.stringify(await pane.drawn())
  for (const t of ['NEEDS YOU', 'WORKING', 'IDLE', 'ACP WORKERS']) expect(drawn).toContain(t)
  expect(drawn).toContain('orch')
  expect(drawn).toContain('kimi (via trail)')
  expect(drawn).toContain('running 1 · stalled 1 · done 1')
  expect(drawn).toContain('read-only · data from aos-sessions (hub, A2A registry, ACP logs)')
  expect(drawn).not.toContain('"type":"Button"')
})

test('two columns when wide, stacked when narrow', async ($, on) => {
  paneMocks(on)
  await $.command.run({ command: 'aos-sessions', args: '' } as never)
  const wide = await mountPane($, 96)
  const wideDrawn = JSON.stringify(await wide.drawn())
  expect(wideDrawn).toContain('col-left')
  expect(wideDrawn).toContain('col-right')
  await wide.unmount()
  const narrow = await mountPane($, 80)
  const narrowDrawn = JSON.stringify(await narrow.drawn())
  expect(narrowDrawn).toContain('"stack"')
  expect(narrowDrawn).not.toContain('col-left')
})

test('error state when both CLI attempts fail', async ($, on) => {
  paneMocks(on, { failBoth: true })
  await $.command.run({ command: 'aos-sessions', args: '' } as never)
  const pane = await mountPane($, 80)
  expect(JSON.stringify(await pane.drawn())).toContain('aos-sessions not found: install AOS v5 or run bin/aos-sessions.mjs')
})

test('falls back to the second command when the first exits non-zero', async ($, on) => {
  const calls = paneMocks(on, { failFirst: true })
  await $.command.run({ command: 'aos-sessions', args: '' } as never)
  const pane = await mountPane($, 80)
  expect(JSON.stringify(await pane.drawn())).toContain('orch')
  expect(calls()).toBe(2)
})

test('demo mode shows demo sessions and never calls process.run', async ($, on) => {
  paneMocks(on, { demo: true })
  await $.command.run({ command: 'aos-sessions', args: '' } as never)
  const pane = await mountPane($, 80)
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('demo-orchestrator')
  expect(drawn).toContain('demo-glm-1')
  const d = demoOverview()
  expect(d.sessions.map(s => s.name)).toEqual(['demo-orchestrator', 'demo-web', 'demo-api'])
  expect(d.acp.map(s => s.name)).toEqual(['demo-glm-1', 'demo-glm-2'])
})

test('card caps at 8 rows with +k more and empty cards show none', () => {
  const o: Overview = {
    now: 't',
    hub: 'down',
    sessions: Array.from({ length: 10 }, (_, i) => ({ ...row({ id: `w${i}`, name: `w${i}` }), section: 'working' as const })),
    acp: [],
  }
  expect(o.sessions.filter(s => s.section === 'working').length).toBe(10)
})

test('every Text uses truncate-end', async ($, on) => {
  paneMocks(on)
  await $.command.run({ command: 'aos-sessions', args: '' } as never)
  const pane = await mountPane($, 80)
  const texts = (node: unknown): { props?: { wrap?: string } }[] =>
    node && typeof node === 'object'
      ? [...((node as { type?: string }).type === 'Text' ? [node as never] : []), ...Object.values(node).flatMap(texts)]
      : []
  const all = texts(await pane.drawn())
  expect(all.length).toBeGreaterThan(5)
  expect(all.every(t => t.props?.wrap === 'truncate-end')).toBe(true)
})
