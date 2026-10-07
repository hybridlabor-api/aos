import { expect, test } from 'claude-code/testing'

import { boardProgress, filled, weather, groupProjects, parsePeers, roleFromName, tasksExtras } from '../hooks/register'

test('role comes from the session name', () => {
  expect(roleFromName('master session')).toBe('master')
  expect(roleFromName('TASK MANAGER')).toBe('task-manager')
  expect(roleFromName('AO Orchestrator')).toBe('orchestrator')
  expect(roleFromName('playbook builder')).toBe('worker')
})

test('sessions group by repo and branch, phase taken from any member', () => {
  const base = { role: 'worker' as const, cwd: '/', updatedAt: 0, activity: 'idle' as const }
  const groups = groupProjects([
    { ...base, id: 'a', name: 'a', repo: 'aos', branch: 'main' },
    { ...base, id: 'b', name: 'b', repo: 'aos', branch: 'main', phase: 'review' },
    { ...base, id: 'c', name: 'c' },
  ])
  expect(groups.map(g => [g.key, g.sessions.length, g.phase])).toEqual([
    ['aos@main', 2, 'review'],
    ['(no repo)', 1, undefined],
  ])
})

test('a go-gate block marks the session as needing a GO, the next tool call clears it', async ($, on) => {
  const writes: { activity?: string; reason?: string }[] = []
  on('state.set', { plugin: 'bdb-aos-fleet', key: 'self' }, (_$, e, next) => {
    writes.push(e.value as { activity?: string; reason?: string })
    return next(e)
  })
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) =>
    e.command.startsWith('npm publish')
      ? { result: { stdout: '', stderr: '', interrupted: false }, isError: true, text: 'Blocked by go-gate hook: npm publish' }
      : { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' },
  )

  await $.tool.call({ tool: 'Bash', command: 'npm publish' })
  expect(writes.at(-1)).toEqual({ activity: 'attention', reason: 'GO: npm publish' })

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(writes.at(-1)?.activity).toBe('working')
})

test('peers without the mod come from ListAgents', () => {
  const text = `This session is me [7cd602] — the name ...

Peer sessions (2):
  TASK MANAGER [ce33b6]  ·  interactive  ·  idle  ·  started 4h ago
  AO Orchestrator [b59d5f]  ·  interactive  ·  busy  ·  started 4h ago`
  expect(parsePeers(text, 1).map(p => [p.name, p.role, p.activity])).toEqual([
    ['TASK MANAGER', 'task-manager', 'idle'],
    ['AO Orchestrator', 'orchestrator', 'working'],
  ])
})

test('TASK MANAGER list gives progress, waits and board ports per owner', () => {
  const x = tasksExtras({
    sessions: { 'AO Orchestrator': { map_url: 'http://127.0.0.1:5331' }, Pkg: { map_url: ['http://127.0.0.1:5332 (a)', 'http://127.0.0.1:5333 (b)'] } },
    tasks: [
      { owner: 'AO Orchestrator', status: 'erledigt' },
      { owner: 'AO Orchestrator', status: 'wartet-auf-GO' },
      { owner: 'AO Orchestrator', status: 'wartet-auf-Tim' },
      { owner: 'AO Orchestrator', status: 'geparkt' },
    ],
  })
  expect(x.progress.get('ao orchestrator')).toEqual({ done: 1, total: 3, blocked: 0, source: 'tasks' })
  expect(x.waits.get('ao orchestrator')).toBe('1 GO · 1 Tim')
  expect(x.ports.get('pkg')).toEqual([5332, 5333])
})

test('board progress sums components across boards and fills the bar', () => {
  const p = boardProgress([
    { components: [{ status: 'done' }, { status: 'blocked' }] },
    { components: [{ status: 'done' }, { status: 'pending' }] },
  ])
  expect(p).toEqual({ done: 2, total: 4, blocked: 1, source: 'plan' })
  expect(filled(p!)).toBe(4)
})

test('context advice follows the token-weather scale', () => {
  expect(weather(30).advice).toBe('ok')
  expect(weather(80).advice).toBe('compact soon')
  expect(weather(95).advice).toBe('compact or start a new session')
})
