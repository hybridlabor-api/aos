// Pack installs and removals for `aos store install --pack` / `aos store remove --pack`.
// Offline by construction: every skill is copied from the installer's local library
// (~/.aos/library/skills), falling back to the installed package's own skills dir. Removal
// never deletes: a removed skill dir is renamed aside under ~/.aos/store/removed/, and only
// copies AOS itself put there (store log entry or byte-exact shipped copy) are touched —
// a user's own skill is never a store copy and never matches byte-exactly, so it stays.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  findItem, installWithBackup, appendInstallLog, readAosFiles,
  fileTargets, planSkillFiles, aosInstalledExact,
  targetsFor as sharedTargetsFor, globalRoots, freshLibraryDir, aosSource as buildAosSource,
} from './store-shared.mjs';

const require = createRequire(import.meta.url);
const skillPacks = require('./skill-packs.js');
const v5Profile = require('./v5/profile.js');
const { storeProtectedDirs } = require('./retired-skills.js');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
const storeIso = () => new Date().toISOString().replace(/[:.]/g, '-');

function packageVersion(root) {
  try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || ''; } catch { return ''; }
}

// Pack definitions from the freshest source available: the library index (written by the
// installer) when it matches the package version, else the package's own skill-packs.json.
export function loadPackDefs(root = ROOT, home = homedir()) {
  const library = freshLibraryDir(root, packageVersion(root));
  if (library) {
    try {
      const idx = JSON.parse(readFileSync(join(library, 'index.json'), 'utf8'));
      if (idx.packs && typeof idx.packs === 'object') return idx.packs;
    } catch { /* fall through to the package */ }
  }
  return skillPacks.loadPacks(root).packs || {};
}

export function knownPack(name, root = ROOT, home = homedir()) {
  return NAME_RE.test(String(name || '')) && Object.hasOwn(loadPackDefs(root, home), name);
}

// Skill names of one pack; a "groups" pack contributes every group flattened.
export function packSkillNames(name, root = ROOT, home = homedir()) {
  if (!NAME_RE.test(String(name || ''))) throw new Error(`Invalid pack name: ${name}`);
  const defs = loadPackDefs(root, home);
  if (!Object.hasOwn(defs, name)) {
    throw new Error(`Unknown pack: ${name}. Known: ${Object.keys(defs).join(', ') || '(none)'}.`);
  }
  const def = defs[name];
  if (Array.isArray(def.skills)) return [...def.skills];
  if (def.groups && typeof def.groups === 'object') return [...new Set(Object.values(def.groups).flat())];
  return [];
}

// The aos source of the running package (library preferred when fresh), rebuilt per call:
// pack operations are rare and the index build is lazy about per-file hashes.
export function aosSources(root = ROOT) {
  const version = packageVersion(root);
  const library = freshLibraryDir(root, version);
  const src = buildAosSource(root, version, library ? join(library, 'skills') : null);
  if (library) src.from = 'library';
  return [src];
}

// One skill from the aos source into every harness skill dir (or the project's). Mirrors the
// CLI's single-skill install for the local branch: staged writes, rename-backup, install log.
export function installSkillFromLibrary(sources, name, { home = homedir(), project = false, dryRun = false, pack = null } = {}) {
  const found = findItem(sources, name);
  if (!found) throw new Error(`Skill not found in the local library or package: ${name}`);
  if (found.src.id !== 'aos') throw new Error(`'${name}' is not an AOS library skill (source: ${found.src.label})`);
  const item = found.item;
  const files = readAosFiles(item);
  const writes = [];
  for (const target of sharedTargetsFor('skills', name, { project, home })) {
    if (aosInstalledExact(item, target)) continue;
    writes.push({ type: 'dir', target, plan: planSkillFiles(target, files) });
  }
  if (dryRun) {
    for (const w of writes) console.log(`[dry-run] write ${w.target}`);
    return { name, written: 0 };
  }
  if (!writes.length) return { name, written: 0, already: true };
  const written = installWithBackup({ writes, home });
  appendInstallLog(home, {
    ts: new Date().toISOString(),
    name,
    kind: 'skill',
    source: 'aos',
    from: found.src.from || 'package',
    ...(pack ? { pack } : {}),
    scope: project ? 'project' : 'global',
    targets: written.targets,
    disks: written.disks,
    backups: written.backups,
  });
  return { name, written: written.targets.length };
}

// Installs every skill of a pack. Returns { installed: [...names], skipped: [{ name, reason }] }.
export function installPack(name, { home = homedir(), root = ROOT, project = false, dryRun = false } = {}) {
  const sources = aosSources(root);
  const installed = [];
  const skipped = [];
  for (const skill of packSkillNames(name, root, home)) {
    try {
      const res = installSkillFromLibrary(sources, skill, { home, project, dryRun, pack: name });
      if (res.already) skipped.push({ name: skill, reason: 'already installed' });
      else installed.push(skill);
    } catch (e) {
      skipped.push({ name: skill, reason: e.message });
    }
  }
  if (!dryRun) markPackSelected(home, name);
  return { installed, skipped };
}

// Records the pack in the v5 settings — but only on top of an existing explicit selection.
// With no stored selection (null = "every skill"), writing one would start deselecting the
// rest, which must never happen as a side effect of installing one more pack.
export function markPackSelected(home, name) {
  try {
    const st = v5Profile.readSettings(home, () => {});
    if (!Array.isArray(st.packs)) return false;
    if (st.packs.includes(name)) return false;
    v5Profile.writeSettings(home, { ...st, packs: [...st.packs, name] });
    return true;
  } catch { return false; }
}

// Drops the pack from an existing explicit selection; a missing selection stays untouched.
export function markPackDeselected(home, name) {
  try {
    const st = v5Profile.readSettings(home, () => {});
    if (!Array.isArray(st.packs) || !st.packs.includes(name)) return false;
    v5Profile.writeSettings(home, { ...st, packs: st.packs.filter((p) => p !== name) });
    return true;
  } catch { return false; }
}

function dirMatchesShippedCopy(dir, item) {
  if (!item || !item.files?.length) return false;
  try {
    const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
    return count(dir) === item.files.length && aosInstalledExact(item, join(dir, 'SKILL.md'));
  } catch { return false; }
}

// Removes every harness-dir copy of a pack's skills by renaming the dirs aside (never a
// recursive delete). A copy is only touched when the store log proves AOS wrote it, or when
// it is byte-identical to the shipped copy; anything else is reported and kept.
export function removePack(name, { home = homedir(), root = ROOT, project = false, dryRun = false } = {}) {
  const sources = aosSources(root);
  const backupBase = join(home, '.aos', 'store', 'removed', `${name}-${storeIso()}`);
  const removed = [];
  const kept = [];
  const roots = project ? [join(process.cwd(), 'skills')] : globalRoots('skills', home);
  const logged = storeProtectedDirs(home);
  for (const skill of packSkillNames(name, root, home)) {
    let item = null;
    try { item = findItem(sources, skill)?.item || null; } catch { /* collision or absent: only the log rule can own it */ }
    for (const rootDir of roots) {
      const dir = join(rootDir, skill);
      if (!existsSync(dir)) continue;
      const owned = logged.has(resolve(dir)) && dirMatchesShippedCopy(dir, item);
      if (!owned) {
        kept.push({ name: skill, dir, reason: 'not a store-logged copy of the shipped skill (not in the install log or content differs); kept' });
        continue;
      }
      if (dryRun) { removed.push({ name: skill, dir }); continue; }
      const dest = join(backupBase, rootDir.replace(/[^A-Za-z0-9]+/g, '_'), skill);
      try {
        mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
        renameSync(dir, dest);
        removed.push({ name: skill, dir, backup: dest });
      } catch (e) {
        kept.push({ name: skill, dir, reason: `rename failed: ${e.message}` });
      }
    }
  }
  if (!dryRun) {
    markPackDeselected(home, name);
    if (removed.length) {
      try {
        appendInstallLog(home, {
          ts: new Date().toISOString(),
          kind: 'pack-remove',
          pack: name,
          scope: project ? 'project' : 'global',
          removed: removed.map((r) => r.dir),
          backups: removed.map((r) => r.backup),
        });
      } catch { /* the removal itself already succeeded */ }
    }
  }
  return { removed, kept };
}

// What `aos store packs` prints: pack names with descriptions and skill counts.
export function packOverview(root = ROOT, home = homedir()) {
  return Object.entries(loadPackDefs(root, home)).map(([name, def]) => ({
    name,
    description: def.description || '',
    external: !!def.external,
    skills: Array.isArray(def.skills) ? def.skills.length : Object.values(def.groups || {}).flat().length,
  }));
}
