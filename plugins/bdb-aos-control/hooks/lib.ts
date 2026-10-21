import type { GateState, PipelineState, UsageSnapshot } from '../types'

// Names mirror the --aos-* tokens in lib/ui-tokens/aos-tokens.css (obsidian surfaces, orchid accent).
export const AOS = {
  bg: '#0a0a0a',
  surface: '#141414',
  surface2: '#1e1e1e',
  border: '#2c2c2c',
  text: '#ececec',
  muted: '#a3a3a3',
  accent: '#c58cff',
  accentInk: '#0a0a0a',
  ok: '#5fe0a0',
  warn: '#ffb454',
  bad: '#ff6b7a',
  info: '#6cb8ff',
} as const

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SECRET_KEY = '[A-Za-z0-9_.-]{0,64}(?:password|passwd|pwd|secret|token|key|authorization)[A-Za-z0-9_.-]{0,64}'
const MAX_REDACT_LEN = 4096
const REDACTIONS: Array<[RegExp, string]> = [
  // KEY=VALUE, KEY: VALUE, "key": "value", any identifier containing a secret word, Bearer/Basic values included
  [new RegExp(`(["']?)(${SECRET_KEY})(\\1[ \\t]*[:=][ \\t]*)("[^"\\n]*"|'[^'\\n]*'|[^\\n]+)`, 'gi'), '$1$2$3[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [redacted]'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]'],
]

export const shq = (text: string) => `'${String(text).replace(/'/g, `'\\''`)}'`

// input is capped so the regexes stay linear on hostile long runs; an unquoted secret value masks to end of line
export const redact = (text: string): string => {
  const t = String(text)
  const capped = t.length > MAX_REDACT_LEN ? `${t.slice(0, MAX_REDACT_LEN)}…` : t
  return REDACTIONS.reduce((acc, [re, to]) => acc.replace(re, to), capped)
}

// ---------------------------------------------------------------------------
// TTL cache (git/worktree probes)
// ---------------------------------------------------------------------------

export const PROBE_TTL_MS = 10_000

export type TtlCache = {
  get<T>(key: string, now: number, load: () => Promise<T>): Promise<T>
  size(): number
}

export const createTtlCache = (ttlMs = PROBE_TTL_MS): TtlCache => {
  const entries = new Map<string, { at: number; value: Promise<unknown> }>()
  return {
    get<T>(key: string, now: number, load: () => Promise<T>) {
      const hit = entries.get(key)
      if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>
      for (const [k, v] of entries) if (now - v.at >= ttlMs) entries.delete(k)
      // in-flight probes are shared per key; a failed load is not cached
      const value = load()
      entries.set(key, { at: now, value })
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key)
      })
      return value
    },
    size: () => entries.size,
  }
}

// ---------------------------------------------------------------------------
// Usage: 5h / 7d bars with reset countdown
// ---------------------------------------------------------------------------

const USAGE_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export const formatCountdown = (resetsAt: string | undefined, nowMs: number): string => {
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(at)) return 'n/a'
  const mins = Math.floor((at - nowMs) / 60_000)
  if (mins <= 0) return 'now'
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d${String(Math.floor((mins % 1440) / 60)).padStart(2, '0')}h`
  if (mins >= 60) return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`
  return `${mins}m`
}

export const usageColor = (percent: number) => (percent >= 90 ? AOS.bad : percent >= 70 ? AOS.warn : AOS.ok)

export const barCells = (percent: number, width: number) => {
  const on = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return { on, off: width - on }
}

export type UsageRow = { label: string; percent: number | null; countdown: string; color: string }

export const usageRows = (usage: UsageSnapshot | null, nowMs: number): UsageRow[] =>
  ['five_hour', 'seven_day'].map(kind => {
    const rl = usage?.rateLimits.find(r => r.kind === kind)
    if (!rl) return { label: USAGE_LABEL[kind]!, percent: null, countdown: 'n/a', color: AOS.muted }
    return { label: USAGE_LABEL[kind]!, percent: rl.percentUsed, countdown: formatCountdown(rl.resetsAt, nowMs), color: usageColor(rl.percentUsed) }
  })

export const usageShort = (usage: UsageSnapshot | null, nowMs: number): string =>
  usageRows(usage, nowMs)
    .map(r => `${r.label} ${r.percent === null ? 'n/a' : `${Math.round(r.percent)}%`}`)
    .join(' ')

// ---------------------------------------------------------------------------
// Context bar + legend
// ---------------------------------------------------------------------------

export type ContextSegment = { name: string; tokens: number; cells: number; color: string; kind: 'used' | 'free' | 'buffer' }
export type ContextBar = {
  mode: 'stacked' | 'single' | 'n/a'
  segments: ContextSegment[]
  percent: number | null
  note: string
}

const USED_PALETTE = [AOS.accent, AOS.info, AOS.ok, AOS.warn, AOS.bad, AOS.text]

const allocate = (weights: number[], total: number): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return weights.map(() => 0)
  const raw = weights.map(w => (w / sum) * total)
  const cells = raw.map(Math.floor)
  // largest-remainder: hand leftover cells to the biggest fractions, nonzero weights never vanish
  let left = total - cells.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    cells[i]!++
    left--
  }
  weights.forEach((w, i) => {
    if (w > 0 && cells[i] === 0) cells[i] = 1
  })
  return cells
}

type CtxInput = {
  tokens?: number
  window: number
  percent?: number
  breakdown?: {
    categories: Array<{ name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }>
    rawMaxTokens: number
    percentage: number
  }
}

export const contextBar = (ctx: CtxInput | null | undefined, width: number): ContextBar => {
  const b = ctx?.breakdown
  if (b) {
    const cats = b.categories.filter(c => c.kind !== 'deferred' && c.tokens > 0)
    const cells = allocate(cats.map(c => c.tokens), width)
    let used = 0
    const segments = cats.map((c, i) => ({
      name: c.name,
      tokens: c.tokens,
      cells: cells[i]!,
      kind: c.kind as 'used' | 'free' | 'buffer',
      color: c.kind === 'free' ? AOS.border : c.kind === 'buffer' ? AOS.muted : USED_PALETTE[used++ % USED_PALETTE.length]!,
    }))
    return { mode: 'stacked', segments, percent: Math.round(b.percentage), note: 'by category (estimate, vs compaction window)' }
  }
  if (!ctx || ctx.tokens === undefined || !ctx.window) {
    return { mode: 'n/a', segments: [], percent: null, note: 'no response yet, context fill unknown' }
  }
  const usedTokens = Math.min(ctx.tokens, ctx.window)
  const [on, off] = allocate([usedTokens, ctx.window - usedTokens], width)
  return {
    mode: 'single',
    percent: ctx.percent ?? Math.round((ctx.tokens / ctx.window) * 100),
    note: 'counts input tokens of the last response (uncached + cache read/write)',
    segments: [
      { name: 'Used', tokens: usedTokens, cells: on!, kind: 'used', color: AOS.accent },
      { name: 'Free', tokens: ctx.window - usedTokens, cells: off!, kind: 'free', color: AOS.border },
    ],
  }
}

export const kTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

// ---------------------------------------------------------------------------
// Pipeline flow strip
// ---------------------------------------------------------------------------

export const FLOW_PHASES = ['define', 'plan', 'build', 'verify', 'review', 'ready_to_ship', 'ship', 'done'] as const
export type FlowStatus = 'done' | 'running' | 'pending' | 'blocked'
export type FlowStep = { phase: string; label: string; status: FlowStatus }

export const FLOW_STYLE: Record<FlowStatus, { glyph: string; color: string }> = {
  done: { glyph: '✓', color: AOS.ok },
  running: { glyph: '▶', color: AOS.accent },
  pending: { glyph: '○', color: AOS.muted },
  blocked: { glyph: '✕', color: AOS.bad },
}

export function flowSteps(state: Pick<PipelineState, 'phase' | 'needs_human' | 'gate'>): FlowStep[] {
  const label = (p: string) => p.replace(/_/g, ' ').toUpperCase()
  if (state.phase === 'escalated') {
    return [
      ...FLOW_PHASES.map(p => ({ phase: p, label: label(p), status: 'pending' as FlowStatus })),
      { phase: 'escalated', label: label('escalated'), status: 'blocked' as FlowStatus },
    ]
  }
  const idx = FLOW_PHASES.indexOf(state.phase as (typeof FLOW_PHASES)[number])
  const blocked = !!state.needs_human || Object.values(state.gate ?? {}).includes('fail')
  return FLOW_PHASES.map((p, i) => ({
    phase: p,
    label: label(p),
    status: state.phase === 'done' || i < idx ? 'done' : i === idx ? (blocked ? 'blocked' : 'running') : 'pending',
  }))
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export function parseGateStatus(text: string): GateState {
  const mode = /: mode (\w+)/.exec(text)?.[1]
  const grants = [...text.matchAll(/^[ \t]+grant (\S+) until \S+ \((-?\d+) min left/gm)].map(m => ({
    scope: m[1]!,
    minutesLeft: Number(m[2]),
  }))
  return mode
    ? { mode, grants, raw: redact(text.trim()) }
    : { mode: 'unknown', grants, raw: redact(text.trim()), error: 'status output had no mode line' }
}

type RunResult = { exitCode: number; stdout: string; stderr?: string }

// A failed probe must never read as "soft": show unknown plus the reason.
export const gateFromRun = (r: RunResult | null, thrown?: unknown): GateState => {
  if (r && r.exitCode === 0) return parseGateStatus(r.stdout)
  const why = thrown instanceof Error ? thrown.message : thrown ? String(thrown) : r ? `exit ${r.exitCode} ${r.stderr ?? ''}`.trim() : 'no result'
  return { mode: 'unknown', grants: [], raw: '', error: redact(why).slice(0, 160) }
}

// ---------------------------------------------------------------------------
// Band (one line above the prompt)
// ---------------------------------------------------------------------------

export type BandSegment = { text: string; color: string }

export function bandSegments(args: {
  gate: GateState | null
  usage: UsageSnapshot | null
  phase?: string
  needsHuman?: boolean
  nowMs: number
}): BandSegment[] {
  const mode = args.gate?.mode ?? 'unknown'
  const modeColor = mode === 'hard' ? AOS.ok : mode === 'soft' ? AOS.warn : mode === 'off' ? AOS.bad : AOS.muted
  const segs: BandSegment[] = [
    { text: 'AOS', color: AOS.accent },
    { text: `gate ${mode.toUpperCase()}${args.gate?.error ? ` (${redact(args.gate.error).slice(0, 40)})` : ''}`, color: modeColor },
    { text: usageShort(args.usage, args.nowMs), color: AOS.text },
    { text: args.phase ? `pipeline ${args.phase.replace(/_/g, ' ')}${args.needsHuman ? ' !' : ''}` : 'pipeline idle', color: args.phase ? AOS.info : AOS.muted },
  ]
  return segs.map(s => ({ ...s, text: s.text.replace(/\s+/g, ' ') }))
}

export const bandText = (segs: BandSegment[]) => segs.map(s => s.text).join(' │ ')

// ---------------------------------------------------------------------------
// Logo: RGBA image with text fallback
// ---------------------------------------------------------------------------

export const LOGO_PX = 16
const GLYPH_A = ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#']

const hexRgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]

export function logoRgba(): { rgba: string; width: number; height: number } {
  const [ar, ag, ab] = hexRgb(AOS.accent)
  const [ir, ig, ib] = hexRgb(AOS.accentInk)
  const bytes = new Uint8Array(LOGO_PX * LOGO_PX * 4)
  for (let y = 0; y < LOGO_PX; y++) {
    for (let x = 0; x < LOGO_PX; x++) {
      const edge = Math.min(x, y, LOGO_PX - 1 - x, LOGO_PX - 1 - y)
      const corner = (x < 2 || x > LOGO_PX - 3) && (y < 2 || y > LOGO_PX - 3) && edge === 0
      const glyph = GLYPH_A[y - 4]?.[x - 5] === '#'
      const o = (y * LOGO_PX + x) * 4
      if (corner) continue
      bytes.set(glyph ? [ir, ig, ib, 255] : [ar, ag, ab, 255], o)
    }
  }
  return { rgba: (bytes as Uint8Array & { toBase64(): string }).toBase64(), width: LOGO_PX, height: LOGO_PX }
}

export const logoMark = (hasImage: boolean): { kind: 'image' | 'text'; text: string } =>
  hasImage ? { kind: 'image', text: 'AOS' } : { kind: 'text', text: 'AOS' }
