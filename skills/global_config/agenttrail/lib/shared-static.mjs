// Serves public/shared/* (the one map renderer) to both the classic board and the hub.
// A narrow GET-only route: resolve, stay inside the directory, 404 otherwise. No CSRF injection.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SHARED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'shared')

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

// Returns the absolute file for a /shared/<name> URL path, or null for anything else.
export function resolveShared(urlPath, dir = SHARED_DIR) {
  if (typeof urlPath !== 'string' || !urlPath.startsWith('/shared/')) return null
  let rel
  try { rel = decodeURIComponent(urlPath.slice('/shared/'.length)) } catch { return null }
  if (!rel || rel.includes('\0')) return null
  const root = path.resolve(dir)
  const file = path.resolve(root, rel)
  if (!file.startsWith(root + path.sep)) return null
  if (!TYPES[path.extname(file)]) return null
  // A symlink inside the dir must not serve a file outside it.
  try { if (!fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep)) return null } catch { return null }
  return file
}

export function serveShared(urlPath, res) {
  const file = resolveShared(urlPath)
  let data = null
  if (file) { try { data = fs.readFileSync(file) } catch { data = null } }
  if (!data) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)], 'cache-control': 'no-store' }).end(data)
}
