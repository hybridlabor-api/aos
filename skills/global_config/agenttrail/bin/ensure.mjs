// `aos-trail --ensure`: start the repo's map if a plan with {#id} markers exists, open it at most once per session.
// Never throws, never reads stdin; the caller always exits 0.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cp from 'node:child_process'
import crypto from 'node:crypto'
import { norm, probePorts, gitRoots, listWorktrees, selectPlan, PROTOCOL, HUB_PORT, HUB_PROTOCOL, hubUrl } from './repoid.mjs'
import { buildEvent } from '../lib/events.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const MARKER = /^##\s+.+?\s*\{#[a-z0-9][a-z0-9-]*\}\s*$/im

// The hub is asked by name on one port. A hub already running is reused.
async function probeHub(port = HUB_PORT) {
  try {
    const w = await fetch(`${hubUrl(port)}/whoami`, { signal: AbortSignal.timeout(300) }).then(r => r.json())
    return w && w.name === 'agenttrail-hub' && Number(w.protocol) >= HUB_PROTOCOL ? { port: w.port || port } : null
  } catch { return null }
}

// Registering a repo goes through /v1/events on purpose: that endpoint needs no
// secret, and it is the same path a harness uses, so there is nothing to protect here.
async function registerWithHub(port, root, plan) {
  const event = buildEvent({ kind: 'note', cwd: root, message: `registered by --ensure${plan ? `: ${plan}` : ''}` }, { cwd: root, env: process.env })
  try {
    const r = await fetch(`${hubUrl(port)}/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(1000),
    })
    return r.ok
  } catch { return false }
}

const hubBinary = () => fileURLToPath(new URL('./trail-hub.mjs', import.meta.url))

function startHub(port) {
  const c = cp.spawn(process.execPath, [hubBinary(), '--port', String(port)], { detached: true, windowsHide: true, stdio: 'ignore' })
  c.on('error', () => {})
  c.unref()
}

// every daemon in the legacy range that serves this repo (identity = main checkout) or a worktree
async function scan(root, wts) {
  const hits = await Promise.all(probePorts().map(port =>
    fetch(`http://127.0.0.1:${port}/whoami`, { signal: AbortSignal.timeout(300) }).then(r => r.json())
      .then(w => (w && typeof w.repoPath === 'string') ? { port, repo: norm(w.repoPath), protocol: Number(w.protocol) || 0 } : null).catch(() => null)))
  const mine = hits.filter(d => d && (d.repo === root || wts.has(d.repo)))
  return { old: mine.filter(d => d.protocol < HUB_PROTOCOL) }
}

const lockFile = root => path.join(os.tmpdir(), 'aos-trail-ensure', `${crypto.createHash('sha1').update(root).digest('hex').slice(0, 16)}.lock`)
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
function takeLock(f) {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(f, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' }); return true } catch (e) { if (e.code !== 'EEXIST') return false }
    let l = {}
    try { l = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
    let at = l.at
    if (!at) try { at = fs.statSync(f).mtimeMs } catch { continue } // being written right now: judge by age, not content
    if (Date.now() - at < 15000 && (l.pid === undefined || alive(l.pid))) return false
    try { fs.unlinkSync(f) } catch {}
  }
  return false
}

// asks an older daemon to quit through its own API; false when it keeps running
async function retire(d) {
  try {
    const r = await fetch(`http://127.0.0.1:${d.port}/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repoPath: d.repo }), signal: AbortSignal.timeout(800) })
    if (!r.ok) return false
  } catch { return false }
  for (let i = 0; i < 10; i++) {
    await sleep(100)
    if (!(await fetch(`http://127.0.0.1:${d.port}/whoami`, { signal: AbortSignal.timeout(200) }).then(() => true).catch(() => false))) return true
  }
  return false
}

function startMap(root, plan, script) {
  const args = [script, root, '--plan', plan, '--no-open']
  if (process.env.AOS_TRAIL_PORTS) args.push('--port', String(probePorts()[0]))
  const c = cp.spawn(process.execPath, args, { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' })
  c.on('error', () => {})
  c.unref()
}

function mayOpen() {
  const e = process.env
  if (e.CI || e.SSH_CONNECTION || e.SSH_TTY) return false
  if (process.platform === 'linux' && !e.DISPLAY && !e.WAYLAND_DISPLAY) return false
  return true
}

function openUrl(url) {
  let cmd, args
  if (process.env.AO_BROWSER_CAPABILITY) [cmd, args] = ['ao', ['preview', url]]
  else if (process.env.AOS_TRAIL_OPENER) [cmd, args] = [process.env.AOS_TRAIL_OPENER, [url]]
  else if (process.platform === 'darwin') [cmd, args] = ['open', [url]]
  else if (process.platform === 'win32') [cmd, args] = ['cmd', ['/c', 'start', '', url]]
  else [cmd, args] = ['xdg-open', [url]]
  try {
    const c = cp.spawn(cmd, args, { detached: true, windowsHide: true, stdio: 'ignore' })
    c.on('error', () => {})
    c.unref()
  } catch {}
}

function stateFile(root, session) {
  const key = (session || process.env.CLAUDE_SESSION_ID || process.env.CODEX_SESSION_ID || `repo-${crypto.createHash('sha1').update(root).digest('hex').slice(0, 16)}`)
  const safe = String(key).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  return path.join(os.tmpdir(), 'aos-trail-ensure', `${safe}.json`)
}

export async function ensure({ cwd, plan: planArg, session, json, script }) {
  const out = { url: null, started: false, opened: false, reason: null, plan: null, hint: null }
  try {
    const g = gitRoots(path.resolve(cwd || process.cwd()))
    const top = norm(g.top)
    const root = norm(g.main)
    let sel = selectPlan(top, planArg)
    if (sel.reason === 'no-plan' && top !== root) sel = selectPlan(root, planArg)
    if (sel.reason) { out.reason = sel.reason; out.hint = sel.hint || null }
    else {
      out.plan = sel.plan
      if (!MARKER.test(fs.readFileSync(sel.plan, 'utf8'))) out.reason = 'no-markers'
    }
    if (!out.reason) {
      const wts = new Set(listWorktrees(root, Infinity).map(w => w.path))
      let hub = await probeHub()
      if (!hub) {
        const lock = lockFile(root)
        if (takeLock(lock)) {
          try {
            hub = await probeHub()
            if (!hub) {
              startHub(HUB_PORT)
              out.started = true
              for (let i = 0; i < 25 && !hub; i++) { await sleep(100); hub = await probeHub() }
            }
          } finally { try { fs.unlinkSync(lock) } catch {} }
        } else {
          for (let i = 0; i < 40 && !hub; i++) { await sleep(100); hub = await probeHub() }
        }
      }
      // Retire the per-repo daemons this hub replaces. A daemon that refuses is
      // reported and left running — nothing is ever killed by pid.
      const { old } = await scan(root, wts)
      if (hub && old.length) {
        const stuck = []
        for (const d of old) if (!(await retire(d))) stuck.push(`:${d.port} (${d.repo})`)
        if (stuck.length) out.hint = `older agenttrail daemon still running on ${stuck.join(', ')}; the hub is on :${hub.port}. Stop the old one yourself (its process listens on that port) — both keep running until then.`
      }
      if (!hub) out.reason = 'error: hub did not start in time'
      else {
        const port = hub.port
        out.url = `http://127.0.0.1:${port}`
        if (!(await registerWithHub(port, root, out.plan)) && !out.hint) out.hint = `hub is on :${port}, but registering ${root} did not answer — any hook event from this repo will register it.`
        const sf = stateFile(root, session)
        if (mayOpen() && !fs.existsSync(sf)) {
          try { fs.mkdirSync(path.dirname(sf), { recursive: true }); fs.writeFileSync(sf, JSON.stringify({ url: out.url, at: Date.now() })) } catch {}
          openUrl(out.url)
          out.opened = true
        }
      }
    }
  } catch (e) {
    out.reason = `error: ${String(e && e.message || e).slice(0, 80)}`
  }
  console.log(json ? JSON.stringify(out) : `agenttrail: ${out.url || out.hint || out.reason}${out.url && out.hint ? `\n${out.hint}` : ''}`)
}
