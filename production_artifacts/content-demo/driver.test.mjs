import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildTimeline, parsePlan, applyEdit, checkDir, PLAN_SRC, DEFAULT_DIR, AGENTS } from './driver.mjs'

const FAKE_USER = 'fixture-user'
const text = fs.readFileSync(PLAN_SRC, 'utf8')
const plan = parsePlan(text)
const KINDS = ['session.start', 'session.end', 'session.stop', 'tool.pre', 'tool.post', 'task.update', 'waiting', 'blocker', 'go.request', 'note']
const STATUS = ['todo', 'doing', 'done', 'stuck']
const events = (tl) => tl.flatMap((s) => s.events)

test('buildTimeline is deterministic', () => {
  assert.deepEqual(buildTimeline(plan, 36), buildTimeline(plan, 36))
})

test('every active task goes todo -> doing -> done in order', () => {
  const tl = buildTimeline(plan, 36)
  const active = plan.tasks.filter((t) => t.mark !== 'x')
  assert.equal(active.length, 23)
  for (const t of active) {
    const marks = tl.filter((s) => s.edit?.taskId === t.id && s.edit.mark).map((s) => s.edit.mark)
    assert.deepEqual(marks, ['~', 'x'], t.id)
    const st = events(tl).filter((e) => e.task?.id === t.id).map((e) => e.task.status)
    const want = t.mark === '!' ? ['stuck', 'doing', 'done'] : ['doing', 'done']
    assert.equal(st[0], want[0], t.id)
    assert.equal(st.at(-1), 'done', t.id)
    assert.ok(st.includes('doing'), t.id)
    if (t.mark === '!') assert.ok(st.includes('stuck'))
  }
  for (const t of plan.tasks.filter((t) => t.mark === 'x')) assert.ok(!tl.some((s) => s.edit?.taskId === t.id))
  assert.ok(tl.some((s) => s.edit?.by), 'at least one hand-off')
  assert.ok(events(tl).some((e) => e.kind === 'waiting'))
})

test('span stays within duration and is sorted', () => {
  for (const d of [36, 10]) {
    const tl = buildTimeline(plan, d)
    assert.ok(tl.every((s, i) => s.atMs >= 0 && s.atMs <= d * 1000 && (i === 0 || tl[i - 1].atMs <= s.atMs)))
    const lastDone = Math.max(...tl.filter((s) => s.edit?.mark === 'x').map((s) => s.atMs))
    assert.ok(lastDone >= d * 1000 - 1000)
  }
})

test('events validate against trail-event/1', () => {
  const evs = events(buildTimeline(plan, 36))
  assert.ok(evs.length > 150)
  for (const e of evs) {
    assert.equal(e.v, 1)
    assert.ok(AGENTS.includes(e.agent))
    assert.ok(typeof e.session.id === 'string' && e.session.id.length <= 128)
    assert.ok(!e.session.name || e.session.name.length <= 64)
    assert.ok(path.isAbsolute(e.cwd))
    assert.ok(KINDS.includes(e.kind), e.kind)
    if (e.message !== undefined) assert.ok(e.message.length <= 500)
    if (e.file !== undefined) assert.ok(typeof e.file === 'string' && !path.isAbsolute(e.file) && e.file.length <= 300)
    if (e.tool) assert.ok(e.tool.name.length <= 80 && (e.tool.detail ?? '').length <= 300)
    if (e.task) assert.ok(STATUS.includes(e.task.status) && e.task.id.length <= 128)
    assert.ok(Buffer.byteLength(JSON.stringify(e)) < 16 * 1024)
  }
  assert.equal(evs.filter((e) => e.kind === 'session.start').length, 4)
  assert.equal(evs.filter((e) => e.kind === 'session.stop').length, 4)
})

test('PLAN.md parses cleanly', () => {
  assert.ok(plan.tasks.length >= 24)
  assert.equal(plan.comps.length, 6)
  const ids = [...plan.comps, ...plan.tasks].map((n) => n.id)
  assert.equal(new Set(ids).size, ids.length)
  const compIds = new Set(plan.comps.map((c) => c.id))
  for (const c of plan.comps) for (const n of c.needs) assert.ok(compIds.has(n), `${c.id} needs ${n}`)
  assert.equal(plan.tasks.filter((t) => t.mark === 'x').length, 2)
  assert.equal(plan.tasks.filter((t) => t.mark === '!').length, 1)
  assert.deepEqual([...new Set(plan.tasks.map((t) => t.by))].sort(), [...AGENTS].sort())
  assert.ok(plan.tasks.every((t) => t.comp))
})

test('no username path or secret-looking string', () => {
  const blob = text + JSON.stringify(buildTimeline(plan, 36))
  const user = FAKE_USER
  assert.ok(!blob.includes(user))
  assert.ok(!/\/Users\/|\/home\//.test(blob))
  assert.ok(!/(sk-|ghp_|xox[bp]-|AKIA)[A-Za-z0-9]{8,}/.test(blob))
  assert.ok(!/[A-Za-z0-9+/=_-]{40,}/.test(blob))
})

test('plan edit round trip ends with all tasks done', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-test-'))
  const file = path.join(dir, 'PLAN.md')
  fs.writeFileSync(file, text)
  let cur = text
  for (const s of buildTimeline(plan, 36, DEFAULT_DIR)) if (s.edit) cur = applyEdit(cur, s.edit)
  fs.writeFileSync(file, cur)
  const after = parsePlan(fs.readFileSync(file, 'utf8'))
  assert.equal(after.tasks.length, plan.tasks.length)
  assert.ok(after.tasks.every((t) => t.mark === 'x'))
  assert.ok(after.tasks.some((t) => t.by !== plan.tasks.find((p) => p.id === t.id).by))
})

test('checkDir rejects relative and home paths', () => {
  assert.throws(() => checkDir('relative/dir', FAKE_USER))
  assert.throws(() => checkDir(path.join(os.homedir(), 'demo'), FAKE_USER))
  assert.doesNotThrow(() => checkDir(DEFAULT_DIR, FAKE_USER))
})

test('checkDir refuses a username path segment but accepts a substring', () => {
  assert.throws(() => checkDir('/tmp/fixture-user/demo', FAKE_USER), /username/)
  assert.throws(() => checkDir('/tmp/Fixture-User', FAKE_USER), /username/)
  assert.doesNotThrow(() => checkDir('/tmp/my-fixture-user-demo', FAKE_USER))
})
