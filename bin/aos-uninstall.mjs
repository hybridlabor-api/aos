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

import { readFileSync, existsSync, rmSync, copyFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const pm = createRequire(import.meta.url)('../lib/plugin-migration.js');
const cn = createRequire(import.meta.url)('../lib/codenotch.js');
const cp = createRequire(import.meta.url)('../lib/codex-plugin-install.js');
const agyPlugin = createRequire(import.meta.url)('../lib/agy-plugin-install.js');
const ur = createRequire(import.meta.url)('../lib/uninstall-records.js');

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

const MODULE_DIRS = ['memB', 'bdb-synapse', 'bdb-os-remote', 'bdb-dev-creator-extension',
  'bdb-hardware-pcb',
  'bdb-dev-tool-installer',
  'bdb-agent-orchestrator',      // AO
  'bdb-os-agent-workspace',      // AO's archived predecessor, if still lying around
  'bdb-dev-optimized-agent-skills', // AOS's own core payload cache, when a "from source" or non-npx run left one behind
].map((m) => h('.agents', m));

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
function plan() {
  const manifest = (() => {
    try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { return null; }
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
    .filter((a) => existsSync(a.plist));

  const modules = MODULE_DIRS.filter(existsSync);
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
function execute(p) {
  const { ours, edited, agents, modules, legacy, data, codenotch } = p;
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  let removed = 0, backed = 0;

  for (const a of agents) {
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

  for (const m of modules) { try { rmSync(m, { recursive: true, force: true }); } catch { /* in use */ } }
  if (modules.length) console.log(`  ${modules.length} Module entfernt`);

  try {
    execFileSync('npm', ['uninstall', '-g', '@vshulcz/deja-vu'], { stdio: 'ignore', shell: process.platform === 'win32' });
    console.log('  deja-vu (npm) entfernt');
  } catch {
    console.log('  deja-vu nicht per npm entfernt — von Hand entfernen: npm uninstall -g @vshulcz/deja-vu');
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
      if (cfg.mcpServers && cfg.mcpServers.deja) {
        delete cfg.mcpServers.deja;
        writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
        console.log(`  deja-Eintrag aus ${tilde(f)} entfernt`);
      }
    } catch { console.log(`  ${tilde(f)} nicht lesbar — von Hand prüfen`); }
  }

  const opencodeCfg = h('.config', 'opencode', 'opencode.jsonc');
  if (existsSync(opencodeCfg) && /"deja"\s*:/.test(readFileSync(opencodeCfg, 'utf8'))) {
    console.log(`  ${tilde(opencodeCfg)} enthält noch einen deja-Eintrag — von Hand entfernen (JSONC, wird nicht automatisch umgeschrieben)`);
  }

  const codexToml = h('.codex', 'config.toml');
  if (existsSync(codexToml)) {
    try {
      const raw = readFileSync(codexToml, 'utf8');
      const eol = raw.includes('\r\n') ? '\r\n' : '\n';
      const lines = raw.split(/\r?\n/);
      const i = lines.findIndex((l) => l.trim() === '[mcp_servers.deja]');
      if (i !== -1) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trimStart().startsWith('[') && lines[j].trim() !== '# AOS:MCP:END') j++;
        lines.splice(i, j - i);
        writeFileSync(codexToml, lines.join(eol));
        console.log(`  deja-Tabelle aus ${tilde(codexToml)} entfernt`);
      }
    } catch { console.log(`  ${tilde(codexToml)} nicht lesbar — von Hand prüfen`); }
  }

  if (codenotch) {
    const r = cn.uninstallCodenotch(codenotch, { stateFile: cn.stateFilePath(HOME) });
    console.log(`  Codenotch: ${r === 'remove' ? 'removed' : r === 'keep' ? 'kept, not the recorded build' : r === 'error' ? 'uninstaller failed, left in place' : 'already gone'}`);
  }

  agyPlugin.uninstall({ home: HOME, dryRun: DRY });

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
      const bdb = ['go-gate.mjs', 'go-token.mjs', 'go-grant.mjs', 'graph-gate.mjs', 'memb-inject.mjs', 'trail-relay.mjs', 'trail-autostart.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs'];
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
const ask = async (q) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(q)).trim();
  rl.close();
  return a;
};

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
  process.exit(0);
}

if (!YES) {
  if ((await ask('\nFortfahren? [ja/nein] ')).toLowerCase() !== 'ja') {
    console.log('Abgebrochen. Nichts verändert.');
    process.exit(0);
  }
  if (PURGE) {
    console.log('\n\x1b[31mDer zweite Schritt löscht das Gedächtnis und die Zugangsdaten unwiderruflich.\x1b[0m');
    if ((await ask('Zum Bestätigen PURGE eingeben: ')).trim() !== 'PURGE') {
      console.log('Abgebrochen. Nichts verändert.');
      process.exit(0);
    }
  }
}

console.log('');
execute(p);
console.log('\nFertig. Neu einrichten mit: npx -y @hybridlabor-api/aos@latest');
