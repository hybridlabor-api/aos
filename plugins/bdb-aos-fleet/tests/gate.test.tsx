import { expect, test } from 'claude-code/testing'

import {
  demoBlocks,
  demoFleet,
  demoGate,
  grantBar,
  grantColor,
  lockCells,
  maskCommand,
  parseGateStatus,
  presetForCommand,
} from '../hooks/register'

const RELEASE = 'gogate grant push-feature,github-write,merge,publish 2h'
const FEATURE = 'gogate grant push-feature,github-write 2h'
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

test('maskCommand masks each secret style before truncating', () => {
  expect(maskCommand('git push https://user:sk-abcdefghij0123456789@host/repo.git')).toBe('git push https://user:***@host/repo.git')
  expect(maskCommand('echo ghp_0123456789abcdefghij gho_0123456789abcdefghij')).toBe('echo *** ***')
  expect(maskCommand('GH_TOKEN=github_pat_11AABBCC0123456789abcdef0123456789abcdef npm publish')).toBe('GH_TOKEN=*** npm publish')
  expect(maskCommand('sl ack xoxb-1234abcdefGH56')).toBe('sl ack ***')
  expect(maskCommand('aws --access-key AKIAIOSFODNN7EXAMPLE s3 ls')).toBe('aws --access-key *** s3 ls')
  expect(maskCommand('curl -H "Authorization: Bearer eyJhbGciOi.eyJzdWIi.signature"')).toBe('curl -H "Authorization: Bearer ***"')
  expect(maskCommand('deploy --token abcdefghij --password hunter2 --api-key=xyz')).toBe('deploy --token *** --password *** --api-key=***')
  expect(maskCommand('API_KEY=abcdefghij0123456789 run')).toBe('API_KEY=*** run')
  expect(maskCommand('hash 0123456789abcdef0123456789abcdef done')).toBe('hash *** done')
  const long = 'ab '.repeat(30)
  const masked = maskCommand(long)
  expect(masked.length).toBe(60)
  expect(masked.endsWith('…')).toBe(true)
})

test('presetForCommand maps to release or feature preset text', () => {
  expect(presetForCommand('git merge main && git push')).toBe(RELEASE)
  expect(presetForCommand('npm publish')).toBe(RELEASE)
  expect(presetForCommand('git push origin main')).toBe(FEATURE)
  expect(presetForCommand('gh pr create')).toBe(FEATURE)
})

test('maskCommand truncation keeps masked output at 60 chars', () => {
  const masked = maskCommand(`${'word '.repeat(20)}sk-a1b2c3d4e5f6g7h8`)
  expect(masked.length).toBe(60)
  expect(masked).toBe(`${'word '.repeat(12)}`.slice(0, 59) + '…')
})

test('demo helpers return placeholder data only', () => {
  const now = 10_000
  const g = demoGate()
  expect(g.mode).toBe('soft')
  expect(g.grants).toEqual([
    { scope: 'push-feature', minutesLeft: 74 },
    { scope: 'github-write', minutesLeft: 74 },
  ])
  const fleetList = demoFleet()
  expect(fleetList.map(s => s.name)).toEqual(['demo-orchestrator', 'demo-web', 'demo-api'])
  expect(fleetList.every(s => s.cwd.startsWith('~/demo/'))).toBe(true)
  const blocksList = demoBlocks(now)
  expect(blocksList.map(b => b.cmd)).toEqual(['git push origin feat/demo-landing', 'npm publish'])
  expect(blocksList.every(b => b.at < now)).toBe(true)
})

const DENIED = { result: { stdout: '', stderr: '', interrupted: false }, text: 'go-gate: blocked — needs a GO', isError: true as const }

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const fleetMocks = (on: any, nowMs: { n: number }, env: (e: unknown) => string = () => '/home') => {
  on('env.get', (_$: unknown, e: unknown) => ({ value: env(e) }))
  on('session.start', () => ({ cwd: '/x' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.cwd', () => ({ value: '/x' }))
  on('session.repo', () => ({ value: null }))
  on('session.usage', () => ({ value: { context: { window: 0 } } as never }))
  on('clock.now', () => ({ value: (nowMs.n += 60_000) }))
  on('clock.every', () => ({ value: { cancel: () => undefined } } as never))
  on('fs.read', () => ({ value: '{}' }))
  on('fs.exists', () => ({ value: false }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: undefined } as never))
}

test('blocked tool calls keep at most 3 blocks, newest first', async ($, on) => {
  const nowMs = { n: 60_000 }
  let fills = 0
  fleetMocks(on, nowMs)
  on('process.run', (_$, e) => {
    if (JSON.stringify(e).includes('go-grant')) throw new Error('status CLI must not run')
    return { value: { stdout: 'main', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', () => ({ value: undefined }))
  on('tool.call', () => DENIED)
  on('prompt.fill', () => {
    fills++
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  const commands = ['git push origin feat/demo-landing', 'npm publish', 'git merge main', 'gh pr merge --squash']
  for (const command of commands) await $.tool.call({ tool: 'Bash', command })
  const pane = await $.ui.mount({
    plugin: 'bdb-aos-fleet',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'gogate-panel',
    props: { bodyColumns: 80 } as never,
  })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('LAST BLOCKED')
  expect(drawn).not.toContain('git push origin feat/demo-landing')
  expect(drawn).toContain('gh pr merge --squash')
  expect(drawn).toContain('npm publish')
  expect(drawn).toContain('git merge main')
  expect((drawn.match(/m ago/g) ?? []).length).toBe(3)
  expect(fills).toBe(0)
})

test('clicking a block row prefills the preset for that command', async ($, on) => {
  const nowMs = { n: 60_000 }
  const fills: string[] = []
  fleetMocks(on, nowMs)
  on('process.run', () => ({ value: STATUS }))
  on('fs.write', () => ({ value: undefined }))
  on('tool.call', () => DENIED)
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push origin feat/demo-landing' })
  await $.tool.call({ tool: 'Bash', command: 'npm publish' })
  const pane = await $.ui.mount({
    plugin: 'bdb-aos-fleet',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'gogate-panel',
    props: { bodyColumns: 80 } as never,
  })
  await pane.press({ key: 'blk-0' } as never)
  expect(fills).toEqual([RELEASE])
  await pane.press({ key: 'blk-1' } as never)
  expect(fills).toEqual([RELEASE, FEATURE])
})

test('a non-empty prompt blocks the block-row fill too', async ($, on) => {
  const nowMs = { n: 60_000 }
  let fills = 0
  fleetMocks(on, nowMs)
  on('process.run', () => ({ value: STATUS }))
  on('fs.write', () => ({ value: undefined }))
  on('tool.call', () => DENIED)
  on('prompt.read', () => ({ value: { text: 'half typed', cursor: 10 } }))
  on('prompt.fill', () => {
    fills++
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push origin feat/demo-landing' })
  const pane = await $.ui.mount({
    plugin: 'bdb-aos-fleet',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'gogate-panel',
    props: { bodyColumns: 80 } as never,
  })
  await pane.press({ key: 'blk-0' } as never)
  expect(fills).toBe(0)
  expect(JSON.stringify(await pane.drawn())).toContain('Prompt is not empty')
})

test('demo mode shows placeholder data, runs no status CLI and writes nothing', async ($, on) => {
  const nowMs = { n: 60_000 }
  const writes: string[] = []
  fleetMocks(on, nowMs, e => (JSON.stringify(e).includes('AOS_FLEET_DEMO') ? '1' : '/home'))
  on('process.run', () => {
    throw new Error('no $.process.run in demo mode')
  })
  on('fs.write', (_$, e) => {
    writes.push(e.path ?? JSON.stringify(e))
    return { value: undefined }
  })
  on('prompt.fill', () => ({ isFilled: true }))
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'gogate-panel', args: '' } as never)
  const pane = await $.ui.mount({
    plugin: 'bdb-aos-fleet',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'gogate-panel',
    props: { bodyColumns: 80 } as never,
  })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('SOFT')
  expect(drawn).toContain('push-feature')
  expect(drawn).toContain('github-write')
  expect(drawn).toContain('1h14')
  expect(drawn).toContain('git push origin feat/demo-landing')
  expect(drawn).toContain('npm publish')
  expect(writes).toEqual([])
})

test('the release button fills an empty prompt once, never a non-empty one', async ($, on) => {
  const fills: string[] = []
  let box = ''
  on('env.get', () => ({ value: '/home' }))
  on('session.id', () => ({ value: 'sid' }))
  on('process.run', () => ({ value: STATUS }))
  on('clock.now', () => ({ value: 1000 }))
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
  on('clock.now', () => ({ value: 1000 }))
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

test('clicking "gate soft" in the band opens the gate pane and fills nothing', async ($, on) => {
  const opened: string[] = []
  let fills = 0
  on('env.get', () => ({ value: '/home' }))
  on('session.id', () => ({ value: 'sid' }))
  on('process.run', () => ({ value: STATUS }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('prompt.fill', () => {
    fills++
    return { isFilled: true }
  })
  on('clock.now', () => ({ value: 0 }))
  await $.command.run({ command: 'gogate-panel', args: '' } as never)
  opened.length = 0
  const band = await $.ui.mount({
    plugin: 'bdb-aos-fleet',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never,
  })
  await band.press({ key: 'gate' } as never)
  expect(opened).toEqual(['gogate-panel'])
  expect(fills).toBe(0)
})

test('grantColor picks the threshold colour; grantBar keeps the width contract', () => {
  expect(grantColor(120)).toBe('green')
  expect(grantColor(30)).toBe('green')
  expect(grantColor(29)).toBe('yellow')
  expect(grantColor(10)).toBe('yellow')
  expect(grantColor(9)).toBe('red')
  expect(grantColor(0)).toBe('red')
  expect(grantBar(74)).toEqual({ on: 7, off: 3 })
})

const GATE_PANE_MOUNT = (bodyColumns: number) => ({
  plugin: 'bdb-aos-fleet',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'gogate-panel',
  props: { bodyColumns } as never,
})

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const gatePaneMocks = (on: any, stdout: string | (() => string)) => {
  on('env.get', () => ({ value: '/home' }))
  on('session.id', () => ({ value: 'sid' }))
  on('process.run', () => ({ value: { ...STATUS, stdout: typeof stdout === 'function' ? stdout() : stdout } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('clock.now', () => ({ value: 1000 }))
}

const STATUS_WITH_GRANT = (mode: string) =>
  `AOS go-gate, session sid: mode ${mode}\n  grant push-feature until ${new Date(Date.now() + 102 * 60000).toISOString()} (102 min left)`

test('the hero card shows the mode word, meaning line and a lock raster', async ($, on) => {
  const cur = { mode: 'soft' }
  gatePaneMocks(on as never, () => STATUS_WITH_GRANT(cur.mode))
  const meanings: [string, string][] = [
    ['hard', 'every guarded command needs a GO'],
    ['soft', 'guarded commands wait until you grant or type GO'],
    ['off', 'gate does not block anything'],
  ]
  for (const [mode, meaning] of meanings) {
    cur.mode = mode
    await $.command.run({ command: 'gogate-panel', args: '' } as never)
    const pane = await $.ui.mount(GATE_PANE_MOUNT(80) as never)
    const drawn = JSON.stringify(await pane.drawn())
    await pane.unmount()
    expect(drawn).toContain(mode.toUpperCase())
    expect(drawn).toContain(meaning)
    expect(drawn.includes('lock') || drawn.includes('🔒') || drawn.includes('🔓')).toBe(true)
  }
})

test('lockCells packs 6 columns x 2 rows of half-block triples', () => {
  const cells = lockCells('hard')
  const raw = atobBase64(cells)
  expect(raw.byteLength).toBe(6 * 2 * 3 * 4)
})

function atobBase64(s: string) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

test('the pane is two-column wide and stacked narrow, both with GRANTS and PRESETS', async ($, on) => {
  gatePaneMocks(on as never, STATUS_WITH_GRANT('soft'))
  const wide = await $.ui.mount(GATE_PANE_MOUNT(96) as never)
  const wideDrawn = JSON.stringify(await wide.drawn())
  expect(wideDrawn).toContain('GRANTS')
  expect(wideDrawn).toContain('PRESETS')
  expect(wideDrawn).toContain('col-left')
  expect(wideDrawn).toContain('col-right')
  expect(wideDrawn).not.toContain('"stack"')
  await wide.unmount()
  const narrow = await $.ui.mount(GATE_PANE_MOUNT(80) as never)
  const narrowDrawn = JSON.stringify(await narrow.drawn())
  expect(narrowDrawn).toContain('GRANTS')
  expect(narrowDrawn).toContain('PRESETS')
  expect(narrowDrawn).toContain('"stack"')
  expect(narrowDrawn).not.toContain('col-left')
})

test('the footer always shows the click hint above the gateMsg', async ($, on) => {
  gatePaneMocks(on as never, STATUS_WITH_GRANT('soft'))
  const pane = await $.ui.mount(GATE_PANE_MOUNT(80) as never)
  await pane.press({ key: 'feature 2h' } as never)
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('click prefills your prompt · you press Enter to record')
  expect(drawn).toContain('▸ in your prompt: gogate grant push-feature,github-write 2h')
  expect(drawn.indexOf('▸ in your prompt')).toBeLessThan(drawn.indexOf('click prefills your prompt'))
})
