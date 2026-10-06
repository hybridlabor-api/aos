// Plan identity across worktrees: one repo, one plan, however many checkouts exist.
import crypto from 'node:crypto'
import path from 'node:path'
import { mainRoot, norm } from '../bin/repoid.mjs'

// The main checkout identifies the repo; a folder that is not a repo identifies itself.
export function repoIdOf(dir) {
  return norm(mainRoot(dir))
}

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')

// Only the component ids matter: task titles churn, the plan's identity does not.
export function fingerprint(plan) {
  const ids = (plan?.nodes || []).filter((n) => n.level === 'component').map((n) => n.id).sort()
  return sha1(ids.join('\n'))
}

export function planKey(repoId, planRel, fp) {
  return sha1(`${repoId}\0${planRel}\0${fp}`)
}

export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a || [])
  const B = b instanceof Set ? b : new Set(b || [])
  if (!A.size && !B.size) return 1
  let inter = 0
  for (const v of A) if (B.has(v)) inter += 1
  const union = A.size + B.size - inter
  return union ? inter / union : 0
}

const compIds = (instance) => new Set((instance.plan?.nodes || []).filter((n) => n.level === 'component').map((n) => n.id))

export function ownerOf(group, activity = {}) {
  const instances = group.instances || []
  if (!instances.length) return null
  const scored = instances.map((i) => {
    const a = activity[i.path] || {}
    return { instance: i, at: Number.isFinite(a.at) ? a.at : 0, own: !!a.own }
  })
  // Own activity outranks recency: a worktree that actually touched the plan owns it.
  const pool = scored.filter((s) => s.own)
  const candidates = (pool.length ? pool : scored).slice().sort((x, y) => {
    if (y.at !== x.at) return y.at - x.at
    return (y.instance.isMain ? 1 : 0) - (x.instance.isMain ? 1 : 0)
  })
  return candidates[0].instance
}

export function classifyInstances(instances, owner, activity = {}) {
  const mirrors = []
  const divergent = []
  for (const i of instances) {
    if (!owner || i.path === owner.path) continue
    const a = activity[i.path] || {}
    if (a.own && a.differs) divergent.push(i)
    else mirrors.push(i)
  }
  return { mirrors, divergent }
}

export function groupInstances(instances, { renameJaccard = 0.8 } = {}) {
  const groups = new Map()
  for (const inst of instances) {
    const key = inst.planKey || planKey(inst.repoId, inst.planRel, inst.fingerprint || fingerprint(inst.plan))
    inst.planKey = key
    if (!groups.has(key)) groups.set(key, { planKey: key, repoId: inst.repoId, instances: [] })
    groups.get(key).instances.push(inst)
  }

  // Rename tolerance: the same components under a different plan path are the same plan.
  // The group that already exists keeps its key so links elsewhere stay valid.
  const out = []
  for (const g of groups.values()) {
    const twin = out.find((existing) =>
      existing.repoId === g.repoId &&
      existing.instances.some((i) => i.planRel !== g.instances[0].planRel) &&
      jaccard(compIds(g.instances[0]), compIds(existing.instances[0])) >= renameJaccard
    )
    if (twin) { twin.instances.push(...g.instances); continue }
    out.push(g)
  }

  for (const g of out) {
    g.instances.sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0))
    g.owner = ownerOf(g, {})
    const { mirrors, divergent } = classifyInstances(g.instances, g.owner, {})
    g.mirrors = mirrors
    g.divergent = divergent
  }
  return out
}

export const relOf = (repoRoot, planPath) => path.relative(repoRoot, planPath)