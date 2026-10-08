import { expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { barText, blinkPhase, maskCommand } from '../hooks/register'

type On = Parameters<TestBody>[1]

const DENIED = { result: { stdout: '', stderr: '', interrupted: false }, text: 'go-gate: blocked — needs a GO', isError: true as const }
const OK = { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }

const clock = { n: 1000 }
function mocks(on: On, demo = false, autoFire = false) {
  on('ui.render', () => ({ type: 'Text', props: { wrap: 'truncate-end' }, children: ['BELOW-TREE'] }) as never)
  on('env.get', () => ({ value: demo ? '1' : '' }))
  on('clock.now', () => ({ value: clock.n }))
  on('clock.every', () => ({ value: { cancel: () => undefined } } as never))
  on('clock.after', () => (autoFire ? { value: undefined } : new Promise(() => undefined)) as never)
  on('command.register', () => ({ value: undefined } as never))
}

const plain = (node: unknown): string =>
  typeof node === 'string' ? node : Array.isArray(node) ? node.map(plain).join('') : node && typeof node === 'object' ? plain((node as { children?: unknown }).children) : ''

const texts = (node: unknown): { props?: { wrap?: string } }[] =>
  node && typeof node === 'object'
    ? [...((node as { type?: string }).type === 'Text' ? [node as never] : []), ...Object.values(node).flatMap(texts)]
    : []

async function drawn($: Engine, component: 'AbovePrompt' | 'PromptHint' = 'AbovePrompt', isDraft = false) {
  const props =
    component === 'AbovePrompt'
      ? { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 }
      : { isDraft, isWorking: false, hint: '? for shortcuts' }
  const ui = await $.ui.mount({ plugin: 'bdb-aos-alert', surface: 'terminal', component, props } as never)
  return ui.drawn()
}
const bar = async ($: Engine, component: 'AbovePrompt' | 'PromptHint' = 'AbovePrompt', isDraft = false) =>
  JSON.stringify(await drawn($, component, isDraft))

test('maskCommand hides secrets and truncates to 60', () => {
  expect(maskCommand('curl -H "Authorization: Bearer abc123def" x')).not.toContain('abc123def')
  expect(maskCommand('echo sk-abcdefghijkl ghp_abcdefghijkl AKIAABCDEFGHIJKLMNOP')).toBe('echo *** *** ***')
  expect(maskCommand('deploy --token hunter22 --password=pw123456')).toBe('deploy --token *** --password=***')
  expect(maskCommand('API_KEY=topsecret1 run')).toBe('API_KEY=*** run')
  expect(maskCommand('word '.repeat(30)).length).toBe(60)
})

test('blinkPhase alternates and turns steady after 30 s', () => {
  expect(blinkPhase(1, 0)).toBe('on')
  expect(blinkPhase(2, 0)).toBe('off')
  expect(blinkPhase(3, 29_999)).toBe('on')
  expect(blinkPhase(2, 30_000)).toBe('steady')
})

test('barText pads to the width and carries the reason', () => {
  const t = barText('GO needed: ls', 90)
  expect(t.length).toBe(90)
  expect(t).toContain('▲ ACTION NEEDED · GO needed: ls · type GO / answer in this window')
})

test('blocked tool.call, then a successful one, toggles the alarm', async ($, on) => {
  mocks(on)
  let blocked = true
  on('tool.call', () => (blocked ? DENIED : OK))
  expect(await bar($)).not.toContain('ACTION NEEDED')
  await $.tool.call({ tool: 'Bash', command: 'git push --token sk-abcdefghijkl' })
  const json = await bar($)
  expect(json).toContain('GO needed: git push --token ***')
  expect(json).not.toContain('sk-abcdefghijkl')
  blocked = false
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(await bar($)).not.toContain('ACTION NEEDED')
})

test('permission request and AskUserQuestion set the alarm, turn.start clears it', async ($, on) => {
  mocks(on)
  on('classic.PermissionRequest', () => ({}) as never)
  on('turn.start', () => ({ turnId: 't1' }) as never)
  let during = ''
  on('tool.call', async () => {
    during = await bar($)
    return OK
  })
  await $.classic.PermissionRequest({ tool_name: 'Edit' } as never)
  expect(await bar($)).toContain('allow? Edit')
  await $.turn.start({ turnId: 't1' } as never)
  expect(await bar($)).not.toContain('ACTION NEEDED')
  await $.tool.call({ tool: 'AskUserQuestion' } as never)
  expect(during).toContain('ACTION NEEDED · question')
  expect(await bar($)).not.toContain('ACTION NEEDED')
})

test('red bar on the first (odd) frame, steady red after 30 s', async ($, on) => {
  mocks(on)
  on('tool.call', () => DENIED)
  clock.n = 1000
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(await bar($)).toContain('"backgroundColor":"red"')
  clock.n = 32_000
  expect(await bar($)).toContain('"backgroundColor":"red"')
})

test('PromptHint is replaced when not drafting and only tailed while drafting', async ($, on) => {
  mocks(on)
  on('tool.call', () => DENIED)
  clock.n = 1000
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(await bar($, 'PromptHint', false)).toContain('ACTION NEEDED')
  const drafting = await bar($, 'PromptHint', true)
  expect(drafting).not.toContain('ACTION NEEDED')
})

test('/aos-alert status, test and off', async ($, on) => {
  mocks(on)
  const run = (args: string) => $.command.run({ command: 'aos-alert', args } as never)
  expect(JSON.stringify(await run(''))).toContain('No alert')
  await run('test')
  expect(await bar($)).toContain('test alarm')
  expect(JSON.stringify(await run(''))).toContain('ALERT active')
  await run('off')
  expect(await bar($)).not.toContain('ACTION NEEDED')
})

test('/aos-alert test auto-clears when the timer fires', async ($, on) => {
  mocks(on, false, true)
  await $.command.run({ command: 'aos-alert', args: 'test' } as never)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  expect(await bar($)).not.toContain('ACTION NEEDED')
})

test('demo mode shows the fictional reason', async ($, on) => {
  mocks(on, true)
  await $.command.run({ command: 'aos-alert', args: 'test' } as never)
  expect(await bar($)).toContain('GO needed: git push origin feat/demo-landing')
})

test('the active bar keeps the tree below it', async ($, on) => {
  mocks(on)
  on('tool.call', () => DENIED)
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  const tree = await drawn($)
  expect(plain(tree)).toContain('ACTION NEEDED')
  expect(plain(tree)).toContain('BELOW-TREE')
  expect(texts(tree).every(t => t.props?.wrap === 'truncate-end')).toBe(true)
})
