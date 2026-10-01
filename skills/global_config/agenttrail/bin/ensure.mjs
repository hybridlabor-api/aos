// `aos-trail --ensure`: start the repo's map if a plan with {#id} markers exists, open it at most once per session.
// Never throws, never reads stdin; the caller always exits 0.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import cp from 'node:child_process'
import crypto from 'node:crypto'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const norm = p => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
const MARKER = /^##\s+.+?\s*\{#[a-z0-9][a-z0-9-]*\}\s*$/im

// AOS_TRAIL_PORTS="lo-hi" overrides the probed range (tests); default 5330-5344 like trail-relay.mjs
function portRange() {
  const m = String(process.env.AOS_TRAIL_PORTS || '').match(/^(\d+)-(\d+)$/)
  const [lo, hi] = m ? [+m[1], +m[2]] : [5330, 5344]
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

function repoRoot(cwd) {
  const r = cp.spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 1000 })
  return r.status === 0 && r.stdout.trim() ? norm(r.stdout.trim()) : norm(cwd)
}

function selectPlan(root, explicit) {
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

async function findMap(root) {
  const hits = await Promise.all(portRange().map(p =>
    fetch(`http://127.0.0.1:${p}/whoami`, { signal: AbortSignal.timeout(300) }).then(r => r.json())
      .then(w => (w && typeof w.repoPath === 'string' && norm(w.repoPath) === root) ? p : null).catch(() => null)))
  return hits.find(Boolean) || null
}

function startMap(root, plan, script) {
  const args = [script, root, '--plan', plan, '--no-open']
  if (process.env.AOS_TRAIL_PORTS) args.push('--port', String(portRange()[0]))
  const c = cp.spawn(process.execPath, args, { cwd: root, detached: true, stdio: 'ignore' })
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
    const c = cp.spawn(cmd, args, { detached: true, stdio: 'ignore' })
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
    const root = repoRoot(path.resolve(cwd || process.cwd()))
    const sel = selectPlan(root, planArg)
    if (sel.reason) { out.reason = sel.reason; out.hint = sel.hint || null }
    else {
      out.plan = sel.plan
      if (!MARKER.test(fs.readFileSync(sel.plan, 'utf8'))) out.reason = 'no-markers'
    }
    if (!out.reason) {
      let port = await findMap(root)
      if (!port) {
        startMap(root, out.plan, script)
        out.started = true
        for (let i = 0; i < 15 && !port; i++) { await sleep(100); port = await findMap(root) }
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
  console.log(json ? JSON.stringify(out) : `agenttrail: ${out.url || out.hint || out.reason}`)
}
