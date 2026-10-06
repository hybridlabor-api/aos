import { expect, test } from 'claude-code/testing'

import { parseGateStatus } from '../hooks/register'

const RELEASE = 'gogate grant push-feature,github-write,merge,publish 2h'
const STATUS = { stdout: 'AOS go-gate, session sid: mode soft\n  no active grants', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false }

test('parseGateStatus handles grants, none, and missing state', () => {
  const iso = new Date(Date.now() + 102 * 60000).toISOString()
  const withGrants = parseGateStatus(
    `AOS go-gate, session abc: mode hard\n  grant push-feature until ${iso} (102 min left; session = this session id)\n  grant merge until ${iso} (12 min left)\n  ignored: bad`,
  )
  expect(withGrants.mode).toBe('hard')
  expect(withGrants.grants).toEqual([
    { scope: 'push-feature', minutesLeft: 102 },
    { scope: 'merge', minutesLeft: 12 },
  ])
  const none = parseGateStatus('AOS go-gate, session abc: mode off\n  no active grants')
  expect([none.mode, none.grants]).toEqual(['off', []])
  const missing = parseGateStatus('AOS go-gate: no session state; every session runs in soft mode with no grants (behaves like hard).')
  expect([missing.mode, missing.grants]).toEqual(['soft', []])
})

test('the release button fills an empty prompt once, never a non-empty one', async ($, on) => {
  const fills: string[] = []
  let box = ''
  on('env.get', () => ({ value: '/home' }))
  on('session.id', () => ({ value: 'sid' }))
  on('process.run', () => ({ value: STATUS }))
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  const pane = await $.ui.mount({
    plugin: 'bdb-aos-fleet',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'gogate-panel',
    props: { bodyColumns: 80 } as never,
  })

  await pane.press({ key: 'release 2h' } as never)
  expect(fills).toEqual([RELEASE])
  expect(JSON.stringify(await pane.drawn())).toContain('press Enter to record')

  box = 'half typed'
  await pane.press({ key: 'release 2h' } as never)
  expect(fills).toHaveLength(1)
  expect(JSON.stringify(await pane.drawn())).toContain('Prompt is not empty')
})

test('the gate pane is a card: mode badge, grant rows, one fill per press', async ($, on) => {
  const fills: string[] = []
  const iso = new Date(Date.now() + 102 * 60000).toISOString()
  const status = { ...STATUS, stdout: `AOS go-gate, session sid: mode soft\n  grant push-feature until ${iso} (102 min left)` }
  on('env.get', () => ({ value: '/home' }))
  on('session.id', () => ({ value: 'sid' }))
  on('process.run', () => ({ value: status }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  await $.command.run({ command: 'gogate-panel', args: '' } as never)
  const pane = await $.ui.mount({
    plugin: 'bdb-aos-fleet',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'gogate-panel',
    props: { bodyColumns: 60 } as never,
  })

  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('SOFT')
  expect(drawn).toContain('push-feature')
  expect(drawn).toContain('1h42')
  expect(drawn).toContain('left')
  expect(drawn).not.toContain('session sid')

  await pane.press({ key: 'feature 2h' } as never)
  expect(fills).toEqual(['gogate grant push-feature,github-write 2h'])
  expect(JSON.stringify(await pane.drawn())).toContain('▸ in your prompt: gogate grant push-feature,github-write 2h')
})

test('session.start, turn.complete and tool.call never fill the prompt', async ($, on) => {
  let fills = 0
  on('env.get', () => ({ value: '/home' }))
  on('prompt.fill', () => {
    fills++
    return { isFilled: true }
  })
  on('process.run', () => ({ value: STATUS }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: undefined } as never
  })
  on('session.start', () => ({ cwd: '/x' }))
  on('turn.complete', () => ({ text: '' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.cwd', () => ({ value: '/x' }))
  on('session.repo', () => ({ value: null }))
  on('session.usage', () => ({ value: { context: { window: 0 } } as never }))
  on('fs.read', () => ({ value: '{}' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: { cancel: () => undefined } } as never))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(registered).toContain('gogate-panel')
  expect(fills).toBe(0)
})
