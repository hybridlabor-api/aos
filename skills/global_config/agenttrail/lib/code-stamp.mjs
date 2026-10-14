// Newest mtime of the entry file plus every file in the given folders
// (non-recursive): "has my code changed under me" for the self-refresh check.
import fs from 'node:fs'
import path from 'node:path'

export function codeStampOf(entryFile, dirs) {
  let newest = 0
  const files = [entryFile]
  for (const d of dirs) {
    try { for (const f of fs.readdirSync(d)) files.push(path.join(d, f)) } catch { /* folder missing: entry only */ }
  }
  for (const f of files) { try { newest = Math.max(newest, fs.statSync(f).mtimeMs) } catch { /* raced with the update */ } }
  return newest
}

// Every 30 s: if the code on disk is newer than at start, restart. Supervised
// (launchd/systemd/Task Scheduler) -> exit 3, the manager starts it again.
// Otherwise re-spawn ourselves detached after closing the server (the child
// binds the same port because the old one released it).
export function watchCodeStamp({ entryFile, dirs, stamp, server, log = (m) => console.error(m) }) {
  let restarting = false
  const restart = async () => {
    restarting = true
    if (process.env.AOS_SUPERVISED === '1') {
      log('agenttrail: its code changed on disk; exiting so the service manager restarts it on the new code')
      process.exit(3)
    }
    log('agenttrail: its code changed on disk; restarting on the new code')
    // Open live-monitor streams keep close() pending forever: drop them, and give up waiting after 2 s.
    const s = typeof server === 'function' ? server() : server
    if (s) {
      s.closeAllConnections?.()
      await Promise.race([new Promise((ok) => s.close(ok)), new Promise((ok) => setTimeout(ok, 2000))])
    }
    const cp = await import('node:child_process')
    cp.spawn(process.execPath, process.argv.slice(1), { cwd: process.cwd(), env: process.env, detached: true, stdio: 'ignore', windowsHide: true }).unref()
    process.exit(0)
  }
  const timer = setInterval(() => { if (!restarting && codeStampOf(entryFile, dirs) > stamp) restart() }, 30000)
  timer.unref()
  return timer
}
