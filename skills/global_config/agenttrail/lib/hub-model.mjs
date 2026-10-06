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

const statSafe = (p) => { try { return fs.statSync(p) } catch { return null } }
const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }

const git = (repo, args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 2000 })

function lastCommitAt(repo, planRel, branch) {
  if (!planRel) return null
  const r = git(repo, ['log', '-1', '--format=%ct', ...(branch ? [branch] : []), '--', planRel])
  const ts = Number((r.stdout || '').trim())
  return Number.isFinite(ts) && ts > 0 ? ts * 1000 : null
}

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
    const sessions = sessionTable.all().filter((s) => s.cwd && inst.path && (s.cwd === inst.path || s.cwd.startsWith(`${inst.path}/`)))
    const lastSession = sessions.reduce((max, s) => Math.max(max, s.lastEventAt || 0), 0)
    const own = (mine ? mine.mtimeMs > ownerMtime + 1 : false) || sessions.some((s) => s.state === 'working' || s.currentTask)
    activity[inst.path] = { at: Math.max(mine ? mine.mtimeMs : 0, lastSession), own }
  }
  return activity
}

export function buildModel({
  now = Date.now(), port, sessionTable, gate = null, asks = [], repos = [], pinnedKeys = [], cfg = CONFIG_DEFAULTS,
} = {}) {
  const sessions = sessionTable.all()
  const outRepos = []
  const archive = []

  for (const entry of repos) {
    const stat = statSafe(entry.root)
    if (!stat || !stat.isDirectory()) continue
    const repoId = repoIdOf(entry.root)
    const worktrees = listWorktrees(repoId, 24)
    // One git call per repo for the default branch, then reuse it for every plan:
    // branchState spawns 2-3 processes, and a model build runs once per request.
    const defBranch = defaultBranchOf(repoId)
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
      const commitAt = lastCommitAt(repoId, primary.planRel, primary.branch) || 0
      const inPrimary = sessions.filter((s) => s.cwd && primary.path && (s.cwd === primary.path || s.cwd.startsWith(`${primary.path}/`)))
      const lastActivity = Math.max(mtime, commitAt, inPrimary.reduce((max, s) => Math.max(max, s.lastEventAt || 0), 0))

      const runs = new Map()
      for (const s of inPrimary) if (s.harness) runs.set(s.harness, { lastEventAt: s.lastEventAt || 0, ended: !!(s.ended && s.done) })
      const stalled = stalledTasks(tasks, runs, now, cfg)

      const bs = primary.branch && primary.branch !== '(detached)'
        ? (bsCache.has(primary.branch) ? bsCache.get(primary.branch) : bsCache.set(primary.branch, branchState(repoId, primary.branch, { defaultBranch: defBranch })).get(primary.branch))
        : 'open'
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
        components: components.map((c) => ({ id: c.id, title: c.title, status: c.status, files: c.files })),
        progress: { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length, stalled: stalled.size },
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