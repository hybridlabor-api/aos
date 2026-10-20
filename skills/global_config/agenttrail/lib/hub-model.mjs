// Builds the one model the UI renders: repos -> worktrees -> plans, plus sessions,
// the gate panel and the waiting list. Pure with respect to everything it observes:
// it reads files and git, and never writes to a repo, a plan file or the gate store.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parsePlan } from './plan.mjs'
import { repoIdOf, fingerprint, planKey, groupInstances, ownerOf, classifyInstances } from './identity.mjs'
import { lifecycle, stalledTasks, branchState, defaultBranchOf, CONFIG_DEFAULTS } from './stale.mjs'
import { waitingList } from './sessions.mjs'
import { listWorktrees, selectPlan } from '../bin/repoid.mjs'

// Card layout helpers. Pure and exported so the hub tests can table-drive them
// without a browser: which entries a collapsed card shows, how many columns a
// card's list wraps into, and how the whole board spreads its cards.

// Collapsed by default: only the entries that need attention stay visible —
// active, blocked, and the next pending entry (the next one due to be worked).
export function visibleEntries(entries) {
  const list = Array.isArray(entries) ? entries : []
  const shown = list.filter((e) => e.status === 'active' || e.status === 'blocked')
  const nextDue = list.find((e) => !e.status || e.status === 'pending')
  if (nextDue && !shown.includes(nextDue)) shown.push(nextDue)
  return shown
}

// From 6 visible entries a card's list wraps into 2-3 columns.
export function entryColumns(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (n < 6) return 1
  if (n <= 12) return 2
  return 3
}

// The whole board must end up wider than tall: a near-square grid of cards,
// several rows instead of one long column, clamped to keep cards readable.
export function gridColumns(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (n <= 1) return 1
  return Math.min(5, Math.max(2, Math.ceil(Math.sqrt(n))))
}

// Row-major placement — index i sits at (row, col) in a c-column grid.
export function gridPlace(index, cols) {
  const c = Math.max(1, Math.floor(Number(cols) || 1))
  const i = Math.max(0, Math.floor(Number(index) || 0))
  return { row: Math.floor(i / c), col: i % c }
}

const statSafe = (p) => { try { return fs.statSync(p) } catch { return null } }
const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }

const git = (repo, args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 2000, windowsHide: true })

// Git facts change on commits and branch moves, not per event. The hub passes a
// ttlMemo so a rebuild reuses them; without one every lookup runs fresh.
export const freshMemo = (_key, fn) => fn()

export function ttlMemo(now = () => Date.now()) {
  const store = new Map()
  return (key, fn, ttlMs) => {
    const hit = store.get(key)
    if (hit && now() - hit.at < ttlMs) return hit.value
    if (store.size > 5000) store.clear()
    const value = fn()
    store.set(key, { at: now(), value })
    return value
  }
}

function lastCommitAt(repo, planRel, branch) {
  if (!planRel) return null
  const r = git(repo, ['log', '-1', '--format=%ct', ...(branch ? [branch] : []), '--', planRel])
  const ts = Number((r.stdout || '').trim())
  return Number.isFinite(ts) && ts > 0 ? ts * 1000 : null
}

const TTL = { worktrees: 5000, defaultBranch: 60000, branch: 10000, commit: 10000 }

const taskStatusSet = (plan) => new Set(plan.nodes.filter((n) => n.level === 'task').map((n) => `${n.id}:${n.status}`))

function differingTasks(a, b) {
  const A = taskStatusSet(a.plan)
  const B = taskStatusSet(b.plan)
  let n = 0
  for (const v of A) if (!B.has(v)) n += 1
  return n
}

// Does this checkout have plan-relevant work of its own, or is it only a mirror?
function activityFor(instances, sessionTable) {
  const activity = {}
  for (const inst of instances) {
    const mine = statSafe(inst.planPath)
    const ownerMtime = statSafe(instances.find((i) => i.isMain)?.planPath || inst.planPath)?.mtimeMs || 0
    const sessions = sessionTable.all().filter((s) => s.cwd && inst.path && (s.cwd === inst.path || s.cwd.startsWith(inst.path + path.sep)))
    const lastSession = sessions.reduce((max, s) => Math.max(max, s.lastEventAt || 0), 0)
    const own = (mine ? mine.mtimeMs > ownerMtime + 1 : false) || sessions.some((s) => s.state === 'working' || s.currentTask)
    activity[inst.path] = { at: Math.max(mine ? mine.mtimeMs : 0, lastSession), own }
  }
  return activity
}

// A session's task.update names a plan node by id and points at its plan file.
// Only the plan it names counts, so the same id in another plan stays untouched.
// Alongside one live marker per task, the sessions reporting on that node become
// the worker card: name, harness, state, last file written and seconds since.
function liveTasksFor(primary, sessions, now, cfg) {
  const live = new Map()
  const workers = new Map()
  for (const s of sessions) {
    const task = s.currentTask
    if (!task || !task.id || !task.plan || s.done) continue
    if (now - (s.lastEventAt || 0) >= cfg.liveMs) continue
    if (path.resolve(primary.path, task.plan) !== primary.planPath) continue
    live.set(task.id, { status: task.status, harness: s.harness || '', name: s.name || '', at: new Date(s.lastEventAt || 0).toISOString() })
    if (!workers.has(task.id)) workers.set(task.id, [])
    workers.get(task.id).push({
      id: s.id,
      name: s.name || '',
      harness: s.harness || '',
      model: s.model || '',
      state: s.state || 'working',
      lastFile: s.lastFile || '',
      lastFileAt: new Date(s.lastFileAt || 0).toISOString(),
      writeAge: s.lastFileAt ? Math.max(0, now - s.lastFileAt) : null,
      age: Math.max(0, now - (s.lastEventAt || 0)),
    })
  }
  return { live, workers }
}

// A node a session released (Stop or SessionEnd) stays visible as touched, never done.
function touchedFor(primary, sessions) {
  const touched = new Map()
  for (const s of sessions) {
    for (const t of s.touched || []) {
      if (!t.plan || path.resolve(primary.path, t.plan) !== primary.planPath) continue
      const at = new Date(t.at || 0).toISOString()
      if (!touched.has(t.id) || touched.get(t.id) < at) touched.set(t.id, at)
    }
  }
  return touched
}

export function buildModel({
  now = Date.now(), port, sessionTable, gate = null, asks = [], repos = [], pinnedKeys = [], cfg = CONFIG_DEFAULTS,
  memo = freshMemo,
} = {}) {
  const sessions = sessionTable.all()
  const outRepos = []
  const archive = []

  for (const entry of repos) {
    const stat = statSafe(entry.root)
    if (!stat || !stat.isDirectory()) continue
    const repoId = memo(`id|${entry.root}`, () => repoIdOf(entry.root), TTL.defaultBranch)
    const worktrees = memo(`wt|${repoId}`, () => listWorktrees(repoId, 24), TTL.worktrees)
    // One git call per repo for the default branch, then reuse it for every plan:
    // branchState spawns 2-3 processes, and a model build runs once per request.
    const defBranch = memo(`def|${repoId}`, () => defaultBranchOf(repoId), TTL.defaultBranch)
    const bsCache = new Map()

    const instances = []
    for (const wt of worktrees) {
      const isMain = wt.path === repoId
      const chosen = selectPlan(wt.path, entry.planHint || undefined)
      const planPath = chosen.plan || null
      const text = planPath ? readSafe(planPath) : ''
      const plan = parsePlan(text)
      const planRel = planPath ? path.relative(wt.path, planPath) : null
      instances.push({
        path: wt.path,
        branch: wt.branch,
        isMain,
        repoId,
        planPath,
        planRel,
        text,
        plan,
        fingerprint: fingerprint(plan),
        planKey: planPath ? planKey(repoId, planRel, fingerprint(plan)) : null,
      })
    }
    if (!instances.length) continue

    const groups = groupInstances(instances)
    const activity = activityFor(instances, sessionTable)

    const plans = []
    for (const group of groups) {
      const owner = ownerOf(group, activity)
      const { mirrors, divergent } = classifyInstances(group.instances, owner, activity)
      const primary = owner || group.instances[0]
      const plan = primary.plan
      const components = plan.nodes.filter((n) => n.level === 'component')
      const tasks = plan.nodes.filter((n) => n.level === 'task')

      const mtime = statSafe(primary.planPath)?.mtimeMs || 0
      const commitAt = memo(`commit|${repoId}|${primary.planRel}|${primary.branch}`, () => lastCommitAt(repoId, primary.planRel, primary.branch), TTL.commit) || 0
      const inPrimary = sessions.filter((s) => s.cwd && primary.path && (s.cwd === primary.path || s.cwd.startsWith(primary.path + path.sep)))
      const lastActivity = Math.max(mtime, commitAt, inPrimary.reduce((max, s) => Math.max(max, s.lastEventAt || 0), 0))

      const runs = new Map()
      for (const s of inPrimary) if (s.harness) runs.set(s.harness, { lastEventAt: s.lastEventAt || 0, ended: !!(s.ended && s.done) })
      const stalled = stalledTasks(tasks, runs, now, cfg)

      const bs = primary.branch && primary.branch !== '(detached)'
        ? (bsCache.has(primary.branch) ? bsCache.get(primary.branch) : bsCache.set(primary.branch, memo(`branch|${repoId}|${primary.branch}`, () => branchState(repoId, primary.branch, { defaultBranch: defBranch }), TTL.branch)).get(primary.branch))
        : 'open'
      const { live: liveTasks, workers } = liveTasksFor(primary, sessions, now, cfg)
      const touchedTasks = touchedFor(primary, sessions)
      const pinned = pinnedKeys.includes(group.planKey)
      // "live" means still reporting and not finished. A session that ended cannot keep a
// merged branch on the main view; one that stopped and is waiting for Tim can.
const live = inPrimary.some((s) => now - (s.lastEventAt || 0) < cfg.liveMs && !s.done)
      const life = primary.planPath
        ? lifecycle({ now, lastActivity, liveSession: live, branchState: bs, pinned, cfg })
        : 'archived'

      const planEntry = {
        planKey: group.planKey,
        name: plan.title || path.basename(primary.planPath || ''),
        path: primary.planPath,
        lifecycle: life,
        pinned,
        owner: { path: primary.path, branch: primary.branch },
        mirrors: mirrors.map((m) => ({ path: m.path, branch: m.branch })),
        divergent: divergent.map((m) => ({ path: m.path, branch: m.branch, tasks: differingTasks(m, primary) })),
        components: components.map((c) => ({ id: c.id, title: c.title, status: c.status, files: c.files, needs: c.needs, links: c.links, tech: c.tech })),
        tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, parent: t.parent, live: liveTasks.get(t.id) || null, workers: workers.get(t.id) || [], touchedAt: touchedTasks.get(t.id) || null })),
        progress: { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length, stalled: stalled.size, live: tasks.filter((t) => liveTasks.has(t.id)).length },
        lastActivity: new Date(lastActivity).toISOString(),
      }

      if (life === 'archived' && !pinned) archive.push({ repoId, repoRoot: repoId, ...planEntry })
      else plans.push(planEntry)
    }

    outRepos.push({
      id: repoId,
      root: repoId,
      worktrees: worktrees.map((w) => ({ path: w.path, branch: w.branch })),
      plans,
    })
  }

  const flatPlans = outRepos.flatMap((r) => r.plans.map((p) => ({ repoId: r.id, repoRoot: r.root, ...p })))
  const gatePanel = gate || { available: false, blocks: [], requests: [], grants: [], modes: [], rejected: [] }

  return {
    now: new Date(now).toISOString(),
    port,
    waiting: waitingList({ sessions, gate: gatePanel, asks, plans: flatPlans }, { now }),
    sessions: sessions.map((s) => ({
      id: s.id,
      harnesses: s.harnesses,
      harness: s.harness,
      name: s.name,
      cwd: s.cwd,
      state: s.state,
      currentTool: s.currentTool,
      currentTask: s.currentTask,
      lastFile: s.lastFile,
      waiting: s.waiting,
      done: s.done,
      ended: s.ended,
      lastEventAt: new Date(s.lastEventAt || 0).toISOString(),
      age: Math.max(0, now - (s.lastEventAt || 0)),
      fromRegistry: !!s.fromRegistry,
    })),
    repos: outRepos,
    archive,
    gate: gatePanel,
  }
}