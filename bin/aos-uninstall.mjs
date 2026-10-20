#!/usr/bin/env node
// Remove AOS from this machine.
//
//   aos-uninstall              what AOS installed; your data stays
//   aos-uninstall --purge      also the memory store, wikis and credentials
//   aos-uninstall --dry-run    list everything, delete nothing
//   aos-uninstall --yes        skip the confirmations (CI only)
//   aos-uninstall --restore-plugin-backup
//                              put back the loose skill copies the installer removed when it
//                              registered the bdb-aos plugin (never overwrites an existing file)
//
// The file-level install manifest records every path AOS wrote together with
// the sha256 it wrote. That is what makes a precise uninstall possible: a file
// still matching its recorded hash is ours and untouched, so it goes; a file
// that differs was edited after installation and is backed up rather than
// deleted; a file with no manifest entry was never ours and is not considered
// at all.

import { readFileSync, existsSync, rmSync, rmdirSync, lstatSync, copyFileSync, readdirSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const pm = createRequire(import.meta.url)('../lib/plugin-migration.js');
const cn = createRequire(import.meta.url)('../lib/codenotch.js');
const cp = createRequire(import.meta.url)('../lib/codex-plugin-install.js');
const agyPlugin = createRequire(import.meta.url)('../lib/agy-plugin-install.js');
const ur = createRequire(import.meta.url)('../lib/uninstall-records.js');
const pk = createRequire(import.meta.url)('../lib/v5/packages.js');
const profile = createRequire(import.meta.url)('../lib/v5/profile.js');
const winStartup = createRequire(import.meta.url)('../lib/v5/win-startup.js');
// A2A MCP registrations (agy + Cursor) live inside harness configs that this
// manifest-based uninstall otherwise leaves alone; the removal is done by the
// installer's own removal code, which only ever touches AOS-owned entries and
// backs the file up first.
const installer = createRequire(import.meta.url)('../installer.js');
const { stripDestructiveBlock } = createRequire(import.meta.url)('../lib/destructive-rules.js');
const { stripRoutingBlock } = createRequire(import.meta.url)('../lib/routing-rules.js');
const { stripHarnessRulesBlock } = createRequire(import.meta.url)('../lib/harness-rules.js');
// agy worker home (~/.aos/agy-worker-home) is built and removed by no-mcp.js; absent in a layout without mcps/.
const noMcp = await import(new URL('../mcps/mcsc/packages/core/src/no-mcp.js', import.meta.url).href).catch(() => null);

const HOME = os.homedir();
const h = (...p) => path.join(HOME, ...p);
const tilde = (p) => p.replace(HOME, '~');

const PURGE = process.argv.includes('--purge');
const DRY = process.argv.includes('--dry-run');
const YES = process.argv.includes('--yes');
const RESTORE = process.argv.includes('--restore-plugin-backup');

const MANIFEST = h('.agents', '.bdb-install-manifest.json');

// Machine-global state AOS creates but does not own the contents of. Removed
// only under --purge, and each is named individually before anything happens —
// losing a memory store to a flag nobody read would be unforgivable.
const DATA_PATHS = [
  { path: h('.MemBDB'), what: 'memB memory store — every memory on this machine' },
  { path: h('.openwiki'), what: 'OpenWiki credentials, daemon config and the watch list' },
  { path: h('.synapse'), what: 'Synapse logs and reports' },
  { path: h('.memb'), what: 'memB WebUI logs' },
  { path: h('.ao'), what: 'AO Orchestrator logs' },
  { path: h('.cache', 'deja'), what: 'deja-vu index — every indexed agent session' },
  { path: h('.config', 'deja'), what: 'deja-vu privacy config — exclusion list and tombstones' },
];

const AGENTS = [
  'com.bdb.memb.webui', 'com.bdb.synapse', 'com.bdb.openwiki.daemon',
  'com.bdb.ao.daemon', 'com.bdb.agent-workspace', 'com.hybridlabor.bdb-remote', 'com.bdb.plan-canvas',
  'com.bdb.memb.ingest',
];
// Linux: the systemd user units the installer writes for the same services.
const LINUX_UNITS = [
  'com.bdb.memb.webui.service', 'com.bdb.synapse.service', 'com.bdb.openwiki-visualize.service', 'com.bdb.plan-canvas.service',
  'openwiki-daemon.timer', 'openwiki-daemon.service', 'com.bdb.memb.ingest.timer', 'com.bdb.memb.ingest.service',
];
// Windows: the installer starts these through a hidden .vbs in the user's
// Startup folder that runs a .bat (names and dirs as written by installer.js).
const WIN_STARTUP = [
  { label: 'plan-canvas', vbsName: 'com.bdb.plan-canvas.vbs', batDir: '.agents', batName: 'run-plan-canvas.bat' },
  { label: 'synapse', vbsName: 'com.bdb.synapse.vbs', batDir: '.synapse', batName: 'run-synapse.bat' },
  { label: 'openwiki-visualizer', vbsName: 'com.bdb.openwiki-visualize.vbs', batDir: '.openwiki', batName: 'run-openwiki-visualize.bat' },
  // The memB WebUI .vbs starts python directly (no .bat); its process is matched by the server path.
  { label: 'memb-webui', vbsName: 'com.bdb.memb.webui.vbs', match: '*memB*backend*server.py*' },
];

// v5 services: Startup .vbs written by pkg-gateway / pkg-hub; processes matched by their script path.
const WIN_V5 = [
  { label: 'com.bdb.aos.gateway', script: path.join('bin', 'aos-gateway.mjs') },
  { label: 'com.bdb.aos.hub', script: path.join('bin', 'aos-hub.mjs') },
];

// A module folder is removed only when the install recorded it: its id in installedModules
// (.bdb-manifest.json) or files under it in the file manifest. Folders without an id are only
// covered by the file manifest.
const MODULE_DIRS = [
  { dir: 'memB', id: 'memb' },
  { dir: 'bdb-synapse', id: 'synapse' },
  { dir: 'bdb-os-remote', id: 'remote' },
  { dir: 'bdb-dev-creator-extension', id: 'creator' },
  { dir: 'bdb-hardware-pcb', id: 'hardware' },
  { dir: 'bdb-dev-tool-installer', id: 'installer' },
  { dir: 'bdb-agent-orchestrator', id: 'ao' },
  { dir: 'bdb-os-agent-workspace' },          // AO's archived predecessor, if still lying around
  { dir: 'bdb-dev-optimized-agent-skills' },  // AOS core payload cache from a "from source" or non-npx run
].map(({ dir, id }) => ({ path: h('.agents', dir), id }));

// installer.js's detectInstallState() treats any of these as proof AOS is
// still installed, independently of the manifest -- a leftover copy after
// this uninstall runs was reported as "Current & Up-to-date" on the very
// next launch, with the manifest already gone. Keep this list in exact sync
// with the `legacyMarkers` array in installer.js's detectInstallState().
const LEGACY_MARKERS = [
  h('.agents', 'AGENTS.md'),
  h('.gemini', 'config', 'skills', 'startcycle', 'SKILL.md'),
  h('.agents', 'skills', 'startcycle', 'SKILL.md'),
  path.join(pm.claudeDir(HOME), 'skills', 'startcycle', 'SKILL.md'),
];

const sha256 = (file) => {
  try { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
  catch { return null; }
};

// --------------------------------------------------------------------- plan
function plan(opts = {}) {
  const home = opts.home || HOME;
  const platform = opts.platform || process.platform;
  const manifest = (() => {
    try { return JSON.parse(readFileSync(opts.manifestPath || MANIFEST, 'utf8').replace(/^﻿/, '')); } catch { return null; }
  })();

  const ours = [];      // matches its recorded hash — delete
  const edited = [];    // differs — back up, then delete
  const gone = [];      // already absent

  for (const [p, entry] of Object.entries(manifest || {})) {
    if (!existsSync(p)) { gone.push(p); continue; }
    (sha256(p) === entry.sha256 ? ours : edited).push(p);
  }

  const keptCommands = ur.editedOpencodeCommands(manifest, HOME);
  for (const f of keptCommands) edited.splice(edited.indexOf(f), 1);

  const agents = AGENTS
    .map((label) => ({ label, plist: h('Library', 'LaunchAgents', `${label}.plist`) }))
    .filter((a) => existsSync(a.plist))
    .concat(LINUX_UNITS.map((label) => ({ label, unit: h('.config', 'systemd', 'user', label) })).filter((a) => existsSync(a.unit)));

  // Windows Startup entries: same services, hidden .vbs -> .bat instead of
  // launchd/systemd. Only pairs where both files are still there.
  if (platform === 'win32') {
    const startupDir = path.join(opts.appData || process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    for (const s of WIN_STARTUP) {
      const vbs = path.join(startupDir, s.vbsName);
      const bat = s.batName ? path.join(home, s.batDir, s.batName) : null;
      if (existsSync(vbs) && (!bat || existsSync(bat))) agents.push({ label: s.label, vbs, bat, match: s.match || (bat && `*${bat}*`) });
    }
    // OpenWiki daemon fallback entry (install_daemon.ps1) when no scheduled task could be registered.
    const owCmd = path.join(startupDir, 'BDB_OpenWiki_Daemon.cmd');
    if (existsSync(owCmd)) agents.push({ label: 'openwiki-daemon', vbs: owCmd, match: '*openwiki_daemon.py*' });
  }

  // v5 gateway/hub autostart: removed by their own step after the package loop, not through WIN_STARTUP.
  const winSvc = platform !== 'win32' ? [] : WIN_V5.map((s) => ({ ...s, full: path.join(home, '.agents', s.script), vbs: winStartup.vbsPath({ home, env: { APPDATA: opts.appData || process.env.APPDATA } }, s.label) }))
    .filter((s) => existsSync(s.vbs));

  let installedModules = [];
  try { installedModules = JSON.parse(readFileSync(path.join(home, '.agents', '.bdb-manifest.json'), 'utf8').replace(/^﻿/, '')).installedModules || []; } catch { /* no record */ }
  const manifestPaths = Object.keys(manifest || {});
  const modules = MODULE_DIRS
    .filter((m) => existsSync(m.path) && ((m.id && installedModules.includes(m.id)) || manifestPaths.some((p) => p.startsWith(m.path + path.sep))))
    .map((m) => m.path);
  const legacy = LEGACY_MARKERS.filter(existsSync);
  const data = PURGE ? DATA_PATHS.filter((d) => existsSync(d.path)) : [];

  const codenotch = cn.planCodenotchUninstall({ stateFile: cn.stateFilePath(HOME) });

  return { manifest, ours, edited, gone, agents, winSvc, modules, legacy, data, codenotch, keptCommands };
}

function describe(p) {
  const { manifest, ours, edited, gone, agents, modules, legacy, data } = p;

  if (!manifest && !ur.hasPending(HOME)) {
    console.log('No install manifest at ' + tilde(MANIFEST) + '.');
    console.log('Without it there is no telling which file came from AOS — nothing is deleted.');
    console.log('Otherwise affected: ~/.claude/skills, ~/.gemini/config/skills, ~/.codex/skills, ~/.agents/');
    return false;
  }

  console.log(`\nManifest: ${Object.keys(manifest || {}).length} files recorded`);
  console.log(`  ${String(ours.length).padStart(5)}  unchanged since install → removed`);
  console.log(`  ${String(edited.length).padStart(5)}  edited after install → .bak first, then removed`);
  console.log(`  ${String(gone.length).padStart(5)}  already gone`);

  if (edited.length) {
    console.log('\n  edited:');
    for (const f of edited.slice(0, 8)) console.log(`    ${tilde(f)}`);
    if (edited.length > 8) console.log(`    … and ${edited.length - 8} more`);
  }

  if (p.keptCommands.length) {
    console.log(`\nOpenCode commands edited after install are kept (${p.keptCommands.length}):`);
    for (const f of p.keptCommands) console.log(`    ${tilde(f)}`);
  }

  if (agents.length) {
    console.log(`\nBackground services (${agents.length}): ${agents.map((a) => a.label).join(', ')}`);
  }
  for (const s of p.winSvc || []) console.log(`\nWindows Startup entry ${tilde(s.vbs)} is removed; processes running ${tilde(s.full)} are stopped`);
  if (modules.length) {
    console.log('\nModules:');
    for (const m of modules) console.log(`    ${tilde(m)}`);
  }
  if (legacy.length) {
    console.log(`\nInstall markers (${legacy.length}) -- without removing them the next`);
    console.log('  install takes AOS for already installed and current:');
    for (const l of legacy) console.log(`    ${tilde(l)}`);
  }

  if (p.codenotch) {
    const c = p.codenotch;
    const note = { remove: 'is removed (still the recorded build)', keep: 'is kept (replaced or modified since AOS installed it)', gone: 'is already gone' }[c.action];
    console.log(`\nBDB AO Codenotch ${tilde(c.state.path || c.state.uninstallPath)} ${note}`);
  }

  const regLines = ur.reverseRegistrations({ home: HOME, dryRun: true, runner: pm.defaultCliRunner });
  const cxLines = cp.uninstallCodexPlugin({ home: HOME, dryRun: true }).lines;
  const agyLines = [];
  agyPlugin.uninstall({ home: HOME, dryRun: true, log: { step: (m) => agyLines.push(m), warn: (m) => agyLines.push(m) } });
  if (regLines.length || cxLines.length || agyLines.length) {
    console.log('\nRegistrations that point at AOS scripts:');
    for (const l of [...regLines, ...cxLines, ...agyLines]) console.log(`    ${l}`);
  }

  console.log('\nKept:');
  if (!PURGE) for (const d of DATA_PATHS.filter((d) => existsSync(d.path))) console.log(`    ${tilde(d.path).padEnd(18)} ${d.what}`);
  console.log('    every file without a manifest entry — your own skills, foreign hooks, anything you wrote');

  if (data.length) {
    console.log('\n\x1b[31mWILL BE DELETED (--purge):\x1b[0m');
    for (const d of data) {
      let size = '';
      try { size = ` (${(dirSize(d.path) / 1e6).toFixed(1)} MB)`; } catch { /* unreadable */ }
      console.log(`    \x1b[31m${tilde(d.path).padEnd(18)}\x1b[0m ${d.what}${size}`);
    }
  }
  return true;
}

function dirSize(p) {
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      try { e.isDirectory() ? walk(f) : (total += statSync(f).size); } catch { /* raced */ }
    }
  };
  try { statSync(p).isDirectory() ? walk(p) : (total = statSync(p).size); } catch { /* gone */ }
  return total;
}

// ------------------------------------------------------------------ execute
// Stop by script path first (a running node would restart nothing, but holds the port), then drop the .vbs.
function removeWinServices(list, run = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore', timeout: 60000 })) {
  for (const s of list || []) {
    // Full path under this profile's home only: the bare suffix also matches other Windows users' services.
    if (s.full) try { run('powershell', winStartup.stopArgs([s.full])); } catch { /* powershell unavailable */ }
    try { rmSync(s.vbs, { force: true }); } catch { /* already gone */ }
  }
}

// Trees the install builds inside the copied MCP servers (npm install, tsc, venv). They are not in the file
// manifest, so they outlive it. Only shipped server names are touched, only these subtrees, and directories are
// removed afterwards only when empty: files the user put there stay.
const MCP_GENERATED = ['node_modules', 'dist', '.venv', '__pycache__'];
const pruneEmpty = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) pruneEmpty(path.join(dir, e.name));
  try { rmdirSync(dir); } catch { /* not empty */ }
};
function removeGeneratedMcpTrees({ home = HOME, appData, names, dry = false } = {}) {
  const base = appData || process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const roots = [
    path.join(home, 'Library', 'Application Support', 'Claude'), path.join(home, '.config', 'Claude'), path.join(base, 'Claude'),
    path.join(home, '.gemini', 'config'), path.join(home, '.codex'), path.join(home, '.windsurf'), path.join(home, '.roo'), path.join(home, '.aider'),
  ].map((r) => path.join(r, 'mcps'));
  let shipped = names;
  if (!shipped) { try { shipped = readdirSync(new URL('../mcps', import.meta.url)); } catch { shipped = []; } }
  const out = [];
  for (const root of roots) for (const name of new Set([...shipped, 'memb-mcp'])) {
    const dir = path.join(root, name);
    let st; try { st = lstatSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const g of MCP_GENERATED) {
      const t = path.join(dir, g);
      if (!existsSync(t)) continue;
      out.push(t);
      if (!dry) rmSync(t, { recursive: true, force: true });
    }
    if (!dry) { pruneEmpty(dir); try { rmdirSync(root); } catch { /* other servers or files left */ } }
  }
  return out;
}

// ~/CLAUDE.md as the installer wrote it: exactly the pointer goes whole; its prefix line goes from user text.
function removeClaudePointer(file) {
  const text = readFileSync(file, 'utf8');
  if (text.replace(/\r\n/g, '\n') === installer.CLAUDE_POINTER) { rmSync(file); return 'removed'; }
  if (!text.startsWith(installer.CLAUDE_PREFIX)) return null;
  writeFileSync(file, text.slice(installer.CLAUDE_PREFIX.length));
  return 'stripped';
}

async function execute(p) {
  const { ours, edited, agents, modules, legacy, data, codenotch } = p;
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  let removed = 0, backed = 0;
  // One failing step must not skip the rest; failures are listed at the end and their records stay.
  const failures = [];
  const attempt = (label, fn) => { try { return fn(); } catch (e) { failures.push(`${label}: ${e.message}`); return undefined; } };

  for (const a of agents) attempt(`service ${a.label}`, () => {
    if (a.vbs) {
      // Windows: the .bat loops (`goto loop`), so kill the processes running it
      // before anything else — delete the bat first, then the vbs, so a cmd
      // between iterations finds no script to restart. Match the exact bat file
      // name in the command line, never a generic word like "node".
      try {
        execFileSync('powershell', winStartup.stopLikeArgs(a.match), { stdio: 'ignore' });
      } catch { /* nothing running or powershell unavailable */ }
      if (a.bat) try { rmSync(a.bat); } catch { /* already gone */ }
      try { rmSync(a.vbs); } catch { /* already gone */ }
      return;
    }
    if (a.unit) {
      try { execFileSync('systemctl', ['--user', 'disable', '--now', a.label], { stdio: 'ignore' }); } catch { /* not loaded */ }
      try { rmSync(a.unit); } catch { /* already gone */ }
      return;
    }
    try { execFileSync('launchctl', ['unload', a.plist], { stdio: 'ignore' }); } catch { /* not loaded */ }
    try { rmSync(a.plist); } catch { /* already gone */ }
  });
  if (agents.length) console.log(`  ${agents.length} services stopped and removed`);
  if (process.platform === 'win32') {
    try { execFileSync('schtasks', ['/Delete', '/TN', 'BDB_OpenWiki_Daemon', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* no such task */ }
  }

  const unsaved = new Set();
  for (const f of edited) {
    try { copyFileSync(f, `${f}.${stamp}.bak`); backed++; } catch (e) { unsaved.add(f); failures.push(`${tilde(f)} not removed: backup failed (${e.message})`); }
  }
  for (const f of [...ours, ...edited].filter((x) => !unsaved.has(x))) {
    try { rmSync(f); removed++; } catch { /* already gone */ }
  }
  console.log(`  ${removed} files removed, ${backed} backed up first`);
  attempt('MCP server build trees', () => {
    const gone = removeGeneratedMcpTrees();
    if (gone.length) console.log(`  ${gone.length} generated MCP folders removed (node_modules, dist, venv)`);
  });

  const ruleFiles = [
    h('CLAUDE.md'), h('AGENTS.md'), h('.github', 'copilot-instructions.md'),
    h('.codex-plugin', 'system.md'), h('.gemini', 'RULES.md'), h('.gemini', 'GEMINI.md'),
  ];
  for (const f of ruleFiles.filter(existsSync)) {
    try {
      let text = readFileSync(f, 'utf8');
      if (f === h('CLAUDE.md')) {
        const r = removeClaudePointer(f);
        if (r === 'removed') { console.log(`  ${tilde(f)} removed (AOS pointer only)`); continue; }
        if (r === 'stripped') { console.log(`  AOS pointer line removed from ${tilde(f)}`); text = readFileSync(f, 'utf8'); }
      }
      // The harness-rules block is the outermost one for ~/.gemini/RULES.md and
      // GEMINI.md — strip it first so the inner blocks go with it; the inner
      // strips still cover older installs that carried only those blocks.
      const stripped = stripRoutingBlock(stripDestructiveBlock(stripHarnessRulesBlock(text)));
      if (stripped === text) continue;
      if (!stripped.trim()) { rmSync(f); console.log(`  ${tilde(f)} removed (no user content left)`); continue; }
      writeFileSync(f, stripped);
      console.log(`  Rule blocks removed from ${tilde(f)}`);
    } catch { failures.push(`${tilde(f)} unreadable (rule blocks)`); console.log(`  ${tilde(f)} unreadable — check the rule blocks by hand`); }
  }

  try {
    const n = createRequire(import.meta.url)('../lib/permissions-allow.js').removeAllRecorded(HOME);
    if (n) console.log(`  ${n} permission rule(s) added by \`aos allow\` removed`);
  } catch { failures.push('aos allow rules'); console.log('  ~/.claude/settings.json unreadable — remove the rules added by `aos allow` (see ~/.aos/allow-records.json) by hand'); }

  for (const m of modules) { try { rmSync(m, { recursive: true, force: true }); } catch { /* in use */ } }
  if (modules.length) console.log(`  ${modules.length} modules removed`);

  const DEJA_PKG = '@vshulcz/deja-vu';
  const dejaByAos = (ur.readRecords(HOME).npmGlobal || []).includes(DEJA_PKG);
  if (dejaByAos) {
    try {
      execFileSync('npm', ['uninstall', '-g', DEJA_PKG], { stdio: 'ignore', shell: process.platform === 'win32' });
      ur.forgetNpmGlobal(HOME, DEJA_PKG);
      console.log('  deja-vu (npm) removed');
    } catch {
      failures.push(`npm uninstall -g ${DEJA_PKG}`);
      console.log(`  deja-vu not removed via npm — remove it by hand: npm uninstall -g ${DEJA_PKG}`);
    }
  }

  // Other global npm packages AOS installed itself (aos-cli, codebase-memory-mcp), recorded at install time.
  for (const pkg of (ur.readRecords(HOME).npmGlobal || []).filter((x) => x !== DEJA_PKG)) {
    try {
      execFileSync('npm', ['uninstall', '-g', pkg], { stdio: 'ignore', shell: process.platform === 'win32' });
      ur.forgetNpmGlobal(HOME, pkg);
      console.log(`  ${pkg} (npm) removed`);
    } catch {
      failures.push(`npm uninstall -g ${pkg}`);
      console.log(`  ${pkg} not removed via npm — remove it by hand: npm uninstall -g ${pkg}`);
    }
  }

  const dejaMcpJson = [
    h('.gemini', 'config', 'mcp_config.json'),
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || HOME, 'Claude', 'claude_desktop_config.json')
      : h('Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    h('.claude.json'),
    h('.cursor', 'mcp.json'),
    h('.roo', 'mcp_settings.json'),
    h('.cline', 'mcp_settings.json'),
    h('.windsurf', 'mcp.json'),
    h('.aider', 'mcp.json'),
  ];
  for (const f of dejaMcpJson.filter(existsSync)) {
    try {
      const cfg = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
      // Backed up before every rewrite; a failed backup aborts this file's edit.
      const save = () => { copyFileSync(f, `${f}.${stamp}.bak`); writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n'); };
      // Only the invocation AOS writes: deja mcp, or cmd /c deja mcp on Windows.
      const d = cfg.mcpServers && cfg.mcpServers.deja;
      const aosDeja = !!d && ((d.command === 'deja' && JSON.stringify(d.args) === '["mcp"]') || (d.command === 'cmd' && JSON.stringify(d.args) === '["/c","deja","mcp"]'));
      if (dejaByAos && aosDeja) {
        delete cfg.mcpServers.deja;
        save();
        console.log(`  deja entry removed from ${tilde(f)}`);
      }
      // Rust + Tauri package: only the entry AOS writes ({command: tauri-pilot, args: [mcp]}) leaves.
      const tp = cfg.mcpServers && cfg.mcpServers['tauri-pilot'];
      if (tp && tp.command === 'tauri-pilot' && JSON.stringify(tp.args) === '["mcp"]') {
        delete cfg.mcpServers['tauri-pilot'];
        save();
        console.log(`  tauri-pilot entry removed from ${tilde(f)}`);
      }
    } catch { failures.push(`${tilde(f)} unreadable`); console.log(`  ${tilde(f)} unreadable — check by hand`); }
  }

  const opencodeCfg = h('.config', 'opencode', 'opencode.jsonc');
  if (existsSync(opencodeCfg) && /"deja"\s*:/.test(readFileSync(opencodeCfg, 'utf8'))) {
    console.log(`  ${tilde(opencodeCfg)} still has a deja entry — remove it by hand (JSONC, not rewritten automatically)`);
  }
  if (existsSync(opencodeCfg) && /"tauri-pilot"\s*:/.test(readFileSync(opencodeCfg, 'utf8'))) {
    console.log(`  ${tilde(opencodeCfg)} still has a tauri-pilot entry — remove it by hand (JSONC, not rewritten automatically)`);
  }

  const codexToml = h('.codex', 'config.toml');
  if (existsSync(codexToml)) {
    try {
      const raw = readFileSync(codexToml, 'utf8');
      const eol = raw.includes('\r\n') ? '\r\n' : '\n';
      const lines = raw.split(/\r?\n/);
      // Only the table AOS wrote (command "deja"); a user's own deja table and its sub-tables stay.
      const kept = ur.dropMcpTables(lines, (n, sec) => n === 'deja' && sec.some((l) => l.trim() === 'command = "deja"'));
      if (kept.length !== lines.length) {
        writeFileSync(codexToml, kept.join(eol));
        console.log(`  deja table removed from ${tilde(codexToml)}`);
      }
    } catch { failures.push(`${tilde(codexToml)} unreadable`); console.log(`  ${tilde(codexToml)} unreadable — check by hand`); }
  }

  if (codenotch) attempt('Codenotch', () => {
    const r = cn.uninstallCodenotch(codenotch, { stateFile: cn.stateFilePath(HOME) });
    console.log(`  Codenotch: ${r === 'remove' ? 'removed' : r === 'keep' ? 'kept, not the recorded build' : r === 'error' ? 'uninstaller failed, left in place' : 'already gone'}`);
  });

  attempt('agy plugin', () => agyPlugin.uninstall({ home: HOME, dryRun: DRY }));

  if (noMcp) attempt('agy worker home', () => {
    const wh = noMcp.removeAgyWorkerHome({ home: HOME, dryRun: DRY });
    if (wh.removed.length) console.log(`  agy worker home without MCP servers: ${wh.removed.length} entries ${DRY ? 'would be removed' : 'removed'}`);
    for (const k of wh.kept) console.log(`  ${tilde(k)} not created by AOS, kept`);
  });

  // Claude Code mods, MCP gateway, hub service and Rust + Tauri have their own registrations; gateway and hub only when installed.
  const always = ['fleet', 'sessions', 'alert', 'control', 'rustauri'];
  for (const id of ['fleet', 'sessions', 'alert', 'control', 'gateway', 'hub', 'rustauri']) {
    const pkg = pk.registry.find((x) => x.id === id);
    try {
      // run: gateway and hub stop their service through it (launchctl, systemctl, or the Windows Startup .vbs process).
      const c = { home: HOME, dryRun: DRY, platform: process.platform, aosRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), env: process.env, run: (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore', timeout: 60000 }) };
      if (!always.includes(id) && !(pkg.present ? pkg.present(c) : (await pkg.detect(c)).installed)) continue;
      const r = await pkg.uninstall(c);
      if (r && r.error) console.log(`  ${pkg.name}: ${r.error}`);
      else if (r && (r.changed || !always.includes(id))) console.log(`  ${pkg.name} removed`);
    } catch (e) { console.log(`  ${pkg.name}: ${e.message} — check by hand`); }
  }

  // The package loop skips gateway/hub when detect() is false; the Startup .vbs must still go, or both autostart again.
  attempt('Windows services', () => removeWinServices(p.winSvc));

  // A2A MCP entries (agy + Cursor): only the AOS-owned ones leave the harness
  // configs, each file backed up first (writeConfigWithBackup inside).
  try {
    const cleanedA2a = installer.removeAosA2aEntries({ targetHome: HOME });
    for (const f of cleanedA2a) console.log(`  A2A MCP entry removed from ${tilde(f)}`);
  } catch (e) { console.log(`  A2A MCP entries could not be checked: ${e.message}`); }

  for (const l of legacy) { try { rmSync(l); } catch { /* already gone */ } }
  if (legacy.length) console.log(`  ${legacy.length} install markers removed`);

  for (const l of ur.reverseRegistrations({ home: HOME, runner: pm.defaultCliRunner, failures })) console.log(`  ${l}`);

  attempt('Claude plugin registration', () => {
    const reg = pm.readState(HOME).registered.claudecode;
    if (!reg) return;
    const r = pm.deregisterClaude({ home: HOME, record: reg });
    if (r.changed) console.log(`  bdb-aos plugin registration removed from settings.json${reg.replaced ? ` (external marketplace ${reg.replaced.key} restored)` : ''}`);
  });

  attempt('Codex plugin', () => { for (const l of cp.uninstallCodexPlugin({ home: HOME }).lines) console.log(`  ${l}`); });

  // Only the BDB hook entries leave settings.json; everything else in it is
  // the user's and must survive an uninstall exactly as it survives an install.
  const settings = path.join(pm.claudeDir(HOME), 'settings.json');
  if (existsSync(settings)) {
    try {
      const s = JSON.parse(readFileSync(settings, 'utf8').replace(/^﻿/, ''));
      const bdb = profile.HOOK_SCRIPTS;
      let touched = false;
      for (const [event, entries] of Object.entries(s.hooks || {})) {
        if (!Array.isArray(entries)) continue;
        // Handler level: a matcher group keeps its foreign handlers and goes only when it ends up empty.
        const kept = [];
        for (const e of entries) {
          const hooks = Array.isArray(e && e.hooks) ? e.hooks : null;
          const left = hooks ? hooks.filter((x) => !ur.commandRunsScript(x && x.command, bdb)) : null;
          if (!hooks || left.length === hooks.length) { kept.push(e); continue; }
          touched = true;
          if (left.length) kept.push({ ...e, hooks: left });
        }
        s.hooks[event] = kept;
        if (!kept.length) delete s.hooks[event];
      }
      if (touched) {
        copyFileSync(settings, `${settings}.${stamp}.bak`);
        writeFileSync(settings, JSON.stringify(s, null, 2) + '\n');
        console.log('  AOS hook handlers removed from settings.json; other handlers and settings unchanged');
      }
    } catch { failures.push('settings.json unreadable'); console.log('  settings.json unreadable — check by hand'); }
  }

  for (const d of data) {
    try { rmSync(d.path, { recursive: true, force: true }); console.log(`  \x1b[31mdeleted:\x1b[0m ${tilde(d.path)}`); }
    catch (e) { failures.push(`${tilde(d.path)}: ${e.message}`); console.log(`  could not delete ${tilde(d.path)}: ${e.message}`); }
  }

  // With a failed step the manifest stays, so a rerun sees the install and finishes the job.
  if (!failures.length) for (const f of [MANIFEST, h('.agents', '.bdb-manifest.json')]) {
    try { rmSync(f); } catch { /* already gone */ }
  }
  if (!failures.length) pm.retireState(HOME);
  ur.retireRecords(HOME);
  if (failures.length) {
    console.log('\nThese steps failed; the rest ran. Fix the cause and run aos-uninstall again:');
    for (const f of failures) console.log(`    ${f}`);
  }
  return failures;
}

// ---------------------------------------------------------------------- main
// plan() is exported for tests; the CLI flow below only runs when this file is
// the entry script.
export { plan, removeWinServices, removeGeneratedMcpTrees, removeClaudePointer };

const ask = async (q) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(q)).trim();
  rl.close();
  return a;
};

// realpath: the npm bin shim is a symlink, and import.meta.url names the resolved file.
const isEntry = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isEntry()) {
  await main();
}

async function main() {
  if (RESTORE) {
    const r = pm.restorePluginBackups({ home: HOME });
    if (!r.dirs.length) { console.log('No plugin-migration backup found.'); process.exit(1); }
    console.log(`  ${r.files.length} files restored from ${r.dirs.length} backup(s), recorded in the install manifest`);
    console.log('Existing files were not overwritten.');
    if (r.deregistered) console.log('  bdb-aos plugin registration removed so the skills do not load twice. Set AOS_PLUGIN_MIGRATION=off so the installer does not remove them again.');
    else if (r.files.length && r.stillEnabled) console.log('  WARNING: the bdb-aos plugin is still enabled, so the skills show up twice. Disable the plugin in Claude Code and set AOS_PLUGIN_MIGRATION=off.');
    process.exit(0);
  }

  const p = plan();
  console.log(PURGE ? '\x1b[31mAOS UNINSTALL — PURGE\x1b[0m' : 'AOS Uninstall');
  if (!describe(p)) process.exit(1);

  if (DRY) {
    console.log('\n[dry-run] Nothing was changed.');
    return;
  }

  if (!YES) {
    if ((await ask('\nContinue? [yes/no] ')).toLowerCase() !== 'yes') {
      console.log('Aborted. Nothing changed.');
      return;
    }
    if (PURGE) {
      console.log('\n\x1b[31mThe second step deletes the memory store and the credentials irreversibly.\x1b[0m');
      if ((await ask('Type PURGE to confirm: ')).trim() !== 'PURGE') {
        console.log('Aborted. Nothing changed.');
        return;
      }
    }
  }

  console.log('');
  const failures = await execute(p);
  if (failures.length) { process.exitCode = 1; return; }
  console.log('\nDone. Reinstall with: npx -y @hybridlabor-api/aos@latest');
}
