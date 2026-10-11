// Workers start WITHOUT MCP servers unless the caller opts in (mcsc: req.mcp === true, aos-acp: --with-mcp).
// On 2026-10-10 every headless worker spawning the full AOS MCP set put the Mac at load 85, and the tool
// list alone fills a small model's context. OpenCode mechanism: OPENCODE_CONFIG_CONTENT with
// {"mcp":{"<name>":{"enabled":false}}} per configured server (verified on OpenCode 1.18.30; AGENTS.md
// "Delegating to an external CLI" item 6). `opencode mcp list` is not used: it would connect the servers.
import { readFileSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

// String-aware: comments and trailing commas outside "..." are dropped.
const STR = '("(?:[^"\\\\]|\\\\.)*")';
const parseJsonc = (text) => JSON.parse(String(text).replace(/^﻿/, '')
  .replace(new RegExp(`${STR}|//[^\\n\\r]*|/\\*[\\s\\S]*?\\*/`, 'g'), (m, s) => s ?? '')
  .replace(new RegExp(`${STR}|,(\\s*[}\\]])`, 'g'), (m, s, tail) => s ?? tail));

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Global files = lib/harnesses.json's opencode row ($CONFIG/opencode/opencode.json[c]). mcsc is installed
// without lib/, so the paths are repeated here rather than imported. Plus the project file in cwd.
export function opencodeConfigFiles(cwd, env = process.env, platform = process.platform) {
  const home = homedir();
  const config = platform === 'win32' ? (env.APPDATA || home) : join(home, '.config');
  const files = [join(config, 'opencode', 'opencode.jsonc'), join(config, 'opencode', 'opencode.json')];
  if (cwd) files.push(join(cwd, 'opencode.jsonc'), join(cwd, 'opencode.json'));
  return files;
}

export function opencodeServerNames(cwd, env = process.env, platform = process.platform) {
  const names = new Set();
  for (const file of opencodeConfigFiles(cwd, env, platform)) {
    try {
      const mcp = parseJsonc(readFileSync(file, 'utf8'))?.mcp;
      if (isObj(mcp)) for (const n of Object.keys(mcp)) names.add(n);
    } catch { /* missing or unparsable: skip */ }
  }
  return [...names];
}

// Returns env with every configured server disabled, merged into a caller-set OPENCODE_CONFIG_CONTENT
// (the caller's own fields for a server win). An unparsable caller value is left untouched.
export function opencodeNoMcpEnv(env, cwd) {
  const names = opencodeServerNames(cwd, env);
  if (names.length === 0) return env;
  let base = {};
  if (env.OPENCODE_CONFIG_CONTENT) {
    try { base = parseJsonc(env.OPENCODE_CONFIG_CONTENT); } catch { return env; }
    if (!isObj(base)) return env;
  }
  const mcp = isObj(base.mcp) ? { ...base.mcp } : {};
  for (const n of names) mcp[n] = { enabled: false, ...(isObj(mcp[n]) ? mcp[n] : {}) };
  return { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...base, mcp }) };
}

// Codex: `-c mcp_servers={}` merges instead of clearing the table (codex-cli 0.162.1), so each configured
// server is disabled by name. Names come from `codex mcp list --json`; ~/.codex/config.toml is the fallback.
const BARE_KEY = /^[A-Za-z0-9_-]+$/;

export function codexServerNames({ list = listCodexMcp, readToml = readCodexToml } = {}) {
  return list() ?? readToml();
}

function listCodexMcp() {
  const r = spawnSync('codex', ['mcp', 'list', '--json'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.error || r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    return Array.isArray(j) ? j.map((o) => o?.name).filter((n) => typeof n === 'string' && n.length > 0) : null;
  } catch { return null; }
}

function readCodexToml(file = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')) {
  try {
    return [...readFileSync(file, 'utf8').matchAll(/^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/gm)]
      .map((m) => m[1] ?? m[2]);
  } catch { return []; }
}

// `-c` keys are unquoted dotted paths, so a name outside BARE_KEY cannot be addressed here (none today).
export function codexNoMcpArgs(names) {
  return names.filter((n) => BARE_KEY.test(n)).flatMap((n) => ['-c', `mcp_servers.${n}.enabled=false`]);
}

// For the ACP adapter: codex-acp takes no -c flags and reads a JSON config object from CODEX_CONFIG.
export function codexNoMcpEnv(env, names = codexServerNames()) {
  if (names.length === 0) return env;
  let base = {};
  if (env.CODEX_CONFIG) {
    try { base = JSON.parse(env.CODEX_CONFIG); } catch { return env; }
    if (!isObj(base)) return env;
  }
  const mcp_servers = isObj(base.mcp_servers) ? { ...base.mcp_servers } : {};
  for (const n of names) mcp_servers[n] = { enabled: false, ...(isObj(mcp_servers[n]) ? mcp_servers[n] : {}) };
  return { ...env, CODEX_CONFIG: JSON.stringify({ ...base, mcp_servers }) };
}

// agy: no per-run switch. It reads <HOME>/.gemini/config/mcp_config.json and each plugin's own
// mcp_config.json, so a worker runs with HOME pointed at a mirror of the real home: every top-level entry
// is a link (git/gh/ssh configs and logins still resolve), except the MCP configs, which are generated empty.
const EMPTY_MCP = '{"mcpServers":{}}\n';
const AGY_MCP_FILE = 'mcp_config.json';
const under = (child, parent) => child === parent || child.startsWith(parent + sep);
const stripVerbatim = (p) => p.replace(/^\\\\\?\\/, '');

export const agyWorkerHomeDir = (home = homedir()) => join(home, '.aos', 'agy-worker-home');

const statOf = (fs, p, follow) => { try { return follow ? fs.statSync(p) : fs.lstatSync(p); } catch { return null; } };
const sameFile = (fs, p, st) => { const o = statOf(fs, p, false); return !!o && o.ino === st.ino && o.dev === st.dev; };
const linkedInto = (fs, link, home) => { try { return under(resolve(dirname(link), stripVerbatim(fs.readlinkSync(link))), home); } catch { return false; } };
const isGeneratedMcp = (fs, p, st) => p.endsWith(AGY_MCP_FILE) && st.isFile() && st.nlink === 1 && fs.readFileSync(p, 'utf8') === EMPTY_MCP;

function unlinkLink(fs, p) {
  try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); }
}

function ensureRealDir(ctx, d) {
  const st = statOf(ctx.fs, d, false);
  if (st?.isSymbolicLink()) unlinkLink(ctx.fs, d);
  else if (st) {
    if (st.isDirectory()) return;
    throw new Error(`${d} is not a directory`);
  }
  if (!st || st.isSymbolicLink()) ctx.fs.mkdirSync(d, { recursive: true });
}

function makeLink(ctx, src, dst, isDir) {
  const { fs, platform } = ctx;
  if (platform !== 'win32') return fs.symlinkSync(src, dst);
  if (isDir) return fs.symlinkSync(src, dst, 'junction');
  try { fs.symlinkSync(src, dst); } catch { fs.linkSync(src, dst); }
}

// Replaces only what we would have made: a link to a different target, or a hard link whose inode no
// longer matches the real file (atomic rewrite of the source). Anything else at dst is foreign and stays.
function linkEntry(ctx, src, dst) {
  const { fs } = ctx;
  const st = statOf(fs, dst, false);
  if (st) {
    if (st.isSymbolicLink()) {
      if (fs.readlinkSync(dst) === src) return;
      unlinkLink(fs, dst);
    } else if (st.isFile() && st.nlink > 1) {
      if (sameFile(fs, src, st)) return;
      fs.unlinkSync(dst);
    } else return;
  }
  makeLink(ctx, src, dst, !!statOf(fs, src, true)?.isDirectory());
}

function pruneStale(ctx, dst, keep) {
  for (const name of ctx.fs.readdirSync(dst)) {
    if (keep.has(name)) continue;
    const d = join(dst, name);
    const st = statOf(ctx.fs, d, false);
    if (st?.isSymbolicLink() && linkedInto(ctx.fs, d, ctx.home)) unlinkLink(ctx.fs, d);
  }
}

function writeGenerated(ctx, p) {
  const { fs } = ctx;
  const st = statOf(fs, p, false);
  if (st?.isFile() && st.nlink === 1 && fs.readFileSync(p, 'utf8') === EMPTY_MCP) return;
  if (st?.isDirectory()) throw new Error(`${p} is a directory`);
  if (st) fs.unlinkSync(p);
  fs.writeFileSync(p, EMPTY_MCP);
}

function syncDir(ctx, src, dst, { skip = [], special = {} } = {}) {
  ensureRealDir(ctx, dst);
  const names = statOf(ctx.fs, src, true)?.isDirectory() ? ctx.fs.readdirSync(src) : [];
  for (const name of names) {
    if (skip.includes(name)) continue;
    const s = join(src, name), d = join(dst, name);
    if (s === ctx.work) continue;
    if (special[name]) special[name](s, d);
    else if (under(ctx.work, s)) syncDir(ctx, s, d);
    else if (statOf(ctx.fs, s, true)) linkEntry(ctx, s, d);
  }
  pruneStale(ctx, dst, new Set([...names, ...skip]));
}

function syncPlugins(ctx, src, dst) {
  ensureRealDir(ctx, dst);
  const names = ctx.fs.readdirSync(src);
  for (const name of names) {
    const ps = join(src, name), pd = join(dst, name);
    if (statOf(ctx.fs, ps, true)?.isDirectory() && statOf(ctx.fs, join(ps, AGY_MCP_FILE), true)) {
      syncDir(ctx, ps, pd, { skip: [AGY_MCP_FILE] });
      writeGenerated(ctx, join(pd, AGY_MCP_FILE));
    } else if (statOf(ctx.fs, ps, true)) linkEntry(ctx, ps, pd);
  }
  pruneStale(ctx, dst, new Set(names));
}

function syncConfig(ctx, src, dst) {
  syncDir(ctx, src, dst, { skip: [AGY_MCP_FILE], special: { plugins: (s, d) => syncPlugins(ctx, s, d) } });
  writeGenerated(ctx, join(dst, AGY_MCP_FILE));
}

function syncGemini(ctx, src, dst) {
  syncDir(ctx, src, dst, { skip: ['config'] });
  syncConfig(ctx, join(src, 'config'), join(dst, 'config'));
}

// Returns the worker home path, or null when it cannot be built (the caller then runs agy with its MCP
// servers and says so). Idempotent: every call re-syncs links with the real home.
export function ensureAgyWorkerHome({ home = homedir(), dir, platform = process.platform, fs = nodeFs } = {}) {
  const ctx = { fs, platform, home: resolve(home), work: resolve(dir ?? agyWorkerHomeDir(home)) };
  try {
    syncDir(ctx, ctx.home, ctx.work, { special: { '.gemini': (s, d) => syncGemini(ctx, s, d) } });
    return ctx.work;
  } catch { return null; }
}

// env with HOME (and USERPROFILE on win32) at the worker home; env unchanged when that cannot be built.
export function agyNoMcpEnv(env, { home, dir, platform = process.platform, fs, warn } = {}) {
  const work = ensureAgyWorkerHome({ home, dir, platform, fs });
  if (!work) {
    warn?.('agy worker home unavailable, agy runs with its MCP servers');
    return env;
  }
  return { ...env, HOME: work, ...(platform === 'win32' && { USERPROFILE: work }) };
}

// The one call sites use: keeps the caller's env when MCP servers are wanted (mcsc req.mcp, aos-acp --with-mcp).
export function agyChildEnv(env, { withMcp = false, ...opts } = {}) {
  return withMcp === true ? env : agyNoMcpEnv(env, opts);
}

// Removes only what ensureAgyWorkerHome makes: links that point into the real home, the generated empty
// mcp_config.json files and hard links to unchanged real files. Walks the worker home alongside the real
// home with lstat, never follows a link, never recursive. Directories go only when empty.
export function removeAgyWorkerHome({ home = homedir(), dir, fs = nodeFs, dryRun = false } = {}) {
  const real = resolve(home), work = resolve(dir ?? agyWorkerHomeDir(home));
  const out = { removed: [], kept: [] };
  const act = (p, fn) => { if (!dryRun) fn(p); out.removed.push(p); };
  const walk = (dst, src) => {
    for (const name of fs.readdirSync(dst)) {
      const d = join(dst, name), s = join(src, name);
      const st = statOf(fs, d, false);
      if (!st) continue;
      if (st.isSymbolicLink()) {
        if (linkedInto(fs, d, real)) act(d, (p) => unlinkLink(fs, p));
        else out.kept.push(d);
      } else if (st.isDirectory() && statOf(fs, s, true)?.isDirectory()) {
        walk(d, s);
        if (!dryRun) { try { fs.rmdirSync(d); } catch { out.kept.push(d); } }
      } else if (isGeneratedMcp(fs, d, st) || (st.isFile() && st.nlink > 1 && sameFile(fs, s, st))) {
        act(d, (p) => fs.unlinkSync(p));
      } else out.kept.push(d);
    }
  };
  if (!statOf(fs, work, false)?.isDirectory()) return out;
  walk(work, real);
  if (!dryRun) { try { fs.rmdirSync(work); } catch { out.kept.push(work); } }
  return out;
}
