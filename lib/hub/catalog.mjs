'use strict';
// WP3 catalog builder. Strictly read-only: every source is only read, never
// written, pruned or deleted. Data sources (plan §3):
//   skills   localSkills(ROOT) + store index items (core wins)
//   agents   localAgents(ROOT) + index subagents
//   commands commands/*.md frontmatter, cross-checked with plugin.json,
//            agy-commands/*.md as agy variants
//   mcps     mcp_config.json.mcpServers (name, transport, command basename),
//            mcp_picks.json groups, GATEWAY_SERVERS / DIRECT_SERVERS from
//            lib/gateway/config.js
// Installed flags per harness: globalRoots('skills'|'agents') dirs for
// skills/agents (re-rooted onto the injected home), harnessMcpFiles() from
// lib/mcp-secrets.js for MCPs — by name, or via the `aos` gateway entry.
// No request value ever reaches the filesystem; no file is ever written.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// CJS modules are loaded through createRequire, the repo's ESM pattern.
const reqCjs = createRequire(import.meta.url);
import { localSkills, localAgents, globalRoots, loadSources } from '../store-shared.mjs';
const { harnessMcpFiles, parseCodexTables, shippedMcpTemplatePath } = reqCjs('../mcp-secrets.js');
const pkgGateway = reqCjs('../gateway/config.js');

const { GATEWAY_SERVERS, DIRECT_SERVERS } = pkgGateway;

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = MODULE_DIR + '/../..';

// Frontmatter of the first `---` block, kept to the scalar keys we need.
// Block scalars (`description: >-`) are joined into one line.
export function frontmatter(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines[0] !== '---') return {};
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '---' || line === '...') break;
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (value === '>-' || value === '>' || value === '|') {
      const parts = [];
      let j = i + 1;
      while (j < lines.length && lines[j] !== '---' && /^\s+\S/.test(lines[j])) {
        parts.push(lines[j].trim());
        j++;
      }
      i = j - 1;
      out[key] = parts.join(' ');
    } else {
      out[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

const blank = () => ({ claude: false, codex: false, agy: false, cursor: false, roo: false });

// Which fixed-shape key a file path belongs to. ~/.agents and ~/.gemini are
// both the AGY/Antigravity family. The `aos` gateway entry lives under
// ~/.agents/gateway. OpenCode paths are recognizable, but globalRoots() has no
// OpenCode entry, so skills/agents never carry an opencode flag.
const harnessKey = (p) => {
  const norm = String(p).toLowerCase().replace(/\\/g, '/');
  if (/\/\.claude\.json$/.test(norm) || /\/\.claude\//.test(norm) || /claude_desktop/.test(norm)) return 'claude';
  if (/\/\.codex\//.test(norm)) return 'codex';
  if (/\/\.agents\/gateway\//.test(norm)) return 'gateway';
  if (/\/\.agents\//.test(norm) || /\/\.gemini\//.test(norm) || /antigravity/.test(norm)) return 'agy';
  if (/\/\.cursor\//.test(norm) || /\/cursor\//.test(norm)) return 'cursor';
  if (/\/\.roo\//.test(norm) || /rooveterinaryinc/.test(norm)) return 'roo';
  if (/opencode\.(json|jsonc)$/.test(norm) || /\/opencode\//.test(norm)) return 'opencode';
  return null;
};

const flagsFromPath = (p) => {
  const flags = { ...blank(), opencode: false, gateway: false };
  const k = harnessKey(p);
  if (k === 'gateway') flags.gateway = true;
  else if (k) flags[k] = true;
  return flags;
};

// globalRoots() is anchored to the real os homedir(); with a fixture home the
// same sub-paths are re-rooted there, so the directory *names* stay identical
// while tests stay inside temp dirs.
function fixtureRoots(type, home) {
  const real = homedir();
  return globalRoots(type).map((p) => {
    if (home === undefined || join(home || '') === join(real)) return p;
    const rel = relative(real, p);
    if (!rel || rel.startsWith('..') || !p.startsWith(real + sep)) return null;
    return join(home, rel);
  }).filter(Boolean);
}

// Skills install targets are <root>/<name>/SKILL.md; agents are <root>/<name>.md.
function installedFlags(type, name, home) {
  const flags = blank();
  for (const dir of fixtureRoots(type, home)) {
    if (!existsSync(dir)) continue;
    let entries = [];
    try { entries = readdirSync(dir); } catch { continue; }
    const hit = type === 'skills'
      ? entries.includes(name) && existsSync(join(dir, name, 'SKILL.md'))
      : entries.some((e) => e.replace(/\.md$/i, '') === name);
    if (hit) {
      const k = harnessKey(dir);
      if (k && k in flags) flags[k] = true;
    }
  }
  return flags;
}

const parseJsonFile = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
};

// Command basename only: never args, never anything containing '='.
const commandEntry = (cfg) => {
  const cmd = cfg && typeof cfg === 'object' ? cfg.command : null;
  const first = Array.isArray(cmd) ? cmd[0] : cmd;
  if (typeof first !== 'string' || !first || first.includes('=')) return 'custom';
  if (first === '__PYTHON_BIN__') return 'python';
  return first.replace(/^.*[/\\]/, '');
};

// env reduced to {KEY:'set'|'unset'}: presence of the key decides, values
// never reach the output in any form.
const envFlags = (env) => {
  const out = {};
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    for (const k of Object.keys(env)) out[k] = env[k] ? 'set' : 'unset';
  }
  return out;
};

export function buildCatalog({ root, home, now = () => Date.now(), env = process.env } = {}) {
  const catalogRoot = root || DEFAULT_ROOT;
  const skills = [];
  const agents = [];
  const commands = [];
  const mcps = [];

  // ---- groups (skills.sh.json) ----
  const skillsSh = parseJsonFile(join(catalogRoot, 'skills.sh.json'));
  const groupOf = (name) => {
    for (const g of skillsSh?.groupings || []) {
      if ((g.skills || []).includes(name)) return g.title;
    }
    return null;
  };

  // ---- skills: local, then store index (local = core wins) ----
  for (const [name, path] of localSkills(catalogRoot)) {
    let fm = {};
    try { fm = frontmatter(readFileSync(path, 'utf8').slice(0, 8192)); } catch { /* unreadable: name-only item */ }
    skills.push({
      kind: 'skill', name,
      description: fm.description || name,
      category: fm.category || null,
      group: groupOf(name),
      source: 'aos',
      installed: installedFlags('skills', name, home),
      core: true,
    });
  }
  try {
    for (const src of loadSources(catalogRoot, env)) {
      for (const [name, item] of Object.entries(src.index.skills || {})) {
        if (skills.some((s) => s.name === name)) continue; // core wins
        skills.push({
          kind: 'skill', name,
          description: item.description || name,
          category: item.category || 'library',
          group: groupOf(name),
          source: src.id,
          installed: installedFlags('skills', name, home),
          core: false,
        });
      }
      for (const [name, item] of Object.entries(src.index.subagents || {})) {
        if (agents.some((a) => a.name === name)) continue; // local wins
        agents.push({
          kind: 'agent', name,
          description: item.description || name,
          category: null,
          group: null,
          source: src.id,
          installed: installedFlags('agents', name, home),
          core: false,
        });
      }
    }
  } catch { /* store index unavailable: local-only catalog is still valid */ }

  // ---- agents: local (subagents from the index were merged above) ----
  for (const [name, path] of localAgents(catalogRoot)) {
    let fm = {};
    try { fm = frontmatter(readFileSync(path, 'utf8').slice(0, 8192)); } catch { /* unreadable */ }
    agents.push({
      kind: 'agent', name,
      description: fm.description || name,
      category: fm.category || null,
      group: null,
      source: 'aos',
      installed: installedFlags('agents', name, home),
      core: true,
    });
  }

  // ---- commands: commands/*.md core-checked against plugin.json; agy variants ----
  const plugin = parseJsonFile(join(catalogRoot, 'plugin.json'));
  const pluginCmds = new Set((plugin?.commands || []).map((c) => basename(c)));
  const readCommandDir = (sub, source) => {
    const dir = join(catalogRoot, sub);
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      const name = entry.replace(/\.md$/i, '');
      if (source !== 'agy-commands' && commands.some((c) => c.name === name)) continue;
      let fm = {};
      try { fm = frontmatter(readFileSync(join(dir, entry), 'utf8').slice(0, 8192)); } catch { /* unreadable */ }
      commands.push({
        kind: 'command', name,
        description: fm.description || name,
        category: fm.category || (source === 'agy-commands' ? 'agy variant' : null),
        group: null,
        source,
        // Harness registration of commands is configurational, not an install
        // target: no globalRoots set applies, so no per-harness flags.
        installed: null,
        core: source === 'commands' && pluginCmds.has(entry),
      });
    }
  };
  readCommandDir('commands', 'commands');
  readCommandDir('agy-commands', 'agy-commands');

  // ---- mcps ----
  const installedMcp = {};
  try {
    for (const { file, kind } of harnessMcpFiles(home, env)) {
      let text;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      if (kind === 'toml') {
        const tables = parseCodexTables(text);
        for (const name of Object.keys(tables)) {
          installedMcp[name] = flagsFromPath(file);
        }
        continue;
      }
      let data;
      try { data = JSON.parse(text); } catch { continue; }
      const map = kind === 'opencode' ? data && data.mcp : data && data.mcpServers;
      if (!map || typeof map !== 'object') continue;
      for (const name of Object.keys(map)) {
        installedMcp[name] = flagsFromPath(file);
      }
    }
  } catch { /* no readable harness config: flags stay open */ }
  const mcpInstalled = (name) => installedMcp[name] || { ...blank(), opencode: false, gateway: false };

  const shipped = parseJsonFile(shippedMcpTemplatePath(catalogRoot));
  const shipping = shipped && typeof shipped === 'object' ? shipped.mcpServers || {} : {};
  const picksData = parseJsonFile(join(catalogRoot, 'mcp_picks.json'));
  const pickOf = (name) => {
    for (const g of picksData?.groups || []) {
      if ((g.candidates || []).some((c) => c.name === name)) return g.group;
    }
    return null;
  };
  for (const [name, cfg] of Object.entries(shipping)) {
    const asCfg = cfg && typeof cfg === 'object' ? cfg : {};
    const pickGroup = pickOf(name);
    const isGateway = GATEWAY_SERVERS.includes(name);
    const isDirect = DIRECT_SERVERS.includes(name);
    mcps.push({
      kind: 'mcp', name,
      description: commandEntry(asCfg),
      category: pickGroup || (isGateway ? 'gateway' : isDirect ? 'direct' : 'other'),
      group: pickGroup,
      source: 'mcp_config',
      installed: mcpInstalled(name),
      core: true,
      transport: 'stdio',
      env: envFlags(asCfg.env),
    });
  }
  // Routing groups as catalog entries even without a shipped template entry.
  for (const name of GATEWAY_SERVERS) {
    if (mcps.some((m) => m.name === name)) continue;
    mcps.push({
      kind: 'mcp', name, description: null, category: 'gateway', group: null,
      source: 'gateway', installed: mcpInstalled(name), core: true,
      transport: 'gateway', env: {},
    });
  }
  for (const name of DIRECT_SERVERS) {
    if (mcps.some((m) => m.name === name)) continue;
    mcps.push({
      kind: 'mcp', name, description: null, category: 'direct', group: null,
      source: 'direct', installed: mcpInstalled(name), core: true,
      transport: 'direct', env: {},
    });
  }

  return { skills, agents, commands, mcps, generatedAt: now() };
}

export default buildCatalog;
