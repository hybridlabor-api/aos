import { expect, test } from 'claude-code/testing'

import { demoProfile, isReleaseClassBlock, parseProfile } from '../hooks/register'

const RUN = (stdout: string) => ({ value: { stdout, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } })
const GATE = 'AOS go-gate, session sid: mode soft\n  no active grants'
const WORK = 'profile: work (187 min left)\nlast change: 2026-10-09T10:00:00Z by touchid'
const RELEASE_TEXT = 'go-gate: profile work: this command is in the release class and needs a GO'

const MOUNT = (component: 'Pane' | 'AbovePrompt') =>
  component === 'Pane'
    ? { plugin: 'bdb-aos-fleet', surface: 'terminal', component, requestId: 'gogate-panel', props: { bodyColumns: 80 } as never }
    : { plugin: 'bdb-aos-fleet', surface: 'terminal', component, props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never }

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const baseMocks = (on: any, demo = false) => {
  on('env.get', (_$: unknown, e: unknown) => ({ value: demo && JSON.stringify(e).includes('AOS_FLEET_DEMO') ? '1' : '/home' }))
  on('session.id', () => ({ value: 'sid' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('clock.now', () => ({ value: 1000 }))
}

test('parseProfile reads profile, minutes, note and rejects garbage', () => {
  expect(parseProfile(WORK)).toEqual({ profile: 'work', minutesLeft: 187 })
  expect(parseProfile('profile: strict (no expiry)')).toEqual({ profile: 'strict', minutesLeft: null })
  expect(parseProfile('profile: strict (no expiry)\nnote: config corrupt\nlast change: x by typed')).toEqual({
    profile: 'strict',
    minutesLeft: null,
    note: 'config corrupt',
  })
  expect(parseProfile('profile: off (30 min left)')?.profile).toBe('off')
  expect(parseProfile('hello world')).toBeNull()
  expect(parseProfile('profile: banana (3 min left)')).toBeNull()
  expect(parseProfile('')).toBeNull()
})

test('isReleaseClassBlock matches the go-gate release-class wording only', () => {
  expect(isReleaseClassBlock(RELEASE_TEXT)).toBe(true)
  expect(isReleaseClassBlock('go-gate: blocked - needs a GO')).toBe(false)
})

test('the gate pane draws the profile line', async ($, on) => {
  baseMocks(on)
  on('process.run', (_$, e) => RUN(JSON.stringify(e).includes('go-grant') ? GATE : WORK))
  await $.command.run({ command: 'gogate-panel', args: '' } as never)
  const drawn = JSON.stringify(await (await $.ui.mount(MOUNT('Pane') as never)).drawn())
  expect(drawn).toContain('profile: work · 3h07 left')
  expect(drawn).toContain('yellow')
})

test('the profile note shows as config ignored', async ($, on) => {
  baseMocks(on)
  on('process.run', (_$, e) => RUN(JSON.stringify(e).includes('go-grant') ? GATE : 'profile: strict (no expiry)\nnote: config missing'))
  await $.command.run({ command: 'gogate-panel', args: '' } as never)
  const drawn = JSON.stringify(await (await $.ui.mount(MOUNT('Pane') as never)).drawn())
  expect(drawn).toContain('profile: strict · no expiry')
  expect(drawn).toContain('config ignored: config missing')
})

test('the band shows a dim chip for work, none for strict', async ($, on) => {
  let out = WORK
  baseMocks(on)
  on('process.run', (_$, e) => RUN(JSON.stringify(e).includes('go-grant') ? GATE : out))
  await $.command.run({ command: 'gogate-panel', args: '' } as never)
  expect(JSON.stringify(await (await $.ui.mount(MOUNT('AbovePrompt') as never)).drawn())).toContain(' · work 3h07')
  out = 'profile: strict (no expiry)'
  await $.command.run({ command: 'gogate-panel', args: '' } as never)
  expect(JSON.stringify(await (await $.ui.mount(MOUNT('AbovePrompt') as never)).drawn())).not.toContain('strict')
})

test('CLI fallback: first command throws, second works', async ($, on) => {
  const seen: string[][] = []
  baseMocks(on)
  on('process.run', (_$, e) => {
    const cmd = Object.values(e as object).find(Array.isArray) as string[]
    if (JSON.stringify(cmd).includes('go-grant')) return RUN(GATE)
    seen.push(cmd)
    if (cmd[0] === 'aos-gate') throw new Error('ENOENT')
    return RUN(WORK)
  })
  await $.command.run({ command: 'gogate-panel', args: '' } as never)
  expect(seen.map(c => c[0])).toEqual(['aos-gate', 'node'])
  expect(seen[1]![1]).toBe('/home/.agents/bin/aos-gate.mjs')
  expect(JSON.stringify(await (await $.ui.mount(MOUNT('Pane') as never)).drawn())).toContain('profile: work')
})

test('both CLIs failing shows no profile line and no error', async ($, on) => {
  baseMocks(on)
  on('process.run', (_$, e) => {
    if (JSON.stringify(e).includes('go-grant')) return RUN(GATE)
    throw new Error('ENOENT')
  })
  await $.command.run({ command: 'gogate-panel', args: '' } as never)
  const drawn = JSON.stringify(await (await $.ui.mount(MOUNT('Pane') as never)).drawn())
  expect(drawn).not.toContain('profile:')
  expect(drawn).toContain('GRANTS')
})

test('demo profile is work 187 min and never calls process.run', async ($, on) => {
  expect(demoProfile()).toEqual({ profile: 'work', minutesLeft: 187 })
  baseMocks(on, true)
  on('process.run', () => {
    throw new Error('no $.process.run in demo mode')
  })
  await $.command.run({ command: 'gogate-panel', args: '' } as never)
  expect(JSON.stringify(await (await $.ui.mount(MOUNT('Pane') as never)).drawn())).toContain('profile: work · 3h07 left')
})

test('a release-class block gets a red tag, a plain block does not', async ($, on) => {
  baseMocks(on)
  on('process.run', (_$, e) => RUN(JSON.stringify(e).includes('go-grant') ? GATE : WORK))
  on('session.start', () => ({ cwd: '/x' }))
  on('session.cwd', () => ({ value: '/x' }))
  on('session.repo', () => ({ value: null }))
  on('session.usage', () => ({ value: { context: { window: 0 } } as never }))
  on('fs.read', () => ({ value: '{}' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('clock.every', () => ({ value: { cancel: () => undefined } } as never))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined } as never))
  on('tool.call', (_$, e) => ({
    result: { stdout: '', stderr: '', interrupted: false },
    text: (e as { command?: string }).command === 'npm publish' ? RELEASE_TEXT : 'go-gate: blocked - needs a GO',
    isError: true as const,
  }))
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push origin feat/x' })
  const pane = await $.ui.mount(MOUNT('Pane') as never)
  const one = JSON.stringify(await pane.drawn())
  await pane.unmount()
  expect(one).not.toContain('release class')
  await $.tool.call({ tool: 'Bash', command: 'npm publish' })
  const two = JSON.stringify(await (await $.ui.mount(MOUNT('Pane') as never)).drawn())
  expect((two.match(/release class/g) ?? []).length).toBe(1)
})
