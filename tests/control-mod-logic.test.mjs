// Node-runnable port of the pure-logic assertions in plugins/bdb-aos-control/tests/control.test.tsx.
// The Claude Code harness tests (UI mounts, command.run, prompt.fill spies) stay in control.test.tsx.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildWorktreeItems,
  demoFleet,
  demoPipeline,
  filterRosterSessions,
  parsePipelineState,
  parseProfile,
  parseServices,
  parseStatusBranch,
  parseV5Settings,
  parseWorktrees,
  redactSession,
  renderErrorText,
  roleHint,
  tokenEstimate,
} from '../plugins/bdb-aos-control/hooks/logic.ts'
import {
  bandSegments,
  bandText,
  contextBar,
  createTtlCache,
  flowSteps,
  formatCountdown,
  gateFromRun,
  logoMark,
  logoRgba,
  parseGateStatus,
  redact,
  shq,
  usageRows,
  usageShort,
} from '../plugins/bdb-aos-control/hooks/lib.ts'

const PIPELINE_FIXTURE = JSON.stringify({
  run_id: 'run-42',
  goal: 'ship the control mod',
  phase: 'review',
  iteration: 2,
  max_iterations: 3,
  gate: { lint: 'pass', typecheck: 'fail', tests: 'skip', a11y: 'skip', seo: 'skip', security: 'pass' },
  findings: [
    { id: 'f1', severity: 'blocking', node: 'engineering', status: 'open', summary: 'missing tests' },
    { id: 'f2', severity: 'advisory', node: 'ui_ux', status: 'fixed', summary: 'logo alignment' },
  ],
  approvals: [],
  needs_human: true,
})

const NOW = Date.parse('2026-10-21T10:00:00Z')

test('parseGateStatus handles mode and grants', () => {
  const g = parseGateStatus('AOS go-gate, session sid: mode hard\n  grant push-feature until 2026-01-01T00:00:00Z (15 min left)')
  assert.equal(g.mode, 'hard')
  assert.deepEqual(g.grants, [{ scope: 'push-feature', minutesLeft: 15 }])
})

test('parseProfile parses strict with minutes', () => {
  assert.deepEqual(parseProfile('profile: strict (30 min left)\nnote: none'), { profile: 'strict', minutesLeft: 30, note: 'none' })
})

test('tokenEstimate formats context profile estimates', () => {
  assert.equal(tokenEstimate('full'), '~70k')
  assert.equal(tokenEstimate('orchestrator'), '~55k')
  assert.equal(tokenEstimate('worker'), '~35k')
  assert.equal(tokenEstimate('small'), '~15k')
  assert.equal(tokenEstimate('unknown'), 'unknown')
})

test('roleHint maps session names to recommended context profiles', () => {
  assert.equal(roleHint('master'), 'full/orchestrator')
  assert.equal(roleHint('orchestrator-1'), 'full/orchestrator')
  assert.equal(roleHint('worker-3'), 'worker')
  assert.equal(roleHint('small-model'), 'small')
  assert.equal(roleHint('sid'), '')
})

test('parseV5Settings reads install and context profiles with defaults', () => {
  assert.deepEqual(parseV5Settings(JSON.stringify({ profile: 'minimal', context: 'worker' })), { installProfile: 'minimal', contextProfile: 'worker' })
  assert.deepEqual(parseV5Settings('not json'), { installProfile: 'standard', contextProfile: 'full' })
  assert.deepEqual(parseV5Settings(JSON.stringify({ context: 'small' })), { installProfile: 'standard', contextProfile: 'small' })
  assert.deepEqual(parseV5Settings(JSON.stringify({ profile: 'invalid', context: 'invalid' })), { installProfile: 'standard', contextProfile: 'full' })
})

test('parsePipelineState validates required phase and findings', () => {
  const s = parsePipelineState(PIPELINE_FIXTURE)
  assert.notEqual(s, null)
  assert.equal(s.phase, 'review')
  assert.equal(s.findings.length, 2)
  assert.equal(s.needs_human, true)
})

test('parsePipelineState rejects invalid phase', () => {
  assert.equal(parsePipelineState(JSON.stringify({ phase: 'invalid' })), null)
})

test('parsePipelineState redacts secrets in goal and finding summaries', () => {
  const s = parsePipelineState(JSON.stringify({ phase: 'build', goal: 'deploy with token=abc123xyz', findings: [{ id: 'f', summary: 'password=pw1' }] }))
  assert.equal(s.goal, 'deploy with token=[redacted]')
  assert.equal(s.findings[0].summary, 'password=[redacted]')
})

test('parsePipelineState validates gate values', () => {
  const s = parsePipelineState(JSON.stringify({ phase: 'build', gate: { lint: 'pass', tests: 'FAIL!!', seo: { x: 1 }, a11y: 'skip' } }))
  assert.deepEqual(s.gate, { lint: 'pass', tests: 'unknown', seo: 'unknown', a11y: 'skip' })
  assert.deepEqual(parsePipelineState(JSON.stringify({ phase: 'build', gate: ['x'] })).gate, {})
})

test('parseServices handles an array of service objects', () => {
  assert.deepEqual(parseServices(JSON.stringify([{ id: 'hub', name: 'Hub', status: 'running', port: 7900 }])), [
    { id: 'hub', name: 'Hub', status: 'running', port: 7900 },
  ])
})

test('parseWorktrees parses porcelain output with detached and branches', () => {
  const text = `worktree /repo/main
HEAD abc1234abcd1234abcd1234abcd1234abcd1234
branch refs/heads/main

worktree /repo/wt1
HEAD def5678def5678def5678def5678def5678def5
detached

worktree /repo/bare
bare
`
  assert.deepEqual(parseWorktrees(text), [
    { path: '/repo/main', head: 'abc1234abcd1234abcd1234abcd1234abcd1234', branch: 'main', bare: false },
    { path: '/repo/wt1', head: 'def5678def5678def5678def5678def5678def5', branch: '(detached)', bare: false },
    { path: '/repo/bare', head: '', branch: '', bare: true },
  ])
})

test('parseStatusBranch extracts branch, ahead, behind and dirty count', () => {
  const sb = parseStatusBranch('## feat/ui...origin/feat/ui [ahead 2, behind 1]\n M file.ts\n?? new.ts')
  assert.deepEqual(sb, { branch: 'feat/ui', ahead: 2, behind: 1, dirty: 2 })
})

test('demo helpers return placeholder data', () => {
  assert.deepEqual(demoFleet().map(s => s.name), ['demo-orchestrator', 'demo-web', 'demo-api'])
  assert.equal(demoPipeline().phase, 'build')
})

test('buildWorktreeItems derives stages from git output and pipeline state', async () => {
  const out = (stdout, exitCode = 0) => ({ stdout, stderr: '', exitCode })
  const fake = {
    process: {
      run: async cmd => {
        const key = cmd.join(' ')
        if (key.includes('worktree list')) {
          return out('worktree /repo/main\nHEAD abc1234\nbranch refs/heads/main\n\nworktree /repo/wt1\nHEAD def5678\nbranch refs/heads/feat/ui\n')
        }
        if (key.includes('status')) return out(key.includes('wt1') ? '## feat/ui...origin/feat/ui [ahead 2]\n' : '## main...origin/main\n')
        if (key.includes('branch --merged')) return out(key.includes('wt1') ? '' : 'main\n')
        return out('', 1)
      },
    },
  }
  const items = await buildWorktreeItems(fake.process.run, '/repo/main', parsePipelineState(PIPELINE_FIXTURE))
  assert.deepEqual(items.map(i => [i.branch, i.stage, i.isAgentWorktree]), [
    ['main', 'merged', false],
    ['feat/ui', 'reviewed', true],
  ])
})

test('buildWorktreeItems runs git once per TTL window', async () => {
  let calls = 0
  const out = (stdout, exitCode = 0) => ({ stdout, stderr: '', exitCode })
  const fake = {
    process: {
      run: async cmd => {
        calls++
        const key = cmd.join(' ')
        if (key.includes('worktree list')) return out('worktree /repo/main\nHEAD abc\nbranch refs/heads/main\n')
        if (key.includes('status')) return out('## main...origin/main\n')
        return out('main\n')
      },
    },
  }
  const cache = createTtlCache(10_000)
  await buildWorktreeItems(fake.process.run, '/repo/main', null, cache, 0)
  const first = calls
  await buildWorktreeItems(fake.process.run, '/repo/main', null, cache, 5_000)
  assert.equal(calls, first)
  await buildWorktreeItems(fake.process.run, '/repo/main', null, cache, 11_000)
  assert.equal(calls, first * 2)
})

test('a git probe failure throws a redacted message', async () => {
  const fake = { process: { run: async () => ({ stdout: '', stderr: 'fatal: token=abc123 denied', exitCode: 128 }) } }
  let msg = ''
  await buildWorktreeItems(fake.process.run, '/r', null).catch(e => (msg = e.message))
  assert.equal(msg, 'git probe failed: fatal: token=[redacted]')
})

test('filterRosterSessions collapses 6 delegated workers into one chip', () => {
  const worker = (id, extra = {}) => ({ id, name: id, role: 'worker', activity: 'idle', cwd: '', updatedAt: 0, ...extra })
  const sessions = [
    { id: 'm1', name: 'master', role: 'master', activity: 'idle', cwd: '', updatedAt: 0 },
    ...[1, 2, 3, 4, 5, 6].map(i => worker(`swarm-${i}`, { delegated: true })),
  ]
  assert.deepEqual(filterRosterSessions(sessions).map(s => s.name), ['master', '+6 delegated'])
})

test('filterRosterSessions shows master and orchestrator always', () => {
  const sessions = [
    { id: 'm1', name: 'master', role: 'master', activity: 'idle', cwd: '', updatedAt: 0 },
    { id: 'o1', name: 'orchestrator', role: 'orchestrator', activity: 'idle', cwd: '', updatedAt: 0 },
    { id: 'd1', name: 'swarm-1', role: 'worker', activity: 'idle', cwd: '', updatedAt: 0, delegated: true },
  ]
  assert.deepEqual(filterRosterSessions(sessions).map(s => s.name), ['master', 'orchestrator', '+1 delegated'])
})

test('filterRosterSessions groups package workers by node with count', () => {
  const pack = (id, updatedAt, trailNode) => ({ id, name: id, role: 'worker', activity: 'idle', cwd: '', updatedAt, trailNode })
  const sessions = [
    { id: 'm1', name: 'master', role: 'master', activity: 'idle', cwd: '', updatedAt: 0 },
    pack('pack-1', 100, 'engineering'),
    pack('pack-2', 200, 'engineering'),
    pack('pack-3', 300, 'review'),
    pack('pack-4', 400, 'review'),
  ]
  const filtered = filterRosterSessions(sessions)
  assert.deepEqual(filtered.map(s => s.name), ['master', 'packs ×2', 'packs ×2'])
  assert.ok(filtered.find(s => s.reason === 'engineering'))
  assert.ok(filtered.find(s => s.reason === 'review'))
})

test('logo: image path with text fallback, and the RGBA payload decodes to full size', () => {
  assert.deepEqual(logoMark(true), { kind: 'image', text: 'AOS' })
  assert.deepEqual(logoMark(false), { kind: 'text', text: 'AOS' })
  const logo = logoRgba()
  assert.equal(atob(logo.rgba).length, logo.width * logo.height * 4)
})

test('formatCountdown formats minutes, hours and days, n/a without a reset', () => {
  assert.equal(formatCountdown('2026-10-21T10:45:00Z', NOW), '45m')
  assert.equal(formatCountdown('2026-10-21T12:13:00Z', NOW), '2h13m')
  assert.equal(formatCountdown('2026-10-24T15:00:00Z', NOW), '3d05h')
  assert.equal(formatCountdown('2026-10-21T09:00:00Z', NOW), 'now')
  assert.equal(formatCountdown(undefined, NOW), 'n/a')
})

test('usageRows and usageShort show n/a when the data path is empty', () => {
  const usage = {
    fetchedAt: NOW,
    context: { window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-21T12:00:00Z' }],
  }
  assert.equal(usageShort(usage, NOW), '5h 24% 7d n/a')
  assert.deepEqual(usageRows(usage, NOW)[0], { label: '5h', percent: 23.5, countdown: '2h00m', color: '#5fe0a0' })
  assert.ok(usageRows(null, NOW).every(r => r.percent === null && r.countdown === 'n/a'))
})

test('contextBar stacks categories with a legend, falls back to a single bar, then n/a', () => {
  const stacked = contextBar(
    {
      window: 200000,
      breakdown: {
        rawMaxTokens: 200000,
        percentage: 31,
        categories: [
          { name: 'Messages', tokens: 50000, kind: 'used' },
          { name: 'Tools', tokens: 10000, kind: 'used' },
          { name: 'Deferred tools', tokens: 9999, kind: 'deferred' },
          { name: 'Free space', tokens: 140000, kind: 'free' },
        ],
      },
    },
    20,
  )
  assert.equal(stacked.mode, 'stacked')
  assert.deepEqual(stacked.segments.map(s => s.name), ['Messages', 'Tools', 'Free space'])
  assert.equal(stacked.segments.reduce((a, s) => a + s.cells, 0), 20)
  const single = contextBar({ tokens: 50000, window: 200000, percent: 25 }, 20)
  assert.equal(single.mode, 'single')
  assert.deepEqual(single.segments.map(s => s.cells), [5, 15])
  assert.equal(contextBar({ window: 200000 }, 20).mode, 'n/a')
})

test('flowSteps renders done, running, pending and blocked', () => {
  const states = (phase, extra = {}) => flowSteps({ phase, gate: {}, ...extra }).map(s => s.status)
  assert.deepEqual(states('build'), ['done', 'done', 'running', 'pending', 'pending', 'pending', 'pending', 'pending'])
  assert.equal(states('review', { needs_human: true })[4], 'blocked')
  assert.equal(states('build', { gate: { lint: 'fail' } })[2], 'blocked')
  assert.ok(states('done').every(x => x === 'done'))
  const esc = flowSteps({ phase: 'escalated', gate: {} })
  assert.deepEqual(esc[esc.length - 1], { phase: 'escalated', label: 'ESCALATED', status: 'blocked' })
})

test('gate load failure shows unknown plus the error, never soft', () => {
  const failed = gateFromRun(null, new Error('spawn node ENOENT'))
  assert.equal(failed.mode, 'unknown')
  assert.ok(failed.error.includes('ENOENT'))
  assert.equal(gateFromRun({ exitCode: 2, stdout: '', stderr: 'boom' }).mode, 'unknown')
  assert.equal(parseGateStatus('garbage').mode, 'unknown')
  assert.equal(gateFromRun({ exitCode: 0, stdout: 'AOS go-gate, session s: mode hard' }).mode, 'hard')
})

test('redact masks tokens, keys, Authorization and password=', () => {
  assert.equal(redact('Authorization: Bearer abcdef1234567890'), 'Authorization: [redacted]')
  assert.ok(!redact('curl -H "Authorization: Basic dXNlcjpwYXNz" url').includes('dXNlcjpwYXNz'))
  assert.equal(redact('db password=hunter2 ok'), 'db password=[redacted]')
  assert.ok(!redact('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123').includes('ghp_'))
  assert.equal(redact('key sk-abcdefghijklmnopqrstuvwx end'), 'key [redacted] end')
  assert.equal(redact('plain text stays'), 'plain text stays')
})

test('redact masks prefixed identifiers and JSON forms', () => {
  assert.equal(redact('DB_PASSWORD=hunter2'), 'DB_PASSWORD=[redacted]')
  assert.equal(redact('OPENAI_API_KEY=abc123'), 'OPENAI_API_KEY=[redacted]')
  assert.equal(redact('GITHUB_TOKEN: xyz'), 'GITHUB_TOKEN: [redacted]')
  assert.equal(redact('{"password": "p w", "ok": 1}'), '{"password": [redacted], "ok": 1}')
  assert.ok(!redact("{'client_secret':'s3'}").includes('s3'))
  assert.ok(!redact('"Authorization": "Bearer abcdef123456"').includes('abcdef123456'))
})

test('redact caps its input and masks an unquoted value to end of line', () => {
  const long = redact(`${'a'.repeat(100_000)}token=x`)
  assert.ok(long.length <= 4200)
  assert.ok(long.endsWith('…'))
  assert.equal(redact('password=hunter 2 more\nnext line'), 'password=[redacted]\nnext line')
})

test('redactSession falls back safely for bad enums and redacts text', () => {
  const s = redactSession({ id: 'x', name: 'worker-token=abc', role: 'bogus', activity: 'sleeping', cwd: '/x', updatedAt: 1, trailNode: 'API_KEY=k1' })
  assert.equal(s.role, 'worker')
  assert.equal(s.activity, 'idle')
  assert.equal(s.name, 'worker-token=[redacted]')
  assert.equal(s.trailNode, 'API_KEY=[redacted]')
})

test('redactSession validates progress numbers', () => {
  const base = { id: 'x', name: 'w', role: 'worker', activity: 'idle', cwd: '', updatedAt: 1 }
  assert.deepEqual(redactSession({ ...base, progress: { done: 9, total: 3, blocked: -1, source: 'x' } }).progress, { done: 3, total: 3, blocked: 0, source: 'plan' })
  assert.deepEqual(redactSession({ ...base, progress: { done: 'a', total: NaN } }).progress, { total: 0, done: 0, blocked: 0, source: 'plan' })
  assert.equal(redactSession({ ...base, progress: 'bad' }).progress, undefined)
})

test('shq single-quotes prefilled values', () => {
  assert.equal(shq("a'b c"), "'a'\\''b c'")
})

test('the band is one line with gate, usage and phase', () => {
  const segs = bandSegments({
    gate: { mode: 'hard', grants: [], raw: '' },
    usage: { fetchedAt: NOW, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 41 }] },
    phase: 'ready_to_ship',
    nowMs: NOW,
  })
  const text = bandText(segs)
  assert.equal(text, 'AOS │ gate HARD │ 5h 10% 7d 41% │ pipeline ready to ship')
  assert.equal(text.includes('\n'), false)
  assert.equal(bandText(bandSegments({ gate: null, usage: null, nowMs: NOW })), 'AOS │ gate UNKNOWN │ 5h n/a 7d n/a │ pipeline idle')
})

test('band shows the short gate error next to UNKNOWN', () => {
  const t = bandText(bandSegments({ gate: { mode: 'unknown', grants: [], raw: '', error: 'spawn ENOENT' }, usage: null, nowMs: NOW }))
  assert.ok(t.includes('gate UNKNOWN (spawn ENOENT)'))
})

test('probe cache honours the TTL', async () => {
  const cache = createTtlCache(10_000)
  let loads = 0
  const load = async () => ++loads
  assert.equal(await cache.get('k', 0, load), 1)
  assert.equal(await cache.get('k', 9_999, load), 1)
  assert.equal(await cache.get('k', 10_000, load), 2)
  assert.equal(loads, 2)
})

test('probe cache dedupes in-flight loads and evicts expired entries', async () => {
  const cache = createTtlCache(10_000)
  let loads = 0
  const load = async () => ++loads
  await Promise.all([cache.get('a', 0, load), cache.get('a', 1, load)])
  assert.equal(loads, 1)
  await cache.get('b', 20_000, load)
  assert.equal(cache.size(), 1)
})

test('a stale failed probe does not evict a newer entry', async () => {
  const cache = createTtlCache(10)
  let fail = () => undefined
  const first = cache.get('k', 0, () => new Promise((_, rej) => (fail = rej)))
  const second = cache.get('k', 20, async () => 2)
  fail(new Error('late'))
  await first.catch(() => undefined)
  assert.equal(await cache.get('k', 21, async () => 3), 2)
  assert.equal(await second, 2)
})

test('renderErrorText is one line and redacted', () => {
  assert.equal(renderErrorText(new Error('x password=p')), 'AOS Control: render error: x password=[redacted]')
})
