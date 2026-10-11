import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AlertState } from '../types'

const CMD_MAX = 60
const BLINK_MS = 600
const STEADY_AFTER_MS = 30_000
const TEST_MS = 6_000
const IDLE: AlertState = { active: false, reason: '', since: 0 }

const alert_ = atom({ plugin: 'bdb-aos-alert', key: 'alert' } as const, IDLE)
const frame_ = atom({ plugin: 'bdb-aos-alert', key: 'frame' } as const, 0)

export const maskCommand = (cmd: string) => {
  const s = cmd
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[bp]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{12,})/g, '***')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer ***')
    .replace(/(--(?:token|password|secret|api-key)[= ])[^\s&"']+/gi, '$1***')
    .replace(/\b[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=[^\s&"']+/gi, m => `${m.split('=')[0]}=***`)
    .replace(/\b[A-Za-z0-9]{32,}\b/g, '***')
  return s.length > CMD_MAX ? `${s.slice(0, CMD_MAX - 1)}…` : s
}

export const isReleaseClassBlock = (text: string) => text.includes('release class')

export type Phase = 'on' | 'off' | 'steady'

export const blinkPhase = (frame: number, elapsedMs: number): Phase =>
  elapsedMs >= STEADY_AFTER_MS ? 'steady' : frame % 2 === 1 ? 'on' : 'off'

export const barText = (reason: string, width: number) =>
  ` ▲ ACTION NEEDED · ${reason} · type GO / answer in this window `.padEnd(width, ' ')

const isElement = (node: unknown): node is { type: string } =>
  !!node && typeof node === 'object' && 'type' in node

async function activate($: EngineInterface, reason: string) {
  const now = await $.clock.now()
  await update($, alert_, a => (a.active && a.reason === reason ? a : { active: true, reason, since: now }))
  await update($, frame_, () => 1)
}

async function clear($: EngineInterface) {
  if ((await read($, alert_)).active) await update($, alert_, () => IDLE)
}

async function tick($: EngineInterface) {
  if ((await read($, alert_)).active) await update($, frame_, f => f + 1)
}

async function sampleReason($: EngineInterface) {
  return (await $.env.get('AOS_FLEET_DEMO')) === '1' ? 'GO needed: git push origin feat/demo-landing' : 'test alarm'
}

async function startTest($: EngineInterface) {
  await activate($, await sampleReason($))
  $.clock.after(TEST_MS, () => void clear($))
}

async function statusText($: EngineInterface) {
  const a = await read($, alert_)
  return a.active ? `ALERT active: ${a.reason}` : 'No alert. /aos-alert test shows a sample, /aos-alert off clears.'
}

async function view($: EngineInterface) {
  const a = await read($, alert_)
  const frame = await read($, frame_)
  const now = await $.clock.now()
  return { a, phase: blinkPhase(frame, now - a.since) }
}

async function renderBar($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], width: number) {
  const { a, phase } = await view($)
  const { Text } = $.ui.resolve(e)
  const text = barText(a.reason, width)
  return phase === 'off' ? (
    <Text key="alert" color="red" dimColor wrap="truncate-end">{text}</Text>
  ) : (
    <Text key="alert" bold color="white" backgroundColor="red" wrap="truncate-end">{text}</Text>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'aos-alert', description: 'Show the alert bar status; "off" clears it, "test" shows a sample' })
    $.clock.every(BLINK_MS, () => void tick($))
    return result
  })

  on('session.end', async ($, e, next) => {
    await clear($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await clear($)
    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await activate($, `allow? ${e.tool_name}`)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'AskUserQuestion') await activate($, 'question')
    const result = await next(e)
    if (result.isError && result.text && /go-gate/i.test(result.text)) {
      const label = isReleaseClassBlock(result.text) ? 'GO needed (release class)' : 'GO needed'
      await activate($, `${label}: ${e.tool === 'Bash' ? maskCommand(e.command) : String(e.tool)}`)
    } else if (!result.isError) {
      await clear($)
    }
    return result
  })

  on('command.run', { command: 'aos-alert' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off') {
      await clear($)
      return { text: 'Alert cleared.' }
    }
    if (arg === 'test') {
      await startTest($)
      return { text: `Test alarm for ${TEST_MS / 1000} s.` }
    }
    return { text: await statusText($) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (!(await read($, alert_)).active) return below
    const { Box } = $.ui.resolve(e)
    const bar = await renderBar($, e, e.props.bodyColumns)
    return (
      <Box flexDirection="column">
        {bar}
        {isElement(below) ? below : null}
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const a = await read($, alert_)
    if (!a.active) return next(e)
    if (e.props.isDraft) return next({ ...e, props: { ...e.props, tail: ` ▲ ${a.reason}` } })
    return renderBar($, e, 0)
  })
}
