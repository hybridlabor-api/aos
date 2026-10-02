// Repo identity shared by the daemon and `--ensure`: every worktree of a git repo resolves to its main checkout.
import fs from 'node:fs'
import path from 'node:path'
import cp from 'node:child_process'

export const norm = p => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }

// AOS_TRAIL_PORTS="lo-hi" overrides the probed range (tests); default 5330-5344 like trail-relay.mjs
export function probePorts() {
  const m = String(process.env.AOS_TRAIL_PORTS || '').match(/^(\d+)-(\d+)$/)
  const [lo, hi] = m ? [+m[1], +m[2]] : [5330, 5344]
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

// top = this checkout's working tree, main = the repo's main working tree (same as top outside linked worktrees).
// Bare repos, separate git dirs and submodules have no `<main>/.git` parent, so they keep today's top-level identity.
export function gitRoots(dir) {
  const d = norm(dir)
  const r = cp.spawnSync('git', ['rev-parse', '--show-toplevel', '--git-common-dir'], { cwd: d, encoding: 'utf8', timeout: 1000 })
  const [top, common] = r.status === 0 ? r.stdout.trim().split('\n') : []
  if (!top) return { top: path.resolve(dir), main: path.resolve(dir) } // non-git folders keep the path they were given
  const t = norm(top)
  const c = norm(path.resolve(d, common || ''))
  return { top: t, main: common && path.basename(c) === '.git' ? path.dirname(c) : t }
}

export const mainRoot = dir => gitRoots(dir).main

// Main checkout first, then linked worktrees that still exist, at most `cap` entries.
export function listWorktrees(main, cap = 12) {
  const only = [{ path: main, branch: null }]
  const r = cp.spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: main, encoding: 'utf8', timeout: 2000 })
  if (r.status !== 0) return only
  const out = []
  for (const block of r.stdout.split(/\n\s*\n/)) {
    const wt = { path: null, branch: null, skip: false }
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) wt.path = line.slice(9)
      else if (line.startsWith('branch ')) wt.branch = line.slice(7).replace(/^refs\/heads\//, '')
      else if (line === 'detached') wt.branch = '(detached)'
      else if (line === 'bare' || line.startsWith('prunable')) wt.skip = true
    }
    if (!wt.path || wt.skip || !fs.existsSync(wt.path)) continue
    out.push({ path: norm(wt.path), branch: wt.branch })
  }
  const first = out.find(w => w.path === main) || only[0]
  return [first, ...out.filter(w => w !== first && w.path !== main)].slice(0, cap)
}

export function selectPlan(root, explicit) {
  if (explicit) {
    const f = path.resolve(root, explicit)
    return fs.existsSync(f) ? { plan: f } : { reason: 'no-plan' }
  }
  const pa = path.join(root, 'production_artifacts')
  const top = path.join(pa, '00_execution_plan.md')
  if (fs.existsSync(top)) return { plan: top }
  let subs = []
  try {
    subs = fs.readdirSync(pa, { withFileTypes: true }).filter(d => d.isDirectory())
      .map(d => path.join(pa, d.name, '00_execution_plan.md')).filter(f => fs.existsSync(f)).sort()
  } catch {}
  // .agents/graph.md defines no plan path beyond production_artifacts/00_execution_plan.md, so nothing extra is accepted
  if (subs.length === 1) return { plan: subs[0] }
  if (subs.length > 1) return { reason: 'several-plans', hint: `several plans, pass --plan: ${subs.map(f => path.relative(root, f)).join(', ')}` }
  return { reason: 'no-plan' }
}
