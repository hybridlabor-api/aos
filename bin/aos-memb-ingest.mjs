#!/usr/bin/env node
// Nightly memB ingest of project docs and wikis, run by the com.bdb.memb.ingest job (launchd / systemd timer).
// Walks the workspace root (settings "memoryIngest.workspace", default ~/dev/bdb-dev), picks every project that has
// .openwiki or AGENTS.md (worktrees "-wt-" skipped) and runs memb_ingest.py on it; memB dedupes by content hash.
// Does nothing when memb is excluded (profile minimal, --without=memb|memory) or "memorySave"/"memoryIngest" is off.
// Usage: aos-memb-ingest.mjs [--dry-run]   Exit code is always 0 except for usage errors.
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const home = os.homedir();
const dry = process.argv.includes('--dry-run');
const say = (m) => process.stdout.write(`aos-memb-ingest: ${m}\n`);

let settings = {};
try { settings = JSON.parse(readFileSync(path.join(home, '.aos', 'v5-settings.json'), 'utf8')); } catch { /* defaults */ }
let excluded = new Set(settings.disabled || []);
try {
  const req = createRequire(import.meta.url);
  const profile = ['../lib/v5/profile.js', path.join(home, '.agents', 'lib', 'v5', 'profile.js')].map((p) => { try { return req(p); } catch { return null; } }).find(Boolean);
  if (profile) excluded = profile.excludedIds(settings);
} catch { /* fall back to the disabled list */ }
if (excluded.has('memb') || settings.memoryIngest === 'off' || (settings.memoryIngest && settings.memoryIngest.enabled === false)) { say('off (memb excluded or disabled).'); process.exit(0); }

const win = process.platform === 'win32';
const py = (d) => path.join(d, '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python');
const dir = [process.env.MEMB_MCP_DIR, path.join(home, '.gemini', 'config', 'mcps', 'memb-mcp'), path.join(home, '.agents', 'mcps', 'memb-mcp'), path.join(home, '.agents', 'memB')]
  .filter(Boolean).find((d) => existsSync(py(d)) && existsSync(path.join(d, 'memb_ingest.py')));
if (!dir) { say('memb_ingest.py not found; install memB (aos package install memb).'); process.exit(0); }

const ws = (settings.memoryIngest && settings.memoryIngest.workspace) || path.join(home, 'dev', 'bdb-dev');
const projects = existsSync(ws) ? readdirSync(ws, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.includes('-wt-'))
  .map((e) => path.join(ws, e.name))
  .filter((p) => existsSync(path.join(p, '.openwiki')) || existsSync(path.join(p, 'AGENTS.md'))) : [];
if (!projects.length) { say(`no projects with .openwiki or AGENTS.md under ${ws}.`); process.exit(0); }

for (const p of projects) {
  if (dry) { say(`would ingest ${p}`); continue; }
  const r = spawnSync(py(dir), [path.join(dir, 'memb_ingest.py'), p, '--project', path.basename(p)], { cwd: dir, stdio: 'inherit', timeout: 20 * 60 * 1000 });
  say(`${path.basename(p)}: ${r.status === 0 ? 'ok' : `exit ${r.status ?? r.signal}`}`);
}
