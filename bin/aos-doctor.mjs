#!/usr/bin/env node
// AOS System Checkup & Doctor: Verifies system dependencies, file placement,
// cross-platform harness synchronization, daemons and hooks across macOS and Windows.
// Usage:
//   aos doctor
//   node bin/aos-doctor.mjs [--json] [--net] [--resources [--sample <seconds>]]

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const req = createRequire(import.meta.url);
const pkg = (() => {
  try { return req('../package.json'); } catch {
    try {
      const rootPath = path.join(os.homedir(), '.agents', 'lib', '.aos-package-root.json');
      const root = JSON.parse(readFileSync(rootPath, 'utf8'))?.packageRoot;
      if (root) {
        const p = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (p && p.version) return p;
      }
    } catch {}
    try {
      const manifestPath = path.join(os.homedir(), '.agents', '.bdb-manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest && manifest.version) return { version: manifest.version };
    } catch {}
    return { version: 'unknown' };
  }
})();
const updateCheck = req('../lib/update-check.js');
const { pluginSkills, pluginAgents, claudeConfigDir } = req('../lib/plugin-evidence.js');
const { doctorPluginRow: pmDoctorRow } = req('../lib/plugin-migration.js');
const { readGoBuildInfo } = req('../lib/go-buildinfo.js');
const { HARNESSES, modelProblem } = req('../lib/agent-models.js');
const { HOOK_SCRIPTS } = req('../lib/v5/profile.js');
const { codexAosHookHash, codexTrustedHashes, CODEX_RULES_HEADER } = req('../lib/uninstall-records.js');
const { btmNotLoadedAgents, agentLoadStatus, btmFixHint } = req('../lib/launchagent-btm.mjs');
const npmGlobalAos = req('../lib/npm-global-aos.js');
const { findExecutable, getGitInstallInstruction, isElevated } = req('../lib/executable-probe.js');
const noMcp = await import(new URL('../mcps/mcsc/packages/core/src/no-mcp.js', import.meta.url).href).catch(() => null);
const HOME = os.homedir();
const JSON_OUT = process.argv.includes('--json');
const NET = process.argv.includes('--net');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_ARM64 = process.arch === 'arm64';

// `aos doctor --resources [--sample <s>] [--json]`: read-only process census, nothing else runs.
if (process.argv.includes('--resources')) {
  const { runResources, format } = await import('../lib/resources.mjs');
  const at = process.argv.indexOf('--sample');
  const sampleSec = at >= 0 && Number.isFinite(Number(process.argv[at + 1])) ? Number(process.argv[at + 1]) : 10;
  const result = await runResources({ sampleSec, home: HOME });
  console.log(JSON_OUT ? JSON.stringify(result, null, 2) : format(result));
  process.exit(0);
}

const h = (...p) => path.join(HOME, ...p);
const hc = (...p) => path.join(claudeConfigDir(HOME), ...p);
const tilde = (p) => (p || '').replace(HOME, '~');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

const firstExisting = (candidates) => candidates.find((c) => existsSync(c)) || null;

const MODULE_BASES = [
  h('.agents'),
  hc(),
  h('dev', 'bdb-dev'),
  ...(process.env.npm_config_prefix ? [path.join(process.env.npm_config_prefix, 'lib', 'node_modules')] : []),
  '/usr/local/lib/node_modules',
  '/opt/homebrew/lib/node_modules',
];
const findModule = (name) => firstExisting(MODULE_BASES.map((b) => path.join(b, name)));

const MCP_DIRS = [
  h('.gemini', 'config', 'mcps'),
  h('Library', 'Application Support', 'Claude', 'mcps'),
  ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'Claude', 'mcps')] : []),
  h('.cursor', 'mcps'),
  h('.codex', 'mcps'),
  h('.windsurf', 'mcps'),
];

const results = [];
const add = (area, name, ok, detail, fix, warningOnly = false) => {
  results.push({ area, name, ok, detail, fix, warningOnly });
};

const which = (bin) => findExecutable(bin);

const dirCount = (p) => {
  try {
    return readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).length;
  } catch {
    return 0;
  }
};

function portOpen(port, timeout = 1200) {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

// ---------------------------------------------------------------- 1. System Prereqs
function checkPrereqs() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('prereq', 'Node.js runtime', nodeMajor >= 20, `v${process.versions.node} (${nodeMajor >= 22 ? 'optimal for OpenWiki' : '>= 20 required'})`,
    'Update Node.js to v20 or v22+ via nvm or nodejs.org.');

  const pyProbe = which('python3') || which('python') || (IS_WIN ? which('py') : null);
  add('prereq', 'Python 3', !!pyProbe, tilde(pyProbe) || 'missing — needed for memB venv & OpenWiki',
    IS_WIN ? 'Install Python from python.org or winget install Python.Python.3.12' : 'brew install python3');

  const gitProbe = which('git');
  const gitFix = getGitInstallInstruction({ platform: process.platform, elevated: isElevated({ platform: process.platform }) });
  add('prereq', 'Git CLI', !!gitProbe, tilde(gitProbe) || 'missing — required for AOS workflows and worktrees', gitFix);

  const uvProbe = which('uv');
  add('prereq', 'uv package manager', !!uvProbe, uvProbe ? `${tilde(uvProbe)} (fast venv seeding)` : 'optional — pip fallback will be used',
    'curl -LsSf https://astral.sh/uv/install.sh | sh (or pip install uv)', true);

  const ghProbe = which('gh');
  add('prereq', 'GitHub CLI (gh)', !!ghProbe, ghProbe ? tilde(ghProbe) : 'optional — needed for repo automation & release PRs',
    'Install GitHub CLI: brew install gh / winget install GitHub.cli', true);
}

// ---------------------------------------------------------------- 2. AOS Core Placement & Store
function checkAosCore() {
  const manifestPath = h('.agents', '.bdb-manifest.json');
  const manifest = readJson(manifestPath);
  add('aos-core', 'Install Manifest', !!manifest,
    manifest ? `v${manifest.version || '4.x'} · tier ${manifest.tier || 'full'} · modules: ${(manifest.installedModules || []).join(', ') || 'default'}` : `${manifestPath} missing or unreadable`,
    'Run the AOS installer: npx @hybridlabor-api/aos@latest');

  // Network version check gated by --net
  if (NET) {
    try {
      const npmBin = IS_WIN ? 'npm.cmd' : 'npm';
      const latest = execFileSync(npmBin, ['view', '@hybridlabor-api/aos', 'version'], {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: IS_WIN
      }).trim();
      const currentVer = manifest?.version || '4.7.1';
      add('aos-core', 'Version vs npm', currentVer === latest, `local v${currentVer} · npm v${latest}`,
        'Run: npx @hybridlabor-api/aos@latest');
    } catch {
      add('aos-core', 'Version vs npm', false, 'npm view failed (offline or network timeout)', 'Re-run with network or omit --net', true);
    }
  } else {
    add('aos-core', 'Version vs npm', true, 'Skipped (offline mode — pass --net to check npm)', '', true);
  }

  // A leftover `npm i -g @hybridlabor-api/aos` can shadow the ~/.local/bin launcher on PATH (audit P0-1):
  // read-only probe (`npm root -g`); the removal command is printed, AOS never removes the package itself.
  {
    const g = npmGlobalAos.detectGlobalAos();
    if (!g.checked) {
      add('aos-core', 'Global npm install', true, 'could not check (npm missing or offline)', '', true);
    } else if (g.found) {
      add('aos-core', 'Global npm install', false, `${tilde(g.root)} (v${g.version})`,
        `Remove the stale copy so it stops shadowing ~/.local/bin: ${npmGlobalAos.REMOVE_CMD} (AOS never removes it automatically).`);
    } else {
      add('aos-core', 'Global npm install', true, 'none — only the ~/.local/bin launcher');
    }
  }

  // Check store index
  const storeIndexCandidates = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'ecc-store-index.json'),
    h('.agents', 'lib', 'ecc-store-index.json'),
    h('dev', 'bdb-dev', 'bdb-dev-optimized-agent-skills', 'lib', 'ecc-store-index.json')
  ];
  const storeIndexPath = firstExisting(storeIndexCandidates);
  let storeSkillsCount = 0;
  if (storeIndexPath) {
    try {
      const idx = readJson(storeIndexPath);
      storeSkillsCount = (idx?.skills ? Object.keys(idx.skills).length : 0);
    } catch {}
  }
  add('aos-core', 'Offline Store Index', !!storeIndexPath && storeSkillsCount > 0,
    storeIndexPath ? `${tilde(storeIndexPath)} (${storeSkillsCount} catalog skills indexed)` : 'Store index missing',
    'Run scripts/build-ecc-store-index.mjs or re-run the AOS installer.');

  // mcsc is registered by the installer in each harness's own MCP config (never ~/.agents/mcp_config.json).
  const mcscIn = [];
  const hasKey = (file, pick) => { const c = readJson(file); return !!(c && pick(c)?.mcsc); };
  const cfgs = [
    [h('.gemini', 'config', 'mcp_config.json'), (c) => c.mcpServers],
    [h('.claude.json'), (c) => c.mcpServers],
    [h('.cursor', 'mcp.json'), (c) => c.mcpServers],
    [h('.windsurf', 'mcp.json'), (c) => c.mcpServers],
    [h('.config', 'opencode', 'opencode.json'), (c) => c.mcp],
  ];
  for (const [file, pick] of cfgs) if (hasKey(file, pick)) mcscIn.push(file);
  const ocJsonc = h('.config', 'opencode', 'opencode.jsonc');
  if (existsSync(ocJsonc) && parseJsonc(readFileSync(ocJsonc, 'utf8'))?.mcp?.mcsc) mcscIn.push(ocJsonc);
  try { if (/^\[mcp_servers\.mcsc\]/m.test(readFileSync(h('.codex', 'config.toml'), 'utf8'))) mcscIn.push(h('.codex', 'config.toml')); } catch { /* no codex config */ }
  add('aos-core', 'MCSC Telemetry Registration', mcscIn.length > 0,
    mcscIn.length ? `mcsc registered in ${mcscIn.map(tilde).join(', ')}` : 'mcsc not found in any harness MCP config (optional MCP, only present when selected at install)',
    'Re-run the installer and select the mcsc MCP to register the cross-harness adapter.', true);

  // Retired module check (CDC bug prevention)
  const retired = findModule('bdb-os-agent-workspace');
  if (retired) {
    add('aos-core', 'Retired AO module', false,
      `${tilde(retired)} — archived predecessor with known CDC loop bug`,
      `Move directory aside or review path: ${tilde(retired)} — AO is now bdb-agent-orchestrator.`);
  }
}

const { parseJsonc } = req('../lib/jsonc.js');

// Zen gateway limit: a tool name (OpenCode builds it from the MCP server name) is at most 64 characters.
// Names only, no network: the tool part of the name is not known here.
const ZEN_TOOL_NAME_MAX = 64;

function checkOpencodeMcpNames() {
  const dirs = [h('.config', 'opencode')];
  const file = firstExisting(dirs.flatMap((d) => ['opencode.jsonc', 'opencode.json'].map((f) => path.join(d, f))));
  if (!file) return;
  const conf = parseJsonc(readFileSync(file, 'utf8'));
  if (!conf) {
    add('harnesses', 'OpenCode MCP names', false, `${tilde(file)} is not valid JSON(C); names not checked`, 'Fix the OpenCode config syntax.', true);
    return;
  }
  const names = Object.keys(conf.mcp && typeof conf.mcp === 'object' ? conf.mcp : {});
  const tooLong = names.filter((n) => n.length > ZEN_TOOL_NAME_MAX);
  add('harnesses', 'OpenCode MCP names', tooLong.length === 0,
    tooLong.length ? `${tooLong.length} MCP name(s) over ${ZEN_TOOL_NAME_MAX} characters (Zen gateway limit): ${tooLong.join(', ')}` : `${names.length} MCP name(s) in ${tilde(file)}, none over ${ZEN_TOOL_NAME_MAX} characters`,
    `Rename the MCP server(s) in ${tilde(file)} to a shorter name; tool names are built from them and a name over ${ZEN_TOOL_NAME_MAX} characters is rejected by the Zen gateway. Keeping the MCP set lean also helps.`, true);
}

// ---------------------------------------------------------------- 3. Harness Placement & Skills Sync
// Skill names this package ships (skills/<group>/<name>/SKILL.md), or null when no package tree is reachable.
function shippedSkillNames() {
  const pkgRoots = [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), readJson(h('.agents', 'lib', '.aos-package-root.json'))?.packageRoot];
  // The name check keeps ~/.agents (installed copy's parent, has skills/ and maybe a legacy package.json) from counting as the package.
  const pkgRoot = pkgRoots.find((r) => typeof r === 'string' && readJson(path.join(r, 'package.json'))?.name === '@hybridlabor-api/aos' && existsSync(path.join(r, 'skills')));
  if (!pkgRoot) return null;
  const names = new Set();
  const walk = (dir, depth) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(dir, d.name);
      if (existsSync(path.join(p, 'SKILL.md'))) names.add(d.name);
      else if (depth < 3) walk(p, depth + 1);
    }
  };
  walk(path.join(pkgRoot, 'skills'), 1);
  return names;
}

function checkHarnesses() {
  const harnesses = [
    { name: 'Claude Code', path: hc('skills') },
    { name: 'Gemini / Antigravity', path: firstExisting([h('.gemini', 'config', 'skills'), h('.gemini', 'antigravity-cli', 'skills')]) || h('.gemini', 'config', 'skills') },
    { name: 'Codex', path: h('.agents', 'skills') },
    { name: 'Roo Code', path: h('.roo', 'skills') },
  ];

  const SENTINEL = 'startcycle';
  for (const hr of harnesses) {
    const exists = existsSync(hr.path);
    const count = dirCount(hr.path);
    const hasSentinel = existsSync(path.join(hr.path, SENTINEL, 'SKILL.md'));
    const plug = hr.name === 'Claude Code' && !hasSentinel ? pluginSkills(HOME, [SENTINEL]) : null;
    const viaPlugin = !!plug;
    const ok = viaPlugin || (exists && count > 0 && hasSentinel);
    add('harnesses', `${hr.name} Skills`, ok,
      viaPlugin ? `provided by the bdb-aos plugin (${plug.skills.size} skills)` : ok ? `${tilde(hr.path)} (${count} skills, sentinel verified)` : (exists ? `${tilde(hr.path)} (${count} skills, sentinel missing)` : `${tilde(hr.path)} not synced`),
      `Run 'npx @hybridlabor-api/aos@latest' and select ${hr.name} to sync skills.`, !exists && !viaPlugin);
  }

  // Codex reads ~/.codex/skills AND ~/.agents/skills; AOS writes only the latter, so same-named copies in the former double-list.
  const codexRoot = h('.codex', 'skills');
  const doubled = existsSync(codexRoot) ? readdirSync(codexRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(path.join(codexRoot, d.name, 'SKILL.md')) && existsSync(path.join(h('.agents', 'skills'), d.name, 'SKILL.md')))
    .map((d) => d.name) : [];
  if (doubled.length) {
    const shipped = shippedSkillNames();
    const preview = (names) => names.slice(0, 8).join(', ') + (names.length > 8 ? ', ...' : '');
    const aosOwned = shipped ? doubled.filter((n) => shipped.has(n)) : [];
    const foreign = shipped ? doubled.filter((n) => !shipped.has(n)) : doubled;
    const fixes = [];
    if (foreign.length) fixes.push(shipped
      ? `Not installed by AOS (${preview(foreign)}): remove the copy in ${tilde(codexRoot)} or ~/.agents/skills yourself.`
      : 'If these are not AOS skills, remove one of the two copies yourself.');
    if (aosOwned.length) fixes.push(`Run 'npx @hybridlabor-api/aos@latest' once (it retires AOS copies from ${tilde(codexRoot)} with a backup).`);
    add('harnesses', 'Codex duplicate skills', false, `${doubled.length} skill(s) exist in both ${tilde(codexRoot)} and ~/.agents/skills, so Codex lists them twice: ${preview(doubled)}`,
      fixes.join(' '), true);
  }

  // The same AOS skill as a manifest-recorded loose copy in the Claude skills dir and in the bdb-aos plugin is listed twice.
  const looseRoot = hc('skills');
  const claudePlugin = pluginSkills(HOME);
  const installManifest = readJson(h('.agents', '.bdb-install-manifest.json')) || {};
  const recorded = new Set(Object.keys(installManifest).filter((k) => k.startsWith(looseRoot + path.sep)).map((k) => k.slice(looseRoot.length + 1).split(path.sep)[0]));
  const twice = claudePlugin ? [...claudePlugin.skills].filter((n) => recorded.has(n) && existsSync(path.join(looseRoot, n, 'SKILL.md'))) : [];
  if (twice.length) {
    add('harnesses', 'Claude duplicate skills', false, `${twice.length} AOS skill(s) exist both as loose copies in ${tilde(looseRoot)} and in the bdb-aos plugin, so Claude lists them twice`,
      'Run the AOS installer again; it backs up and retires the loose copies (aos-uninstall --restore-plugin-backup restores them).', true);
  }

  // Duplicate agents: when ~/.claude/agents mirrors the plugin agents
  const agentsRoot = hc('agents');
  const claudePluginAgents = pluginAgents(HOME);
  if (claudePluginAgents && existsSync(agentsRoot)) {
    try {
      const looseAgents = readdirSync(agentsRoot).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
      const hasOverride = (a) => { try { return /^model:/m.test((readFileSync(path.join(agentsRoot, `${a}.md`), 'utf8').match(/^---\n([\s\S]*?)\n---/) || [])[1] || ''); } catch { return false; } };
      const duplicates = looseAgents.filter((a) => claudePluginAgents.agents.has(a) && !hasOverride(a));
      if (duplicates.length) {
        add('harnesses', 'Claude duplicate agents', false,
          `${duplicates.length} agent(s) exist both in ${tilde(agentsRoot)} and in the bdb-aos plugin, which duplicates system prompt token cost (~${Math.round(duplicates.length * 97)} tokens)`,
          `Run aos update / aos repair: the installer backs up and retires unedited copies (aos-uninstall --restore-plugin-backup restores them). Copies you edited, or that carry a pipeline.json model override, stay.`,
          true);
      }
    } catch {}
  }

  const ov = req('../lib/opencode-verify.js');
  results.push(...ov.checkOpencode({ home: HOME }), ...ov.checkAcpAndGoCheck({ home: HOME }));
  checkOpencodeMcpNames();
}

// ---------------------------------------------------------------- 4. Hooks & Security Gates
function checkHooks() {
  const claudeHooksDir = hc('hooks');
  const gateOff = req('../lib/v5/profile.js').readSettings(HOME, () => {}).gate === 'off';
  if (gateOff) add('hooks', 'go-gate: off (by setting)', true, 'go-gate, go-token, go-grant and graph-gate are not registered; turn on: aos, Settings, Go-gate', '');
  const EXPECTED_VERSION = { 'memb-inject.mjs': 8 };
  const versionOf = (text) => {
    const m = /^\/\/\s*aos-hook-version:\s*(\d+)/m.exec(text);
    return m ? Number(m[1]) : null;
  };

  for (const file of ['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs']) {
    const p = path.join(claudeHooksDir, file);
    if (!existsSync(p)) {
      add('hooks', file, false, 'missing from ~/.claude/hooks',
        'Run the installer to wire Claude Code safety hooks.');
      continue;
    }
    const want = EXPECTED_VERSION[file];
    if (!want) {
      add('hooks', file, true, tilde(p), '');
      continue;
    }
    const got = versionOf(readFileSync(p, 'utf8'));
    add('hooks', file, got === want,
      got === want ? `${tilde(p)} (v${got})` : `${tilde(p)} (v${got || 'legacy'}, expected v${want})`,
      'Run the AOS installer to update to latest hook version.');
  }

  // Claude settings.json wiring
  const claudeSettings = readJson(hc('settings.json'));
  const wired = JSON.stringify(claudeSettings?.hooks || {});
  const claudeWiredOk = (gateOff || wired.includes('go-gate.mjs')) && wired.includes('memb-inject.mjs');
  add('hooks', 'Claude settings.json wired', claudeWiredOk,
    claudeWiredOk ? 'PreToolUse & UserPromptSubmit registered' : 'Hooks not fully registered in ~/.claude/settings.json',
    'Run the AOS installer to wire hooks in settings.json.');

  // Destructive-actions rules re-injected per prompt, and the home-level permissions.deny rules.
  const injectFile = path.join(claudeHooksDir, 'rules-inject.mjs');
  const injectWired = JSON.stringify(claudeSettings?.hooks?.UserPromptSubmit || []).includes('rules-inject.mjs');
  add('hooks', 'Destructive rules re-injection (rules-inject)', existsSync(injectFile) && injectWired,
    existsSync(injectFile) ? (injectWired ? `${tilde(injectFile)}, UserPromptSubmit registered` : `${tilde(injectFile)} present but not registered in settings.json`) : `${tilde(injectFile)} missing`,
    'Run the AOS installer to install and register rules-inject.mjs.', true);
  let denyRules = [];
  try { denyRules = req('../lib/destructive-rules.js').CLAUDE_DENY_RULES; } catch {}
  if (denyRules.length) {
    const have = Array.isArray(claudeSettings?.permissions?.deny) ? claudeSettings.permissions.deny : [];
    const missingDeny = denyRules.filter((r) => !have.includes(r));
    add('hooks', 'Claude permissions.deny (home-level rm)', missingDeny.length === 0,
      missingDeny.length === 0 ? `${denyRules.length}/${denyRules.length} AOS deny rules in ${tilde(hc('settings.json'))}` : `${missingDeny.length}/${denyRules.length} AOS deny rules missing from ${tilde(hc('settings.json'))}`,
      'Run the AOS installer to add the deny rules (it never touches your own rules).', true);
  }

  // Antigravity hooks
  const agHooksFile = firstExisting([
    h('.gemini', 'antigravity-cli', 'hooks.json'),
    h('.gemini', 'config', 'hooks.json'),
    h('.agents', 'hooks.json')
  ]);
  const agHooks = agHooksFile ? readJson(agHooksFile) : null;
  // New format: one named hook per concern at the top level; legacy: all handlers under "hooks".
  const AG_NAMED = ['aos-go-gate', 'aos-conventional-commits', 'aos-env-protection', 'aos-trail-relay', 'aos-graph-gate', 'aos-context', 'aos-a2a-inbox']
    .filter((n) => !(gateOff && (n === 'aos-go-gate' || n === 'aos-graph-gate')));
  const namedWired = AG_NAMED.filter((n) => agHooks && agHooks[n]);
  const legacyWired = JSON.stringify(agHooks?.hooks || {}).includes('memb-inject.mjs');
  const missingNamed = AG_NAMED.filter((n) => !(agHooks && agHooks[n]));
  const agOk = !!agHooks && !legacyWired && missingNamed.length === 0;
  const agDetail = !agHooksFile ? 'hooks.json not found'
    : `${tilde(agHooksFile)} (${legacyWired ? 'old format: AOS handlers sit under one "hooks" key, agy loads only 1 hook' : missingNamed.length ? `missing ${missingNamed.join(', ')}` : `${AG_NAMED.length}/${AG_NAMED.length} named aos-* hooks`}; manual check: agy logs "loaded N named hooks" at start, N should count every aos-* hook plus your own)`;
  add('hooks', 'Antigravity hooks', agOk, agDetail,
    'Run the AOS installer to rewrite the Antigravity hooks.json in the named format.', true);

  // Codex hooks
  const codexConf = h('.codex', 'config.toml');
  let codexToml = '';
  try { codexToml = readFileSync(codexConf, 'utf8'); } catch {}
  // The Codex CLI drops comments when it rewrites config.toml, so the hook command itself is the evidence.
  const codexWired = /^\s*command\s*=.*(?:go-gate|graph-gate|memb-inject|trail-relay)\.mjs/m.test(codexToml);
  add('hooks', 'Codex config.toml hooks', codexWired,
    existsSync(codexConf) ? `${tilde(codexConf)} (${codexWired ? 'AOS hook commands wired' : 'no AOS hook commands'})` : `${tilde(codexConf)} missing`,
    'Run the AOS installer to wire Codex hooks.', true);

  if (codexWired) {
    // Codex's hash algorithm is not reproduced here. Evidence of a re-trust is only that Codex's set of
    // trust values changed after the install that last changed the AOS hooks (snapshot in ~/.aos/codex-hooks.json).
    const rec = readJson(h('.aos', 'codex-hooks.json'));
    const fix = 'In Codex run /hooks and trust the AOS hooks; a changed hook command needs the review again.\nNon-interactive opt-in: pass --dangerously-bypass-hook-trust to codex.';
    const gateWired = /^\s*command\s*=.*go-gate\.mjs/m.test(codexToml);
    // Informational only: our hook hash is more sensitive than Codex's own, so "no new trust entry" is not proof of an
    // untrusted hook (Lenovo P15 saw a false warning while /hooks showed Active 2/2). Codex says "Hooks need review"
    // itself, and the enforced layer in Codex is aos-gate.rules, not the hook.
    const retrusted = gateWired && rec && rec.hookHash === codexAosHookHash(codexToml)
      && JSON.stringify(codexTrustedHashes(codexToml)) !== JSON.stringify(rec.trustedHashes || []);
    add('hooks', 'Codex hook review', true, retrusted
      ? `Codex trust entries changed after the last AOS hook change (${rec.changedAt || 'time unknown'}): re-trusted after the last hook change`
      : 'trust state is not readable from here: if Codex shows "Hooks need review", run /hooks and trust the AOS go-gate hook (Codex enforces AOS rules through aos-gate.rules either way)', fix, true);
  }
  if (existsSync(h('.codex')) && !gateOff) {
    const rulesFile = h('.codex', 'rules', 'aos-gate.rules');
    let rulesText = '';
    try { rulesText = readFileSync(rulesFile, 'utf8'); } catch {}
    const rulesOk = rulesText.startsWith(CODEX_RULES_HEADER);
    add('hooks', 'Codex rules backstop', rulesOk,
      rulesOk ? `${tilde(rulesFile)} present` : `Codex ignores hook denials in codex exec / bypass modes; the AOS rules file ${tilde(rulesFile)} is missing — run aos update`,
      'Run aos update to write the AOS Codex rules file.', true);
  }
  let codexJson = '';
  try { codexJson =readFileSync(h('.codex', 'hooks.json'), 'utf8'); } catch {}
  if (codexWired && HOOK_SCRIPTS.some((n) => codexJson.includes(n))) {
    add('hooks', 'Codex hooks in two files', false, `hooks in both hooks.json and config.toml (${tilde(h('.codex', 'hooks.json'))} and ${tilde(codexConf)}); Codex merges them and warns at startup`,
      'Run the AOS installer: it moves its hooks out of hooks.json (original kept as hooks.json.aos-bak-<time>).', true);
  }
}

// ---------------------------------------------------------------- 4b. Unified memory start context per harness
// One row per harness: is the hook that injects the start context (memb-inject) wired? Unified memory
// switched off, or a harness that is not installed, is not a failure.
function checkMemoryContext() {
  const area = 'memory';
  let off = [];
  try { off = req('../lib/v5/profile.js').readSettings(HOME, () => {}).disabled || []; } catch {}
  const memOff = off.includes('memb');
  const row = (name, installed, wired, detail, fix) =>
    add(area, name, memOff || !installed || wired, memOff ? 'unified memory is off (memb excluded)' : !installed ? 'harness not installed' : detail, fix, !installed);
  const fix = 'Run aos update to wire the memory start-context hook.';

  const cs = readJson(hc('settings.json'));
  const claudeWired = JSON.stringify(cs?.hooks?.SessionStart || []).includes('memb-inject.mjs') && existsSync(hc('hooks', 'memb-inject.mjs'));
  row('Memory start context Claude Code', existsSync(claudeConfigDir(HOME)), claudeWired,
    claudeWired ? 'memb-inject on SessionStart + UserPromptSubmit' : 'memb-inject.mjs not registered for SessionStart in settings.json', fix);

  let codexToml = '';
  try { codexToml = readFileSync(h('.codex', 'config.toml'), 'utf8'); } catch {}
  const codexWired = /^\s*command\s*=.*memb-inject\.mjs/m.test(codexToml);
  row('Memory start context Codex', existsSync(h('.codex')), codexWired,
    codexWired ? 'memb-inject wired in config.toml' : 'memb-inject.mjs not in ~/.codex/config.toml', fix);

  const agFile = firstExisting([h('.gemini', 'antigravity-cli', 'hooks.json'), h('.gemini', 'config', 'hooks.json'), h('.agents', 'hooks.json')]);
  const agWired = JSON.stringify(readJson(agFile || '')?.['aos-context'] || {}).includes('memb-inject.mjs');
  row('Memory start context Antigravity (agy)', Boolean(agFile) || existsSync(h('.gemini')), agWired,
    agWired ? 'memb-inject in aos-context (PreInvocation, first turn)' : 'aos-context hook without memb-inject.mjs', fix);

  const ocPlugin = h('.config', 'opencode', 'plugins', 'bdb-aos.js');
  let ocSrc = '';
  try { ocSrc = readFileSync(ocPlugin, 'utf8'); } catch {}
  const ocWired = ocSrc.includes('buildMemoryBlock') && existsSync(h('.config', 'opencode', 'plugins', 'aos-hooks', 'memb-inject.mjs'));
  row('Memory start context OpenCode', existsSync(h('.config', 'opencode')), ocWired,
    ocWired ? 'plugin injects memory on the first message' : `${tilde(ocPlugin)} lacks buildMemoryBlock or aos-hooks/memb-inject.mjs`, fix);
}

// ---------------------------------------------------------------- 5b. A2A capability matrix (WP-INSTALL)
// A harness that is installed but whose A2A wiring is broken fails the doctor; a harness that is
// not installed, and the optional agy/Codex/sidecar/SDK pieces, stay warnings (same philosophy as the mcsc row).
// Codex and agy are delegation targets, so they never carry a sidecar
// SessionStart hook (fork-bomb rule); their row checks the pull/CLI pieces.
async function checkA2aMatrix() {
  const area = 'a2a';
  const pkgBin = path.join(path.resolve(fileURLToPath(import.meta.url), '..'), 'a2a-inbox-mcp.mjs');
  // Where the hook and the OpenCode plugin find lib/a2a-inbox.mjs: ../../lib, else ~/.agents/lib.
  const inboxLib = firstExisting([h('.agents', 'lib', 'a2a-inbox.mjs'), path.join(hc('hooks'), '..', '..', 'lib', 'a2a-inbox.mjs')]);

  // Claude Code: drain + stop hooks wired in settings.json, and the lib they import resolvable.
  const claudeSettings = readJson(hc('settings.json'));
  const claudeWired = JSON.stringify(claudeSettings?.hooks || {}).includes('a2a-inbox.mjs');
  const claudeOk = claudeWired && !!inboxLib;
  const sidecarShipped = existsSync(hc('hooks', 'a2a-session.mjs'));
  add(area, 'A2A Claude Code', claudeOk,
    !claudeWired ? 'a2a-inbox.mjs not wired in ~/.claude/settings.json'
      : !inboxLib ? 'a2a-inbox.mjs wired, but lib/a2a-inbox.mjs is not under ~/.agents/lib (the hook would be a no-op)'
        : `a2a-inbox.mjs drain + stop wired in ${tilde(hc('settings.json'))}`,
    'Run the AOS installer to wire the A2A inbox hooks and ship the lib.', !existsSync(claudeConfigDir(HOME)));

  // OpenCode: the plugin carries the sidecar init call and the inbox import.
  const ocDirs = [h('.config', 'opencode')];
  const ocPlugin = firstExisting(ocDirs.map((d) => path.join(d, 'plugins', 'bdb-aos.js')));
  let ocOk = false, ocDetail = `${tilde(h('.config', 'opencode', 'plugins', 'bdb-aos.js'))} missing`;
  if (ocPlugin) {
    let src = '';
    try { src = readFileSync(ocPlugin, 'utf8'); } catch {}
    ocOk = src.includes('a2a-oc.mjs') && src.includes('ensureSidecar') && !!inboxLib;
    ocDetail = ocOk ? `${tilde(ocPlugin)} delivers A2A injections + sidecar init`
      : `${tilde(ocPlugin)} lacks the A2A sidecar init call or lib/a2a-inbox.mjs is missing under ~/.agents/lib`;
  }
  add(area, 'A2A OpenCode', ocOk, ocDetail, 'Run the AOS installer to install the OpenCode plugin.', !ocPlugin);

  // agy: pull-side MCP payload present (registration is a manual `agy mcp add`).
  const agyMcp = firstExisting([h('.agents', 'bin', 'aos-a2a-mcp.mjs'), h('.agents', 'bin', 'a2a-inbox-mcp.mjs'), existsSync(path.join(path.resolve(fileURLToPath(import.meta.url), '..'), 'aos-a2a-mcp.mjs')) ? path.join(path.resolve(fileURLToPath(import.meta.url), '..'), 'aos-a2a-mcp.mjs') : null, existsSync(pkgBin) ? pkgBin : null]);
  add(area, 'A2A agy (Antigravity)', !!agyMcp,
    agyMcp ? `${tilde(agyMcp)} shipped · optional: agy mcp add aos-a2a node "${agyMcp}"` : 'aos-a2a-mcp.mjs missing (install AOS)',
    'Run the AOS installer; register with: agy mcp add aos-a2a node <path to aos-a2a-mcp.mjs>', true);

  // Cursor: check ~/.cursor/mcp.json for aos-a2a with AOS_A2A_NAME
  const cursorMcpFile = h('.cursor', 'mcp.json');
  const cursorCfg = readJson(cursorMcpFile);
  const cursorEntry = cursorCfg?.mcpServers?.['aos-a2a'] || cursorCfg?.mcpServers?.['aos-a2a-mcp'];
  if (cursorEntry) {
    const cursorHasName = Boolean(cursorEntry?.env?.AOS_A2A_NAME);
    add(area, 'A2A Cursor MCP', cursorHasName,
      cursorHasName ? `registered in ${tilde(cursorMcpFile)} with AOS_A2A_NAME="${cursorEntry.env.AOS_A2A_NAME}"`
        : `registered in ${tilde(cursorMcpFile)} but lacks AOS_A2A_NAME in env`,
      'Set AOS_A2A_NAME in ~/.cursor/mcp.json env', true);
  }


  // Codex: live through the shared CLI/lib (no sidecar hook — delegation target).
  const codexLib = firstExisting([h('.agents', 'lib', 'a2a-codex.mjs')]);
  add(area, 'A2A Codex', !!codexLib,
    codexLib ? `${tilde(codexLib)} + a2a-inbox.mjs shipped (live via aos-a2a; no sidecar hook — delegation target)` : `~/.agents/lib/a2a-codex.mjs missing (install AOS)`,
    'Run the AOS installer to ship the A2A Codex lib.', true);

  // Sidecar: who starts `aos-a2a serve`, and the off switch that keeps it a no-op
  // when a session is itself a delegated worker.
  add(area, 'A2A sidecar guard', true,
    sidecarShipped ? 'a2a-session.mjs hook shipped; skipped under AOS_A2A_SIDECAR=off / AOS_DELEGATE_DEPTH>0'
      : 'SessionStart hook not shipped in this package; sidecar starts only from the OpenCode plugin init (also skipped under AOS_A2A_SIDECAR=off)',
    '', true);

  // Dependency the sidecar itself needs.
  let sdkOk = false;
  for (const id of ['@a2a-js/sdk/package.json', '@a2a-js/sdk']) {
    try { req.resolve(id); sdkOk = true; break; } catch { /* try next */ }
  }
  if (!sdkOk) {
    try {
      const { a2aImport } = req('../lib/a2a-sdk-resolve.mjs');
      if (a2aImport) { await a2aImport('@a2a-js/sdk'); sdkOk = true; }
    } catch { /* sdk missing */ }
  }
  add(area, 'A2A SDK dependency', sdkOk,
    sdkOk ? '@a2a-js/sdk resolvable next to this doctor' : '@a2a-js/sdk not resolvable: `aos-a2a serve/send` will fail with a clear SDK-missing error',
    'Install @a2a-js/sdk: npm install @a2a-js/sdk in the package root or re-run the AOS installer: npx @hybridlabor-api/aos@latest', true);
}

// agy workers run without MCP servers through a worker home (no-mcp.js). Warning only: without it agy still works.
function checkAgyWorkerHome() {
  if (!noMcp || !which('agy')) return;
  // Read-only: the worker home is built on the first agy worker start, never by the doctor.
  const wh = h('.aos', 'agy-worker-home');
  const cfg = path.join(wh, '.gemini', 'config', 'mcp_config.json');
  const ok = !existsSync(wh) || Object.keys(readJson(cfg)?.mcpServers ?? { x: 1 }).length === 0;
  add('agy', 'agy worker home (workers without MCP servers)', ok,
    !existsSync(wh) ? 'not built yet: the first agy worker start builds it' : ok ? `${tilde(wh)} present, empty MCP config` : `${tilde(cfg)} is missing or lists MCP servers: agy workers would run with them`,
    IS_WIN ? 'Enable Windows Developer Mode (file symlinks), then re-run aos-doctor; the AOS installer rebuilds it.' : 'Check that ~/.aos is writable, then re-run aos-doctor.', true);
}

// mcsc delegates to agy; agy loading mcsc from its own config recurses into a fork bomb.
function checkAgyMcsc() {
  for (const f of [h('.gemini', 'config', 'mcp_config.json'), h('.gemini', 'antigravity-cli', 'mcp_config.json')]) {
    if (!existsSync(f) || !readJson(f)?.mcpServers?.mcsc) continue;
    add('agy', 'mcsc not in agy config', false, `mcsc is registered in ${tilde(f)} and can recurse (agy -> mcsc -> agy ...)`,
      `Remove the "mcsc" entry from ${tilde(f)}, or re-run the AOS installer (it removes its own entry).`, true);
  }
}

// Antigravity loads <workspace>/.agents/mcp_config.json; in $HOME that picked up the shipped server template.
function checkAgyWorkspaceMcp() {
  const f = h('.agents', 'mcp_config.json');
  if (!existsSync(f)) {
    add('agy', 'agy workspace MCP', true, `${tilde(f)} absent (clean)`, '');
    return;
  }
  const data = readJson(f);
  const servers = Object.keys(data?.mcpServers || {});
  const foreign = servers.filter((s) => s !== 'aos' && s !== 'mcsc');
  if (!foreign.length) {
    add('agy', 'agy workspace MCP', true, `${tilde(f)} lists only ${servers.join(', ') || 'no'} servers`, '');
    return;
  }
  add('agy', 'agy workspace MCP', false,
    `${tilde(f)} lists servers other than aos/mcsc (${foreign.join(', ')}): agy loads them in $HOME`,
    'aos update moves an AOS template copy aside; a user-owned file must be edited or removed by hand', true);
}

// Secrets belong in ~/.aos/secrets.env (0600), never inline in a harness MCP config. Names only, never values.
function checkMcpSecrets() {
  const { findInlineSecrets, secretsPath, readSecretsFile, firecrawlDoctorHint } = req('../lib/mcp-secrets.js');
  // Opt-in firecrawl pick: warn names-only when it is enabled without a key (see docs/firecrawl-mcp.md).
  const firecrawlHint = firecrawlDoctorHint(process.env, readSecretsFile(secretsPath(HOME)).vars);
  if (firecrawlHint) add('mcp-secrets', 'Firecrawl MCP key', false, firecrawlHint,
    'Add FIRECRAWL_API_KEY=value to the MCP secrets file, or unset AOS_FIRECRAWL_MCP to keep the pick off (docs/firecrawl-mcp.md).', true);
  const byEntry = new Map();
  for (const f of findInlineSecrets(HOME, process.env)) {
    const k = `${f.file}\0${f.server}`;
    byEntry.set(k, { ...f, variables: [...(byEntry.get(k)?.variables || []), f.variable] });
  }
  for (const f of byEntry.values()) {
    add('mcp-secrets', 'MCP inline secret', false, `${tilde(f.file)} · server "${f.server}" · ${f.variables.join(', ')}`,
      `Run the AOS installer or Quick Update (moves the value into ${tilde(secretsPath(HOME))} and rewrites the entry), or move it there by hand.`, true);
  }
  const file = secretsPath(HOME);
  let st;
  try { st = statSync(file); } catch { return; }
  const loose = !IS_WIN && (st.mode & 0o077) !== 0;
  add('mcp-secrets', 'MCP secrets file', st.isFile() && !loose,
    !st.isFile() ? `${tilde(file)} is not a regular file` : loose ? `${tilde(file)} has mode ${(st.mode & 0o777).toString(8)}, must be 600` : `${tilde(file)} (mode 600)`,
    `chmod 600 ${tilde(file)}`, true);
}

// .bak files the installer left next to files it manages (<file>.<YYYYMMDD_HHMMSS>.bak, <file> in its manifest).
// Listed only; deleting is the user's call.
function installerBakFiles() {
  const manifest = readJson(h('.agents', '.bdb-install-manifest.json')) || {};
  const managed = new Set(Object.keys(manifest));
  const found = [];
  for (const dir of new Set([...managed].map((f) => path.dirname(f)))) {
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const m = /^(.+)\.\d{8}_\d{6}\.bak$/.exec(n);
      if (m && managed.has(path.join(dir, m[1]))) found.push(path.join(dir, n));
    }
  }
  return found.sort();
}

// MCP gateway (opt-in): every check is a warning until the gateway is installed.
async function checkGateway() {
  try {
    const home = os.homedir();
    const { gatewayChecks } = req('../lib/gateway/doctor.js');
    const { gatewayDir } = req('../lib/gateway/config.js');
    const { harnessMcpFiles, shippedServers } = req('../lib/mcp-secrets.js');
    let status;
    try { status = await (await import('./aos-gateway.mjs')).gatewayStatus({ dir: gatewayDir(home) }); } catch { /* reported as not running */ }
    let checks;
    try { checks = gatewayChecks({ home, files: harnessMcpFiles(home, process.env, process.platform, home), status, shipped: shippedServers() }); } catch (e) { add('gateway', 'gateway checks', false, `could not run: ${e.message}`, '', true); checks = []; }
    for (const c of checks) add(c.area, c.name, c.ok, c.detail, c.fix, c.warningOnly);
    // Per-harness exposure: live tool counts (estimate) when the gateway answers; server list always.
    try {
        let toolCounts = undefined;
        const profile = req('../lib/v5/profile.js');
        const st = profile.readSettings(home, () => {});
        const selection = (st.gateway && st.gateway.servers) || undefined;
        const aosRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const presets = req('../lib/v5/pkg-gateway.js').shippedPresets(aosRoot);
        if (status && status.running) {
            const { gatewayToolCounts } = req('../lib/gateway/doctor.js');
            try { toolCounts = await gatewayToolCounts({ token: fs.readFileSync(path.join(gatewayDir(home), 'token'), 'utf8').trim() }); } catch { /* estimate unavailable */ }
        }
        const { gatewayExposureRows } = req('../lib/gateway/doctor.js');
        const rows = gatewayExposureRows({ files: harnessMcpFiles(home, process.env, process.platform, home), toolCounts: toolCounts || {}, selection, presets: {} });
        for (const r of rows) {
            const counts = r.tools === null ? 'tool count unavailable (gateway not running or did not answer)' : `~${r.tools} tools (estimate)`;
            add('gateway', `gateway exposure in ${path.basename(r.file)}`, r.servers.length > 0,
                `${r.servers.length} gateway server(s): ${r.servers.join(', ')}; ${counts}${r.estimatedTokens !== null ? ` => ~${r.estimatedTokens.toLocaleString()} tokens (estimate: ${r.tools} tools x 85 tokens/tool)` : ''}`, r.servers.length ? '' : 'aos-gateway add <server>', true);
        }
    } catch (e) { add('gateway', 'gateway exposure', false, `could not measure: ${e.message}`, '', true); }
  } catch (e) {
    add('gateway', 'gateway checks', false, `could not run: ${e.message}`, '', true);
  }
}

function checkInstallerBaks() {
  const list = installerBakFiles();
  if (process.argv.includes('--list-baks')) { console.log(list.join('\n')); process.exit(0); }
  if (!list.length) return;
  add('installer', 'Old installer .bak files', false, `${list.length} backup file${list.length > 1 ? 's' : ''} from earlier installer runs, e.g. ${tilde(list[0])}`,
    'Review with: node bin/aos-doctor.mjs --list-baks. Move aside or clean up manually if no longer needed.', true);
}

// AOS Hub (on demand): reachability is informational, not a failure — the hub
// starts only when `aos hub` or a browser opens it. hub.json holds a pid+token
// and must stay 0600. Leftover store backup parked dirs are listed only.
async function checkHub() {
  const hubFile = h('.aos', 'hub', 'hub.json');
  const hubRecord = readJson(hubFile);
  const hubPort = Number(hubRecord?.port) || 7900;
  const hubReachable = await portOpen(hubPort);
  // The hub is the supervisor: once its service is installed, a dead :7900 means nothing restarts the other services.
  const serviceFile = IS_MAC ? h('Library', 'LaunchAgents', 'com.bdb.aos.hub.plist') : IS_WIN ? null : h('.config', 'systemd', 'user', 'com.bdb.aos.hub.service');
  const serviceInstalled = !!serviceFile && existsSync(serviceFile);
  add('hub', 'AOS Hub (:7900)', hubReachable,
    hubReachable ? 'Running on http://127.0.0.1:7900 (one port: /canvas /memb /synapse /trail /store)'
      : serviceInstalled ? 'Service installed but not answering — nothing supervises the other services'
        : 'Not installed or not running — `aos update` installs the hub service (supervisor)',
    serviceInstalled ? 'aos repair' : 'aos update', !serviceInstalled);
  const statusJson = readJson(h('.aos', 'status.json'));
  if (statusJson && typeof statusJson.at === 'number') {
    const ageS = Math.round((Date.now() - statusJson.at) / 1000);
    const svcs = Object.entries(statusJson.services || {});
    const failed = svcs.filter(([, e]) => e && e.failed).map(([id]) => id);
    const down = svcs.filter(([, e]) => e && e.up === false).map(([id]) => id);
    const stale = ageS > 120;
    add('hub', 'Supervisor (status.json)', !stale && failed.length === 0,
      `${svcs.length} services tracked, updated ${ageS}s ago${stale ? ' (stale)' : ''}${down.length ? `, down: ${down.join(', ')}` : ''}${failed.length ? `, gave up on: ${failed.join(', ')}` : ''}`,
      'aos repair', true);
  }

  if (existsSync(hubFile)) {
    let modeLoose = !IS_WIN && (statSync(hubFile).mode & 0o077) !== 0;
    add('hub', 'Hub state file permissions', !modeLoose,
      modeLoose ? `${tilde(hubFile)} has mode ${(statSync(hubFile).mode & 0o777).toString(8)}, must be 600` : `${tilde(hubFile)} exists (mode 600 ok)`,
      `chmod 600 ${tilde(hubFile)}`, true);
  } else {
    add('hub', 'Hub state file permissions', true,
      `${tilde(hubFile)} not present (nothing written yet)`, '', true);
  }

  const backupRoots = [h('.aos', 'store')];
  try {
    const storeDir = h('.aos', 'store');
    const parked = [];
    for (const dir of backupRoots) {
      let names;
      try { names = readdirSync(dir); } catch { continue; }
      for (const n of names) {
        if (/\.(aos-bak-|aos-failed-)/.test(n)) parked.push(path.join(dir, n));
      }
    }
    if (parked.length) {
      add('hub', 'Store backup leftovers', false, `${parked.length} parked backup(s), e.g. ${tilde(parked[0])}`,
        'Rollback or restore first (`aos store rollback`); leftover backups are only removed on a successful rollback or reinstall. Nothing is deleted here.', true);
    }
  } catch { /* informational; never fails the doctor */ }
}

async function checkDaemonsAndModules() {
  // memB venv entry-module import check (10 s timeout)
  {
    const membMcp = firstExisting([h('.gemini', 'config', 'mcps', 'memb-mcp'), ...MODULE_BASES.map((b) => path.join(b, 'memb-mcp')), ...MODULE_BASES.map((b) => path.join(b, 'memB'))]);
    const venvPython = membMcp && !IS_WIN ? path.join(membMcp, '.venv', 'bin', 'python') : membMcp ? path.join(membMcp, '.venv', 'Scripts', 'python.exe') : null;
    if (!membMcp) {
      add('daemons', 'memB MCP venv', true, 'memb-mcp not installed', undefined, true);
    } else if (!venvPython || !existsSync(venvPython)) {
      add('daemons', 'memB MCP venv', false, `no venv python at ${tilde(venvPython || '')}`, 're-run the AOS installer to create the venv', true);
    } else {
      const r = spawnSync(venvPython, ['-c', 'import memb; import run as memb_run'], { cwd: membMcp, timeout: 10000, encoding: 'utf8' });
      if (r.error || r.status !== 0) {
        const why = r.error && r.error.code === 'ETIMEDOUT' ? 'timed out after 10s' : (r.stderr || '').trim().split('\n').slice(-3).join(' | ') || `exit ${r.status}`;
        add('daemons', 'memB MCP venv', false, `entry import failed: ${why}`, 'reinstall the venv: re-run the AOS installer (requirements reconcile) or delete the .venv and re-run', true);
      } else {
        add('daemons', 'memB MCP venv', true, `entry module imports OK (${tilde(venvPython)})`);
      }
    }
  }

  // Hardware & PCB module: KiCad / OpenSCAD app presence. The module registers both MCP
  // servers unconditionally; when the app is absent the installer skips the registration,
  // so the doctor labels it app missing (warning only — installing the app re-enables it).
  {
    const hwDir = findModule('bdb-hardware-pcb');
    if (hwDir) {
      let hardwareApps = null;
      try { hardwareApps = req('../lib/hardware-apps.js'); } catch { /* check skipped, never fatal */ }
      if (hardwareApps) {
        for (const appId of ['kicad', 'openscad']) {
          const status = hardwareApps.hwAppStatus(appId);
          if (status.found) {
            add('daemons', `${hardwareApps.HW_APPS[appId].label} (${appId} MCP)`, true,
              `present: ${tilde(status.path || '')} · shipped launcher: ${path.join(hwDir, 'scripts', appId === 'kicad' ? 'run_kicad_mcp.sh' : 'run_openscad_mcp.sh')}`);
          } else {
            add('daemons', `${hardwareApps.HW_APPS[appId].label} (${appId} MCP)`, false,
              `${hardwareApps.appMissingMessage(appId)} — the ${appId} MCP server was not registered`, 'install KiCad/OpenSCAD, then re-run the AOS installer', true);
          }
        }
      }
    }
  }

  // Codebase Memory MCP: third-party stdio binary, not an @hybridlabor-api module. Nothing
  // is registered without the binary, so the doctor reports presence/'app missing' in the
  // same style as the kicad/openscad check above (warning only — installing the binary
  // re-enables it; docs/codebase-memory.md has the exact install commands).
  {
    let codebaseMemory = null;
    try { codebaseMemory = req('../lib/codebase-memory.js'); } catch { /* check skipped, never fatal */ }
    if (codebaseMemory) {
      const status = codebaseMemory.cmbAppStatus();
      if (status.found) {
        add('daemons', 'codebase-memory-mcp (codebase-memory MCP)', true,
          `present: ${tilde(status.path)} · stdio binary, local SQLite at ~/.cache/codebase-memory-mcp (no cloud calls)`);
      } else {
        add('daemons', 'codebase-memory-mcp (codebase-memory MCP)', false,
          `${codebaseMemory.cmbMissingMessage({ status })} — the codebase-memory MCP server is not registered`,
          'install codebase-memory-mcp: curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash (or npm install -g codebase-memory-mcp)', true);
      }
    }
  }

  // REA MCP: opt-in dual-use reverse-engineering tool. Kept direct (stateful stdio, large tool catalog).
  {
    const reaEnabled = process.env.AOS_REA_MCP === 'on';
    if (!reaEnabled) {
      add('daemons', 'REA MCP', true,
        'off — dual-use research tool; opt-in via AOS_REA_MCP=on or `aos package install rea`',
        'Set AOS_REA_MCP=on to enable the REA reverse-engineering MCP pick.', true);
    } else {
      let reaPath = which('rea');
      let reaVer = null;
      if (reaPath) {
        try {
          reaVer = execFileSync(reaPath, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        } catch {}
      }
      // Fall back to the npm package name when the global `rea` shim is absent.
      if (!reaPath) {
        try {
          reaVer = execFileSync(IS_WIN ? 'npx.cmd' : 'npx', ['-y', 'rea-agents@6.5.0', '--version'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          reaPath = 'npx -y rea-agents@6.5.0';
        } catch {}
      }
      if (reaPath) {
        add('daemons', 'REA MCP', true,
          `present: ${tilde(reaPath)} · stdio MCP (${reaVer || 'v6.5.0'}, direct)`);
      } else {
        add('daemons', 'REA MCP', false,
          'AOS_REA_MCP=on but the REA CLI is not reachable',
          'Run: npm install -g rea-agents@latest (or `aos package install rea` once available)');
      }
    }
  }

  // memB
  const membDir = findModule('memB');
  const membListening = await portOpen(8088);
  // macOS BTM (audit P0-3): a down service whose plist exists but whose agent is not loaded
  // after login is macOS background-revocation, not a missing file — say the Login Items fix
  // instead of `launchctl load -w`, which cannot lift it.
  const membPlist = IS_MAC ? h('Library', 'LaunchAgents', 'com.bdb.memb.webui.plist') : null;
  const membNotLoaded = membPlist && existsSync(membPlist) && !membListening && agentLoadStatus('com.bdb.memb.webui') === 'no';
  add('daemons', 'memB WebUI (:8088)', membListening,
    membListening ? 'Active & listening on http://127.0.0.1:8088' : 'Not listening on port 8088',
    membNotLoaded ? btmFixHint('com.bdb.memb.webui') : IS_MAC ? 'launchctl load -w ~/Library/LaunchAgents/com.bdb.memb.webui.plist' : 'Start src/backend/server.py in memB module.');

  // Synapse 3D
  const synapseListening = await portOpen(7781);
  const synapsePlist = IS_MAC ? h('Library', 'LaunchAgents', 'com.bdb.synapse.plist') : null;
  const synapseNotLoaded = synapsePlist && existsSync(synapsePlist) && !synapseListening && agentLoadStatus('com.bdb.synapse') === 'no';
  add('daemons', 'Synapse 3D (:7781)', synapseListening,
    synapseListening ? 'Active & listening on http://127.0.0.1:7781' : 'Not listening on port 7781',
    synapseNotLoaded ? btmFixHint('com.bdb.synapse') : IS_MAC ? 'launchctl load -w ~/Library/LaunchAgents/com.bdb.synapse.plist' : 'synapse serve --port 7781', true);

  // BDB OS Remote Gateway
  const remoteListening = await portOpen(9080);
  add('daemons', 'Remote Gateway (:9080)', remoteListening,
    remoteListening ? 'Active & listening on port 9080' : 'Not listening on port 9080',
    'Start gateway via ~/dev/bdb-dev/bdb-os-remote/start-gateway.sh', true);

  // BDB Agent Orchestrator (AO)
  const aoBin = which('ao') || (existsSync(h('.local', 'bin', 'ao')) ? h('.local', 'bin', 'ao') : null);
  let aoVer = null;
  if (aoBin) {
    try {
      aoVer = execFileSync(aoBin, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {}
  }
  const aoListening = await portOpen(3101);
  let aoServiceInfo = 'Not running';
  if (aoBin) {
    try {
      const statusOut = execFileSync(aoBin, ['service', 'status'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      const runningLine = statusOut.split('\n').find(l => l.toLowerCase().includes('running'));
      if (runningLine) aoServiceInfo = runningLine.trim();
    } catch {}
  }

  const aoOk = !!aoBin;
  add('daemons', 'AO Agent Orchestrator', aoOk,
    aoBin ? `${tilde(aoBin)} (${aoVer || 'installed'}) · Daemon :3101: ${aoListening ? 'ONLINE' : 'STOPPED'} (${aoServiceInfo})` : 'ao binary not found',
    IS_MAC && IS_ARM64
      ? 'Enable AO in the installer or run: ao service install'
      : 'AO binary is arm64 macOS native; build from source on other platforms: github.com/hybridlabor-api/bdb-agent-orchestrator', true);

  // Installed ao vs a local AO checkout's HEAD, read from the binary's embedded build info.
  const aoCheckout = firstExisting([h('dev', 'agents', 'bdb-agent-orchestrator'), h('dev', 'bdb-dev', 'bdb-agent-orchestrator')]);
  if (aoBin && aoCheckout && existsSync(path.join(aoCheckout, '.git'))) {
    const build = readGoBuildInfo(aoBin);
    let head = null;
    try { head = execFileSync('git', ['--no-optional-locks', '-C', aoCheckout, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
    // Only backend/ builds the binary: commits elsewhere in the checkout (app, docs) do not make it stale.
    let backendSame = false;
    if (build && head && build.revision !== head) {
      try { execFileSync('git', ['--no-optional-locks', '-C', aoCheckout, 'diff', '--quiet', build.revision, head, '--', 'backend'], { stdio: 'ignore' }); backendSame = true; } catch {}
    }
    const same = !!(build && head && (build.revision === head || backendSame) && !build.modified);
    add('daemons', 'AO revision vs checkout', same,
      !build ? 'Installed ao has no readable build revision'
        : `Installed ${build.revision.slice(0, 9)}${build.modified ? ' (dirty build)' : ''} · checkout HEAD ${head ? head.slice(0, 9) : 'unknown'}${backendSame ? ' (backend/ unchanged)' : ''}`,
      `Rebuild from a clean checkout: cd ${tilde(path.join(aoCheckout, 'backend'))} && go build -ldflags='-s -w' -o ~/.local/bin/ao.new ./cmd/ao && mv ~/.local/bin/ao.new ~/.local/bin/ao && ao service install`, true);
  }

  // Code-signing check for AO on macOS
  if (IS_MAC && aoBin) {
    let signed = false;
    try {
      execFileSync('codesign', ['-v', aoBin], { stdio: 'ignore' });
      signed = true;
    } catch {}
    add('security', 'AO Binary Signature (AMFI)', signed,
      signed ? 'Binary code-signed (AMFI safe)' : 'Unsigned binary — AMFI might terminate on launch',
      `Run: codesign -s - -f "${aoBin}"`);
  }

  // macOS BTM sweep (audit P0-3): any com.bdb.* LaunchAgent whose plist is installed but
  // whose label is not loaded after login. Read-only `launchctl print` only (never sfltool);
  // under a test sandbox without a run override the helper answers nothing, so the row is skipped.
  if (IS_MAC) {
    for (const a of btmNotLoadedAgents(HOME)) {
      add('daemons', `LaunchAgent ${a.label}`, false,
        'plist installed but the agent is not loaded after login (macOS revoked its background authorization)',
        a.fix, true);
    }
  }
}

function report() {
  if (JSON_OUT) {
    const ok = results.filter(r => !r.warningOnly).every(r => r.ok);
    console.log(JSON.stringify({ ok, platform: process.platform, arch: process.arch, results }, null, 2));
    return;
  }

  console.log(`\n======================================================`);
  console.log(`   🩺 AOS SYSTEM CHECKUP & DIAGNOSTIC REPORT`);
  console.log(`   Platform: ${process.platform} (${process.arch}) · Node: ${process.version}`);
  console.log(`======================================================`);

  let currentArea = '';
  for (const r of results) {
    if (r.area !== currentArea) {
      currentArea = r.area;
      console.log(`\n[${currentArea.toUpperCase()}]`);
    }
    const icon = r.ok ? '✅' : (r.warningOnly ? '⚠️ ' : '❌');
    console.log(`  ${icon} ${r.name.padEnd(28)} ${r.detail}`);
    if (!r.ok && r.fix) {
      console.log(`     ↳ Fix: ${r.fix}`);
    }
  }

  const criticalFails = results.filter(r => !r.ok && !r.warningOnly);
  const warnings = results.filter(r => !r.ok && r.warningOnly);

  console.log(`\n------------------------------------------------------`);
  if (criticalFails.length === 0) {
    console.log(`🎉 ALL CRITICAL CHECKS PASSED (${results.length - warnings.length}/${results.length})! AOS is properly configured.`);
    if (warnings.length > 0) {
      console.log(`   (${warnings.length} optional warning(s) detected — see hints above).`);
    }
  } else {
    console.log(`⚠️  ${criticalFails.length} critical check(s) need attention! Follow the fix instructions above.`);
  }
  console.log(`------------------------------------------------------\n`);
  try {
    const updateInfo = updateCheck.getCachedUpdateInfo({ home: HOME, installed: pkg.version });
    if (updateInfo.updateAvailable && updateInfo.latest) {
      updateCheck.notifySurface('doctor', {
        home: HOME,
        installed: pkg.version,
        latest: updateInfo.latest,
        out: (msg) => console.log(msg),
      });
    }
  } catch {}
}

// ---------------------------------------------------------------- Run
checkPrereqs();
checkAosCore();
// ---------------------------------------------------------------- 4b. bdb-aos plugin registration per harness
function checkPlugins() {
  const PLUGIN_ID = 'bdb-aos@bdb-marketplace';
  const optOut = 'Opted out ("false" in settings.json); nothing to do.';
  const settings = readJson(hc('settings.json'));
  if (existsSync(claudeConfigDir(HOME))) {
    const flag = settings?.enabledPlugins?.[PLUGIN_ID];
    const marketplace = !!settings?.extraKnownMarketplaces?.['bdb-marketplace'];
    const installed = !!pluginSkills(HOME);
    const ok = flag === true && marketplace && installed;
    add('plugins', 'Claude Code bdb-aos plugin', flag === false || ok,
      flag === false ? 'disabled by the user' : `settings.json ${flag === true ? 'enables' : 'does not enable'} ${PLUGIN_ID}, marketplace ${marketplace ? 'known' : 'missing'}, plugin cache ${installed ? 'present' : 'missing'}`,
      flag === false ? optOut : 'Run the AOS installer (registers settings.json), then: claude plugin marketplace add hybridlabor-api/aos && claude plugin install bdb-aos@bdb-marketplace', true);
  }
  // Same resolver as the installer's CLI steps: finds claude even when this shell's PATH misses it
  // (GUI daemons, scheduled tasks). installed+enabled / installed+disabled / missing, from the CLI itself.
  const { resolveCommand, run: runCli } = req('../lib/cli-spawn.js');
  const claudeBin = which('claude') || resolveCommand('claude');
  const pluginRow = (() => {
    if (!claudeBin) return { ok: false, detail: 'claude CLI not found on PATH or in a known install location; plugin bdb-aos missing', fix: 'Install Claude Code, then: claude plugin marketplace add hybridlabor-api/aos; claude plugin install bdb-aos@bdb-marketplace' };
    return pmDoctorRow(runCli('claude', ['plugin', 'list'], { timeout: 15000 }), PLUGIN_ID);
  })();
  if (pluginRow) add('plugins', 'Claude plugin via CLI', pluginRow.ok, pluginRow.detail, pluginRow.fix, true);
  if (claudeBin) {
    const MODS = ['fleet', 'sessions', 'alert', 'control'];
    const enabled = MODS.filter((m) => settings?.enabledPlugins?.[`bdb-aos-${m}@bdb-marketplace`] === true);
    const off = MODS.filter((m) => !enabled.includes(m));
    let ver = null;
    try { ver = /(\d+\.\d+\.\d+)/.exec(execFileSync(claudeBin, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }))?.[1] || null; } catch { /* version unknown */ }
    add('plugins', 'Claude Code mods', off.length === 0,
      `enabled: ${enabled.join(', ') || 'none'}; not enabled: ${off.join(', ') || 'none'}; Claude Code in PATH is ${ver || 'of unknown version'}`,
      `Mods need Claude Code >= 2.1.287 (the doctor checks the CLI in PATH). Run \`claude update\`, then \`aos package install ${off.join('|')}\`.`, true);
  }
  if (existsSync(h('.codex'))) {
    const dir = h('.codex', 'plugins', 'cache', 'bdb-aos', 'bdb-aos');
    const ok = existsSync(dir);
    add('plugins', 'Codex bdb-aos plugin', ok, ok ? tilde(dir) : `${tilde(dir)} missing`,
      'Run the AOS installer, or: codex plugin marketplace add hybridlabor-api/aos && codex plugin add bdb-aos@bdb-aos', true);
  }
  if (existsSync(h('.gemini'))) {
    const dir = h('.gemini', 'config', 'plugins', 'bdb-aos');
    const ok = existsSync(dir);
    add('plugins', 'Antigravity bdb-aos plugin', ok, ok ? tilde(dir) : `${tilde(dir)} missing`,
      'Run the AOS installer (needs agy on PATH), or: agy plugin install <plugin dir>', true);
  }
}

// ---------------------------------------------------------------- 4c. agent model overrides (docs/agent-models.md)
// Format check only: no network, no provider lists. The installer passes these strings through verbatim.
function checkAgentModels() {
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const agentsMd = firstExisting([path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.agents', 'AGENTS.md'), h('.agents', 'AGENTS.md')]);
  const slugs = agentsMd ? new Set([...readFileSync(agentsMd, 'utf8').split(/\n## /).slice(1)]
    .filter((b) => /-\s*\*\*Role\*\*:/.test(b))
    .map((b) => b.split('\n')[0].replace(/^[^\w]+/, '').trim().split(/\s+/)[0].toLowerCase().replace(/-/g, '_'))) : null;
  // Node ids and the /startcycle-graph helper agents are valid role keys too (docs/agent-models.md).
  if (slugs) for (const k of ['ui_ux', 'engineering', 'media_eventtech', 'shipping', 'load_registry', 'merge_state', 'archify_verify', 'validate_skills']) slugs.add(k);
  const files = [
    path.join(process.cwd(), '.aos', 'pipeline.json'),
    path.join(process.cwd(), '.aos', 'project.json'),
    h('.aos', 'pipeline.json'),
  ].filter(existsSync).map((f) => realpathSync(f)).filter((f, i, a) => a.indexOf(f) === i);
  for (const file of files) {
    const data = readJson(file);
    if (data === null) {
      if (!/project\.json$/.test(file)) add('agents', `Agent models ${tilde(file)}`, false, `${tilde(file)} is not valid JSON; its model overrides are ignored`, 'Fix the JSON or delete the file.');
      continue;
    }
    for (const [role, cfg] of Object.entries(data.pipeline || {})) {
      if (!isObject(cfg)) continue;
      if (slugs && !slugs.has(role.toLowerCase().replace(/-/g, '_'))) {
        add('agents', `Agent role ${role}`, false, `${tilde(file)}: role "${role}" matches no agent in AGENTS.md; its overrides are inert`,
          `Use a real agent slug with "-" as "_" (${[...slugs].join(', ')}).`, true);
      }
      if (cfg.tier !== undefined) {
        add('agents', `Agent tier ${role}`, false, `${tilde(file)}: role "${role}" has "tier" = ${JSON.stringify(cfg.tier)}; tiers are legacy and ignored`,
          `Remove "tier" from role "${role}"; a model is set only through models.<harness> (docs/agent-models.md).`, true);
      }
      const entries = [];
      if (cfg.models !== undefined && !isObject(cfg.models)) {
        add('agents', `Agent models ${role}`, false, `${tilde(file)}: role "${role}", models must be an object of harness to model`, `Fix or remove "models" for role "${role}" in ${tilde(file)}.`);
      } else {
        for (const [harness, value] of Object.entries(cfg.models || {})) entries.push([harness, value, `models.${harness}`]);
      }
      if (cfg.model !== undefined) {
        for (const harness of cfg.harness ? [cfg.harness] : HARNESSES) entries.push([harness, cfg.model, 'model']);
      }
      for (const [harness, value, field] of entries) {
        const problem = modelProblem(harness, value, { strictAgy: true });
        if (problem) add('agents', `Agent model ${role}/${harness}`, false,
          `${tilde(file)}: role "${role}", harness "${harness}", ${field} = ${JSON.stringify(value)}: ${problem}`,
          `Correct or remove ${field} for role "${role}" in ${tilde(file)}; AOS never substitutes another model.`);
      }
    }
  }
}

checkHarnesses();
checkAgentModels();
checkHooks();
checkMemoryContext();
checkPlugins();
checkAgyMcsc();
checkAgyWorkspaceMcp();
checkAgyWorkerHome();
checkMcpSecrets();
checkInstallerBaks();
await checkHub();
await checkA2aMatrix();
await checkDaemonsAndModules();
await checkGateway();
report();

const hasCriticalFails = results.some(r => !r.ok && !r.warningOnly);
process.exit(hasCriticalFails ? 1 : 0);
