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
const IS_WIN = process.platform === 'win32';

const h = (...p) => path.join(HOME, ...p);

const firstExisting = (candidates) => candidates.find((c) => existsSync(c)) || null;

// installer.js moduleBasePath() resolves to ~/.agents only under npx; a global
// `npm i -g` or a dev checkout puts the modules next to the package instead.
// Probe every base rather than assuming the npx one, or a perfectly good
// install reports as missing.
const MODULE_BASES = [
  h('.agents'),
  h('.claude'),
  ...(process.env.npm_config_prefix ? [path.join(process.env.npm_config_prefix, 'lib', 'node_modules')] : []),
  '/usr/local/lib/node_modules',
  '/opt/homebrew/lib/node_modules',
];
const findModule = (name) => firstExisting(MODULE_BASES.map((b) => path.join(b, name)));

// resolveTargetPaths() sends the MCP payload to a different directory per
// harness (installer.js:1968+), so ~/.gemini is one option among several.
const MCP_DIRS = [
  h('.gemini', 'config', 'mcps'),
  h('Library', 'Application Support', 'Claude', 'mcps'),
  ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'Claude', 'mcps')] : []),
  h('.cursor', 'mcps'),
  h('.codex', 'mcps'),
  h('.windsurf', 'mcps'),
];

const results = [];
const add = (area, name, ok, detail, fix) => results.push({ area, name, ok, detail, fix });

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const tilde = (p) => (p || '').replace(HOME, '~');
// `which` does not exist on native Windows; cmd ships `where`, which prints one
// path per line.
const which = (bin) => {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try { return tilde(execFileSync(probe, [bin], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]); } catch { return null; }
};
const dirCount = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).length; } catch { return 0; } };

// npm's Windows shim is deja.cmd, and Node refuses to spawn .cmd/.bat without
// a shell (CVE-2024-27980), so every deja probe goes through one on Windows.
// All args used here are JSON flags and single-token prefixes — no metacharacters.
const runDeja = (args) => execFileSync('deja', args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'], shell: IS_WIN });

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
  const manifestPath = h('.agents', '.bdb-manifest.json');
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
  ];  // OpenCode gets an MCP config but no skill sync from installer.js — no row for it.
  // A non-empty skills directory proves nothing — it can hold one unrelated
  // skill, or a stale partial sync. Require a sentinel that only AOS ships.
  const SENTINEL = 'startcycle';
  const synced = harnesses.filter(([, p]) => dirCount(p) > 0);
  const withSentinel = synced.filter(([, p]) => existsSync(path.join(p, SENTINEL, 'SKILL.md')));
  add('aos', 'skills synced to harnesses', withSentinel.length > 0,
    synced.length
      ? synced.map(([n, p]) => `${n}: ${dirCount(p)}${existsSync(path.join(p, SENTINEL, 'SKILL.md')) ? '' : ' (no ' + SENTINEL + ' — partial/foreign)'}`).join(' · ')
      : 'no harness skill directory holds any skill',
    'npx -y @hybridlabor-api/aos@latest and pick every harness you actually use.');

  // AO's predecessor. Its repository is archived and the last version it
  // published predates the archiving, so a copy still on disk is the build
  // carrying the CDC loop defect — worth naming, because nothing else will.
  const retired = findModule('bdb-os-agent-workspace');
  if (retired) {
    add('aos', 'retired AO module', false,
      `${tilde(retired)} — the archived predecessor of AO`,
      `Remove it: rm -rf ${tilde(retired)} — AO now comes from hybridlabor-api/bdb-agent-orchestrator.`);
  }

  // The optional modules are opt-in, so absence is not a failure — but a
  // manifest that claims one is installed while its directory is gone is.
  const claimed = new Set(manifest?.installedModules || []);
  for (const [id, dir, label] of [
    ['memb', 'memB', 'memB'],
    ['synapse', 'bdb-synapse', 'Synapse'],
    ['remote', 'bdb-os-remote', 'OS Remote'],
    ['creator', 'bdb-dev-creator-extension', 'Creator Extension'],
    ['installer', 'bdb-dev-tool-installer', 'Tool Installer'],
    ['ao', 'bdb-agent-orchestrator', 'AO Orchestrator'],
  ]) {
    if (!claimed.has(id)) continue;
    const found = findModule(dir);
    // AO is distributed on npm as @hybridlabor-api/bdb-agent-orchestrator, but only
    // with a prebuilt binary for macOS arm64. On all other platforms, the installer
    // deliberately skips it and directs you to build from source, so a missing module
    // directory is expected rather than a broken install.
    const aoNote = 'AO is published on npm as @hybridlabor-api/bdb-agent-orchestrator with a prebuilt binary for macOS arm64 only; the installer skips it on other platforms and directs you to build from source, so a missing module directory is expected there. `ao --version` is what says whether it is really present.';
    add('aos', `module ${label}`, !!found || id === 'ao',
      found ? tilde(found)
        : id === 'ao' ? (existsSync(h('.local', 'bin', 'ao')) ? 'built from git — binary present at ~/.local/bin/ao' : 'no binary at ~/.local/bin/ao')
        : 'the manifest claims it is installed, but its directory is gone',
      id === 'ao' ? aoNote : 'npx -y @hybridlabor-api/aos@latest and re-enable the module.');
  }
}

// ---------------------------------------------------------------- hooks
function checkHooks() {
  const hooksDir = h('.claude', 'hooks');

  // Existence is not enough: an older install leaves a stale copy behind, and
  // the row would go green over a hook carrying a bug this version fixed.
  // Hooks that carry an `aos-hook-version:` line are checked against what this
  // release expects; the ones that do not are existence-only.
  const EXPECTED_VERSION = { 'memb-inject.mjs': 3 };
  const versionOf = (text) => {
    const m = /^\/\/\s*aos-hook-version:\s*(\d+)/m.exec(text);
    return m ? Number(m[1]) : null;
  };

  for (const file of ['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs']) {
    const p = path.join(hooksDir, file);
    if (!existsSync(p)) {
      add('hooks', file, false, 'missing',
        'npx -y @hybridlabor-api/aos@latest (the installer ships and wires all three).');
      continue;
    }
    const want = EXPECTED_VERSION[file];
    if (!want) {
      add('hooks', file, true, tilde(p), '');
      continue;
    }
    const got = versionOf(readFileSync(p, 'utf8'));
    add('hooks', file, got === want,
      got === want ? `${tilde(p)} (v${got})`
        : got === null ? `${tilde(p)} — predates version stamping, so it is older than v${want}`
        : `${tilde(p)} — v${got}, this release ships v${want}`,
      'npx -y @hybridlabor-api/aos@latest — Quick Update refreshes hooks from v4.4.1 on; an older installer never replaced them.');
  }

  const settings = readJson(h('.claude', 'settings.json'));
  const wired = JSON.stringify(settings?.hooks || {});
  for (const [file, event] of [['go-gate.mjs', 'PreToolUse'], ['graph-gate.mjs', 'Stop'], ['memb-inject.mjs', 'UserPromptSubmit']]) {
    add('hooks', `${file} wired`, wired.includes(file), wired.includes(file) ? `present in ${event}` : `not referenced in ~/.claude/settings.json`,
      'Add it under the matching hooks event in ~/.claude/settings.json (see this skill, section 4).');
  }

  // Antigravity hook wiring
  const agDir = h('.gemini', 'antigravity-cli');
  const agHooksCandidate = existsSync(path.join(agDir, 'hooks.json'))
    ? path.join(agDir, 'hooks.json')
    : existsSync(h('.gemini', 'config', 'hooks.json'))
      ? h('.gemini', 'config', 'hooks.json')
      : existsSync(h('.agents', 'hooks.json'))
        ? h('.agents', 'hooks.json')
        : null;

  if (existsSync(agDir) || existsSync(h('.gemini', 'config', 'skills')) || agHooksCandidate) {
    const targetFile = agHooksCandidate || path.join(agDir, 'hooks.json');
    if (existsSync(targetFile)) {
      const agHooks = readJson(targetFile);
      const agWired = JSON.stringify(agHooks?.hooks || {});
      const hasMemb = agWired.includes('memb-inject.mjs');
      add('hooks', 'Antigravity hooks.json wired', hasMemb,
        hasMemb ? `wired in ${tilde(targetFile)}` : `memb-inject.mjs not wired in ${tilde(targetFile)}`,
        'Run installer or mergeAntigravityHooks to wire hooks in hooks.json.');
    } else {
      add('hooks', 'Antigravity hooks.json', false, `missing ${tilde(targetFile)}`,
        'Run installer to create and wire hooks.json for Antigravity.');
    }
  }

  // Codex hook wiring
  const codexDir = h('.codex');
  const codexConf = path.join(codexDir, 'config.toml');
  if (existsSync(codexDir) || existsSync(codexConf)) {
    if (existsSync(codexConf)) {
      let toml = '';
      try { toml = readFileSync(codexConf, 'utf8'); } catch {}
      const hasMemb = toml.includes('memb-inject.mjs');
      add('hooks', 'Codex config.toml wired', hasMemb,
        hasMemb ? `wired in ${tilde(codexConf)}` : `memb-inject.mjs not wired in ${tilde(codexConf)}`,
        'Run installer or mergeCodexTomlHooks to wire hooks in config.toml.');
    } else {
      add('hooks', 'Codex config.toml', false, `missing ${tilde(codexConf)}`,
        'Run installer to create and wire config.toml for Codex.');
    }
  }
}

// ---------------------------------------------------------------- memB
async function checkMemb() {
  const membDir = findModule('memB');
  add('memB', 'module', !!membDir, membDir ? tilde(membDir) : `not found under: ${MODULE_BASES.map(tilde).join(', ')}`,
    'Run the installer and enable the memB optional module.');

  const venvPy = membDir && path.join(membDir, IS_WIN ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  add('memB', 'python venv', !!venvPy && existsSync(venvPy), venvPy && existsSync(venvPy) ? tilde(venvPy) : 'no .venv — requirements were never installed',
    'Re-run the installer, or: uv venv --seed .venv && uv pip install --python .venv/bin/python -r requirements.txt (in ~/.agents/memB).');

  const db = h('.MemBDB', 'memb.db');
  add('memB', 'vector store', existsSync(db), existsSync(db) ? '~/.MemBDB/memb.db' : 'no database yet (empty memory)',
    'Created on first write; run an ingest from /aos-project-init to seed it.');

  add('memB', 'WebUI :8088', await portOpen(8088), 'something is listening (a bare TCP probe — it does not prove it is memB)',
    IS_MAC ? 'launchctl load -w ~/Library/LaunchAgents/com.bdb.memb.webui.plist (installer writes it).' : 'Start src/backend/server.py from the memB module.');

  if (IS_MAC) {
    const plist = h('Library', 'LaunchAgents', 'com.bdb.memb.webui.plist');
    add('memB', 'autostart', existsSync(plist), existsSync(plist) ? 'LaunchAgent installed' : 'no LaunchAgent — WebUI will not survive a reboot',
      'Re-run the installer with the memB WebUI option enabled.');
  }

  const mcpPy = firstExisting(MCP_DIRS.map((d) => path.join(d, 'memb-mcp', IS_WIN ? '.venv/Scripts/python.exe' : '.venv/bin/python')));
  add('memB', 'memb-mcp server', !!mcpPy, mcpPy ? tilde(mcpPy) : `no memb-mcp venv under: ${MCP_DIRS.map(tilde).join(', ')}`,
    'Re-run the installer and select the memb-mcp MCP.');

  const claudeCfg = readJson(h('.claude.json'));
  const servers = Object.keys(claudeCfg?.mcpServers || {});
  add('memB', 'memb_mcp registered', servers.some(s => s.includes('memb')), servers.length ? `${servers.length} MCP servers configured` : 'no mcpServers in ~/.claude.json',
    'Re-run the installer; it writes the MCP block for every harness you pick.');
}

// ---------------------------------------------------------------- deja
async function checkDeja() {
  const bin = which('deja');
  add('deja', 'deja on PATH', !!bin, bin || 'not on PATH', 'npm install -g @vshulcz/deja-vu@0.21.1');
  if (!bin) return;

  let doc = null;
  try {
    doc = JSON.parse(runDeja(['doctor', '--json', '--offline'])); // --offline keeps the version check off the network
  } catch (e) {
    add('deja', 'deja CLI not runnable', false, String(e.message || e).split('\n')[0],
      'Reinstall: npm install -g @vshulcz/deja-vu@0.21.1');
    return;
  }
  const idx = doc?.index || {};
  const readAt = idx.sources_read_at;
  const ok = idx.state === 'ok' && (idx.stale_stores ?? 0) === 0;
  add('deja', 'index status', ok,
    `${idx.state ?? 'unknown'}${idx.stale_stores ? `, ${idx.stale_stores} stale store(s)` : ''}${readAt != null ? `, sources read at ${typeof readAt === 'string' ? readAt : JSON.stringify(readAt)}` : ''}`,
    ok ? '' : 'deja index');

  // Redaction self-check (techlead condition): a hit is a confirmed unredacted
  // secret only when returned hit text carries a full key shape; a bare prefix
  // hit ("task-", "xoxo") is noise and must never fail the doctor. When deja
  // returns no hit text at all, warn instead of failing.
  const STRICT = [/AIza[0-9A-Za-z_-]{35}/, /ghp_[A-Za-z0-9]{36}/, /sk-[A-Za-z0-9_-]{20,}/, /xox[abprs]-[A-Za-z0-9-]{10,}/];
  const TIERS = new Set(['exact', 'close', 'stemmed', 'semantic', 'error']); // 'relevance' = nothing matched
  const TEXT_KEYS = ['text', 'snippet', 'excerpt', 'content', 'body', 'chunk', 'message', 'preview', 'match', 'line'];
  const confirmed = [];
  const unverified = [];
  for (const prefix of ['AIza', 'ghp_', 'sk-', 'xox']) {
    let env = null;
    try { env = JSON.parse(runDeja(['search', '--json', prefix])); } catch { continue; }
    if (!TIERS.has(env?.tier)) continue;
    for (const hit of env.hits || []) {
      const label = `${hit?.session?.id || '?'} (${hit?.session?.harness || '?'})`;
      const text = TEXT_KEYS.map((k) => hit?.[k]).find((v) => typeof v === 'string' && v) || null;
      if (!text) { unverified.push(label); continue; }
      if (STRICT.some((re) => re.test(text))) confirmed.push(label);
    }
  }
  if (confirmed.length) {
    add('deja', 'redaction self-check', false, `unredacted secret in: ${confirmed.join(', ')}`,
      'deja forget --session <id> — once per listed session, then re-run this doctor.');
  } else if (unverified.length) {
    add('deja', 'redaction self-check', true,
      `possible secret, verify with deja show <id> — no hit text returned to test for: ${unverified.join(', ')}`, '');
  } else {
    add('deja', 'redaction self-check', true, 'no unredacted keys in returned hit text', '');
  }
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
      // The status enum includes "not-installed", whose substring would match a
      // naive includes('installed') — compare the exact tab-separated field.
      const installed = out.split('\n')
        .map(l => l.split('\t'))
        .filter(f => f[1]?.trim() === 'installed')
        .map(f => f[0].trim());
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
  // installer.js skips the ~/.local/bin symlink on Windows and leaves the
  // binary inside the module, so look there too before calling it missing.
  const moduleDir = findModule('bdb-synapse');
  const inModule = moduleDir && firstExisting([
    path.join(moduleDir, 'bin', IS_WIN ? 'synapse.js' : 'synapse'),
    path.join(moduleDir, 'bin', 'synapse-darwin-arm64'),
    path.join(moduleDir, 'bin', 'synapse-linux-amd64'),
  ]);
  const bin = which('synapse') || (existsSync(h('.local', 'bin', 'synapse')) ? '~/.local/bin/synapse' : null) || (inModule && tilde(inModule));
  add('synapse', 'binary available', !!bin, bin || 'no binary on PATH or in the module',
    IS_WIN ? 'Re-run the installer; on Windows the binary stays in the module rather than being symlinked.'
           : 'Re-run the installer (it symlinks ~/.local/bin/synapse), and add ~/.local/bin to PATH.');
  add('synapse', 'daemon :7781', await portOpen(7781), 'something is listening (a bare TCP probe — it does not prove it is Synapse)',
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
await checkDeja();
checkOpenWiki();
await checkSynapse();
report();
process.exit(results.some(r => !r.ok) ? 1 : 0);
