#!/usr/bin/env node
// AOS machine doctor: reports what a full AOS install needs and what this
// machine actually has. Read-only — it never installs or edits anything.
//   node aos-doctor.mjs [--json] [--net]
// --net additionally asks npm whether a newer AOS is published (needs network).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const JSON_OUT = process.argv.includes('--json');
const NET = process.argv.includes('--net');
const IS_MAC = process.platform === 'darwin';

const h = (...p) => path.join(HOME, ...p);
const AGENTS = h('.agents');
const MCPS = h('.gemini', 'config', 'mcps');   // installer's canonical MCP code target

const results = [];
const add = (area, name, ok, detail, fix) => results.push({ area, name, ok, detail, fix });

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const tilde = (p) => (p || '').replace(HOME, '~');
const which = (bin) => { try { return tilde(execFileSync('which', [bin], { encoding: 'utf8' }).trim()); } catch { return null; } };
const dirCount = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).length; } catch { return 0; } };

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

// ---------------------------------------------------------------- prereqs
function checkPrereqs() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('prereq', 'node >= 22', nodeMajor >= 22, `v${process.versions.node}`,
    'OpenWiki needs Node 22+. Install via nvm/homebrew, then re-run.');

  for (const [bin, why, fix] of [
    ['python3', 'memB venv + OpenWiki daemon', 'Install Python 3 (brew install python / python.org).'],
    ['git', 'every per-project step', 'Install git.'],
    ['uv', 'fast, reliable memB venv seeding', 'curl -LsSf https://astral.sh/uv/install.sh | sh (optional but recommended — pip fallback exists).'],
    ['gh', 'private-repo creation in /aos-project-init', 'brew install gh && gh auth login (optional).'],
  ]) {
    const p = which(bin);
    add('prereq', bin, !!p, p || `missing — needed for ${why}`, fix);
  }
}

// ---------------------------------------------------------------- AOS core
function checkAos() {
  const manifestPath = path.join(AGENTS, '.bdb-manifest.json');
  const manifest = readJson(manifestPath);
  add('aos', 'install manifest', !!manifest,
    manifest ? `v${manifest.version} · tier ${manifest.tier} · modules: ${(manifest.installedModules || []).join(', ') || 'none'}` : `${manifestPath} missing`,
    'npx -y @hybridlabor-api/aos@latest');

  if (manifest && NET) {
    try {
      const latest = execFileSync('npm', ['view', '@hybridlabor-api/aos', 'version'], { encoding: 'utf8', timeout: 8000 }).trim();
      add('aos', 'version vs npm', manifest.version === latest, `local v${manifest.version} · npm v${latest}`,
        'npx -y @hybridlabor-api/aos@latest');
    } catch {
      add('aos', 'version vs npm', false, 'npm view failed (offline?)', 'Re-run with network, or skip --net.');
    }
  }

  const harnesses = [
    ['Claude Code', h('.claude', 'skills')],
    ['Gemini / Antigravity', h('.gemini', 'config', 'skills')],
    ['Codex', h('.codex', 'skills')],
    ['OpenCode', h('.config', 'opencode', 'skill')],
  ];
  const synced = harnesses.filter(([, p]) => dirCount(p) > 0);
  add('aos', 'skills synced to harnesses', synced.length > 0,
    synced.length ? synced.map(([n, p]) => `${n}: ${dirCount(p)}`).join(' · ') : 'no harness skill directory holds any skill',
    'npx -y @hybridlabor-api/aos@latest and pick every harness you actually use.');
}

// ---------------------------------------------------------------- hooks
function checkHooks() {
  const hooksDir = h('.claude', 'hooks');
  for (const file of ['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs']) {
    const p = path.join(hooksDir, file);
    add('hooks', file, existsSync(p), existsSync(p) ? p.replace(HOME, '~') : 'missing',
      file === 'memb-inject.mjs'
        ? 'Copy assets/memb-inject.mjs from this skill to ~/.claude/hooks/ and wire it as a UserPromptSubmit hook.'
        : 'npx -y @hybridlabor-api/aos@latest (the installer ships and wires both gates).');
  }

  const settings = readJson(h('.claude', 'settings.json'));
  const wired = JSON.stringify(settings?.hooks || {});
  for (const [file, event] of [['go-gate.mjs', 'PreToolUse'], ['graph-gate.mjs', 'Stop'], ['memb-inject.mjs', 'UserPromptSubmit']]) {
    add('hooks', `${file} wired`, wired.includes(file), wired.includes(file) ? `present in ${event}` : `not referenced in ~/.claude/settings.json`,
      'Add it under the matching hooks event in ~/.claude/settings.json (see this skill, section 4).');
  }
}

// ---------------------------------------------------------------- memB
async function checkMemb() {
  const membDir = path.join(AGENTS, 'memB');
  add('memB', 'module', existsSync(membDir), membDir.replace(HOME, '~'),
    'Run the installer and enable the memB optional module.');

  const venvPy = path.join(membDir, IS_MAC || process.platform === 'linux' ? '.venv/bin/python' : '.venv/Scripts/python.exe');
  add('memB', 'python venv', existsSync(venvPy), existsSync(venvPy) ? venvPy.replace(HOME, '~') : 'no .venv — requirements were never installed',
    'Re-run the installer, or: uv venv --seed .venv && uv pip install --python .venv/bin/python -r requirements.txt (in ~/.agents/memB).');

  const db = h('.MemBDB', 'memb.db');
  add('memB', 'vector store', existsSync(db), existsSync(db) ? '~/.MemBDB/memb.db' : 'no database yet (empty memory)',
    'Created on first write; run an ingest from /aos-project-init to seed it.');

  add('memB', 'WebUI :8088', await portOpen(8088), 'daemon serving the memory UI',
    IS_MAC ? 'launchctl load -w ~/Library/LaunchAgents/com.bdb.memb.webui.plist (installer writes it).' : 'Start src/backend/server.py from the memB module.');

  if (IS_MAC) {
    const plist = h('Library', 'LaunchAgents', 'com.bdb.memb.webui.plist');
    add('memB', 'autostart', existsSync(plist), existsSync(plist) ? 'LaunchAgent installed' : 'no LaunchAgent — WebUI will not survive a reboot',
      'Re-run the installer with the memB WebUI option enabled.');
  }

  const mcpPy = path.join(MCPS, 'memb-mcp', IS_MAC || process.platform === 'linux' ? '.venv/bin/python' : '.venv/Scripts/python.exe');
  add('memB', 'memb-mcp server', existsSync(mcpPy), existsSync(mcpPy) ? mcpPy.replace(HOME, '~') : 'memb-mcp venv missing',
    'Re-run the installer and select the memb-mcp MCP.');

  const claudeCfg = readJson(h('.claude.json'));
  const servers = Object.keys(claudeCfg?.mcpServers || {});
  add('memB', 'memb_mcp registered', servers.some(s => s.includes('memb')), servers.length ? `${servers.length} MCP servers configured` : 'no mcpServers in ~/.claude.json',
    'Re-run the installer; it writes the MCP block for every harness you pick.');
}

// ---------------------------------------------------------------- OpenWiki
function checkOpenWiki() {
  const bin = which('openwiki');
  add('openwiki', 'CLI', !!bin, bin || 'not on PATH', 'npm install -g openwiki@latest');

  const env = h('.openwiki', '.env');
  add('openwiki', 'provider credentials', existsSync(env), existsSync(env) ? '~/.openwiki/.env' : 'no ~/.openwiki/.env — every run will fail auth',
    'openwiki auth <provider>   (google | openai | groq | openrouter | ollama …)');

  if (bin) {
    try {
      const out = execFileSync(bin, ['integrations', 'list'], { encoding: 'utf8', timeout: 15000 });
      const installed = out.split('\n').filter(l => l.includes('installed')).map(l => l.split('\t')[0]).filter(Boolean);
      add('openwiki', 'host integrations', installed.length > 0, installed.length ? installed.join(', ') : 'no harness integration installed',
        'openwiki integrations install claude   (repeat for codex/cursor/opencode as needed).');
    } catch {
      add('openwiki', 'host integrations', false, 'integrations list failed', 'Check `openwiki integrations list` manually.');
    }
  }

  if (IS_MAC) {
    const plist = h('Library', 'LaunchAgents', 'com.bdb.openwiki.daemon.plist');
    add('openwiki', 'refresh daemon', existsSync(plist), existsSync(plist) ? 'LaunchAgent installed (2-hourly)' : 'no daemon — wikis only update when you run openwiki by hand',
      'Re-run the installer with an OpenWiki API key, or run the skill script: openwiki-skill/scripts/install_daemon.sh');
  }
}

// ---------------------------------------------------------------- Synapse
async function checkSynapse() {
  const bin = which('synapse') || (existsSync(h('.local', 'bin', 'synapse')) ? '~/.local/bin/synapse' : null);
  add('synapse', 'binary on PATH', !!bin, bin || 'not found — ~/.local/bin may be missing from PATH',
    'Re-run the installer (it symlinks ~/.local/bin/synapse), and add ~/.local/bin to PATH.');
  add('synapse', 'daemon :7781', await portOpen(7781), '3D codebase visualizer',
    IS_MAC ? 'launchctl load -w ~/Library/LaunchAgents/com.bdb.synapse.plist' : 'synapse serve --port 7781');
}

// ---------------------------------------------------------------- report
function report() {
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: results.every(r => r.ok), results }, null, 2));
    return;
  }
  let area = '';
  for (const r of results) {
    if (r.area !== area) { area = r.area; console.log(`\n${area.toUpperCase()}`); }
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(26)} ${r.detail}`);
    if (!r.ok) console.log(`     ↳ fix: ${r.fix}`);
  }
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} checks pass.` + (bad.length ? ` ${bad.length} need attention.` : ' AOS is fully wired.'));
}

checkPrereqs();
checkAos();
checkHooks();
await checkMemb();
checkOpenWiki();
await checkSynapse();
report();
process.exit(results.some(r => !r.ok) ? 1 : 0);
