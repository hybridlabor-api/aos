import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const MAX_FILES = 200;
export const MAX_BYTES = 5 * 1024 * 1024;

function safeRel(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\\0]/.test(path)
    || path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`Unsafe file path in store index: ${JSON.stringify(path)}`);
  }
}

export function validateFiles(files) {
  if (files.length > MAX_FILES) throw new Error(`Too many files (${files.length} > ${MAX_FILES})`);
  let total = 0;
  const seen = new Set();
  for (const f of files) {
    safeRel(f.path);
    if (seen.has(f.path)) throw new Error(`Duplicate file path: ${f.path}`);
    seen.add(f.path);
    if (f.size !== undefined) {
      if (!Number.isInteger(f.size) || f.size < 0) throw new Error(`Invalid size for ${f.path}`);
      total += f.size;
    }
  }
  if (total > MAX_BYTES) throw new Error(`Skill too large (${total} > ${MAX_BYTES} bytes)`);
  return files;
}

// True when every file of the item exists (size checked when the index has it); no hashing.
export function isInstalled(type, name, item, opts) {
  const targets = targetsFor(type, name, opts);
  if (type !== 'skills' || !(item.files?.length > 1)) return targets.every(existsSync);
  return targets.every((t) => fileTargets(t, item.files).every((p, i) => {
    try { const st = statSync(p); return st.isFile() && st.size === item.files[i].size; } catch { return false; }
  }));
}

export const fileTargets = (skillMd, files) => files.map((f) => join(dirname(skillMd), ...f.path.split('/')));

// Downloads and verifies everything in memory; nothing touches disk.
export async function fetchSkillFiles(rawBase, commit, upstreamDir, files) {
  validateFiles(files);
  const out = [];
  let total = 0;
  for (const f of files) {
    const url = `${rawBase}/${commit}/${upstreamDir}/${f.path}`;
    const res = await fetch(url, { headers: { 'user-agent': 'aos-store' } });
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    const data = Buffer.from(await res.arrayBuffer());
    total += data.length;
    if (total > MAX_BYTES) throw new Error(`Skill too large (> ${MAX_BYTES} bytes)`);
    if (f.size !== undefined && data.length !== f.size) throw new Error(`Size mismatch for ${f.path}: expected ${f.size}, got ${data.length}`);
    const digest = createHash('sha256').update(data).digest('hex');
    if (digest !== f.sha256) throw new Error(`SHA-256 mismatch for ${f.path}: expected ${f.sha256}, got ${digest}`);
    out.push({ ...f, data });
  }
  return out;
}

function assertNoSymlink(path) {
  try { if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${path}`); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}

// Checks every destination; throws on an unsafe path and touches nothing.
export function planSkillFiles(skillMd, files) {
  const dir = resolve(dirname(skillMd));
  return files.map((f) => {
    safeRel(f.path);
    const dest = resolve(dir, ...f.path.split('/'));
    if (!dest.startsWith(dir + sep)) throw new Error(`Path escapes skill dir: ${f.path}`);
    for (let p = dest; p !== dir; p = dirname(p)) assertNoSymlink(p);
    assertNoSymlink(dir);
    return { ...f, dest };
  });
}

export function writePlan(plan) {
  for (const f of plan) {
    mkdirSync(dirname(f.dest), { recursive: true });
    writeFileSync(f.dest, f.data);
    if (f.exec) chmodSync(f.dest, 0o755);
  }
  return plan.map((f) => f.dest);
}

export const writeSkillFiles = (skillMd, files) => writePlan(planSkillFiles(skillMd, files));

const RAW_BASE_RE = /^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+$/;
const ECC_SOURCE = {
  id: 'ecc', label: 'ECC', raw_base: 'https://raw.githubusercontent.com/affaan-m/ECC',
  license: 'MIT', copyright: 'Copyright (c) 2026 Affaan Mustafa', third_party: true,
};

// Test overrides: AOS_STORE_INDEX / AOS_STORE_RAW_BASE (ECC), AOS_STORE_INDEX_SCENARIO / AOS_STORE_RAW_BASE_SCENARIO (Scenario).
export function loadSources(root, env = process.env) {
  const specs = [
    { file: env.AOS_STORE_INDEX || join(root, 'lib', 'ecc-store-index.json'), base: env.AOS_STORE_RAW_BASE, fallback: ECC_SOURCE },
    { file: env.AOS_STORE_INDEX_SCENARIO || join(root, 'lib', 'scenario-store-index.json'), base: env.AOS_STORE_RAW_BASE_SCENARIO },
  ];
  return specs.map(({ file, base, fallback }) => {
    const index = JSON.parse(readFileSync(file, 'utf8'));
    if (!index.pinned_commit || !index.skills || !index.subagents) throw new Error(`Invalid AOS store index: ${file}`);
    const meta = { ...fallback, ...index.source };
    if (!meta.id || !meta.label) throw new Error(`Store index has no source descriptor: ${file}`);
    if (!base && !RAW_BASE_RE.test(meta.raw_base || '')) throw new Error(`Untrusted raw_base in ${file}: ${meta.raw_base}`);
    return { ...meta, raw_base: (base || meta.raw_base).replace(/\/+$/, ''), pinned_commit: index.pinned_commit, index };
  });
}

export function findItems(sources, name) {
  const found = [];
  for (const src of sources) {
    for (const type of ['skills', 'subagents']) {
      if (src.index[type]?.[name]) found.push({ name, item: src.index[type][name], type, src });
    }
  }
  return found;
}

export function findItem(sources, name) {
  const found = findItems(sources, name);
  if (found.length > 1) {
    throw new Error(`Name collision: '${name}' exists in ${found.map((f) => f.src.label).join(' and ')}; refusing to pick one or overwrite`);
  }
  return found[0] || null;
}

// The item plus the skills it requires (same source), dependencies first.
export function installPlan(sources, found) {
  const plan = [];
  const visit = (entry, chain) => {
    if (chain.includes(entry.name)) throw new Error(`Circular requires: ${[...chain, entry.name].join(' -> ')}`);
    for (const dep of entry.item.requires || []) {
      const hit = findItem(sources, dep);
      if (!hit || hit.src !== entry.src || hit.type !== 'skills') throw new Error(`${entry.name} requires '${dep}', which is not available in ${entry.src.label}`);
      visit(hit, [...chain, entry.name]);
    }
    if (!plan.some((p) => p.name === entry.name)) plan.push(entry);
  };
  visit(found, []);
  return plan;
}

export function planSummary(plan) {
  const all = plan.flatMap((p) => (p.item.files || []).map((f) => ({ ...f, skill: p.name })));
  const bridge = plan.flatMap((p) => (p.item.execBridgeFiles || []).map((f) => ({ skill: p.name, ...f })));
  return {
    skills: plan.map((p) => p.name),
    requires: plan.slice(0, -1).map((p) => p.name),
    fileCount: all.length || plan.length,
    totalSize: all.reduce((n, f) => n + f.size, 0),
    scriptCount: plan.reduce((n, p) => n + (p.item.scriptCount || 0), 0),
    hasScripts: plan.some((p) => p.item.hasScripts),
    execBridge: plan.some((p) => p.item.execBridge),
    execBridgeFiles: bridge,
    software: [...new Set(plan.flatMap((p) => p.item.software || []))],
  };
}

export function localSkills(root) {
  const found = new Map();
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name === 'SKILL.md') found.set(basename(dirname(fullPath)), fullPath);
    }
  };
  visit(join(root, 'skills'));
  return found;
}

export function localAgents(root) {
  const found = new Map();
  for (const dir of [join(root, '.claude', 'agents'), join(root, '.agents', 'agents'), join(root, 'agents')]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) found.set(entry.replace(/\.md$/i, ''), join(dir, entry));
  }
  return found;
}

// ============================================================================
// WP4: rename-backup install, installs.jsonl log, validated rollback.
// Nothing in this module ever deletes: a failure parks artifacts under
// .aos-failed-<ISO> / restores the backups verbatim.
// ============================================================================

// ISO = YYYY-MM-DDTHH-MM-SS-mmmZ (the plan's install/backup/failed suffix).
export const storeIso = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-');
export const ISO_SUFFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
export const installsLogPath = (home = homedir()) => join(home, '.aos', 'store', 'installs.jsonl');
export const STORE_NAME_RE = /^[A-Za-z0-9_-]+$/;

// A unique parked path: the base name, then -1, -2, ... on a timestamp clash.
function parkPath(base, suffix) {
  let candidate = `${base}.${suffix}`;
  for (let i = 1; lstatExists(candidate); i++) candidate = `${base}.${suffix}-${i}`;
  return candidate;
}

const lstatExists = (p) => {
  try { lstatSync(p); return true; } catch { return false; }
};

export function appendInstallLog(home, line) {
  const file = installsLogPath(home);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
  return file;
}

export function readInstallsLog(home) {
  const file = installsLogPath(home);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return { name: null, corrupt: true }; }
    });
}

export function readInstallsLogRaw(home) {
  const file = installsLogPath(home);
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
}

//Canonicalize a target for rollback validation: the parent dir is realpathed
// (symlinks in the fixture roots collapse), the basename must be identical.
const canonicalTarget = (t) => {
  if (typeof t !== 'string') return null;
  let parent;
  try { parent = realpathSync(dirname(t)); } catch { parent = resolve(dirname(t)); }
  return join(parent, basename(t));
};

/**
 * Writes a planned install with rename-backup semantics.
 * writes: [{ type:'file', target, data, exec? } | { type:'dir', target (SKILL.md), plan }]
 * The `type:'dir'` unit backs up and rewrites the whole skill directory
 * (dirname of the SKILL.md target). Returns { targets, backups, iso }.
 * Every byte of `data`/`plan` must be fetched and hash-verified BEFORE this
 * is called (all files verified in memory before the first write).
 */
export function installWithBackup({ writes, home = homedir() }) {
  if (!Array.isArray(writes) || !writes.length) throw new Error('installWithBackup: empty write plan');
  const iso = storeIso();
  const targets = [];
  const disks = [];
  const backups = [];
  const backupMap = new Map(); // disk path -> backup path (existing ones only)
  const written = []; // units already written (write phase)
  const renameAway = (disk, tag) => {
    assertNoSymlink(disk);
    const to = parkPath(disk, tag);
    renameSync(disk, to);
    return to;
  };
  try {
    // Backup phase: each existing target (file or skill dir) renamed aside.
    backupMap.clear();
    for (const w of writes) {
      const disk = w.type === 'file' ? w.target : dirname(w.target);
      if (lstatExists(disk)) backupMap.set(disk, renameAway(disk, `aos-bak-${iso}`));
    }
    // Write phase.
    for (const w of writes) {
      if (w.type === 'file') {
        mkdirSync(dirname(w.target), { recursive: true });
        writeFileSync(w.target, w.data);
        if (w.exec) chmodSync(w.target, 0o755);
      } else if (w.type === 'dir') {
        writePlan(w.plan);
      } else throw new Error(`installWithBackup: unknown write kind ${JSON.stringify(w.type)}`);
      written.push(w.target);
    }
  } catch (e) {
    // Mid-write failure: nothing is deleted. Written targets are parked, and
    // every already-created backup is renamed back.
    const failIso = storeIso();
    const done = [...backupMap.entries()].reverse();
    for (const w of writes) {
      if (!written.includes(w.target)) continue;
      const disk = w.type === 'file' ? w.target : dirname(w.target);
      if (lstatExists(disk)) {
        renameAway(disk, `aos-failed-${failIso}`);
      }
    }
    const restored = [];
    for (const [disk, backup] of done) {
      if (!lstatExists(backup)) continue;
      if (lstatExists(disk)) renameAway(disk, `aos-failed-${failIso}`);
      renameSync(backup, disk);
      restored.push(disk);
    }
    void restored;
    throw e;
  }
  for (const w of writes) {
    const disk = w.type === 'file' ? w.target : dirname(w.target);
    targets.push(w.target);
    disks.push(disk);
    backups.push(backupMap.get(disk) || null);
  }
  return { targets, disks, backups, iso };
}

export function rollbackInstall({ name, home = homedir(), project = false, cwd = process.cwd() } = {}) {
  if (!STORE_NAME_RE.test(String(name || ''))) throw new Error(`Invalid store name: ${JSON.stringify(name)}`);
  const entries = readInstallsLog(home);
  const hits = entries.filter((e) => e && e.name === name && !e.corrupt);
  if (!hits.length) throw new Error(`No store install entry for '${name}' in ${installsLogPath(home)}`);
  const last = hits[hits.length - 1];
  const type = last.kind === 'agent' ? 'agents'
    : last.kind === 'skill' ? 'skills'
      : null;
  if (!type) throw new Error(`Unknown install kind in log: ${JSON.stringify(last.kind)}`);
  if (!Array.isArray(last.targets) || !last.targets.length) throw new Error('Log entry has no targets; refusing');
  const expected = targetsFor(type, name, { project, cwd }).map(canonicalTarget);
  const expectedSet = new Set(expected);
  const pairs = [];
  // `disks` = the physically renamed paths. For file units that IS the target;
  // for multi-file skills the target is `<root>/skills/<name>/SKILL.md` while
  // the whole skill directory is renamed. When the log has no disks array the
  // targets themselves are the disks (single-file installs). Every disk is
  // validated as strictly as the targets.
  const logged = Array.isArray(last.disks) ? last.disks : last.targets.map(() => undefined);
  const diskPath = (i, t) => {
    const d = logged[i];
    if (d === undefined || d === null || d === '') return t;
    if (typeof d !== 'string') throw new Error(`Rollback aborted: bad disk entry for ${t}`);
    const cd = canonicalTarget(d);
    // A logged disk is either the target itself (file units) or, for dir
    // units, exactly the parent directory installWithBackup renamed away
    // (written.disks = dirname(target)). Both are being validated the same
    // way targets are: canonicalTarget resolves the parent realpath, so
    // both sides see the same resolved path even for /tmp -> /private/tmp.
    if (cd !== canonicalTarget(t) && cd !== canonicalTarget(dirname(t))) {
      throw new Error(`Rollback aborted: logged disk path ${JSON.stringify(d)} does not belong to ${name}`);
    }
    return d;
  };
  for (const t of last.targets) {
    // Membership against canonicalTarget covers both path-escape attempts and
    // non-target siblings (basename check is implicit in the expected set:
    // `<name>/SKILL.md` for skills, `<name>.md` for agents).
    if (typeof t !== 'string' || !expectedSet.has(canonicalTarget(t))) {
      throw new Error(`Rollback aborted: logged target ${JSON.stringify(t)} is not a current target of '${name}'`);
    }
    pairs.push({ target: t, backup: null, disk: diskPath(pairs.length, t) });
  }
  const backups = Array.isArray(last.backups) ? last.backups : [];
  for (let i = 0; i < last.targets.length; i++) {
    const b = backups[i];
    if (b === null || b === undefined) continue;
    const t = last.targets[i];
    const disk = pairs[i].disk;
    if (typeof b !== 'string') throw new Error(`Rollback aborted: bad backup entry for ${t}`);
    if (!b.startsWith(`${disk}.aos-bak-`)) throw new Error(`Rollback aborted: backup ${JSON.stringify(b)} does not match target ${t}`);
    const suffix = b.slice(disk.length + '.aos-bak-'.length);
    if (!ISO_SUFFIX_RE.test(suffix)) throw new Error(`Rollback aborted: backup suffix does not look like an ISO stamp: ${JSON.stringify(suffix)}`);
    if (dirname(b) !== dirname(disk)) throw new Error(`Rollback aborted: backup ${b} is not a sibling of ${disk}`);
    if (!lstatExists(b)) throw new Error(`Rollback aborted: backup ${b} is missing on disk`);
    if (lstatSync(b).isSymbolicLink()) throw new Error(`Rollback aborted: backup ${b} is a symlink`);
    if (lstatExists(disk)) {
      if (lstatSync(disk).isSymbolicLink()) throw new Error(`Rollback aborted: disk ${disk} is a symlink`);
    }
    pairs[i].backup = b;
  }
  const failIso = storeIso();
  const parked = [];
  for (const { target, disk, backup } of pairs) {
    if (!backup) continue;
    if (disk === target) {
      // File-unit pair. For skills the overwritten state is the whole skill
      // directory, so it is parked at the project root level as
      // `<name>.aos-failed-<ISO>` and the sibling file backup is renamed into
      // a freshly rebuilt target directory (the parked backup file moves with
      // its directory, hence the movedBackup path). Agent file units park
      // only the overwritten file itself: the agents root holds unrelated
      // entries that must never be renamed away wholesale.
      if (last.kind === 'skill') {
        const dir = dirname(target);
        let to = null;
        if (lstatExists(dir)) { to = parkPath(dir, `aos-failed-${failIso}`); renameSync(dir, to); parked.push(to); }
        mkdirSync(dir, { recursive: true });
        renameSync(to ? join(to, basename(backup)) : backup, target);
        continue;
      }
      if (lstatExists(disk)) {
        const to = parkPath(disk, `aos-failed-${failIso}`);
        renameSync(disk, to);
        parked.push(to);
      }
      renameSync(backup, target);
      continue;
    }
    // Dir-unit pair: park the overwritten directory, restore the backup dir.
    if (lstatExists(disk)) {
      const to = parkPath(disk, `aos-failed-${failIso}`);
      renameSync(disk, to);
      parked.push(to);
    }
    renameSync(backup, disk);
  }
  return { name, kind: last.kind, scope: last.scope, restored: pairs.filter((p) => p.backup).length, parked };
}

export function globalRoots(type) {
  const home = homedir();
  const sub = type === 'skills' ? 'skills' : 'agents';
  return [
    join(home, '.agents', sub),
    join(home, '.claude', sub),
    join(home, '.codex', sub),
    join(home, '.cursor', sub),
    join(home, '.roo', sub),
    join(home, '.gemini', 'config', sub),
  ];
}

export function targetsFor(type, name, { project = false, cwd = process.cwd() } = {}) {
  if (project) {
    return type === 'skills'
      ? [join(cwd, 'skills', name, 'SKILL.md')]
      : [join(cwd, 'agents', `${name}.md`)];
  }
  return globalRoots(type).map((root) => (type === 'skills'
    ? join(root, name, 'SKILL.md')
    : join(root, `${name}.md`)));
}
