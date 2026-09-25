#!/usr/bin/env node
// AOS System Checkup & Doctor: Verifies system dependencies, file placement,
// cross-platform harness synchronization, daemons and hooks across macOS and Windows.
// Usage:
//   aos doctor
//   node bin/aos-doctor.mjs [--json] [--net]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const JSON_OUT = process.argv.includes('--json');
const NET = process.argv.includes('--net');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_ARM64 = process.arch === 'arm64';

const h = (...p) => path.join(HOME, ...p);
const tilde = (p) => (p || '').replace(HOME, '~');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const firstExisting = (candidates) => candidates.find((c) => existsSync(c)) || null;

const MODULE_BASES = [
  h('.agents'),
  h('.claude'),
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
    return tilde(execFileSync(probe, [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0]);
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
  add('prereq', 'Python 3', !!pyProbe, pyProbe || 'missing — needed for memB venv & OpenWiki',
    IS_WIN ? 'Install Python from python.org or winget install Python.Python.3.12' : 'brew install python3');

  const gitProbe = which('git');
  add('prereq', 'Git CLI', !!gitProbe, gitProbe || 'missing — required for AOS workflows and worktrees',
    IS_WIN ? 'Install Git via git-scm.com or winget install Git.Git' : 'brew install git / xcode-select --install');

  const uvProbe = which('uv');
  add('prereq', 'uv package manager', !!uvProbe, uvProbe ? `${uvProbe} (fast venv seeding)` : 'optional — pip fallback will be used',
    'curl -LsSf https://astral.sh/uv/install.sh | sh (or pip install uv)', true);

  const ghProbe = which('gh');
  add('prereq', 'GitHub CLI (gh)', !!ghProbe, ghProbe ? `${ghProbe}` : 'optional — needed for repo automation & release PRs',
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
      const latest = execFileSync('npm', ['view', '@hybridlabor-api/aos', 'version'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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

  // Check MCSC registration
  const mcpConfigCandidates = [
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'mcp_config.json'),
    h('.agents', 'mcp_config.json'),
    h('dev', 'bdb-dev', 'bdb-dev-optimized-agent-skills', 'mcp_config.json')
  ];
  const mcpConfigPath = firstExisting(mcpConfigCandidates);
  const mcpConfig = mcpConfigPath ? readJson(mcpConfigPath) : null;
  const hasMcsc = !!mcpConfig?.mcpServers?.mcsc;
  add('aos-core', 'MCSC Telemetry Registration', hasMcsc,
    hasMcsc ? `Registered in ${tilde(mcpConfigPath)}` : 'mcsc missing from mcp_config.json',
    'Re-run installer to register mcsc cross-harness adapter.');

  // Retired module check (CDC bug prevention)
  const retired = findModule('bdb-os-agent-workspace');
  if (retired) {
    add('aos-core', 'Retired AO module', false,
      `${tilde(retired)} — archived predecessor with known CDC loop bug`,
      `Remove directory: rm -rf ${tilde(retired)} — AO is now bdb-agent-orchestrator.`);
  }
}

// ---------------------------------------------------------------- 3. Harness Placement & Skills Sync
function checkHarnesses() {
  const harnesses = [
    { name: 'Claude Code', path: h('.claude', 'skills') },
    { name: 'Gemini / Antigravity', path: firstExisting([h('.gemini', 'config', 'skills'), h('.gemini', 'antigravity-cli', 'skills')]) || h('.gemini', 'config', 'skills') },
    { name: 'Codex', path: h('.codex', 'skills') },
    { name: 'Cursor', path: h('.cursor', 'skills') },
    { name: 'Roo Code', path: h('.roo', 'skills') },
  ];

  const SENTINEL = 'startcycle';
  for (const hr of harnesses) {
    const exists = existsSync(hr.path);
    const count = dirCount(hr.path);
    const hasSentinel = existsSync(path.join(hr.path, SENTINEL, 'SKILL.md'));
    const ok = exists && count > 0 && hasSentinel;
    add('harnesses', `${hr.name} Skills`, ok,
      ok ? `${tilde(hr.path)} (${count} skills, sentinel verified)` : (exists ? `${tilde(hr.path)} (${count} skills, sentinel missing)` : `${tilde(hr.path)} not synced`),
      `Run 'npx @hybridlabor-api/aos@latest' and select ${hr.name} to sync skills.`, !exists);
  }

  // OpenCode Plugin check
  const opencodePlugin = firstExisting([
    h('.opencode', 'plugins', 'bdb-aos.js'),
    h('.config', 'opencode', 'plugins', 'bdb-aos.js')
  ]);
  add('harnesses', 'OpenCode Plugin', !!opencodePlugin,
    opencodePlugin ? tilde(opencodePlugin) : 'bdb-aos.js not installed in OpenCode plugins',
    'Run the AOS installer to wire OpenCode telemetry plugin.', true);
}

// ---------------------------------------------------------------- 4. Hooks & Security Gates
function checkHooks() {
  const claudeHooksDir = h('.claude', 'hooks');
  const EXPECTED_VERSION = { 'memb-inject.mjs': 5 };
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
  const claudeSettings = readJson(h('.claude', 'settings.json'));
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
  const agWired = JSON.stringify(agHooks?.hooks || {});
  add('hooks', 'Antigravity hooks', agWired.includes('memb-inject.mjs'),
    agHooksFile ? `${tilde(agHooksFile)} (${agWired.includes('memb-inject.mjs') ? 'memb-inject wired' : 'unwired'})` : 'hooks.json not found',
    'Run the AOS installer to configure Antigravity hooks.', true);

  // Codex hooks
  const codexConf = h('.codex', 'config.toml');
  let codexToml = '';
  try { codexToml = readFileSync(codexConf, 'utf8'); } catch {}
  add('hooks', 'Codex config.toml hooks', codexToml.includes('AOS:HOOKS'),
    existsSync(codexConf) ? `${tilde(codexConf)} (${codexToml.includes('AOS:HOOKS') ? 'AOS:HOOKS block wired' : 'no AOS:HOOKS'})` : `${tilde(codexConf)} missing`,
    'Run the AOS installer to wire Codex hooks.', true);
}

// ---------------------------------------------------------------- 5. Daemons & Ecosystem Modules (Including AO)
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
      : 'AO binary is arm64 macOS native; build from source on other platforms: github.com/hybridlabor-api/bdb-agent-orchestrator', false);

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
│   🚀 BDB AGENT ORCHESTRATOR APP — FINALE BETA JETZT VERFÜGBAR!              │
│                                                                              │
│   Die nächste Generation der Cross-Harness Multi-Agenten-Orchestrierung      │
│   ist jetzt als finale Beta für alle User freigeschaltet.                    │
│                                                                              │
│   • Dashboard & WebUI:  http://localhost:3101                                │
│   • Service-Befehl:     ao service install  (Hintergrunddienst aktivieren)   │
│   • Quick Launch:       ao open  oder  ao service status                     │
│   • Features:           Session-Telemetrie, Live-AgentTrail & Multi-Workspaces│
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
await checkDaemonsAndModules();
report();

const hasCriticalFails = results.some(r => !r.ok && !r.warningOnly);
process.exit(hasCriticalFails ? 1 : 0);
