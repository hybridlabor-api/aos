#!/usr/bin/env node
// aos-hook-version: 1
/**
 * memB auto-save at session end (Claude SessionEnd, agy Stop).
 * Condenses the transcript into one short memory (task, outcome) and hands it to
 * memb-mcp's add_memory (infer=False: no LLM, no key needed) in a detached child, so
 * the session never waits for the embedder. Fails open: any problem exits 0 silently.
 *
 * Skips: switches (AOS_MEMB_AUTOSAVE=off, AOS_SESSION_START_CONTEXT=off, AOS_DELEGATE_DEPTH>0,
 * ~/.aos/v5-settings.json "memorySave":"off"), sessions under MIN_TURNS user turns or without
 * a substantial last answer, and sessions already saved (stamp per session id).
 * Secrets: env-like lines are dropped and token shapes redacted; memb-mcp filters again.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, realpathSync, fstatSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_TURNS = 4;
const MIN_OUTCOME_CHARS = 200;
const TASK_CHARS = 240;
const OUTCOME_CHARS = 900;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

const ENV_LINE = /^\s*(export\s+)?[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/;
const TOKEN = /\b(ghp_|gho_|ghu_|ghs_|github_pat_|sk-|AIza|xox[abp]-|glpat-|nvapi-)[A-Za-z0-9_\-]{12,}|\bBearer\s+[A-Za-z0-9._\-]{16,}|\b[A-Za-z0-9+/_-]{40,}={0,2}(?=\s|$)/g;

export function scrub(text) {
  return String(text || '')
    .split('\n').filter((l) => !ENV_LINE.test(l)).join('\n')
    .replace(TOKEN, '[redacted]');
}

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n') : '');

// Claude transcript JSONL: {type:'user'|'assistant', message:{content}, isMeta?, isSidechain?}.
export function summarize(jsonl) {
  let turns = 0; let task = ''; let outcome = '';
  for (const line of String(jsonl).split('\n')) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.isSidechain || o.isMeta) continue;
    const text = textOf(o.message?.content).trim();
    if (!text || text.startsWith('<')) continue; // system reminders, command echoes
    if (o.type === 'user') { turns++; if (!task) task = text; } else if (o.type === 'assistant') outcome = text;
  }
  if (turns < MIN_TURNS || outcome.length < MIN_OUTCOME_CHARS) return null;
  const clip = (s, n) => scrub(s).replace(/\s+/g, ' ').trim().slice(0, n);
  return `Session summary. Task: ${clip(task, TASK_CHARS)} Outcome: ${clip(outcome, OUTCOME_CHARS)}`;
}

export function disabled(env = process.env, home = os.homedir()) {
  if (env.AOS_MEMB_AUTOSAVE === 'off' || env.AOS_SESSION_START_CONTEXT === 'off' || Number(env.AOS_DELEGATE_DEPTH || 0) > 0) return true;
  try { return JSON.parse(readFileSync(path.join(home, '.aos', 'v5-settings.json'), 'utf8')).memorySave === 'off'; } catch { return false; }
}

export function membMcpDir(home = os.homedir(), env = process.env) {
  const win = process.platform === 'win32';
  const py = (d) => path.join(d, '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python');
  const dirs = [env.MEMB_MCP_DIR, path.join(home, '.gemini', 'config', 'mcps', 'memb-mcp'), path.join(home, '.agents', 'mcps', 'memb-mcp'), path.join(home, '.agents', 'memB')].filter(Boolean);
  const dir = dirs.find((d) => existsSync(py(d)) && existsSync(path.join(d, 'run.py')));
  return dir ? { dir, python: py(dir) } : null;
}

// true the first time a session id is seen. Stamps under ~/.aos/cache are disposable.
export function firstTime(sessionId, base = path.join(os.homedir(), '.aos', 'cache', 'memb-save')) {
  const id = String(sessionId || '').replace(/[^\w.-]/g, '_').slice(0, 80);
  if (!id) return false;
  const stamp = path.join(base, id);
  if (existsSync(stamp)) return false;
  try { mkdirSync(base, { recursive: true }); writeFileSync(stamp, ''); } catch { return false; }
  return true;
}

const PY = 'import sys,json\nd=json.load(sys.stdin)\nimport run\nrun.add_memory(d["text"],project_id=d["project"],category="task_learnings",infer=False,source="session-end",harness=d["harness"],session=d["session"])\n';

// Bounded stdin read, same as rules-inject.mjs readStdinBounded: an open stdin pipe (Codex on Windows) must not hang
// the hook. Stops on end, first complete JSON, byte cap or timeout; null = nothing read before a timeout or an error.
function readStdinBounded(maxMs, maxBytes = 64 << 20) {
  // A regular file or directory never blocks: read it at once. A read error (EISDIR, closed fd) is null, which go-gate denies.
  let st;
  try { st = fstatSync(0); } catch { return Promise.resolve(null); }
  if (st.isFile() || st.isDirectory()) { try { return Promise.resolve(readFileSync(0, "utf8")); } catch { return Promise.resolve(null); } }
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let buf = "";
    let settled = false;
    const finish = (incomplete) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      // pause() alone keeps an open pipe ref'd: a hook that ends without process.exit (a2a-session) would hang.
      try { process.stdin.pause(); process.stdin.unref?.(); } catch {}
      resolve(incomplete === true && !buf ? null : buf);
    };
    const to = setTimeout(finish, maxMs, true);
    if (to.unref) to.unref();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      if (buf.length >= maxBytes) return finish();
      if (buf.trimEnd().endsWith("}")) try { JSON.parse(buf); finish(); } catch {}
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", () => finish(true));
    process.stdin.resume();
  });
}

async function main() {
  const raw = (await readStdinBounded(1500)) ?? '';
  const input = JSON.parse(raw);
  if (disabled()) return;
  const tp = input.transcript_path;
  if (!tp || !existsSync(tp)) return;
  const buf = readFileSync(tp);
  const text = summarize(buf.length > MAX_TRANSCRIPT_BYTES ? buf.subarray(buf.length - MAX_TRANSCRIPT_BYTES).toString('utf8') : buf.toString('utf8'));
  const mcp = membMcpDir();
  const sid = input.session_id || input.conversationId;
  if (!text || !mcp || !firstTime(sid)) return;
  const cwd = input.cwd || (Array.isArray(input.workspacePaths) && input.workspacePaths[0]) || process.cwd();
  const harness = input.hook_event_name ? 'claude' : 'agy';
  const child = spawn(mcp.python, ['-c', PY], { cwd: mcp.dir, detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, env: process.env });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  await new Promise((r) => child.stdin.end(JSON.stringify({ text, project: path.basename(cwd), harness, session: String(sid) }), r));
  child.unref();
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  // Hard wall-clock budget: ~70 % of this hook's 5 s timeout (Claude SessionEnd, agy Stop); past it, exit 0.
  setTimeout(() => process.exit(0), 3500 - process.uptime() * 1000).unref();
  try { await main(); } catch { /* fail open */ }
  process.exit(0);
}
