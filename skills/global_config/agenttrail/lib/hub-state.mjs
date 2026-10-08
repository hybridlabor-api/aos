// Hub state under ~/.aos/trail (0700). Every write is tmp + rename, so a crash
// mid-write can never leave a half-written registry behind.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const STATE_DIR = () => process.env.AOS_TRAIL_STATE_DIR || path.join(os.homedir(), '.aos', 'trail')

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function loadRepos(dir = STATE_DIR()) {
  const v = readJson(path.join(dir, 'repos.json'), [])
  return Array.isArray(v) ? v.filter((r) => r && typeof r.root === 'string') : []
}

export function saveRepos(repos, dir = STATE_DIR()) {
  writeAtomic(path.join(dir, 'repos.json'), repos)
}

export function registerRepo(root, { planHint = null, dir = STATE_DIR() } = {}) {
  const repos = loadRepos(dir)
  const norm = path.resolve(root)
  const i = repos.findIndex((r) => r.root === norm)
  if (i >= 0) {
    repos[i] = { ...repos[i], planHint: planHint ?? repos[i].planHint ?? null }
  } else {
    repos.push({ root: norm, planHint: planHint ?? null, addedAt: new Date().toISOString() })
  }
  saveRepos(repos, dir)
  return repos
}

export function loadState(dir = STATE_DIR()) {
  const v = readJson(path.join(dir, 'state.json'), {})
  return { pinned: Array.isArray(v.pinned) ? v.pinned : [], unarchived: Array.isArray(v.unarchived) ? v.unarchived : [] }
}

export function saveState(state, dir = STATE_DIR()) {
  writeAtomic(path.join(dir, 'state.json'), { pinned: state.pinned || [], unarchived: state.unarchived || [] })
}

export function setPinned(planKey, pinned, dir = STATE_DIR()) {
  const state = loadState(dir)
  const set = new Set(state.pinned)
  if (pinned) set.add(planKey)
  else set.delete(planKey)
  saveState({ ...state, pinned: [...set] }, dir)
  return loadState(dir)
}

export function loadArchive(dir = STATE_DIR()) {
  const v = readJson(path.join(dir, 'archive.json'), [])
  return Array.isArray(v) ? v : []
}

export function saveArchive(entries, dir = STATE_DIR()) {
  writeAtomic(path.join(dir, 'archive.json'), entries)
}