// Workers start WITHOUT MCP servers unless the caller opts in (mcsc: req.mcp === true, aos-acp: --with-mcp).
// On 2026-10-10 every headless worker spawning the full AOS MCP set put the Mac at load 85, and the tool
// list alone fills a small model's context. OpenCode mechanism: OPENCODE_CONFIG_CONTENT with
// {"mcp":{"<name>":{"enabled":false}}} per configured server (verified on OpenCode 1.18.30; AGENTS.md
// "Delegating to an external CLI" item 6). `opencode mcp list` is not used: it would connect the servers.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
