// `aos-trail --ensure`: start the repo's map if a plan with {#id} markers exists, open it at most once per session.
// Never throws, never reads stdin; the caller always exits 0.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import cp from 'node:child_process'
import crypto from 'node:crypto'
import { norm, probePorts, gitRoots, selectPlan, PROTOCOL } from './repoid.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const MARKER = /^##\s+.+?\s*\{#[a-z0-9][a-z0-9-]*\}\s*$/im

// the running map of this repo (main checkout identity), if any; other repos' maps are never touched
async function findMap(root) {
  const hits = await Promise.all(probePorts().map(port =>
    fetch(`http://127.0.0.1:${port}/whoami`, { signal: AbortSignal.timeout(300) }).then(r => r.json())
      .then(w => (w && typeof w.repoPath === 'string' && norm(w.repoPath) === root && Number(w.protocol) >= PROTOCOL) ? port : null).catch(() => null)))
  return hits.find(Boolean) || null
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

function startMap(root, plan, script) {
  const args = [script, root, '--plan', plan, '--no-open']
  if (process.env.AOS_TRAIL_PORTS) args.push('--port', String(probePorts()[0]))
  const c = cp.spawn(process.execPath, args, { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' })
  c.on('error', () => {})
  c.unref()
}

function mayOpen() {
  const e = process.env
  if (e.AOS_NO_OPEN === '1') return false
  if (e.AOS_TEST_SANDBOX === '1' && !e.AOS_TRAIL_OPENER) return false
  if (e.CI || e.SSH_CONNECTION || e.SSH_TTY) return false
  if (process.platform === 'linux' && !e.DISPLAY && !e.WAYLAND_DISPLAY) return false
  return true
}

function openUrl(url) {
  if (process.env.AOS_NO_OPEN === '1') return
  let cmd, args
  if (process.env.AO_BROWSER_CAPABILITY) [cmd, args] = ['ao', ['preview', url]]
  else if (process.env.AOS_TRAIL_OPENER) [cmd, args] = [process.env.AOS_TRAIL_OPENER, [url]]
  else if (process.platform === 'darwin') [cmd, args] = fs.existsSync('/Applications/Google Chrome.app') ? ['open', ['-na', 'Google Chrome', '--args', `--app=${url}`]] : ['open', [url]]
  else if (process.platform === 'win32') [cmd, args] = ['cmd', ['/c', 'start', '', 'chrome', `--app=${url}`]]
  else [cmd, args] = ['xdg-open', [url]] // ponytail: Linux/Windows app-window is best effort; Windows needs chrome on PATH
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
      let port = await findMap(root)
      if (!port) {
        const lock = lockFile(root)
        if (takeLock(lock)) {
          try {
            port = await findMap(root)
            if (!port) {
              startMap(root, out.plan, script)
              out.started = true
              for (let i = 0; i < 40 && !port; i++) { await sleep(100); port = await findMap(root) }
            }
          } finally { try { fs.unlinkSync(lock) } catch {} }
        } else {
          for (let i = 0; i < 40 && !port; i++) { await sleep(100); port = await findMap(root) }
        }
      }
      if (!port) out.reason = 'error: map did not start in time'
      else {
        out.url = `http://127.0.0.1:${port}`
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
