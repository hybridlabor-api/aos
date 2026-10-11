import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const DENIED = { result: { stdout: '', stderr: '', interrupted: false }, text: 'go-gate: blocked — needs a GO', isError: true as const }

function baseMocks(on: On, seen: { last?: { props?: Record<string, unknown> } }) {
  on('ui.render', (_$, e) => {
    seen.last = e as never
    return { type: 'Text', props: { wrap: 'truncate-end' }, children: ['BELOW-TREE'] } as never
  })
  on('env.get', () => ({ value: '' }))
  on('command.register', () => ({ value: undefined } as never))
  on('session.start', () => ({ cwd: '/x' }) as never)
  on('tool.call', () => DENIED)
}

const START = { cwd: '/x', surface: 'terminal', isInteractive: true } as never

async function bar($: Engine) {
  const ui = await $.ui.mount({
    plugin: 'bdb-aos-alert',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 },
  } as never)
  const json = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return json
}

test('with a ticking clock the bar blinks red / dim and turns steady red after 30 s', async ($, on) => {
  const clock = mock.clock(on)
  baseMocks(on, {})
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(await bar($)).toContain('"backgroundColor":"red"')
  await clock.advance(600)
  const off = await bar($)
  expect(off).not.toContain('"backgroundColor":"red"')
  expect(off).toContain('"dimColor":true')
  expect(off).toContain('ACTION NEEDED')
  await clock.advance(600)
  expect(await bar($)).toContain('"backgroundColor":"red"')
  await clock.advance(30_000)
  expect(await bar($)).toContain('"backgroundColor":"red"')
  await clock.advance(600)
  expect(await bar($)).toContain('"backgroundColor":"red"')
})

test('the timer does not advance frames while no alarm is active', async ($, on) => {
  const clock = mock.clock(on)
  baseMocks(on, {})
  await $.session.start(START)
  await clock.advance(5_000)
  expect(await bar($)).not.toContain('ACTION NEEDED')
})

test('while drafting, PromptHint passes the alert as tail to the engine line', async ($, on) => {
  mock.clock(on)
  const seen: { last?: { props?: Record<string, unknown> } } = {}
  baseMocks(on, seen)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  const ui = await $.ui.mount({
    plugin: 'bdb-aos-alert',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: true, isWorking: false, hint: '? for shortcuts' },
  } as never)
  await ui.drawn()
  expect(String(seen.last?.props?.tail)).toContain('▲ GO needed: git push')
  expect(seen.last?.props?.hint).toBe('? for shortcuts')
})
