#!/usr/bin/env node
// memB ingest of project docs and wikis, run by the com.bdb.memb.ingest job (launchd / systemd timer) or `aos memory run`.
// Paths and schedule are per machine: settings "memoryIngest": { paths, time } (see lib/memory-import.js, `aos memory`).
// No paths = nothing happens and the script says how to add one. Does nothing when memb is excluded (profile minimal,
// --without=memb|memory) or memoryIngest is off.
// Usage: aos-memb-ingest.mjs [--dry-run]   Exit code is always 0.
import '../lib/cli-help-guard.mjs';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
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
if (excluded.has('memb')) { say('off (memb excluded).'); process.exit(0); }

const win = process.platform === 'win32';
const py = (d) => path.join(d, '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python');
const dir = [process.env.MEMB_MCP_DIR, path.join(home, '.gemini', 'config', 'mcps', 'memb-mcp'), path.join(home, '.agents', 'mcps', 'memb-mcp'), path.join(home, '.agents', 'memB')]
  .filter(Boolean).find((d) => existsSync(py(d)) && existsSync(path.join(d, 'memb_ingest.py')));
if (!dir) { say('memb_ingest.py not found; install memB (aos package install memb).'); process.exit(0); }

let mi = null;
for (const p of ['../lib/memory-import.js', path.join(home, '.agents', 'lib', 'memory-import.js')]) { try { mi = createRequire(import.meta.url)(p); break; } catch { /* next */ } }
if (!mi) { say('lib/memory-import.js not found; re-run the AOS installer.'); process.exit(0); }
const cfg = mi.read(home);
if (cfg.off) { say('off (memoryIngest is off).'); process.exit(0); }
if (!cfg.paths.length) { say(`no paths configured. ${mi.HOW_TO}`); process.exit(0); }
const projects = mi.findProjects(cfg.paths);
if (!projects.length) { say(`no projects with .openwiki or AGENTS.md under ${cfg.paths.join(', ')}.`); process.exit(0); }

for (const p of projects) {
  if (dry) { say(`would ingest ${p}`); continue; }
  const r = spawnSync(py(dir), [path.join(dir, 'memb_ingest.py'), p, '--project', path.basename(p)], { cwd: dir, stdio: 'inherit', timeout: 20 * 60 * 1000 });
  say(`${path.basename(p)}: ${r.status === 0 ? 'ok' : `exit ${r.status ?? r.signal}`}`);
}
