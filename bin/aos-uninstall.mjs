#!/usr/bin/env node
// Remove AOS from this machine.
//
//   aos-uninstall              what AOS installed; your data stays
//   aos-uninstall --purge      also the memory store, wikis and credentials
//   aos-uninstall --dry-run    list everything, delete nothing
//   aos-uninstall --yes        skip the confirmations (CI only)
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

const HOME = os.homedir();
const h = (...p) => path.join(HOME, ...p);
const tilde = (p) => p.replace(HOME, '~');

const PURGE = process.argv.includes('--purge');
const DRY = process.argv.includes('--dry-run');
const YES = process.argv.includes('--yes');

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
];

const AGENTS = [
  'com.bdb.memb.webui', 'com.bdb.synapse', 'com.bdb.openwiki.daemon',
  'com.bdb.ao.daemon', 'com.bdb.agent-workspace', 'com.hybridlabor.bdb-remote',
];

const MODULE_DIRS = ['memB', 'bdb-synapse', 'bdb-os-remote', 'bdb-dev-creator-extension',
  'bdb-dev-tool-installer', 'bdb-os-agent-workspace'].map((m) => h('.agents', m));

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

  const agents = AGENTS
    .map((label) => ({ label, plist: h('Library', 'LaunchAgents', `${label}.plist`) }))
    .filter((a) => existsSync(a.plist));

  const modules = MODULE_DIRS.filter(existsSync);
  const data = PURGE ? DATA_PATHS.filter((d) => existsSync(d.path)) : [];

  return { manifest, ours, edited, gone, agents, modules, data };
}

function describe(p) {
  const { manifest, ours, edited, gone, agents, modules, data } = p;

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

  if (agents.length) {
    console.log(`\nHintergrunddienste (${agents.length}): ${agents.map((a) => a.label).join(', ')}`);
  }
  if (modules.length) {
    console.log('\nModule:');
    for (const m of modules) console.log(`    ${tilde(m)}`);
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
  const { ours, edited, agents, modules, data } = p;
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

  // Only the BDB hook entries leave settings.json; everything else in it is
  // the user's and must survive an uninstall exactly as it survives an install.
  const settings = h('.claude', 'settings.json');
  if (existsSync(settings)) {
    try {
      const s = JSON.parse(readFileSync(settings, 'utf8'));
      const bdb = ['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs'];
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
}

// ---------------------------------------------------------------------- main
const ask = async (q) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(q)).trim();
  rl.close();
  return a;
};

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
