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

import { readFileSync, existsSync, rmSync, copyFileSync, readdirSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
// A2A MCP registrations (agy + Cursor) live inside harness configs that this
// manifest-based uninstall otherwise leaves alone; the removal is done by the
// installer's own removal code, which only ever touches AOS-owned entries and
// backs the file up first.
const installer = createRequire(import.meta.url)('../installer.js');
const { stripDestructiveBlock } = createRequire(import.meta.url)('../lib/destructive-rules.js');
const { stripRoutingBlock } = createRequire(import.meta.url)('../lib/routing-rules.js');

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
  { path: h('.cache', 'deja'), what: 'deja-vu Index — alle indizierten Agenten-Sessions' },
  { path: h('.config', 'deja'), what: 'deja-vu Privacy-Config — Ausschlussliste und Tombstones' },
];

const AGENTS = [
  'com.bdb.memb.webui', 'com.bdb.synapse', 'com.bdb.openwiki.daemon',
  'com.bdb.ao.daemon', 'com.bdb.agent-workspace', 'com.hybridlabor.bdb-remote', 'com.bdb.plan-canvas',
];
// Linux: the systemd user units the installer writes for the same services.
const LINUX_UNITS = ['com.bdb.memb.webui.service', 'com.bdb.synapse.service', 'com.bdb.openwiki-visualize.service', 'com.bdb.plan-canvas.service'];
// Windows: the installer starts these through a hidden .vbs in the user's
// Startup folder that runs a .bat (names and dirs as written by installer.js).
const WIN_STARTUP = [
  { label: 'plan-canvas', vbsName: 'com.bdb.plan-canvas.vbs', batDir: '.agents', batName: 'run-plan-canvas.bat' },
  { label: 'synapse', vbsName: 'com.bdb.synapse.vbs', batDir: '.synapse', batName: 'run-synapse.bat' },
  { label: 'openwiki-visualizer', vbsName: 'com.bdb.openwiki-visualize.vbs', batDir: '.openwiki', batName: 'run-openwiki-visualize.bat' },
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
    try { return JSON.parse(readFileSync(opts.manifestPath || MANIFEST, 'utf8')); } catch { return null; }
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
      const bat = path.join(home, s.batDir, s.batName);
      if (existsSync(vbs) && existsSync(bat)) agents.push({ label: s.label, vbs, bat });
    }
  }

  let installedModules = [];
  try { installedModules = JSON.parse(readFileSync(path.join(home, '.agents', '.bdb-manifest.json'), 'utf8')).installedModules || []; } catch { /* no record */ }
  const manifestPaths = Object.keys(manifest || {});
  const modules = MODULE_DIRS
    .filter((m) => existsSync(m.path) && ((m.id && installedModules.includes(m.id)) || manifestPaths.some((p) => p.startsWith(m.path + path.sep))))
    .map((m) => m.path);
  const legacy = LEGACY_MARKERS.filter(existsSync);
  const data = PURGE ? DATA_PATHS.filter((d) => existsSync(d.path)) : [];

  const codenotch = cn.planCodenotchUninstall({ stateFile: cn.stateFilePath(HOME) });

  return { manifest, ours, edited, gone, agents, modules, legacy, data, codenotch, keptCommands };
}

function describe(p) {
  const { manifest, ours, edited, gone, agents, modules, legacy, data } = p;

  if (!manifest) {
    console.log('Kein Installations-Manifest unter ' + tilde(MANIFEST) + '.');
    console.log('Ohne das lässt sich nicht sagen, welche Datei von AOS stammt — es wird nichts gelöscht.');
    console.log('Betroffen wären sonst: ~/.claude/skills, ~/.gemini/config/skills, ~/.codex/skills, ~/.agents/');
    return false;
  }

  console.log(`\nManifest: ${Object.keys(manifest).length} Dateien erfasst`);
  console.log(`  ${String(ours.length).padStart(5)}  unverändert seit der Installation → werden entfernt`);
  console.log(`  ${String(edited.length).padStart(5)}  nach der Installation bearbeitet → erst .bak, dann entfernt`);
  console.log(`  ${String(gone.length).padStart(5)}  bereits nicht mehr vorhanden`);

  if (edited.length) {
    console.log('\n  bearbeitet:');
    for (const f of edited.slice(0, 8)) console.log(`    ${tilde(f)}`);
    if (edited.length > 8) console.log(`    … und ${edited.length - 8} weitere`);
  }

  if (p.keptCommands.length) {
    console.log(`\nOpenCode-Commands, die nach der Installation bearbeitet wurden, bleiben (${p.keptCommands.length}):`);
    for (const f of p.keptCommands) console.log(`    ${tilde(f)}`);
  }

  if (agents.length) {
    console.log(`\nHintergrunddienste (${agents.length}): ${agents.map((a) => a.label).join(', ')}`);
  }
  if (modules.length) {
    console.log('\nModule:');
    for (const m of modules) console.log(`    ${tilde(m)}`);
  }
  if (legacy.length) {
    console.log(`\nInstallations-Marker (${legacy.length}) -- ohne diese hält die nächste`);
    console.log('  Installation AOS für bereits aktuell installiert:');
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
    console.log('\nRegistrierungen, die auf AOS-Skripte zeigen:');
    for (const l of [...regLines, ...cxLines, ...agyLines]) console.log(`    ${l}`);
  }

  console.log('\nBleibt erhalten:');
  if (!PURGE) for (const d of DATA_PATHS.filter((d) => existsSync(d.path))) console.log(`    ${tilde(d.path).padEnd(18)} ${d.what}`);
  console.log('    jede Datei ohne Manifest-Eintrag — eigene Skills, fremde Hooks, alles Selbstgeschriebene');

  if (data.length) {
    console.log('\n\x1b[31mWIRD GELÖSCHT (--purge):\x1b[0m');
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
async function execute(p) {
  const { ours, edited, agents, modules, legacy, data, codenotch } = p;
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  let removed = 0, backed = 0;

  for (const a of agents) {
    if (a.vbs) {
      // Windows: the .bat loops (`goto loop`), so kill the processes running it
      // before anything else — delete the bat first, then the vbs, so a cmd
      // between iterations finds no script to restart. Match the exact bat file
      // name in the command line, never a generic word like "node".
      try {
        execFileSync('powershell', ['-NoProfile', '-Command',
          `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${path.basename(a.bat)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
        ], { stdio: 'ignore' });
      } catch { /* nothing running or powershell unavailable */ }
      try { rmSync(a.bat); } catch { /* already gone */ }
      try { rmSync(a.vbs); } catch { /* already gone */ }
      continue;
    }
    if (a.unit) {
      try { execFileSync('systemctl', ['--user', 'disable', '--now', a.label], { stdio: 'ignore' }); } catch { /* not loaded */ }
      try { rmSync(a.unit); } catch { /* already gone */ }
      continue;
    }
    try { execFileSync('launchctl', ['unload', a.plist], { stdio: 'ignore' }); } catch { /* not loaded */ }
    try { rmSync(a.plist); } catch { /* already gone */ }
  }
  if (agents.length) console.log(`  ${agents.length} Dienste gestoppt und entfernt`);

  for (const f of edited) {
    try { copyFileSync(f, `${f}.${stamp}.bak`); backed++; } catch { /* unreadable */ }
  }
  for (const f of [...ours, ...edited]) {
    try { rmSync(f); removed++; } catch { /* already gone */ }
  }
  console.log(`  ${removed} Dateien entfernt, ${backed} vorher gesichert`);

  const ruleFiles = [
    h('CLAUDE.md'), h('AGENTS.md'), h('.github', 'copilot-instructions.md'),
    h('.codex-plugin', 'system.md'), h('.gemini', 'RULES.md'), h('.gemini', 'GEMINI.md'),
  ];
  for (const f of ruleFiles.filter(existsSync)) {
    try {
      const text = readFileSync(f, 'utf8');
      const stripped = stripRoutingBlock(stripDestructiveBlock(text));
      if (stripped === text) continue;
      writeFileSync(f, stripped);
      console.log(`  Regelblöcke aus ${tilde(f)} entfernt`);
    } catch { console.log(`  ${tilde(f)} nicht lesbar — Regelblöcke von Hand prüfen`); }
  }

  for (const m of modules) { try { rmSync(m, { recursive: true, force: true }); } catch { /* in use */ } }
  if (modules.length) console.log(`  ${modules.length} Module entfernt`);

  const DEJA_PKG = '@vshulcz/deja-vu';
  const dejaByAos = (ur.readRecords(HOME).npmGlobal || []).includes(DEJA_PKG);
  if (dejaByAos) {
    try {
      execFileSync('npm', ['uninstall', '-g', DEJA_PKG], { stdio: 'ignore', shell: process.platform === 'win32' });
      ur.forgetNpmGlobal(HOME, DEJA_PKG);
      console.log('  deja-vu (npm) entfernt');
    } catch {
      console.log(`  deja-vu nicht per npm entfernt — von Hand entfernen: npm uninstall -g ${DEJA_PKG}`);
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
      const cfg = JSON.parse(readFileSync(f, 'utf8'));
      if (dejaByAos && cfg.mcpServers && cfg.mcpServers.deja) {
        delete cfg.mcpServers.deja;
        writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
        console.log(`  deja-Eintrag aus ${tilde(f)} entfernt`);
      }
      // Rust + Tauri package: only the entry AOS writes ({command: tauri-pilot, args: [mcp]}) leaves.
      const tp = cfg.mcpServers && cfg.mcpServers['tauri-pilot'];
      if (tp && tp.command === 'tauri-pilot' && JSON.stringify(tp.args) === '["mcp"]') {
        delete cfg.mcpServers['tauri-pilot'];
        writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
        console.log(`  tauri-pilot-Eintrag aus ${tilde(f)} entfernt`);
      }
    } catch { console.log(`  ${tilde(f)} nicht lesbar — von Hand prüfen`); }
  }

  const opencodeCfg = h('.config', 'opencode', 'opencode.jsonc');
  if (existsSync(opencodeCfg) && /"deja"\s*:/.test(readFileSync(opencodeCfg, 'utf8'))) {
    console.log(`  ${tilde(opencodeCfg)} enthält noch einen deja-Eintrag — von Hand entfernen (JSONC, wird nicht automatisch umgeschrieben)`);
  }
  if (existsSync(opencodeCfg) && /"tauri-pilot"\s*:/.test(readFileSync(opencodeCfg, 'utf8'))) {
    console.log(`  ${tilde(opencodeCfg)} enthält noch einen tauri-pilot-Eintrag — von Hand entfernen (JSONC, wird nicht automatisch umgeschrieben)`);
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
        console.log(`  deja-Tabelle aus ${tilde(codexToml)} entfernt`);
      }
    } catch { console.log(`  ${tilde(codexToml)} nicht lesbar — von Hand prüfen`); }
  }

  if (codenotch) {
    const r = cn.uninstallCodenotch(codenotch, { stateFile: cn.stateFilePath(HOME) });
    console.log(`  Codenotch: ${r === 'remove' ? 'removed' : r === 'keep' ? 'kept, not the recorded build' : r === 'error' ? 'uninstaller failed, left in place' : 'already gone'}`);
  }

  agyPlugin.uninstall({ home: HOME, dryRun: DRY });

  // Fleet mod, MCP gateway, hub service and Rust + Tauri have their own registrations; gateway and hub only when installed.
  for (const id of ['fleet', 'gateway', 'hub', 'rustauri']) {
    const pkg = pk.registry.find((x) => x.id === id);
    try {
      const c = { home: HOME, dryRun: DRY };
      if (!['fleet', 'rustauri'].includes(id) && !(await pkg.detect(c)).installed) continue;
      const r = await pkg.uninstall(c);
      if (r && r.error) console.log(`  ${pkg.name}: ${r.error}`);
      else if (r && (r.changed || !['fleet', 'rustauri'].includes(id))) console.log(`  ${pkg.name} entfernt`);
    } catch (e) { console.log(`  ${pkg.name}: ${e.message} — von Hand prüfen`); }
  }

  // A2A MCP entries (agy + Cursor): only the AOS-owned ones leave the harness
  // configs, each file backed up first (writeConfigWithBackup inside).
  try {
    const cleanedA2a = installer.removeAosA2aEntries({ targetHome: HOME });
    for (const f of cleanedA2a) console.log(`  A2A-MCP-Eintrag aus ${tilde(f)} entfernt`);
  } catch (e) { console.log(`  A2A-MCP-Einträge konnten nicht geprüft werden: ${e.message}`); }

  for (const l of legacy) { try { rmSync(l); } catch { /* already gone */ } }
  if (legacy.length) console.log(`  ${legacy.length} Installations-Marker entfernt`);

  for (const l of ur.reverseRegistrations({ home: HOME, runner: pm.defaultCliRunner })) console.log(`  ${l}`);

  const reg = pm.readState(HOME).registered.claudecode;
  if (reg) {
    const r = pm.deregisterClaude({ home: HOME, record: reg });
    if (r.changed) console.log(`  bdb-aos Plugin-Registrierung aus settings.json entfernt${reg.replaced ? ` (externer Marketplace ${reg.replaced.key} wiederhergestellt)` : ''}`);
  }

  const cx = cp.uninstallCodexPlugin({ home: HOME });
  for (const l of cx.lines) console.log(`  ${l}`);

  // Only the BDB hook entries leave settings.json; everything else in it is
  // the user's and must survive an uninstall exactly as it survives an install.
  const settings = path.join(pm.claudeDir(HOME), 'settings.json');
  if (existsSync(settings)) {
    try {
      const s = JSON.parse(readFileSync(settings, 'utf8'));
      const bdb = profile.HOOK_SCRIPTS;
      let touched = false;
      for (const [event, entries] of Object.entries(s.hooks || {})) {
        const kept = entries.filter((e) => !(e.hooks || []).some((x) => bdb.some((n) => String(x.command).includes(n))));
        if (kept.length !== entries.length) { touched = true; s.hooks[event] = kept; }
        if (!kept.length) delete s.hooks[event];
      }
      if (touched) {
        writeFileSync(settings, JSON.stringify(s, null, 2) + '\n');
        console.log('  BDB-Hooks aus settings.json entfernt, alles andere unverändert');
      }
    } catch { console.log('  settings.json nicht lesbar — von Hand prüfen'); }
  }

  for (const d of data) {
    try { rmSync(d.path, { recursive: true, force: true }); console.log(`  \x1b[31mgelöscht:\x1b[0m ${tilde(d.path)}`); }
    catch (e) { console.log(`  konnte ${tilde(d.path)} nicht löschen: ${e.message}`); }
  }

  for (const f of [MANIFEST, h('.agents', '.bdb-manifest.json')]) {
    try { rmSync(f); } catch { /* already gone */ }
  }
  pm.retireState(HOME);
  ur.retireRecords(HOME);
}

// ---------------------------------------------------------------------- main
// plan() is exported for tests; the CLI flow below only runs when this file is
// the entry script.
export { plan };

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
    if (!r.dirs.length) { console.log('Keine Plugin-Migrations-Sicherung gefunden.'); process.exit(1); }
    console.log(`  ${r.files.length} Dateien aus ${r.dirs.length} Sicherung(en) wiederhergestellt, im Install-Manifest erfasst`);
    console.log('Vorhandene Dateien wurden nicht überschrieben.');
    if (r.deregistered) console.log('  bdb-aos Plugin-Registrierung entfernt, damit die Skills nicht doppelt geladen werden. Setze AOS_PLUGIN_MIGRATION=off, damit der Installer sie nicht erneut entfernt.');
    else if (r.files.length && r.stillEnabled) console.log('  WARNUNG: das bdb-aos Plugin ist weiterhin aktiv, die Skills erscheinen doppelt. Plugin in Claude Code deaktivieren und AOS_PLUGIN_MIGRATION=off setzen.');
    process.exit(0);
  }

  const p = plan();
  console.log(PURGE ? '\x1b[31mAOS UNINSTALL — PURGE\x1b[0m' : 'AOS Uninstall');
  if (!describe(p)) process.exit(1);

  if (DRY) {
    console.log('\n[dry-run] Es wurde nichts verändert.');
    return;
  }

  if (!YES) {
    if ((await ask('\nFortfahren? [ja/nein] ')).toLowerCase() !== 'ja') {
      console.log('Abgebrochen. Nichts verändert.');
      return;
    }
    if (PURGE) {
      console.log('\n\x1b[31mDer zweite Schritt löscht das Gedächtnis und die Zugangsdaten unwiderruflich.\x1b[0m');
      if ((await ask('Zum Bestätigen PURGE eingeben: ')).trim() !== 'PURGE') {
        console.log('Abgebrochen. Nichts verändert.');
        return;
      }
    }
  }

  console.log('');
  await execute(p);
  console.log('\nFertig. Neu einrichten mit: npx -y @hybridlabor-api/aos@latest');
}
