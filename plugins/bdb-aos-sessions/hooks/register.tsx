import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Overview, SessionRow } from '../types'

const PANE = 'aos-sessions'
const MAX_ROWS = 200
const MAX_STR = 80
const CARD_MAX = 8
type PaneInput = Parameters<EngineInterface['ui']['resolve']>[0] & { props: { bodyColumns?: number } }

const overviewAtom = atom({ plugin: 'bdb-aos-sessions', key: 'overview' } as const, null as Overview | null)
const errorAtom = atom({ plugin: 'bdb-aos-sessions', key: 'error' } as const, '')
const atAtom = atom({ plugin: 'bdb-aos-sessions', key: 'at' } as const, 0)

const cut = (s: unknown): string => (typeof s === 'string' ? s.slice(0, MAX_STR) : '')

function cleanRow(r: Record<string, unknown>): SessionRow {
  const section = r.section
  const age = typeof r.ageMs === 'number' && Number.isFinite(r.ageMs) ? r.ageMs : null
  return {
    source: cut(r.source),
    id: cut(r.id),
    name: cut(r.name),
    harness: cut(r.harness),
    state: cut(r.state),
    section: section === 'needs' || section === 'working' || section === 'idle' || section === 'acp' || section === 'dead' ? section : 'idle',
    detail: cut(r.detail),
    ageMs: age,
  }
}

export function parseOverview(text: string): Overview | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  if (!Array.isArray(parsed.sessions) || !Array.isArray(parsed.acp)) return null
  const hub = parsed.hub === 'running' ? 'running' : 'down'
  const now = typeof parsed.now === 'number' ? String(parsed.now) : cut(parsed.now)
  const sessions = (parsed.sessions as unknown[]).slice(0, MAX_ROWS).map(r => cleanRow((r ?? {}) as Record<string, unknown>))
  const acp = (parsed.acp as unknown[]).slice(0, MAX_ROWS).map(r => cleanRow((r ?? {}) as Record<string, unknown>))
  return { now, hub, sessions, acp }
}

export function sectionCounts(o: Overview) {
  const needs = o.sessions.filter(s => s.section === 'needs').length
  const working = o.sessions.filter(s => s.section === 'working').length
  const idle = o.sessions.filter(s => s.section === 'idle').length
  const running = o.acp.filter(s => s.state === 'running').length
  const stalled = o.acp.filter(s => s.state === 'stalled').length
  const done = o.acp.filter(s => s.state === 'done').length
  const go = o.acp.filter(s => /go/i.test(s.state) || /go/i.test(s.detail)).length
  return { needs, working, idle, acp: o.acp.length, running, stalled, done, go }
}

export function ageLabel(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 5000) return 'now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

export function harnessLabel(h: string): string {
  return /kimi/i.test(h) ? 'kimi (via trail)' : h
}

export function demoOverview(): Overview {
  return {
    now: 'demo',
    hub: 'running',
    sessions: [
      { source: 'demo', id: 'demo-orchestrator', name: 'demo-orchestrator', harness: 'claude', state: 'waiting', section: 'needs', detail: 'waiting for a GO', ageMs: 40000 },
      { source: 'demo', id: 'demo-web', name: 'demo-web', harness: 'codex', state: 'working', section: 'working', detail: 'building', ageMs: 240000 },
      { source: 'demo', id: 'demo-api', name: 'demo-api', harness: 'kimi', state: 'idle', section: 'idle', detail: 'idle', ageMs: 10800000 },
    ],
    acp: [
      { source: 'acp', id: 'demo-glm-1', name: 'demo-glm-1', harness: 'agy', state: 'running', section: 'acp', detail: 'running', ageMs: 60000 },
      { source: 'acp', id: 'demo-glm-2', name: 'demo-glm-2', harness: 'opencode', state: 'GO needed', section: 'acp', detail: 'GO needed', ageMs: 120000 },
    ],
  }
}

export async function loadOverview($: EngineInterface): Promise<void> {
  try {
    if ((await $.env.get('AOS_FLEET_DEMO')) === '1') {
      const nowMs = await $.clock.now()
      await update($, overviewAtom, () => demoOverview())
      await update($, errorAtom, () => '')
      await update($, atAtom, () => nowMs)
      return
    }
    const home = await $.env.get('HOME')
    const attempts: string[][] = [[ 'node', `${home}/.agents/bin/aos-sessions.mjs`, '--json' ], ['aos-sessions', '--json']]
    for (const args of attempts) {
      try {
        const r = await $.process.run(args)
        if (r.exitCode !== 0) continue
        const parsed = parseOverview(r.stdout)
        if (!parsed) continue
        await update($, overviewAtom, () => parsed)
        await update($, errorAtom, () => '')
        await update($, atAtom, () => Date.now())
        return
      } catch {
        continue
      }
    }
    await update($, overviewAtom, () => null)
    await update($, errorAtom, () => 'aos-sessions not found: install AOS v5 or run bin/aos-sessions.mjs')
    await update($, atAtom, () => Date.now())
  } catch {
    await update($, overviewAtom, () => null)
    await update($, errorAtom, () => 'aos-sessions not found: install AOS v5 or run bin/aos-sessions.mjs')
  }
}

let timerOn = false

export const register: Register = registerHook => {
  registerHook('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'aos-sessions', description: 'Show all sessions and ACP workers' })
    return result
  })

  registerHook('command.run', { command: 'aos-sessions' }, async $ => {
    await loadOverview($)
    if (!timerOn) {
      timerOn = true
      $.clock.every(10_000, () => void loadOverview($).catch(() => undefined))
    }
    await $.ui.open({ id: PANE, title: 'AOS sessions' })
    return { text: 'aos-sessions pane opened.' }
  })

  registerHook('ui.render', { component: 'Pane', requestId: PANE }, async ($, e: PaneInput) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const err = await read($, errorAtom)
    const o = await read($, overviewAtom)
    if (err || !o) {
      return (
        <Box flexDirection="column">
          <Text dimColor color="yellow" wrap="truncate-end">{err || 'no data yet'}</Text>
          <Text dimColor wrap="truncate-end">read-only · data from aos-sessions (hub, A2A registry, ACP logs)</Text>
        </Box>
      )
    }
    const counts = sectionCounts(o)
    const active = o.sessions.length
    const acpTitle = `ACP WORKERS running ${counts.running} · stalled ${counts.stalled} · done ${counts.done}`
    const fit = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
    const renderRow = (r: SessionRow, glyph: string, color: string, key: string) => (
      <Box key={key} flexDirection="row" justifyContent="space-between">
        <Box key={`${key}-l`} flexDirection="row">
          <Text key={`${key}-g`} color={color} wrap="truncate-end">{glyph} </Text>
          <Text key={`${key}-h`} dimColor wrap="truncate-end">{harnessLabel(r.harness).padEnd(16).slice(0, 16)} </Text>
          <Text key={`${key}-n`} bold wrap="truncate-end">{r.name} </Text>
          <Text key={`${key}-d`} dimColor wrap="truncate-end">{fit(r.detail, 40)}</Text>
        </Box>
        <Text key={`${key}-a`} dimColor wrap="truncate-end">{ageLabel(r.ageMs)}</Text>
      </Box>
    )
    const card = (title: string, borderColor: string, key: string, rows: SessionRow[], glyph: string, color: string, acpMode = false) => {
      const shown = rows.slice(0, CARD_MAX)
      const more = rows.length - shown.length
      return (
        <Box key={key} flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} marginBottom={1}>
          <Text key={`${key}-t`} bold wrap="truncate-end">{title}</Text>
          {shown.length === 0 ? (
            <Text key={`${key}-none`} dimColor wrap="truncate-end">none</Text>
          ) : acpMode ? (
            shown.map(r => {
              const g = r.state === 'running' ? { glyph: '●', color: 'green' } : /go/i.test(r.state) || /go/i.test(r.detail) ? { glyph: '▲', color: 'yellow' } : r.state === 'stalled' ? { glyph: '◌', color: 'gray' } : { glyph: '✓', color: 'gray' }
              return renderRow(r, g.glyph, g.color, `${key}-${r.id}`)
            })
          ) : (
            shown.map(r => renderRow(r, glyph, color, `${key}-${r.id}`))
          )}
          {more > 0 && <Text key={`${key}-more`} dimColor wrap="truncate-end">+{more} more</Text>}
        </Box>
      )
    }
    const needs = card('NEEDS YOU', 'yellow', 'needs', o.sessions.filter(s => s.section === 'needs'), '▲', 'yellow')
    const working = card('WORKING', 'green', 'working', o.sessions.filter(s => s.section === 'working'), '●', 'green')
    const idle = card('IDLE', 'gray', 'idle', o.sessions.filter(s => s.section === 'idle'), '○', 'gray')
    const acp = card(acpTitle, 'blue', 'acp', o.acp, '●', 'blue', true)
    const wide = (e.props.bodyColumns ?? 80) >= 96
    const body = wide ? (
      <Box key="cols" flexDirection="row">
        <Box key="col-left" flexGrow={1} flexDirection="column">{needs}{working}</Box>
        <Box key="col-right" flexGrow={1} flexDirection="column">{idle}{acp}</Box>
      </Box>
    ) : (
      <Box key="stack" flexDirection="column">{needs}{working}{idle}{acp}</Box>
    )
    return (
      <Box flexDirection="column">
        <Box key="head" flexDirection="row" justifyContent="space-between">
          <Text key="title" bold wrap="truncate-end">SESSIONS</Text>
          <Text key="sub" dimColor wrap="truncate-end">{active} active · hub {o.hub}</Text>
        </Box>
        {body}
        <Text dimColor wrap="truncate-end">read-only · data from aos-sessions (hub, A2A registry, ACP logs)</Text>
      </Box>
    )
  })
}
