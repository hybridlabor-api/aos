#!/usr/bin/env node
// AOS System Checkup & Doctor: Verifies system dependencies, file placement,
// cross-platform harness synchronization, daemons and hooks across macOS and Windows.
// Usage:
//   aos doctor
//   node bin/aos-doctor.mjs [--json] [--net]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { pluginSkills, claudeConfigDir } = req('../lib/plugin-evidence.js');
const { readGoBuildInfo } = req('../lib/go-buildinfo.js');
const HOME = os.homedir();
const JSON_OUT = process.argv.includes('--json');
const NET = process.argv.includes('--net');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_ARM64 = process.arch === 'arm64';

const h = (...p) => path.join(HOME, ...p);
const hc = (...p) => path.join(claudeConfigDir(HOME), ...p);
const tilde = (p) => (p || '').replace(HOME, '~');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

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

const which = (bin) => {
  const probe = IS_WIN ? 'where.exe' : 'which';
  try {
    return execFileSync(probe, [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
  } catch {
    return null;
  }
};

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
  add('prereq', 'Git CLI', !!gitProbe, tilde(gitProbe) || 'missing — required for AOS workflows and worktrees',
    IS_WIN ? 'Install Git via git-scm.com or winget install Git.Git' : 'brew install git / xcode-select --install');

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

  // Check store index
  const storeIndexCandidates = [
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'lib', 'ecc-store-index.json'),
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
      `Remove directory: rm -rf ${tilde(retired)} — AO is now bdb-agent-orchestrator.`);
  }
}

const { parseJsonc } = req('../lib/jsonc.js');

// Zen gateway limit: a tool name (OpenCode builds it from the MCP server name) is at most 64 characters.
// Names only, no network: the tool part of the name is not known here.
const ZEN_TOOL_NAME_MAX = 64;

function checkOpencodeMcpNames() {
  const dirs = [process.platform === 'win32' ? path.join(process.env.APPDATA || HOME, 'opencode') : h('.config', 'opencode')];
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
function checkHarnesses() {
  const harnesses = [
    { name: 'Claude Code', path: hc('skills') },
    { name: 'Gemini / Antigravity', path: firstExisting([h('.gemini', 'config', 'skills'), h('.gemini', 'antigravity-cli', 'skills')]) || h('.gemini', 'config', 'skills') },
    { name: 'Codex', path: h('.agents', 'skills') },
    { name: 'Cursor', path: h('.cursor', 'skills') },
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
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(path.join(codexRoot, d.name, 'SKILL.md')) && existsSync(path.join(h('.agents', 'skills'), d.name, 'SKILL.md'))).length : 0;
  if (doubled) {
    add('harnesses', 'Codex duplicate skills', false, `${doubled} skill(s) exist in both ${tilde(codexRoot)} and ~/.agents/skills, so Codex lists them twice`,
      `Run 'npx @hybridlabor-api/aos@latest' once (it retires AOS copies from ${tilde(codexRoot)} with a backup) or move your own copies out.`, true);
  }

  const ov = req('../lib/opencode-verify.js');
  results.push(...ov.checkOpencode({ home: HOME }), ...ov.checkAcpAndGoCheck({ home: HOME }));
  checkOpencodeMcpNames();
}

// ---------------------------------------------------------------- 4. Hooks & Security Gates
function checkHooks() {
  const claudeHooksDir = hc('hooks');
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
  const claudeWiredOk = wired.includes('go-gate.mjs') && wired.includes('memb-inject.mjs');
  add('hooks', 'Claude settings.json wired', claudeWiredOk,
    claudeWiredOk ? 'PreToolUse & UserPromptSubmit registered' : 'Hooks not fully registered in ~/.claude/settings.json',
    'Run the AOS installer to wire hooks in settings.json.');

  // Antigravity hooks
  const agHooksFile = firstExisting([
    h('.gemini', 'antigravity-cli', 'hooks.json'),
    h('.gemini', 'config', 'hooks.json'),
    h('.agents', 'hooks.json')
  ]);
  const agHooks = agHooksFile ? readJson(agHooksFile) : null;
  // New format: one named hook per concern at the top level; legacy: all handlers under "hooks".
  const AG_NAMED = ['aos-go-gate', 'aos-conventional-commits', 'aos-env-protection', 'aos-trail-relay', 'aos-graph-gate', 'aos-context'];
  const namedWired = AG_NAMED.filter((n) => agHooks && agHooks[n]);
  const legacyWired = JSON.stringify(agHooks?.hooks || {}).includes('memb-inject.mjs');
  const agOk = namedWired.includes('aos-context') || legacyWired;
  add('hooks', 'Antigravity hooks', agOk,
    agHooksFile ? `${tilde(agHooksFile)} (${namedWired.length ? `${namedWired.length}/${AG_NAMED.length} named aos-* hooks` : legacyWired ? 'legacy "hooks" lump, memb-inject wired' : 'unwired'})` : 'hooks.json not found',
    'Run the AOS installer to configure Antigravity hooks.', true);

  // Codex hooks
  const codexConf = h('.codex', 'config.toml');
  let codexToml = '';
  try { codexToml = readFileSync(codexConf, 'utf8'); } catch {}
  // The Codex CLI drops comments when it rewrites config.toml, so the hook command itself is the evidence.
  const codexWired = /^\s*command\s*=.*(?:go-gate|graph-gate|memb-inject|trail-relay)\.mjs/m.test(codexToml);
  add('hooks', 'Codex config.toml hooks', codexWired,
    existsSync(codexConf) ? `${tilde(codexConf)} (${codexWired ? 'AOS hook commands wired' : 'no AOS hook commands'})` : `${tilde(codexConf)} missing`,
    'Run the AOS installer to wire Codex hooks.', true);
}

// ---------------------------------------------------------------- 5. Daemons & Ecosystem Modules (Including AO)
// mcsc delegates to agy; agy loading mcsc from its own config recurses into a fork bomb.
function checkAgyMcsc() {
  for (const f of [h('.gemini', 'config', 'mcp_config.json'), h('.gemini', 'antigravity-cli', 'mcp_config.json')]) {
    if (!existsSync(f) || !readJson(f)?.mcpServers?.mcsc) continue;
    add('agy', 'mcsc not in agy config', false, `mcsc is registered in ${tilde(f)} and can recurse (agy -> mcsc -> agy ...)`,
      `Remove the "mcsc" entry from ${tilde(f)}, or re-run the AOS installer (it removes its own entry).`, true);
  }
}

async function checkDaemonsAndModules() {
  // memB
  const membDir = findModule('memB');
  const membListening = await portOpen(8088);
  add('daemons', 'memB WebUI (:8088)', membListening,
    membListening ? 'Active & listening on http://127.0.0.1:8088' : 'Not listening on port 8088',
    IS_MAC ? 'launchctl load -w ~/Library/LaunchAgents/com.bdb.memb.webui.plist' : 'Start src/backend/server.py in memB module.');

  // Synapse 3D
  const synapseListening = await portOpen(7781);
  add('daemons', 'Synapse 3D (:7781)', synapseListening,
    synapseListening ? 'Active & listening on http://127.0.0.1:7781' : 'Not listening on port 7781',
    IS_MAC ? 'launchctl load -w ~/Library/LaunchAgents/com.bdb.synapse.plist' : 'synapse serve --port 7781', true);

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
    const same = !!(build && head && build.revision === head && !build.modified);
    add('daemons', 'AO revision vs checkout', same,
      !build ? 'Installed ao has no readable build revision'
        : `Installed ${build.revision.slice(0, 9)}${build.modified ? ' (dirty build)' : ''} · checkout HEAD ${head ? head.slice(0, 9) : 'unknown'}`,
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
}

// ---------------------------------------------------------------- 6. Output & Announcement
function printAoAnnouncement() {
  console.log(`
╭──────────────────────────────────────────────────────────────────────────────╮
│                                                                              │
│   BDB AGENT ORCHESTRATOR APP — FINAL BETA NOW AVAILABLE                      │
│                                                                              │
│   The next generation of cross-harness multi-agent orchestration             │
│   is now open to every user as a final beta.                                 │
│                                                                              │
│   • Dashboard & WebUI:  http://localhost:3101                                │
│   • Service command:    ao service install  (enables the background service) │
│   • Quick launch:       ao open  or  ao service status                       │
│   • Features:           session telemetry, live AgentTrail, multi-workspaces │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
`);
}

function report() {
  if (JSON_OUT) {
    const ok = results.filter(r => !r.warningOnly).every(r => r.ok);
    console.log(JSON.stringify({ ok, platform: process.platform, arch: process.arch, results }, null, 2));
    return;
  }

  printAoAnnouncement();

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
}

// ---------------------------------------------------------------- Run
checkPrereqs();
checkAosCore();
checkHarnesses();
checkHooks();
checkAgyMcsc();
await checkDaemonsAndModules();
report();

const hasCriticalFails = results.some(r => !r.ok && !r.warningOnly);
process.exit(hasCriticalFails ? 1 : 0);
