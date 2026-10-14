// Plan lifecycle: how long a plan stays on the main view, and when a task counts as stalled.
// Thresholds come from ~/.aos/trail/config.json and fall back to these defaults.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const MIN = 60 * 1000
const HOUR = 60 * MIN

export const CONFIG_DEFAULTS = Object.freeze({
  liveMs: 10 * MIN,
  activeMs: 6 * HOUR,
  idleMs: 48 * HOUR,
  stalledMs: 30 * MIN,
})

export function loadConfig(dir) {
  let raw
  try { raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf8') } catch { return { ...CONFIG_DEFAULTS } }
  try {
    const parsed = JSON.parse(raw)
    const out = { ...CONFIG_DEFAULTS }
    for (const k of Object.keys(CONFIG_DEFAULTS)) if (typeof parsed[k] === 'number' && Number.isFinite(parsed[k])) out[k] = parsed[k]
    return out
  } catch { return { ...CONFIG_DEFAULTS } }
}

export function lifecycle({ now, lastActivity, liveSession = false, branchState: bs = 'open', pinned = false, cfg = CONFIG_DEFAULTS }) {
  const age = Math.max(0, now - lastActivity)
  // Liveness is the caller's call: only a session that reported recently counts, so a
  // plan file that was just touched never outranks a merged branch.
  if (liveSession) return 'live'
  if (bs === 'merged' || bs === 'deleted') return 'archived'
  if (pinned) return age < cfg.activeMs ? 'active' : 'idle'
  if (age < cfg.activeMs) return 'active'
  if (age < cfg.idleMs) return 'idle'
  return 'archived'
}

export function stalledTasks(tasks, runs, now, cfg = CONFIG_DEFAULTS) {
  const read = runs instanceof Map ? (k) => runs.get(k) : (k) => runs[k]
  const out = new Set()
  for (const t of tasks) {
    if (!t || t.status !== 'active' || !t.by) continue
    const run = read(t.by)
    if (!run) { out.add(t.id); continue }
    if (run.ended) { out.add(t.id); continue }
    if (now - (run.lastEventAt || 0) >= cfg.stalledMs) out.add(t.id)
  }
  return out
}

const runGit = (repo, args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })

function discoverDefaultBranch(repo, run) {
  const head = run(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head.status === 0) {
    const name = head.stdout.trim().replace(/^origin\//, '')
    if (name) return name
  }
  for (const candidate of ['main', 'master']) if (run(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`]).status === 0) return candidate
  return 'main'
}

export function defaultBranchOf(repo, opts = {}) {
  const run = opts.runGit || runGit
  return discoverDefaultBranch(repo, run)
}

export function branchState(repo, branch, opts = {}) {
  const run = opts.runGit || runGit
  if (!branch) return 'deleted'
  const def = opts.defaultBranch || discoverDefaultBranch(repo, run)
  const merged = run(repo, ['branch', '--merged', def])
  if (merged.status !== 0) return 'open'
  const names = merged.stdout.split('\n').map((s) => s.replace(/^[*+ ]+/, '').trim()).filter(Boolean)
  if (names.includes(branch)) return 'merged'
  if (run(repo, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, def]).status === 0) return 'merged'
  if (run(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).status !== 0) return 'deleted'
  return 'open'
}